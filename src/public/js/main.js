/* Carousel de depoimentos */
(function () {
    var car = document.getElementById('testiCarousel');
    var dotsWrap = document.getElementById('testiDots');
    if (!car || !dotsWrap) return;
    var cards = Array.prototype.slice.call(car.children);
    var base = cards.length ? cards[0].offsetLeft : 0;
    cards.forEach(function (c, i) {
        var d = document.createElement('button');
        d.className = 'testi-dot';
        d.setAttribute('aria-label', 'Ver depoimento ' + (i + 1));
        d.addEventListener('click', function () {
            car.scrollTo({ left: c.offsetLeft - base, behavior: 'smooth' });
        });
        dotsWrap.appendChild(d);
    });
    var dots = Array.prototype.slice.call(dotsWrap.children);
    function setActive() {
        var idx = 0, min = Infinity;
        cards.forEach(function (c, i) {
            var dist = Math.abs((c.offsetLeft - base) - car.scrollLeft);
            if (dist < min) { min = dist; idx = i; }
        });
        dots.forEach(function (d, i) { d.classList.toggle('active', i === idx); });
    }
    car.addEventListener('scroll', function () { window.requestAnimationFrame(setActive); });
    setActive();
})();

/* FAQ accordion */
(function () {
    document.querySelectorAll('.faq-q').forEach(function (q) {
        q.addEventListener('click', function () {
            var item = q.parentElement;
            var open = item.classList.toggle('open');
            q.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    });
})();
/* Menu hambúrguer (mobile) */
(function () {
  var header = document.querySelector('.main-header');
  if (!header) return;
  var toggle = header.querySelector('.nav-toggle');
  if (!toggle) return;
  function fechar() { header.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); }
  toggle.addEventListener('click', function () {
    var aberto = header.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  });
  header.querySelectorAll('.nav-links a').forEach(function (a) {
    a.addEventListener('click', fechar);
  });
  window.addEventListener('resize', function () { if (window.innerWidth > 1024) fechar(); });
})();
