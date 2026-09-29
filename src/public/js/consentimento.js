/* Aviso de cookies da Escola (LGPD; Guia de Cookies da ANPD, 2022).
 *
 * Cópia adaptada do aviso do site principal (cruzvermelhariodejaneiro.org,
 * site/consentimento/consentimento.js): mesmo cookie, mesmos textos e mesmo comportamento.
 *
 * Primeiro nível: um aviso com três botões do mesmo tamanho (Rejeitar, Personalizar, Aceitar todos).
 * Segundo nível: as categorias, com estatística e marketing desligados até a pessoa ligar.
 * A escolha fica no cookie cvrj_consentimento (necessário) por 12 meses. No endereço
 * escola.cruzvermelhariodejaneiro.org o cookie vale para todo *.cruzvermelhariodejaneiro.org,
 * então quem já escolheu no site principal não é perguntado de novo.
 *
 * Quem baixa o Google Analytics e o Pixel da Meta é o bloco de medição do <head>
 * (window.cvrjMedicao, em views/partials/rastreamento.ejs): sem escolha, ou com "não",
 * nada é baixado. Este arquivo só pergunta, grava e avisa o bloco.
 *
 * Diferenças para o original:
 *  - o CSS fica em /consentimento.css: o CSP da escola não aceita <style> injetado;
 *  - só português;
 *  - a Política de Cookies é a do site principal (link com endereço completo).
 *
 * "Preferências de cookies" (rodapé): qualquer elemento com data-cvrj-cookies reabre as categorias.
 */
