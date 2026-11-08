// "Minha escola" → lote (Escola Digital, 2026-11, vistoria H11): copiar o link de convite e confirmar antes de
// trocar ou desligar o link. Arquivo próprio: a CSP não aceita JS dentro do HTML.
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-copiar]');
  if (!b) return;
  var campo = document.getElementById(b.getAttribute('data-copiar'));
  if (!campo) return;
  var feito = function () { var t = b.textContent; b.textContent = 'Copiado!'; setTimeout(function () { b.textContent = t; }, 1800); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(campo.value).then(feito, function () { campo.select(); document.execCommand('copy'); feito(); });
  else { campo.select(); document.execCommand('copy'); feito(); }
});
document.addEventListener('submit', function (e) {
  var f = e.target;
  if (f && f.dataset && f.dataset.confirmar && !window.confirm(f.dataset.confirmar)) e.preventDefault();
}, true);
