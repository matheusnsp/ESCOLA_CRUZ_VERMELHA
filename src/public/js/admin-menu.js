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

  function iniciar() { iniciarGrupos(); iniciarGaveta(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
