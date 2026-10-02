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

/* Service Worker: guarda CSS/JS/imagens no navegador para acelerar a navegação */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
}

/* Cabeçalho novo (vitrine.css): menu do celular */
(function () {
  var header = document.querySelector('.v-header');
  if (!header) return;
  var botao = header.querySelector('.v-burger');
  var gaveta = document.getElementById('vGaveta');
  if (!botao || !gaveta) return;
  function abrir(sim) {
    gaveta.hidden = !sim;
    botao.setAttribute('aria-expanded', sim ? 'true' : 'false');
    botao.setAttribute('aria-label', sim ? 'Fechar menu' : 'Abrir menu');
    var i = botao.querySelector('i');
    if (i) i.className = sim ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
  }
  botao.addEventListener('click', function () { abrir(gaveta.hidden); });
  gaveta.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { abrir(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !gaveta.hidden) { abrir(false); botao.focus(); } });
  window.addEventListener('resize', function () { if (window.innerWidth > 980) abrir(false); });
  // Menu do aluno logado: fecha ao clicar fora.
  var user = header.querySelector('.v-user');
  if (user) document.addEventListener('click', function (e) { if (user.open && !user.contains(e.target)) user.open = false; });
})();

/* Filtros da vitrine: área (home e /cursos); no catálogo também a busca e "só com inscrições abertas".
   Listas extras com data-filtra="<id da grade>" (as próximas turmas) seguem os mesmos filtros e a
   seção delas some quando nada combina. */
(function () {
  function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  var ids = {};
  document.querySelectorAll('[data-filtros],[data-busca],[data-so-abertas]').forEach(function (el) {
    ids[el.getAttribute('data-filtros') || el.getAttribute('data-busca') || el.getAttribute('data-so-abertas')] = true;
  });
  Object.keys(ids).forEach(function (id) {
    var grade = document.getElementById(id);
    if (!grade) return;
    var listas = [grade].concat(Array.prototype.slice.call(document.querySelectorAll('[data-filtra="' + id + '"]')));
    var cards = [];
    listas.forEach(function (lista, i) {
      lista.querySelectorAll('[data-cat]').forEach(function (el) {
        cards.push({ el: el, lista: i, cat: el.getAttribute('data-cat'), aberta: el.getAttribute('data-aberta') === '1', texto: norm(el.getAttribute('data-texto') || el.textContent) });
      });
    });
    var chips = document.querySelectorAll('[data-filtros="' + id + '"] .v-chip');
    var busca = document.querySelector('[data-busca="' + id + '"]');
    var abertas = document.querySelector('[data-so-abertas="' + id + '"]');
    var nada = document.querySelector('[data-nada="' + id + '"]');
    var conta = document.querySelector('[data-contagem="' + id + '"]');
    var cat = '';
    function aplicar() {
      var q = busca ? norm(busca.value) : '';
      var so = !!(abertas && abertas.checked);
      var vistos = listas.map(function () { return 0; });
      cards.forEach(function (c) {
        var ok = (!cat || c.cat === cat) && (!so || c.aberta) && (!q || c.texto.indexOf(q) !== -1);
        c.el.hidden = !ok;
        if (ok) vistos[c.lista]++;
      });
      listas.forEach(function (lista, i) {
        var secao = i > 0 && lista.closest('[data-some-se-vazio]');
        if (secao) secao.hidden = vistos[i] === 0;
      });
      var n = vistos[0];
      var filtrando = !!(cat || q || so);
      grade.classList.toggle('v-grade-filtrada', filtrando);
      if (nada) nada.hidden = n > 0;
      if (conta) conta.textContent = filtrando ? (n === 1 ? '1 curso encontrado' : n + ' cursos encontrados') : conta.getAttribute('data-padrao');
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        cat = chip.getAttribute('data-valor');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        aplicar();
      });
    });
    if (busca) busca.addEventListener('input', aplicar);
    if (abertas) abertas.addEventListener('change', aplicar);
    document.querySelectorAll('[data-limpar="' + id + '"]').forEach(function (b) {
      b.addEventListener('click', function () {
        cat = '';
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-valor') === '' ? 'true' : 'false'); });
        if (busca) busca.value = '';
        if (abertas) abertas.checked = false;
        aplicar();
        if (busca) busca.focus();
      });
    });
    // Ao voltar para a página, o navegador pode restaurar a busca ou o "só abertas".
    if ((busca && busca.value) || (abertas && abertas.checked)) aplicar();
  });
})();
