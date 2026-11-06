// Cronômetro do cenário do curso online (views/ead-teste/cenario.ejs). Só mostra o tempo: o que vale
// é o medido pelo servidor (lib/ead-progresso-db.js escolherNoCenario). Sem este script, a página mostra
// o tempo decorrido calculado pelo servidor no carregamento.
(function () {
  var el = document.querySelector('.ea-crono');
  if (!el || el.dataset.parado) return;
  var inicio = new Date(el.dataset.inicio).getTime();
  var sugerido = Number(el.dataset.sugerido) || 0;
  var valor = el.querySelector('.ea-crono-valor');
  if (!inicio || !valor) return;
  function mmss(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function tique() {
    var seg = (Date.now() - inicio) / 1000;
    valor.textContent = mmss(seg);
    el.classList.toggle('estourou', sugerido > 0 && seg > sugerido);
  }
  tique();
  setInterval(tique, 1000);
})();
