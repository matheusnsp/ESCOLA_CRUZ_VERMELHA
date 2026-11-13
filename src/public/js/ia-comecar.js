// "Começar com a IA" (2026-11-13): manda o texto livre da pessoa, recebe os campos e preenche o formulário
// (Novo curso: os 3 passos, textos e dúvidas; Nova turma: curso, início, aulas, vagas e instrutor). Nada é salvo.
(function () {
  document.querySelectorAll('.adm-comecar-ia').forEach(function (caixa) {
    var bt = caixa.querySelector('.adm-comecar-bt');
    var area = caixa.querySelector('.adm-comecar-texto');
    var msg = caixa.querySelector('.ia-textos-msg');
    var form = document.getElementById(caixa.getAttribute('data-comecar-form'));
    if (!bt || !area || !form) return;
    function aviso(t, erro) { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('erro', !!erro); }
    function definir(nome, v) {
      var e = form.querySelector('[name="' + nome + '"]');
      if (!e || v == null || v === '') return false;
      if (e.type === 'checkbox') e.checked = !!v;
      else if (e.tagName === 'SELECT') { if (!Array.prototype.some.call(e.options, function (o) { return o.value === String(v); })) return false; e.value = String(v); }
      else e.value = String(v);
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    bt.addEventListener('click', function () {
      var texto = area.value.trim();
      if (!texto) { aviso('Escreva o que você sabe antes de pedir à IA.', true); area.focus(); return; }
      var rotulo = bt.innerHTML;
      bt.disabled = true; bt.textContent = 'A IA está preenchendo…';
      aviso('A IA está preenchendo… leva uns 20 segundos.');
      var csrf = form.querySelector('[name=_csrf]');
      var dados = new URLSearchParams(); dados.append('texto', texto); if (csrf) dados.append('_csrf', csrf.value);
      fetch(caixa.getAttribute('data-comecar-url'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CSRF-Token': csrf ? csrf.value : '' }, body: dados.toString(), credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { aviso(j.erro || 'A IA não conseguiu agora; preencha à mão ou tente de novo.', true); return; }
          var veio = {};
          Object.keys(j.campos || {}).forEach(function (k) { if (k !== 'aulas' && definir(k, j.campos[k])) veio[k] = true; });
          var t = j.textos || {};
          ['descricao', 'descricaoLonga', 'conteudoProgramatico'].forEach(function (k) { if (definir(k, t[k])) veio[k] = true; });
          var ia = form.querySelector('.ia-textos');
          if (ia && ia.iaMostrarFaqs && t.faqs && t.faqs.length) ia.iaMostrarFaqs(t.faqs);
          if (j.campos && j.campos.aulas && window.admAulas) { window.admAulas.substituir(j.campos.aulas); veio.aulas = true; }
          if (window.admPassos) window.admPassos.mostrarTudoQueVeio(veio);
          else Object.keys(veio).forEach(function (k) { var e = form.querySelector('[name="' + k + '"]'); var l = e && e.closest('label'); if (l && !l.querySelector('.adm-tag-ia')) { var s = document.createElement('span'); s.className = 'adm-tag-ia'; s.textContent = 'IA'; l.insertBefore(s, l.firstChild ? l.firstChild.nextSibling : null); } });
          aviso('Pronto: a IA preencheu o que você contou. Confira e mude o que quiser; nada foi salvo.');
        })
        .catch(function () { aviso('Não foi possível falar com o servidor. Tente de novo.', true); })
        .finally(function () { bt.disabled = false; bt.innerHTML = rotulo; });
    });
  });
})();