(function () {
  'use strict';
  if (window.cvrjConsentimento) return;

  var NOME = 'cvrj_consentimento';
  var VERSAO = '1';
  var VALIDADE_S = 365 * 24 * 60 * 60;
  var DOMINIO = /(^|\.)cruzvermelhariodejaneiro\.org$/i.test(location.hostname) ? '.cruzvermelhariodejaneiro.org' : '';
  // A Política de Cookies mora no site principal.
  var URL_POLITICA = 'https://cruzvermelhariodejaneiro.org/cookies/';

  var T = {
    titulo: 'Sua privacidade',
    texto: 'Usamos cookies necessários para o site funcionar. Com a sua permissão, usamos também cookies de estatística (Google Analytics), para saber quais páginas são lidas, e de marketing (Pixel da Meta), para medir nossas campanhas. Você escolhe, e pode mudar quando quiser em “Preferências de cookies”, no rodapé.',
    politica: 'Política de Cookies',
    rejeitar: 'Rejeitar', personalizar: 'Personalizar', aceitar: 'Aceitar todos',
    painel: 'Preferências de cookies',
    intro: 'Escolha quais cookies podemos usar. Os necessários ficam sempre ligados, porque sem eles o site não funciona.',
    categorias: {
      necessarios: ['Necessários', 'Fazem o site funcionar: guardam a sua escolha sobre cookies e mantêm você conectado à sua conta.'],
      estatistica: ['Estatística', 'Google Analytics: conta as visitas e mostra quais páginas são lidas, sem identificar você pelo nome.'],
      marketing: ['Marketing', 'Pixel da Meta (Facebook e Instagram): mede o alcance das nossas campanhas de divulgação.']
    },
    sempre: 'Sempre ligados',
    rejeitarTudo: 'Rejeitar não necessários', salvar: 'Salvar escolhas', fechar: 'Fechar'
  };

  function ler() {
    var m = document.cookie.match(/(?:^|;\s*)cvrj_consentimento=([^;]+)/);
    if (!m) return null;
    var p = {};
    try {
      decodeURIComponent(m[1]).split('&').forEach(function (par) {
        var i = par.indexOf('=');
        if (i > 0) p[par.slice(0, i)] = par.slice(i + 1);
      });
    } catch (e) { return null; }
    if (p.v !== VERSAO) return null;
    return { estatistica: p.e === '1', marketing: p.m === '1', em: parseInt(p.t, 10) || 0 };
  }

  function gravar(c) {
    var valor = 'v=' + VERSAO + '&e=' + (c.estatistica ? 1 : 0) + '&m=' + (c.marketing ? 1 : 0) + '&t=' + Math.floor(Date.now() / 1000);
    document.cookie = NOME + '=' + encodeURIComponent(valor) + '; Max-Age=' + VALIDADE_S + '; Path=/; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '') + (DOMINIO ? '; Domain=' + DOMINIO : '');
  }

  // Quem tira a permissão depois de dar: os cookies das ferramentas saem do navegador (os de
  // primeira parte, que o próprio site consegue apagar).
  function apagarCookiesDeMedicao(estatistica, marketing) {
    var nomes = document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); });
    nomes.forEach(function (n) {
      var ehEstatistica = n === '_ga' || n.indexOf('_ga_') === 0 || n === '_gid' || n.indexOf('_gat') === 0;
      var ehMarketing = n === '_fbp' || n === '_fbc';
      if ((ehEstatistica && !estatistica) || (ehMarketing && !marketing)) {
        ['', location.hostname, DOMINIO].forEach(function (d) {
          document.cookie = n + '=; Max-Age=0; Path=/' + (d ? '; Domain=' + d : '');
        });
      }
    });
  }

  function escolher(c) {
    gravar(c);
    apagarCookiesDeMedicao(c.estatistica, c.marketing);
    if (window.cvrjMedicao && typeof window.cvrjMedicao.aplicar === 'function') window.cvrjMedicao.aplicar(c);
    fecharTudo();
    try { document.dispatchEvent(new CustomEvent('cvrj:consentimento', { detail: c })); } catch (e) { /* navegador antigo */ }
  }

  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'texto') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
    return n;
  }

  function botao(texto, acao) {
    var b = el('button', { type: 'button', texto: texto });
    b.addEventListener('click', acao);
    return b;
  }

  var aviso = null, fundo = null, voltarFoco = null;

  function fecharTudo() {
    if (aviso) { aviso.remove(); aviso = null; }
    if (fundo) { fundo.remove(); fundo = null; document.removeEventListener('keydown', teclado, true); }
    if (voltarFoco && document.contains(voltarFoco)) { try { voltarFoco.focus(); } catch (e) { /* segue */ } }
    voltarFoco = null;
  }

  function mostrarAviso() {
    if (aviso || fundo) return;
    aviso = el('section', { class: 'cvrj-ck', role: 'region', 'aria-labelledby': 'cvrj-ck-t1' }, [
      el('h2', { id: 'cvrj-ck-t1', texto: T.titulo }),
      el('p', {}, [T.texto + ' ', el('a', { href: URL_POLITICA, texto: T.politica }), '.']),
      el('div', { class: 'cvrj-ck-botoes' }, [
        botao(T.rejeitar, function () { escolher({ estatistica: false, marketing: false }); }),
        botao(T.personalizar, function () { abrirPainel(); }),
        botao(T.aceitar, function () { escolher({ estatistica: true, marketing: true }); })
      ])
    ]);
    document.body.appendChild(aviso);
  }

  function categoria(chave, ligada, fixa) {
    var c = T.categorias[chave];
    var entrada = el('input', { type: 'checkbox', role: 'switch', id: 'cvrj-ck-' + chave });
    entrada.checked = !!ligada;
    if (fixa) entrada.disabled = true;
    var rotulo = el('label', { for: 'cvrj-ck-' + chave }, [
      el('span', { texto: c[0] }),
      fixa ? el('span', { class: 'cvrj-ck-sempre', texto: T.sempre }) : null,
      entrada,
      el('span', { class: 'cvrj-ck-chave', 'aria-hidden': 'true' })
    ]);
    return el('div', { class: 'cvrj-ck-cat' }, [rotulo, el('p', { texto: c[1] })]);
  }

  // Fechar o painel sem escolher: o foco volta para onde estava, e quem ainda não escolheu
  // volta a ver o aviso.
  function fecharPainel() {
    if (!fundo) return;
    fundo.remove(); fundo = null;
    document.removeEventListener('keydown', teclado, true);
    var foco = voltarFoco;
    voltarFoco = null;
    if (!ler()) mostrarAviso();
    else if (foco && document.contains(foco)) { try { foco.focus(); } catch (e) { /* segue */ } }
  }

  function teclado(e) {
    if (!fundo) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      fecharPainel();
      return;
    }
    if (e.key !== 'Tab') return;
    var focaveis = fundo.querySelectorAll('button, a[href], input:not([disabled])');
    if (!focaveis.length) return;
    var primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }

  function abrirPainel() {
    if (aviso) { aviso.remove(); aviso = null; }
    if (fundo) return;
    voltarFoco = document.activeElement;
    var atual = ler() || { estatistica: false, marketing: false };
    var catEstatistica = categoria('estatistica', atual.estatistica);
    var catMarketing = categoria('marketing', atual.marketing);
    var painel = el('div', { class: 'cvrj-ck-painel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cvrj-ck-t2' }, [
      botao('×', fecharPainel),
      el('h2', { id: 'cvrj-ck-t2', texto: T.painel }),
      el('p', {}, [T.intro + ' ', el('a', { href: URL_POLITICA, texto: T.politica }), '.']),
      categoria('necessarios', true, true),
      catEstatistica,
      catMarketing,
      el('div', { class: 'cvrj-ck-botoes' }, [
        botao(T.rejeitarTudo, function () { escolher({ estatistica: false, marketing: false }); }),
        botao(T.salvar, function () {
          escolher({
            estatistica: catEstatistica.querySelector('input').checked,
            marketing: catMarketing.querySelector('input').checked
          });
        }),
        botao(T.aceitar, function () { escolher({ estatistica: true, marketing: true }); })
      ])
    ]);
    var fechar = painel.firstChild;
    fechar.className = 'cvrj-ck-fechar';
    fechar.setAttribute('aria-label', T.fechar);
    fundo = el('div', { class: 'cvrj-ck-fundo' }, [painel]);
    fundo.addEventListener('click', function (e) { if (e.target === fundo) fecharPainel(); });
    document.body.appendChild(fundo);
    document.addEventListener('keydown', teclado, true);
    var primeiraChave = painel.querySelector('input:not([disabled])');
    if (primeiraChave) primeiraChave.focus();
  }

  // "Preferências de cookies": qualquer elemento com data-cvrj-cookies abre as categorias.
  document.addEventListener('click', function (e) {
    var alvo = e.target && e.target.closest ? e.target.closest('[data-cvrj-cookies]') : null;
    if (!alvo) return;
    e.preventDefault();
    abrirPainel();
  });

  window.cvrjConsentimento = { ler: ler, abrir: abrirPainel };

  function iniciar() { if (!ler()) mostrarAviso(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
