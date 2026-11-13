// "Sugerir com IA" no conteúdo programático (seção Certificado, 2026-11-13): preenche o campo; nada é salvo.
(function () {
  var bt = document.querySelector('.ia-conteudo-bt');
  if (!bt) return;
  var form = bt.closest('form');
  var campo = form && form.querySelector('[name=conteudoProgramatico]');
  var msg = document.querySelector('.ia-conteudo-msg');
  function aviso(t, erro) { if (!msg) return; msg.textContent = t; msg.hidden = !t; msg.classList.toggle('erro', !!erro); }
  bt.addEventListener('click', function (e) {
    e.preventDefault();
    if (!campo) return;
    if (campo.value.trim() && !window.confirm('Substituir o conteúdo que já está escrito?')) return;
    var rotulo = bt.innerHTML; bt.disabled = true; bt.textContent = 'Escrevendo…';
    var csrf = form.querySelector('[name=_csrf]');
    var dados = new URLSearchParams(); if (csrf) dados.append('_csrf', csrf.value);
    fetch(bt.getAttribute('data-url'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: dados.toString(), credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { aviso(j.erro || 'A IA não conseguiu agora; preencha à mão ou tente de novo.', true); return; }
        campo.value = j.conteudo || '';
        var l = campo.closest('label');
        if (l && !l.querySelector('.adm-tag-ia')) { var t = document.createElement('span'); t.className = 'adm-tag-ia'; t.textContent = 'IA'; l.insertBefore(t, l.firstChild); }
        aviso('Sugerido a partir do texto do curso. Confira antes de salvar: vai no verso do certificado.');
      })
      .catch(function () { aviso('Não foi possível falar com o servidor. Tente de novo.', true); })
      .finally(function () { bt.disabled = false; bt.innerHTML = rotulo; });
  });
})();
