// Abrir a conversa no aplicativo WhatsApp do computador (2026-11-16), sem aba nova. Quando o aplicativo abre, o
// navegador perde o foco: aí esta tela volta sozinha para a lista. Se em 3 s nada abriu, mostra a opção do Web.
(function () {
  var caixa = document.getElementById('wppApp');
  if (!caixa) return;
  var linkApp = caixa.getAttribute('data-link-app');
  var voltar = caixa.getAttribute('data-voltar') || '/alunos';
  var abriu = false;
  window.addEventListener('blur', function () {
    abriu = true;
    setTimeout(function () { location.replace(voltar); }, 400);
  });
  setTimeout(function () { location.href = linkApp; }, 300);
  setTimeout(function () {
    if (abriu) return;
    var sem = document.getElementById('semApp'); var nota = document.getElementById('nota');
    if (sem) sem.hidden = false; if (nota) nota.hidden = true;
  }, 3300);
})();
