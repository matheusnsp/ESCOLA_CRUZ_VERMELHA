// Conta o tempo restante até o início da próxima turma do curso.
(function () {
  var caixas = document.querySelectorAll('.curso-countdown');
  if (!caixas.length) return;

  function dois(n) { return n < 10 ? '0' + n : '' + n; }

  caixas.forEach(function (el) {
    var alvo = new Date(el.dataset.inicio).getTime();
    if (isNaN(alvo)) return;

    function set(sel, v) { var n = el.querySelector(sel); if (n) n.textContent = dois(v); }

    function tick() {
      var diff = alvo - Date.now();
      if (diff <= 0) {
        var nums = el.querySelector('.cd-nums');
        if (nums) nums.innerHTML = '<span style="min-width:auto;font-size:15px;color:#1f2733;font-weight:700;">O curso já começou!</span>';
        clearInterval(id);
        return;
      }
      var totalSeg = Math.floor(diff / 1000);
      set('[data-d]', Math.floor(totalSeg / 86400));
      set('[data-h]', Math.floor(totalSeg / 3600) % 24);
      set('[data-m]', Math.floor(totalSeg / 60) % 60);
      set('[data-s]', totalSeg % 60);
    }

    tick();
    var id = setInterval(tick, 1000);
  });
})();
