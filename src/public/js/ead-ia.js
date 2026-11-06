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
  var lista = form.querySelector('[data-modulos]');
  var modelo = document.getElementById('iaModeloModulo');

  // Módulo final: só cenários (os tópicos ficam escondidos e o servidor os ignora).
  function marcarFinal(mod) {
    var final = mod.querySelector('[data-final]').checked;
    mod.classList.toggle('ia-final', final);
  }
  function acrescentarCampo(bloco, rotulo) {
    var n = bloco.querySelectorAll('input').length;
    var label = document.createElement('label');
    label.className = 'full';
    label.textContent = rotulo + ' ' + (n + 1);
    var input = document.createElement('input');
    input.type = 'text'; input.maxLength = 120;
    input.name = bloco.getAttribute('data-nome') + '[' + n + ']';
    label.appendChild(input);
    bloco.appendChild(label);
    input.focus();
  }

  form.addEventListener('change', function (ev) {
    if (ev.target.hasAttribute('data-final')) marcarFinal(ev.target.closest('[data-modulo]'));
  });
  form.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    var mod = b.closest('[data-modulo]');
    if (b.hasAttribute('data-mais-modulo')) {
      var i = 'n' + Date.now();
      var div = document.createElement('div');
      div.innerHTML = modelo.innerHTML.split('__i__').join(i);
      var novo = div.firstElementChild;
      lista.appendChild(novo);
      novo.querySelector('input[type=text]').focus();
    } else if (b.hasAttribute('data-subir') && mod.previousElementSibling) {
      mod.parentNode.insertBefore(mod, mod.previousElementSibling);
    } else if (b.hasAttribute('data-descer') && mod.nextElementSibling) {
      mod.parentNode.insertBefore(mod.nextElementSibling, mod);
    } else if (b.hasAttribute('data-mais-topico')) {
      acrescentarCampo(mod.querySelector('[data-topicos]'), 'Tópico');
    } else if (b.hasAttribute('data-mais-cenario')) {
      acrescentarCampo(mod.querySelector('[data-cenarios]'), 'Cenário');
    }
  });
})();
