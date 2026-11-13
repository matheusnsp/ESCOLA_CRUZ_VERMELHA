// /js/admin-menu.js — menu do painel (2026-11-13; spec docs/superpowers/specs/2026-11-13-menu-submenus-design.md).
// Grupos que abrem e fecham (lembrados neste navegador) e a gaveta do menu no celular/tablet.
// Sem dependências. localStorage pode estar bloqueado (aba anônima, Safari): tudo em try/catch.
(function () {
  'use strict';
  var CHAVE = 'adm-menu-abertos';

  function lerAbertos() {
    try { var v = JSON.parse(window.localStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function gravarAbertos(lista) {
    try { window.localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch (e) { /* sem armazenamento: só não lembra */ }
  }
  function marcar(grp, aberto) {
    grp.classList.toggle('aberto', aberto);
    var b = grp.querySelector('.adm-grp-tit');
    if (b) b.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  }

  function iniciarGrupos() {
    var grupos = document.querySelectorAll('.adm-grp[data-grupo]');
    var abertos = lerAbertos();
    Array.prototype.forEach.call(grupos, function (g) {
      if (abertos.indexOf(g.getAttribute('data-grupo')) >= 0) marcar(g, true);
      var b = g.querySelector('.adm-grp-tit');
      if (!b) return;
      b.addEventListener('click', function () {
        var abrir = !g.classList.contains('aberto');
        marcar(g, abrir);
        var lista = lerAbertos().filter(function (id) { return id !== g.getAttribute('data-grupo'); });
        // O grupo da página atual já abre sozinho; lembramos só os que a pessoa abriu por conta própria.
        if (abrir && !g.classList.contains('ativo')) lista.push(g.getAttribute('data-grupo'));
        gravarAbertos(lista);
      });
    });
  }

  function iniciarGaveta() {
    var btn = document.querySelector('.adm-menu-btn');
    var fundo = document.getElementById('admLadoFundo');
    var fechar = document.querySelector('.adm-lado-fechar');
    if (!btn) return;
    function abrir(sim) {
      document.body.classList.toggle('adm-menu-aberto', sim);
      btn.setAttribute('aria-expanded', sim ? 'true' : 'false');
      if (fundo) fundo.hidden = !sim;
      if (sim && fechar) fechar.focus(); else if (!sim) btn.focus();
    }
    btn.addEventListener('click', function () { abrir(true); });
    if (fechar) fechar.addEventListener('click', function () { abrir(false); });
    if (fundo) fundo.addEventListener('click', function () { abrir(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('adm-menu-aberto')) abrir(false);
    });
  }


  // ---- Filtros no celular (até 620 px): toda .adm-abas ganha um cartão "Mostrando …" que abre uma lista de baixo.
  // As abas continuam no HTML (no computador nada muda); no celular o CSS esconde as abas e mostra o cartão.
  var BAIXAR = /\.(xlsx|csv|pdf)(\?|$)/i;
  function textoAba(a) {
    var n = a.querySelector('.adm-aba-num');
    var t = a.textContent;
    if (n) t = t.replace(n.textContent, '');
    return { rotulo: t.replace(/\s+/g, ' ').trim(), num: n ? n.textContent.trim() : '' };
  }
  function rotuloBaixar(a, rotulo) {
    var href = a.getAttribute('href') || '';
    return (/\.pdf/i.test(href) ? 'Baixar PDF (' : 'Baixar planilha (') + rotulo + ')';
  }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function montarFiltro(abas) {
    var nome = abas.getAttribute('aria-label') || '';
    var cartao = el('button', 'adm-filtro-cel');
    cartao.type = 'button';
    cartao.setAttribute('aria-haspopup', 'dialog');
    abas.parentNode.insertBefore(cartao, abas);

    function atual() {
      var lista = abas.querySelectorAll('.adm-aba');
      for (var i = 0; i < lista.length; i++) if (lista[i].classList.contains('on')) return lista[i];
      for (var j = 0; j < lista.length; j++) if (!BAIXAR.test(lista[j].getAttribute('href') || '')) return lista[j];
      return null;
    }
    function desenharCartao() {
      var a = atual(); var t = a ? textoAba(a) : { rotulo: nome, num: '' };
      cartao.innerHTML = '<i class="fa-solid fa-filter" aria-hidden="true"></i><span class="adm-filtro-txt">Mostrando<b>' + esc(t.rotulo) + '</b></span>' +
        (t.num ? '<span class="adm-filtro-num">' + esc(t.num) + '</span>' : '') + '<i class="fa-solid fa-chevron-down adm-filtro-seta" aria-hidden="true"></i>';
    }
    desenharCartao();

    var fundo = null, folha = null;
    function fechar() {
      if (!folha) return;
      folha.hidden = true; fundo.hidden = true;
      document.removeEventListener('keydown', teclou);
      cartao.focus();
    }
    function teclou(e) { if (e.key === 'Escape') fechar(); }
    function abrir() {
      if (!folha) {
        fundo = el('div', 'adm-folha-fundo'); fundo.hidden = true;
        folha = el('div', 'adm-folha'); folha.hidden = true;
        folha.setAttribute('role', 'dialog'); folha.setAttribute('aria-modal', 'true');
        fundo.addEventListener('click', fechar);
        document.body.appendChild(fundo); document.body.appendChild(folha);
      }
      var titulo = 'Mostrar' + (nome ? ' ' + nome.charAt(0).toLowerCase() + nome.slice(1) : '');
      folha.setAttribute('aria-label', titulo);
      folha.innerHTML = '<div class="adm-folha-puxador" aria-hidden="true"></div><h3>' + esc(titulo) + '</h3>';
      var normais = [], depois = [];
      Array.prototype.forEach.call(abas.querySelectorAll('.adm-aba'), function (a) {
        var baixa = BAIXAR.test(a.getAttribute('href') || '');
        (baixa || a.classList.contains('adm-aba-sep') ? depois : normais).push({ a: a, baixa: baixa });
      });
      function item(x) {
        var t = textoAba(x.a);
        var ehLink = x.a.tagName === 'A';
        var it = el(ehLink ? 'a' : 'button', 'adm-folha-item' + (x.a.classList.contains('on') && !x.baixa ? ' on' : ''));
        if (ehLink) { it.href = x.a.getAttribute('href'); if (x.a.hasAttribute('download')) it.setAttribute('download', ''); } else it.type = 'button';
        var icone = x.baixa ? 'fa-download' : 'fa-check';
        it.innerHTML = '<i class="fa-solid ' + icone + ' adm-folha-ok" aria-hidden="true"></i><span>' + esc(x.baixa ? rotuloBaixar(x.a, t.rotulo) : t.rotulo) + '</span> ' +
          (t.num ? '<span class="adm-folha-num">' + esc(t.num) + '</span>' : '');
        if (!ehLink) it.addEventListener('click', function () { x.a.click(); fechar(); desenharCartao(); });
        else if (x.baixa) it.addEventListener('click', function () { fechar(); });
        folha.appendChild(it);
      }
      normais.forEach(item);
      if (depois.length) { folha.appendChild(el('div', 'adm-folha-sep')); depois.forEach(item); }
      folha.hidden = false; fundo.hidden = false;
      document.addEventListener('keydown', teclou);
      var marcado = folha.querySelector('.adm-folha-item.on') || folha.querySelector('.adm-folha-item');
      if (marcado) marcado.focus();
    }
    cartao.addEventListener('click', abrir);
    // Aba trocada por outro caminho (ex.: o próprio Financeiro no computador): o cartão acompanha.
    abas.addEventListener('click', function () { setTimeout(desenharCartao, 0); });
  }
  function iniciarFiltros() { Array.prototype.forEach.call(document.querySelectorAll('.adm-abas'), montarFiltro); }

  function iniciar() { iniciarGrupos(); iniciarGaveta(); iniciarFiltros(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
