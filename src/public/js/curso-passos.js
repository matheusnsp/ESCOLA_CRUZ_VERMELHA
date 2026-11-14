// Novo curso em 3 passos (2026-11-13). Mostra um passo por vez; "Continuar" confere os campos do passo; só o
// botão "Criar curso" (no passo 3) envia. window.admPassos é usado pelo assistente e pela "Começar com a IA":
//   ir(n)                     vai ao passo n
//   mostrarTudoQueVeio(campos) marca com a etiqueta IA os campos preenchidos e abre "Mais detalhes" se veio algo dele
(function () {
  var form = document.getElementById('cursoNovo');
  if (!form) return;
  var passos = Array.prototype.slice.call(form.querySelectorAll('[data-passo]'));
  var voltar = form.querySelector('[data-passos-voltar]');
  var continuar = form.querySelector('[data-passos-continuar]');
  var criar = form.querySelector('[data-passos-criar]');
  var caixaErro = document.querySelector('[data-passos-erro]');
  var mais = document.getElementById('maisDetalhes');
  var MAIS = ['conteudoProgramatico', 'nomeCertificado', 'certificadoValidade', 'exigeComprovanteSaude', 'ativo'];
  var atual = 1;

  function erro(msg) {
    if (!caixaErro) return;
    caixaErro.hidden = !msg;
    var t = caixaErro.querySelector('span'); if (t) t.textContent = msg || '';
  }
  function ir(n) {
    atual = Math.max(1, Math.min(passos.length, n));
    passos.forEach(function (p) { p.hidden = Number(p.getAttribute('data-passo')) !== atual; });
    document.querySelectorAll('[data-ind]').forEach(function (i) {
      var k = Number(i.getAttribute('data-ind'));
      i.classList.toggle('on', k === atual); i.classList.toggle('feito', k < atual);
    });
    voltar.hidden = atual === 1;
    continuar.hidden = atual === passos.length;
    criar.hidden = atual !== passos.length;
  }
  function campo(n) { return form.querySelector('[name="' + n + '"]'); }
  function vazio(n) { var e = campo(n); return !e || !String(e.value).trim(); }
  function numeroRuim(n) { var e = campo(n); return !e || !/^\d+([.,]\d{1,2})?$/.test(String(e.value).trim()); }
  function conferir(n) {
    if (n === 1) {
      if (vazio('nome')) return 'Informe o nome do curso.';
      if (!(Number(campo('cargaHoraria').value) >= 1)) return 'Carga horaria invalida.';
    }
    if (n === 2) {
      if (numeroRuim('precoAvista') || numeroRuim('precoCheio')) return 'Verifique os valores (use numeros, ex.: 150.00).';
      if (!(parseInt(campo('parcelas').value, 10) >= 1)) return 'Numero de parcelas invalido.';
    }
    return null;
  }
  continuar.addEventListener('click', function () {
    var m = conferir(atual);
    erro(m);
    if (!m) ir(atual + 1);
  });
  voltar.addEventListener('click', function () { erro(null); ir(atual - 1); });
  form.addEventListener('submit', function (e) {
    for (var n = 1; n < passos.length; n++) { var m = conferir(n); if (m) { e.preventDefault(); erro(m); ir(n); return; } }
  });

  function etiquetar(e) {
    var rot = e && e.closest('label');
    if (!rot || rot.querySelector('.adm-tag-ia')) return;
    var t = document.createElement('span'); t.className = 'adm-tag-ia'; t.textContent = 'IA';
    rot.insertBefore(t, rot.firstChild ? rot.firstChild.nextSibling : null);
  }
  function mostrarTudoQueVeio(campos) {
    var c = campos || {};
    Object.keys(c).forEach(function (k) { etiquetar(campo(k)); });
    if (mais && MAIS.some(function (k) { return k in c; })) mais.open = true;
    erro(null);
    ir(1);
  }
  window.admPassos = { ir: ir, mostrarTudoQueVeio: mostrarTudoQueVeio };
  ir(Number(form.getAttribute('data-passo-erro')) || 1);
})();
