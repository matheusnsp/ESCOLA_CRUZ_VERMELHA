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

/* Cabeçalho novo (vitrine.css): menu do celular em tela cheia.
   Aberto: a página não rola por baixo (classe no <html>, sem mexer na posição), o resto da página fica
   inerte (leitor de tela e Tab não saem do menu) e o Tab dá a volta entre o botão X e os itens do menu.
   Fecha no X, no Esc (o foco volta ao botão), ao clicar num link e ao passar de 1060 px. */
(function () {
  var header = document.querySelector('.v-header');
  if (!header) return;
  var botao = header.querySelector('.v-burger');
  var gaveta = document.getElementById('vGaveta');
  if (!botao || !gaveta) return;
  var raiz = document.documentElement;
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saida = null, rolagem = 0, inertes = [];
  function visivel(el) { return el.getClientRects().length > 0; }
  // aviso de cookies (consentimento.js) aberto junto com o menu: entra na volta do Tab e o fim do painel
  // ganha espaço para nada ficar escondido atrás dele
  function aviso() { var a = document.querySelector('.cvrj-ck'); return a && visivel(a) ? a : null; }
  // o painel começa onde o cabeçalho termina (com a página no topo, a faixa vermelha fica à vista em cima)
  function medir() {
    gaveta.style.setProperty('--v-gaveta-top', Math.max(0, Math.round(header.getBoundingClientRect().bottom)) + 'px');
    var a = aviso();
    gaveta.style.setProperty('--v-gaveta-aviso', a ? Math.max(0, Math.round(window.innerHeight - a.getBoundingClientRect().top)) + 'px' : '0px');
  }
  function focaveis() {
    var lista = [botao].concat(Array.prototype.filter.call(gaveta.querySelectorAll('a[href], button'), visivel));
    var a = aviso();
    return a ? lista.concat(Array.prototype.filter.call(a.querySelectorAll('a[href], button'), visivel)) : lista;
  }
  function aberto() { return botao.getAttribute('aria-expanded') === 'true'; }
  // tudo fora do cabeçalho fica inerte enquanto o menu está aberto (menos o aviso de cookies, que fica por cima)
  function inerte(sim) {
    inertes.forEach(function (el) { el.inert = false; });
    inertes = [];
    if (!sim) return;
    for (var dentro = header; dentro && dentro !== document.body; dentro = dentro.parentElement) {
      Array.prototype.forEach.call(dentro.parentElement.children, function (el) {
        // a faixa vermelha e o aviso de matrícula ficam à vista acima do painel com a página no topo: continuam clicáveis
        if (el === dentro || el.inert || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName) || /(^|\s)(cvrj-ck|v-topbar|aviso-pagamento)/.test(el.className)) return;
        el.inert = true; inertes.push(el);
      });
    }
  }
  function abrir(sim) {
    if (sim === aberto()) return;
    botao.setAttribute('aria-expanded', sim ? 'true' : 'false');
    botao.setAttribute('aria-label', sim ? 'Fechar menu' : 'Abrir menu');
    var i = botao.querySelector('i');
    if (i) i.className = sim ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    clearTimeout(saida);
    gaveta.classList.remove('v-gaveta-saindo');
    inerte(sim);
    if (sim) {
      rolagem = window.scrollY;
      // sem a barra de rolagem (overflow: hidden) a página alargaria e o cabeçalho pularia para o lado
      var barra = window.innerWidth - raiz.clientWidth;
      if (barra > 0) raiz.style.paddingRight = barra + 'px';
      medir();
      raiz.classList.add('v-menu-aberto');
      gaveta.hidden = false;
      gaveta.scrollTop = 0;
      var primeiro = focaveis()[1];
      if (primeiro) primeiro.focus({ preventScroll: true });
    } else {
      // destrava a rolagem já (um link de seção precisa rolar a página); o painel some com um fade curto
      raiz.classList.remove('v-menu-aberto');
      raiz.style.paddingRight = '';
      // iPhone antigo (antes do iOS 16) rola a página por baixo mesmo assim: volta para onde estava
      if (window.scrollY !== rolagem) {
        raiz.style.scrollBehavior = 'auto'; window.scrollTo(0, rolagem); raiz.style.scrollBehavior = '';
      }
      if (calmo) { gaveta.hidden = true; return; }
      gaveta.classList.add('v-gaveta-saindo');
      saida = setTimeout(function () { gaveta.hidden = true; gaveta.classList.remove('v-gaveta-saindo'); }, 150);
    }
  }
  // o toque/clique não dá foco ao botão (o foco faria a página pular por causa do cabeçalho sticky)
  botao.addEventListener('mousedown', function (e) { e.preventDefault(); });
  botao.addEventListener('click', function () {
    if (!aberto()) { abrir(true); return; }
    abrir(false); botao.focus({ preventScroll: true });
  });
  // se a página rolar mesmo assim (leitor de tela, iOS antigo), o painel acompanha o cabeçalho
  window.addEventListener('scroll', function () { if (aberto()) medir(); }, { passive: true });
  gaveta.querySelectorAll('a').forEach(function (a) {
    if (a.target !== '_blank') a.addEventListener('click', function () { abrir(false); });
  });
  document.addEventListener('keydown', function (e) {
    // a janela "Preferências de cookies" fica por cima de tudo e cuida do próprio teclado
    if (!aberto() || e.defaultPrevented || document.querySelector('.cvrj-ck-fundo')) return;
    if (e.key === 'Escape') { abrir(false); botao.focus({ preventScroll: true }); return; }
    if (e.key !== 'Tab') return;
    // só as pontas dão a volta; no meio da lista o Tab segue normal
    // (foco sempre com preventScroll: o cabeçalho é sticky e o scroll-padding-top do <html> faria a página pular)
    var lista = focaveis(), ultimo = lista[lista.length - 1], atual = document.activeElement, alvo = null;
    if (lista.indexOf(atual) === -1) alvo = e.shiftKey ? ultimo : lista[1] || botao;
    else if (e.shiftKey && atual === botao) alvo = ultimo;
    else if (!e.shiftKey && atual === ultimo) alvo = botao;
    else if (e.shiftKey && atual === lista[1]) alvo = botao;
    if (alvo) { e.preventDefault(); alvo.focus({ preventScroll: true }); }
  });
  // escolher no aviso de cookies tira o aviso da tela: o fim do painel volta ao normal
  document.addEventListener('click', function (e) {
    if (aberto() && e.target.closest && e.target.closest('.cvrj-ck, .cvrj-ck-fundo')) setTimeout(medir, 0);
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 1060) {
      // o menu e o botão somem no computador: o foco que estava neles vai para o menu do cabeçalho
      var perdido = aberto() && (gaveta.contains(document.activeElement) || document.activeElement === botao);
      abrir(false);
      var alvo = perdido && (header.querySelector('.v-menu a') || header.querySelector('.logo-area'));
      if (alvo) alvo.focus({ preventScroll: true });
    } else if (aberto()) medir();
  });
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

