// Formulários de pagamento (<form data-cobranca>): depois do clique, o botão fica desabilitado e
// mostra "Gerando cobrança…", para a pessoa não reapertar enquanto o gateway responde (cada
// clique a mais era uma cobrança nova; ver lib/cobranca-guarda.js, que protege o servidor).
//
// Progressivo: sem JS o formulário envia normalmente. Ao voltar para a página pelo botão
// "voltar" do navegador (cache de página), o botão volta ao estado de antes, para não ficar preso.
(function () {
  var TEXTO = 'Gerando cobrança…';

  function botoesDe(form) {
    return form.querySelectorAll('button[type="submit"], input[type="submit"]');
  }

  // Fase de bolha no document: roda depois dos outros handlers do formulário, então
  // defaultPrevented já diz se o envio vai mesmo acontecer.
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form || !form.hasAttribute || !form.hasAttribute('data-cobranca')) return;
    if (form.getAttribute('data-enviando') === '1') { ev.preventDefault(); return; }
    if (ev.defaultPrevented) return;
    form.setAttribute('data-enviando', '1');
    Array.prototype.forEach.call(botoesDe(form), function (b) {
      b.setAttribute('data-html-original', b.tagName === 'INPUT' ? b.value : b.innerHTML);
      b.setAttribute('data-disabled-original', b.disabled ? '1' : '');
      b.disabled = true;
      b.setAttribute('aria-busy', 'true');
      if (b.tagName === 'INPUT') b.value = TEXTO; else b.textContent = TEXTO;
    });
  });

  window.addEventListener('pageshow', function () {
    Array.prototype.forEach.call(document.querySelectorAll('form[data-cobranca][data-enviando="1"]'), function (form) {
      form.removeAttribute('data-enviando');
      Array.prototype.forEach.call(botoesDe(form), function (b) {
        var original = b.getAttribute('data-html-original');
        if (original !== null) {
          if (b.tagName === 'INPUT') b.value = original; else b.innerHTML = original;
        }
        b.disabled = b.getAttribute('data-disabled-original') === '1';
        b.removeAttribute('aria-busy');
        b.removeAttribute('data-html-original');
        b.removeAttribute('data-disabled-original');
      });
    });
  });
})();
