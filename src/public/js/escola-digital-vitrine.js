// Vitrine da Escola Digital (2026-11-09): setas ‹ › dos carrosséis no computador. Sem JS, a linha rola normalmente.
(function () {
  document.querySelectorAll('.ed-carrossel').forEach(function (car) {
    var linha = car.querySelector('.ed-linha');
    var ant = car.querySelector('.ed-seta-ant');
    var prox = car.querySelector('.ed-seta-prox');
    if (!linha || !ant || !prox) return;
    function atualizar() {
      var max = linha.scrollWidth - linha.clientWidth - 2;
      ant.hidden = linha.scrollLeft <= 2;
      prox.hidden = linha.scrollLeft >= max;
    }
    function mover(dir) { linha.scrollBy({ left: dir * Math.max(linha.clientWidth * 0.85, 240), behavior: 'smooth' }); }
    ant.addEventListener('click', function () { mover(-1); });
    prox.addEventListener('click', function () { mover(1); });
    linha.addEventListener('scroll', atualizar, { passive: true });
    window.addEventListener('resize', atualizar);
    atualizar();
  });
})();
