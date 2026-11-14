// Dúvidas frequentes do curso (2026-11-13): "Editar" troca o texto da dúvida pelos campos, ali mesmo.
// Sem este script, os campos de edição ficam visíveis (o formulário funciona do mesmo jeito).
(function () {
  document.querySelectorAll('.adm-faq').forEach(function (item) {
    var form = item.querySelector('[data-faq-edicao]');
    var bt = item.querySelector('[data-faq-editar]');
    var cancelar = item.querySelector('[data-faq-cancelar]');
    if (!form || !bt) return;
    form.hidden = true;
    bt.hidden = false;
    bt.addEventListener('click', function () { form.hidden = false; bt.hidden = true; var c = form.querySelector('input[name="pergunta"]'); if (c) c.focus(); });
    if (cancelar) cancelar.addEventListener('click', function () { form.reset(); form.hidden = true; bt.hidden = false; bt.focus(); });
  });
})();