/* Menu do topo na home: o traço vermelho fica só no item da seção que está na tela.
   Ao clicar, marca o item clicado; ao rolar a página, acompanha a seção. */
(function () {
  var menu = document.querySelector('.v-menu');
  if (!menu || location.pathname !== '/') return;
  var inicio = null, secoes = [];
  menu.querySelectorAll('a').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    if (href === '/') inicio = { a: a, secao: null };
    else if (href.indexOf('/#') === 0) {
      var el = document.getElementById(href.slice(2));
      if (el) secoes.push({ a: a, secao: el });
    }
  });
  if (!inicio && !secoes.length) return;
  var itens = (inicio ? [inicio] : []).concat(secoes);
  var travaAte = 0, agendado = false;
  function marcar(item) {
    itens.forEach(function (i) {
      if (i === item) i.a.setAttribute('aria-current', i.secao ? 'location' : 'page');
      else i.a.removeAttribute('aria-current');
    });
  }
  function itemNaTela() {
    var limite = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) + 40;
    var ativo = inicio;
    secoes.forEach(function (i) { if (i.secao.getBoundingClientRect().top <= limite) ativo = i; });
    // No fim da página a última seção pode não chegar ao topo: vale a última que aparece.
    var noFim = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    var ultima = secoes[secoes.length - 1];
    if (noFim && ultima && ultima.secao.getBoundingClientRect().top < window.innerHeight) ativo = ultima;
    return ativo;
  }
  function atualizar() {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(function () {
      agendado = false;
      if (Date.now() < travaAte) return;
      var i = itemNaTela();
      if (i) marcar(i);
    });
  }
  itens.forEach(function (i) {
    i.a.addEventListener('click', function (e) {
      marcar(i);
      travaAte = Date.now() + 1000; // a rolagem suave passa pelas outras seções: não troca no caminho
      if (!i.secao) { // "Início" na própria home: sobe sem recarregar
        e.preventDefault();
        window.scrollTo({ top: 0 });
        history.replaceState(null, '', '/');
      }
    });
  });
  window.addEventListener('scroll', atualizar, { passive: true });
  window.addEventListener('scrollend', function () { travaAte = 0; atualizar(); });
  window.addEventListener('hashchange', atualizar);
  window.addEventListener('load', atualizar);
  atualizar();
})();

