// Auto-logout por inatividade no painel da secretaria.
// Avisa 1 min antes e, ao zerar, envia o formulário de logout (com CSRF) do cabeçalho.
(function () {
  var LIMITE_MS = 15 * 60 * 1000; // 15 minutos
  var AVISO_MS = 14 * 60 * 1000;  // mostra o aviso 1 min antes
  var timerAviso = null;
  var timerLogout = null;
  var banner = null;
  var contagem = null;
  var intervaloContagem = null;

  function formLogout() {
    return document.querySelector('form[action="/logout"]');
  }

  function sair() {
    var f = formLogout();
    if (f) f.submit();
    else window.location.href = '/login?expirado=1';
  }

  function criarBanner() {
    if (banner) return;
    banner = document.createElement('div');
    banner.setAttribute('role', 'alertdialog');
    banner.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'background:#fff', 'border:1px solid #e7ebf2', 'border-left:4px solid #cc0000',
      'box-shadow:0 18px 44px rgba(11,18,32,.18)', 'border-radius:14px',
      'padding:16px 20px', 'z-index:9999', 'max-width:92vw', 'width:380px',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif', 'color:#1b2330'
    ].join(';');
    banner.innerHTML =
      '<div style="font-weight:800;margin-bottom:4px;">Você ainda está aí?</div>' +
      '<div style="font-size:14px;color:#6b7585;">Por segurança, sua sessão será encerrada em ' +
      '<strong id="idle-contagem">60</strong>s por inatividade.</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;">' +
      '<button id="idle-continuar" style="background:#cc0000;color:#fff;border:none;border-radius:9px;padding:9px 16px;font-weight:700;cursor:pointer;">Continuar conectado</button>' +
      '<button id="idle-sair" style="background:#fff;border:1px solid #e7ebf2;border-radius:9px;padding:9px 16px;font-weight:700;cursor:pointer;color:#1b2330;">Sair agora</button>' +
      '</div>';
    document.body.appendChild(banner);
    contagem = banner.querySelector('#idle-contagem');
    banner.querySelector('#idle-continuar').addEventListener('click', function () { registrarAtividade(true); });
    banner.querySelector('#idle-sair').addEventListener('click', sair);
  }

  function mostrarAviso() {
    criarBanner();
    banner.style.display = 'block';
    var restante = Math.round((LIMITE_MS - AVISO_MS) / 1000);
    if (contagem) contagem.textContent = String(restante);
    clearInterval(intervaloContagem);
    intervaloContagem = setInterval(function () {
      restante -= 1;
      if (contagem) contagem.textContent = String(Math.max(0, restante));
      if (restante <= 0) clearInterval(intervaloContagem);
    }, 1000);
  }

  function esconderAviso() {
    if (banner) banner.style.display = 'none';
    clearInterval(intervaloContagem);
  }

  function registrarAtividade(forcar) {
    // 'forcar' = clique em "Continuar conectado" (sempre reinicia).
    esconderAviso();
    clearTimeout(timerAviso);
    clearTimeout(timerLogout);
    timerAviso = setTimeout(mostrarAviso, AVISO_MS);
    timerLogout = setTimeout(sair, LIMITE_MS);
  }

  // Eventos que contam como atividade.
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      // Se o aviso já está na tela, só reinicia ao mover/clicar fora dos botões.
      registrarAtividade(false);
    }, { passive: true });
  });

  // Inicia a contagem ao carregar a página do painel.
  registrarAtividade(false);
})();
