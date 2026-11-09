// "Escrever pedido com o Claude" (2026-11-09): o Claude escreve o pedido da imagem e o texto vai para o campo
// "Pedido da imagem"; a pessoa edita e confirma em "Gerar com este pedido". Não gera a imagem aqui.
(function () {
  document.querySelectorAll('.ia-pedido-bt').forEach(function (bt) {
    bt.addEventListener('click', function () {
      var alvo = document.getElementById(bt.getAttribute('data-alvo'));
      var msg = document.getElementById(bt.getAttribute('data-alvo') + '-msg');
      var csrf = document.querySelector('input[name="_csrf"]');
      if (!alvo) return;
      if (alvo.value.trim() && !window.confirm('Substituir o pedido que está no campo?')) return;
      var dados = new URLSearchParams();
      dados.set('_csrf', csrf ? csrf.value : '');
      dados.set('tipo', bt.getAttribute('data-tipo') || 'curso');
      dados.set('id', bt.getAttribute('data-id') || '');
      var rotulo = bt.innerHTML; bt.disabled = true; bt.textContent = 'O Claude está escrevendo…';
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      fetch(bt.getAttribute('data-url'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: dados.toString(), credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (msg) { msg.hidden = false; msg.classList.toggle('erro', !j.ok); msg.textContent = j.ok ? 'Pedido escrito. Edite se quiser e clique em gerar.' : (j.erro || 'Não foi possível escrever o pedido.'); }
          if (j.ok) { alvo.value = j.pedido; alvo.focus(); }
        })
        .catch(function () { if (msg) { msg.hidden = false; msg.classList.add('erro'); msg.textContent = 'Não foi possível falar com o servidor.'; } })
        .finally(function () { bt.disabled = false; bt.innerHTML = rotulo; });
    });
  });
})();
