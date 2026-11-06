// Painel → Criar curso com IA (etapa 9): atualiza a página enquanto a IA trabalha e cuida do editor do roteiro
// (subir/descer módulo, + tópico). Sem JS inline (CSP).
(function () {
  var estado = document.getElementById('iaEstado');
  if (estado && estado.getAttribute('data-andando') === '1') {
    var url = estado.getAttribute('data-estado-url');
    // Compara com o estado que a página mostrou ao abrir: se a IA terminou um passo antes da primeira consulta,
    // a página recarrega do mesmo jeito.
    var antes = estado.getAttribute('data-assinatura');
    setInterval(function () {
      fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (e) {
        var agora = JSON.stringify([e.status, (e.modulos || []).map(function (m) { return m.status; })]);
        if (agora !== antes) window.location.reload();
      }).catch(function () {});
    }, 5000);
  }

  var form = document.getElementById('iaRoteiro');
  if (!form) return;
  form.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var mod = b.closest('[data-modulo]');
    if (b.hasAttribute('data-subir') && mod.previousElementSibling && mod.previousElementSibling.hasAttribute('data-modulo')) {
      mod.parentNode.insertBefore(mod, mod.previousElementSibling);
    } else if (b.hasAttribute('data-descer') && mod.nextElementSibling && mod.nextElementSibling.hasAttribute('data-modulo')) {
      mod.parentNode.insertBefore(mod.nextElementSibling, mod);
    } else if (b.hasAttribute('data-mais-topico')) {
      var lista = mod.querySelector('[data-topicos]');
      var n = lista.querySelectorAll('input').length;
      var label = document.createElement('label');
      label.className = 'full';
      label.textContent = 'Tópico';
      var input = document.createElement('input');
      input.type = 'text'; input.maxLength = 160;
      input.name = lista.getAttribute('data-nome') + '[' + n + ']';
      label.appendChild(input);
      lista.appendChild(label);
      input.focus();
    }
  });
})();
