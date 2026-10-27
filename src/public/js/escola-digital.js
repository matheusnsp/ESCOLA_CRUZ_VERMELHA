// Escola Digital CVB-RJ: comportamento das telas (sem script embutido nas páginas, por causa da CSP).
//   [data-ed-consulta]    consulta a situação do pagamento a cada 5 s; pago → data-ed-ok,
//                         cancelado/recusado → data-ed-falha (tela do PIX e cartão em análise)
//   [data-ed-recarregar]  recarrega a página depois de N segundos (PIX ainda sendo gerado)
//   [data-ed-copiar]      copia o texto do campo indicado (PIX copia e cola)
//   [data-ed-pagamento]   formulário de pagamento: parcelado só no cartão; dados do cartão só com cartão
//   [data-ed-relogio]     relógio do cenário: mostra o tempo corrido (mm:ss) a partir de data-inicio (epoch em ms),
//                         ao lado do tempo sugerido (data-sugerido, em segundos). Passou do sugerido, só muda o
//                         estilo e mostra o aviso: nunca bloqueia. Sem JavaScript a página mostra o tempo de quando abriu.
(function () {
  'use strict';

  var INTERVALO_MS = 5000;
  var LIMITE_MS = 30 * 60 * 1000; // depois de 30 min o PIX venceu: para de perguntar

  function consultarSituacao(el) {
    var url = el.getAttribute('data-ed-consulta');
    var ok = el.getAttribute('data-ed-ok');
    var falha = el.getAttribute('data-ed-falha');
    var texto = el.querySelector('[data-ed-status-texto]');
    var inicio = Date.now();
    var parado = false;

    function avisar(msg) { if (texto) texto.textContent = msg; }

    function perguntar() {
      if (parado) return;
      if (Date.now() - inicio > LIMITE_MS) {
        avisar('O tempo para pagar acabou. Recarregue a página para ver a situação.');
        return;
      }
      fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j) return agendar();
          if (j.status === 'PAGO' || j.situacao === 'ATIVA' || j.situacao === 'CONCLUIDA') {
            parado = true;
            avisar('Pagamento confirmado! Abrindo o curso…');
            window.location.assign(ok);
            return;
          }
          if (j.status === 'CANCELADO' || j.status === 'ESTORNADO') {
            parado = true;
            window.location.assign(falha);
            return;
          }
          agendar();
        })
        .catch(agendar); // sem rede por um instante: tenta de novo
    }

    function agendar() { if (!parado) setTimeout(perguntar, INTERVALO_MS); }
    agendar();
  }

  function copiar(botao) {
    var campo = document.getElementById(botao.getAttribute('data-ed-copiar'));
    if (!campo) return;
    var original = botao.textContent;
    function pronto() {
      botao.textContent = 'Código copiado ✓';
      setTimeout(function () { botao.textContent = original; }, 2000);
    }
    function antigo() {
      campo.focus();
      campo.select();
      try { document.execCommand('copy'); pronto(); } catch (e) { /* a pessoa seleciona e copia na mão */ }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(campo.value).then(pronto, antigo);
    } else {
      antigo();
    }
  }

  // Formulário de pagamento: com parcelado escolhido, o PIX fica desabilitado (e o cartão marcado);
  // com PIX, os campos do cartão somem. Sem JavaScript tudo continua visível e o servidor confere.
  function formularioPagamento(form) {
    var pix = form.querySelector('input[name="forma"][value="PIX"]');
    var credito = form.querySelector('input[name="forma"][value="CREDITO"]');
    var cartao = form.querySelector('[data-ed-cartao]');

    function atualizar() {
      var parcelado = !!form.querySelector('input[name="opcao"][data-ed-parcelado]:checked');
      if (pix) {
        pix.disabled = parcelado;
        if (parcelado && pix.checked && credito) credito.checked = true;
      }
      if (cartao) cartao.hidden = !(credito && credito.checked);
    }
    form.addEventListener('change', atualizar);
    atualizar();

    // Máscaras leves: número do cartão em grupos de 4 e validade MM/AA.
    var numero = form.querySelector('[data-ed-mascara="cartao"]');
    if (numero) {
      numero.addEventListener('input', function () {
        numero.value = numero.value.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
      });
    }
    var validade = form.querySelector('[data-ed-mascara="validade"]');
    if (validade) {
      validade.addEventListener('input', function () {
        var d = validade.value.replace(/\D/g, '').slice(0, 4);
        validade.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
      });
    }
  }

  function doisDigitos(n) { return n < 10 ? '0' + n : String(n); }

  // O servidor manda também a hora dele (data-agora): a diferença para o relógio do aparelho é
  // descontada, então um aparelho com hora errada não adianta nem atrasa o contador.
  function relogioCenario(el) {
    var inicio = Number(el.getAttribute('data-inicio'));
    var sugerido = Number(el.getAttribute('data-sugerido'));
    var agoraServidor = Number(el.getAttribute('data-agora'));
    var tempo = el.querySelector('[data-ed-relogio-tempo]');
    var aviso = document.querySelector('[data-ed-relogio-aviso]');
    if (!tempo || !isFinite(inicio)) return;
    var desvio = isFinite(agoraServidor) && agoraServidor > 0 ? agoraServidor - Date.now() : 0;

    function atualizar() {
      var s = Math.max(0, Math.floor((Date.now() + desvio - inicio) / 1000));
      var m = Math.min(99, Math.floor(s / 60));
      tempo.textContent = doisDigitos(m) + ':' + doisDigitos(s % 60);
      var passou = isFinite(sugerido) && s > sugerido;
      if (el.classList) el.classList.toggle('ed-relogio-passou', passou);
      if (aviso) aviso.hidden = !passou;
    }
    atualizar();
    setInterval(atualizar, 1000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ed-relogio]'), relogioCenario);
    Array.prototype.forEach.call(document.querySelectorAll('[data-ed-consulta]'), consultarSituacao);
    Array.prototype.forEach.call(document.querySelectorAll('[data-ed-copiar]'), function (b) {
      b.addEventListener('click', function () { copiar(b); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ed-pagamento]'), formularioPagamento);
    var recarregar = document.querySelector('[data-ed-recarregar]');
    if (recarregar) {
      var s = Number(recarregar.getAttribute('data-ed-recarregar')) || 5;
      setTimeout(function () { window.location.reload(); }, s * 1000);
    }
  });
}());
