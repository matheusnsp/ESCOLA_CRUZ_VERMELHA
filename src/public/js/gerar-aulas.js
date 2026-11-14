// Aulas da turma (2026-11-13): "Gerar aulas" (dias da semana + horário + até quando cria as datas de uma vez),
// "Adicionar aula" e remover. gerarAulas é pura (testada no Node); window.admAulas é usada pela "Começar com a IA".
(function (raiz) {
  var HORARIO = /^\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:–|-|às|as|a|até)\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*$/i;
  function normalizarHorario(v) {
    var m = HORARIO.exec(String(v || ''));
    if (!m) return null;
    var h1 = +m[1], h2 = +m[3], m1 = m[2] || '00', m2 = m[4] || '00';
    if (h1 > 23 || h2 > 23 || +m1 > 59 || +m2 > 59) return null;
    var p = function (h, mi) { return (h < 10 ? '0' : '') + h + ':' + mi; };
    return p(h1, m1) + ' – ' + p(h2, m2);
  }
  function dataUTC(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null; // 31/02 não existe
  }
  var iso = function (d) { return d.toISOString().slice(0, 10); };

  // { inicio, ate: 'AAAA-MM-DD', dias: [0=dom..6=sáb], horario } -> { aulas: [{ data, horario }], erro }
  function gerarAulas(o) {
    var i = dataUTC(o && o.inicio), f = dataUTC(o && o.ate);
    var dias = (o && o.dias || []).map(Number);
    var falha = function (erro) { return { aulas: [], erro: erro }; };
    if (!i || !f) return falha('Informe o início e a data final.');
    if (!dias.length) return falha('Marque pelo menos um dia da semana.');
    if (f < i) return falha('A data final é antes do início.');
    var h = normalizarHorario(o.horario);
    if (!h) return falha('Horário no formato 18:00 – 22:00.');
    var aulas = [];
    for (var d = new Date(i); d <= f; d.setUTCDate(d.getUTCDate() + 1)) {
      if (dias.indexOf(d.getUTCDay()) >= 0) aulas.push({ data: iso(d), horario: h });
      if (aulas.length > 60) return falha('Mais de 60 aulas: diminua o período.');
    }
    return { aulas: aulas, erro: null };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { gerarAulas: gerarAulas, normalizarHorario: normalizarHorario }; return; }
  raiz.gerarAulas = gerarAulas;

  function iniciar() {
    var lista = document.getElementById('aulas-lista');
    if (!lista) return;
    var idx = lista.querySelectorAll('.aula-linha').length;
    function linha(data, horario) {
      var div = document.createElement('div');
      div.className = 'aula-linha';
      div.innerHTML = '<input type="date" aria-label="Data da aula"><input type="text" placeholder="18:00 – 22:00" aria-label="Horário da aula">'
        + '<button type="button" class="adm-mini danger btn-remover-aula" aria-label="Remover aula"><i class="fa-solid fa-trash"></i></button>';
      var d = div.querySelector('input[type=date]'), t = div.querySelector('input[type=text]');
      d.name = 'aulas[' + idx + '][data]'; t.name = 'aulas[' + idx + '][horario]'; idx++;
      d.value = data || ''; t.value = horario || '';
      lista.appendChild(div);
      return div;
    }
    function substituir(aulas) {
      lista.textContent = '';
      (aulas || []).forEach(function (a) { linha(a.data, a.horario); });
    }
    var adicionar = document.getElementById('btnAdicionarAula');
    if (adicionar) adicionar.addEventListener('click', function () {
      // Repete o horário da última linha: quase sempre é o mesmo em todas as aulas.
      var hs = lista.querySelectorAll('.aula-linha input[type=text]');
      linha('', hs.length ? hs[hs.length - 1].value : '').querySelector('input[type=date]').focus();
    });
    lista.addEventListener('click', function (e) { var b = e.target.closest('.btn-remover-aula'); if (b) b.closest('.aula-linha').remove(); });

    var caixa = document.querySelector('[data-gerar-aulas]');
    if (caixa) {
      var msg = caixa.querySelector('.gerar-aulas-msg');
      caixa.querySelector('.gerar-aulas-bt').addEventListener('click', function () {
        var form = caixa.closest('form');
        var inicio = form.querySelector('[name=inicioPrevisto]').value;
        var dias = Array.prototype.map.call(caixa.querySelectorAll('input[type=checkbox]:checked'), function (c) { return +c.value; });
        var r = gerarAulas({ inicio: inicio, ate: caixa.querySelector('.gerar-aulas-ate').value, dias: dias, horario: caixa.querySelector('.gerar-aulas-horario').value });
        msg.hidden = false; msg.classList.toggle('erro', !!r.erro);
        if (r.erro) { msg.textContent = r.erro; return; }
        if (!r.aulas.length) { msg.textContent = 'Nenhum dia marcado cai nesse período.'; msg.classList.add('erro'); return; }
        var temAulas = Array.prototype.some.call(lista.querySelectorAll('input[type=date]'), function (d) { return d.value; });
        if (temAulas && !window.confirm('Trocar as aulas que já estão na lista pelas ' + r.aulas.length + ' novas?')) { msg.hidden = true; return; }
        substituir(r.aulas);
        msg.textContent = r.aulas.length + (r.aulas.length === 1 ? ' aula criada' : ' aulas criadas') + '. Confira e salve.';
      });
    }
    raiz.admAulas = { substituir: substituir };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(typeof window !== 'undefined' ? window : this);
