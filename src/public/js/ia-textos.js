// Escrever com IA (2026-11-09): pede os textos ao servidor e preenche o formulário. Nada é salvo aqui.
(function () {
  document.querySelectorAll('.ia-textos').forEach(function (bloco) {
    var form = bloco.closest('form');
    var bt = bloco.querySelector('.ia-textos-bt');
    var msg = bloco.querySelector('.ia-textos-msg');
    var faqs = bloco.querySelector('.ia-faqs');
    var lista = bloco.querySelector('.ia-faqs-lista');
    if (!form || !bt) return;
    // Curso já criado: as dúvidas ficam na seção de dúvidas (data-sem-faqs); aqui só os textos.
    var campos = ['descricao', 'descricaoLonga', 'conteudoProgramatico'];
    function campo(n) { return form.querySelector('[name="' + n + '"]'); }
    function aviso(t, erro) { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('erro', !!erro); }
    function el(tag, attrs, texto) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); if (texto != null) e.textContent = texto; return e; }
    function mostrarFaqs(itens) {
      lista.textContent = '';
      (itens || []).forEach(function (f, i) {
        var linha = el('div', { class: 'ia-faq' });
        var marca = el('label', { class: 'check' });
        var cb = el('input', { type: 'checkbox', name: 'faqsIa[' + i + '][usar]', value: '1' }); cb.checked = true;
        marca.appendChild(cb); marca.appendChild(document.createTextNode(' Usar'));
        var p = el('input', { type: 'text', name: 'faqsIa[' + i + '][pergunta]', maxlength: '200' }); p.value = f.pergunta;
        var r = el('textarea', { name: 'faqsIa[' + i + '][resposta]', rows: '2', maxlength: '600' }); r.value = f.resposta;
        linha.appendChild(marca); linha.appendChild(p); linha.appendChild(r);
        lista.appendChild(linha);
      });
      faqs.hidden = !(itens && itens.length);
    }
    bt.addEventListener('click', function () {
      var temTexto = campos.some(function (n) { var c = campo(n); return c && c.value.trim(); });
      if (temTexto && !window.confirm('Substituir os textos que você já escreveu?')) return;
      var dados = new URLSearchParams();
      var fd = new FormData(form);
      fd.forEach(function (v, k) { if (typeof v === 'string' && k.indexOf('faqsIa') !== 0) dados.append(k, v); });
      dados.set('tipo', bloco.getAttribute('data-tipo'));
      dados.set('cursoId', bloco.getAttribute('data-curso-id') || '');
      dados.set('ideias', (campo('ideiasIa') || {}).value || '');
      bt.disabled = true; var rotulo = bt.innerHTML; bt.textContent = 'Escrevendo… (20 a 40 s)';
      aviso('');
      fetch(bloco.getAttribute('data-ia-textos-url'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: dados.toString(), credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { aviso(j.erro || 'Não foi possível escrever agora.', true); return; }
          campos.forEach(function (n) { var c = campo(n); if (c && typeof j.textos[n] === 'string' && j.textos[n]) c.value = j.textos[n]; });
          if (faqs && !bloco.hasAttribute('data-sem-faqs')) mostrarFaqs(j.textos.faqs);
          aviso('Pronto: confira os textos e clique em Salvar.');
        })
        .catch(function () { aviso('Não foi possível falar com o servidor. Tente de novo.', true); })
        .finally(function () { bt.disabled = false; bt.innerHTML = rotulo; });
    });
  });

  // "Escrever dúvidas com IA" dentro da seção de dúvidas (curso já criado): sugestões com caixinhas e um formulário
  // próprio que grava as marcadas direto.
  document.querySelectorAll('.ia-duvidas').forEach(function (bloco) {
    var bt = bloco.querySelector('.ia-duvidas-bt');
    var msg = bloco.querySelector('.ia-textos-msg');
    var form = bloco.querySelector('.ia-duvidas-form');
    var lista = form && form.querySelector('.ia-faqs-lista');
    if (!bt || !form) return;
    function aviso(t, erro) { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('erro', !!erro); }
    function el(tag, attrs) { var e = document.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
    bt.addEventListener('click', function () {
      var dados = new URLSearchParams();
      dados.set('_csrf', (form.querySelector('[name="_csrf"]') || {}).value || '');
      dados.set('tipo', bloco.getAttribute('data-tipo'));
      dados.set('cursoId', bloco.getAttribute('data-curso-id'));
      dados.set('soDuvidas', '1');
      bt.disabled = true; var rotulo = bt.innerHTML; bt.textContent = 'Escrevendo… (20 a 40 s)';
      aviso('');
      fetch(bloco.getAttribute('data-ia-textos-url'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: dados.toString(), credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { aviso(j.erro || 'Não foi possível escrever agora.', true); return; }
          var itens = (j.textos && j.textos.faqs) || [];
          lista.textContent = '';
          itens.forEach(function (f, i) {
            var linha = el('div', { class: 'ia-faq' });
            var marca = el('label', { class: 'check' });
            var cb = el('input', { type: 'checkbox', name: 'faqsIa[' + i + '][usar]', value: '1' }); cb.checked = true;
            marca.appendChild(cb); marca.appendChild(document.createTextNode(' Usar'));
            var p = el('input', { type: 'text', name: 'faqsIa[' + i + '][pergunta]', maxlength: '200' }); p.value = f.pergunta;
            var r = el('textarea', { name: 'faqsIa[' + i + '][resposta]', rows: '2', maxlength: '600' }); r.value = f.resposta;
            linha.appendChild(marca); linha.appendChild(p); linha.appendChild(r);
            lista.appendChild(linha);
          });
          form.hidden = !itens.length;
          aviso(itens.length ? 'Confira e clique em "Adicionar as marcadas".' : 'A IA não sugeriu dúvidas novas para este curso.', !itens.length);
        })
        .catch(function () { aviso('Não foi possível falar com o servidor. Tente de novo.', true); })
        .finally(function () { bt.disabled = false; bt.innerHTML = rotulo; });
    });
  });
})();
