// Assistente da secretaria (2026-11-13; spec docs/superpowers/specs/2026-11-13-assistente-secretaria-design.md §5).
// Painel de conversa à direita (tela cheia no celular). Fala com POST /assistente/mensagem (NDJSON, um evento por linha).
// Segurança: o texto do modelo NUNCA entra com innerHTML; o Markdown (negrito, listas, tabelas, links) é montado com
// elementos e textContent. Links só no texto final ("resposta", já filtrado no servidor) e só caminhos internos.
// A conversa fica no sessionStorage da aba (some ao fechar a aba). O assistente não salva nada no sistema.
(function () {
  'use strict';
  var botao = document.getElementById('admAssistBtn');
  if (!botao) return;
  var botaoTopo = document.querySelector('.adm-assist-top');
  var CSRF = botao.getAttribute('data-csrf') || '';
  var CHAVE = 'adm-assistente-conversa';
  var CHAVE_PREENCHER = 'adm-assistente-preencher';
  var VALIDADE_PREENCHER = 30 * 60 * 1000;
  var NOMES_FERRAMENTAS = {
    buscar_alunos: 'Procurando aluno…', ver_aluno: 'Abrindo os dados do aluno…', listar_pendentes: 'Olhando os pendentes…',
    listar_turmas: 'Olhando as turmas…', listar_cursos: 'Olhando os cursos…', escrever_textos_curso: 'Escrevendo os textos do curso…',
    preencher_curso: 'Preparando o formulário…', preencher_turma: 'Preparando o formulário…',
  };
  var ROTULOS = {
    curso: {
      nome: 'Nome', descricao: 'Resumo', descricaoLonga: 'Texto completo', cargaHoraria: 'Carga horária (h)', escolaridadeMinima: 'Escolaridade mínima',
      categoria: 'Área', precoAvista: 'Preço à vista', precoCheio: 'Total no parcelado', parcelas: 'Máximo de parcelas', taxaMatricula: 'Taxa de inscrição',
      nomeCertificado: 'Nome no certificado', conteudoProgramatico: 'Conteúdo programático', certificadoValidade: 'Validade do certificado',
      exigeComprovanteSaude: 'Exige comprovante de saúde', pedido: 'Ordem na lista', ativo: 'Aparece no site', faqs: 'Dúvidas frequentes',
    },
    turma: {
      cursoId: 'Curso', inicioPrevisto: 'Início previsto', vagas: 'Vagas', minimoAlunos: 'Mínimo de alunos', instrutorNome: 'Instrutor',
      instrutorRegistro: 'Registro do instrutor', status: 'Situação', aulas: 'Aulas',
    },
  };
  var DESTINO = { curso: { caminho: '/cursos/novo', rotulo: 'Abrir Novo curso e preencher' }, turma: { caminho: '/turmas/nova', rotulo: 'Abrir Nova turma e preencher' } };

  // ---------- guardar ----------
  function ler(chave, guardado) {
    try { var v = guardado.getItem(chave); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { if (valor == null) sessionStorage.removeItem(chave); else sessionStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* aba sem storage: segue só na memória */ }
  }
  var conversa = ler(CHAVE, window.sessionStorage) || [];
  if (!Array.isArray(conversa)) conversa = [];
  function salvarConversa() { gravar(CHAVE, conversa.slice(-40)); }

  // ---------- montar o painel (texto fixo, sem nada do modelo) ----------
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function icone(nome) { var i = el('i', 'fa-solid ' + nome); i.setAttribute('aria-hidden', 'true'); return i; }

  var painel = el('aside', 'adm-assist');
  painel.id = 'admAssist';
  painel.setAttribute('role', 'dialog');
  painel.setAttribute('aria-label', 'Assistente da secretaria');
  painel.hidden = true;

  var cab = el('div', 'adm-assist-cab');
  var ico = el('span', 'adm-assist-ico'); ico.appendChild(icone('fa-wand-magic-sparkles'));
  var tit = el('div', 'adm-assist-tit');
  tit.appendChild(el('strong', null, 'Assistente da secretaria'));
  tit.appendChild(el('small', null, 'Tira dúvidas e mostra o caminho no painel'));
  var nova = el('button', 'adm-assist-nova'); nova.type = 'button'; nova.title = 'Nova conversa'; nova.setAttribute('aria-label', 'Nova conversa');
  nova.appendChild(icone('fa-rotate-left'));
  var fechar = el('button', 'adm-assist-x'); fechar.type = 'button'; fechar.setAttribute('aria-label', 'Fechar o assistente');
  fechar.appendChild(icone('fa-xmark'));
  cab.appendChild(ico); cab.appendChild(tit); cab.appendChild(nova); cab.appendChild(fechar);

  var corpo = el('div', 'adm-assist-corpo');
  var onde = el('div', 'adm-assist-onde');
  onde.appendChild(icone('fa-location-dot'));
  onde.appendChild(document.createTextNode(' Você está em '));
  onde.appendChild(el('strong', null, tituloDaPagina()));
  var msgs = el('div', 'adm-assist-msgs');
  var vazio = el('p', 'adm-assist-vazio', 'Pergunte quem não pagou, procure um aluno pelo nome, e-mail, telefone ou CPF, ou peça o caminho para fazer algo no painel.');
  corpo.appendChild(onde); corpo.appendChild(vazio); corpo.appendChild(msgs);

  var sug = el('div', 'adm-assist-sug');
  var SUGESTOES = [
    { t: 'Quem não pagou?', enviar: 'Quem ainda não pagou?' },
    { t: 'Procurar aluno', preencher: 'Procure o aluno ' },
    { t: 'Como faço…?', preencher: 'Como faço para ' },
  ];
  if (document.querySelector('form [name=cargaHoraria]')) SUGESTOES.push({ t: 'Escrever os textos', enviar: 'Escreva os textos deste curso e preencha o formulário.' });
  else SUGESTOES.push({ t: 'Criar curso', preencher: 'Quero criar um curso: ' });
  SUGESTOES.forEach(function (s) {
    var b = el('button', null, s.t); b.type = 'button';
    b.addEventListener('click', function () {
      if (s.enviar) { enviar(s.enviar); return; }
      campo.value = s.preencher; ajustarAltura(); campo.focus();
      try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch (e) { /* ok */ }
    });
    sug.appendChild(b);
  });

  var form = el('form', 'adm-assist-form');
  var campo = el('textarea');
  campo.rows = 1; campo.maxLength = 2000; campo.setAttribute('aria-label', 'Sua pergunta');
  campo.placeholder = 'Escreva sua pergunta';
  var enviarBtn = el('button'); enviarBtn.type = 'submit'; enviarBtn.setAttribute('aria-label', 'Enviar');
  enviarBtn.appendChild(icone('fa-paper-plane'));
  form.appendChild(campo); form.appendChild(enviarBtn);
  var aviso = el('p', 'adm-assist-aviso', 'O assistente consulta e preenche formulários, mas não salva nada: quem salva é você.');

  painel.appendChild(cab); painel.appendChild(corpo); painel.appendChild(sug); painel.appendChild(form); painel.appendChild(aviso);
  document.body.appendChild(painel);

  function tituloDaPagina() {
    var h = document.querySelector('.adm-wrap h1, main h1, h1.adm-h1');
    var t = h && h.textContent.replace(/\s+/g, ' ').trim();
    if (!t) { var o = document.querySelector('.adm-topo-onde'); t = o && o.textContent.trim(); }
    return t || document.title || 'Painel';
  }

  // ---------- abrir / fechar ----------
  // Celular e tablet (toque ou até 1024 px): abrir NÃO dá foco ao campo. O foco abria o teclado e empurrava a tela;
  // a pessoa toca no campo quando quiser escrever. No computador, o foco vai direto para o campo.
  function telaDeToque() {
    try { return window.matchMedia('(max-width: 1024px), (hover: none) and (pointer: coarse)').matches; } catch (e) { return false; }
  }
  function focarCampo() { if (!telaDeToque()) campo.focus(); }
  painel.tabIndex = -1; // no toque, o foco fica no painel (leitor de tela anuncia o diálogo) sem abrir o teclado
  var quemAbriu = null;
  function abrir(origem) {
    quemAbriu = origem || botao;
    painel.hidden = false;
    document.body.classList.add('adm-assist-aberto');
    travarPagina();
    corDoSafari(true);
    [botao, botaoTopo].forEach(function (b) { if (b) b.setAttribute('aria-expanded', 'true'); });
    rolarFim();
    if (telaDeToque()) { try { painel.focus({ preventScroll: true }); } catch (e) { painel.focus(); } } else campo.focus();
    ajustarAoTeclado();
  }
  // Teclado do celular: o painel acompanha a área visível (visualViewport), então o campo fica acima do teclado
  // e a página por trás não é empurrada.
  function ajustarAoTeclado() {
    var vv = window.visualViewport;
    if (!vv || painel.hidden || !window.matchMedia || !window.matchMedia('(max-width: 620px)').matches) { painel.style.top = ''; painel.style.height = ''; return; }
    painel.style.top = vv.offsetTop + 'px';
    painel.style.height = vv.height + 'px';
    rolarFim();
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustarAoTeclado);
    window.visualViewport.addEventListener('scroll', ajustarAoTeclado);
  }
  // Na 1ª vez que o teclado abre (e ao mandar a 1ª mensagem), o Safari do iPhone muda a área visível sem avisar
  // (sem resize/scroll), e o painel ficava fora do lugar até a próxima mudança. Reajusta algumas vezes seguidas.
  var sincronias = [];
  function sincronizarTeclado() {
    sincronias.forEach(clearTimeout);
    ajustarAoTeclado();
    sincronias = [60, 180, 360, 650, 1000].map(function (ms) { return setTimeout(ajustarAoTeclado, ms); });
  }
  // iPhone: com o painel em tela cheia, ao abrir o teclado o Safari rolava a página por trás (o topo do painel sumia
  // e a página aparecia embaixo). overflow:hidden não basta no iOS; prender o body com position:fixed resolve.
  // Ao fechar, a página volta exatamente para onde estava.
  var rolagemTravada = null;
  // Barras do próprio Safari (endereço e a barra ↑ ↓ ✓ em cima do teclado) ficam fora da página; a única forma de
  // mudar a cor delas é a meta theme-color. Com o painel aberto, a cor do painel; ao fechar, volta a de antes.
  var corAntes = null;
  function corDoSafari(abrindo) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (abrindo) {
      if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m); m.setAttribute('data-assist', ''); }
      if (corAntes === null) corAntes = m.getAttribute('content') || '';
      m.setAttribute('content', getComputedStyle(painel).backgroundColor);
    } else if (m && corAntes !== null) {
      if (m.hasAttribute('data-assist') && !corAntes) m.parentNode.removeChild(m); else m.setAttribute('content', corAntes);
      corAntes = null;
    }
  }
  function travarPagina() {
    if (rolagemTravada !== null || !window.matchMedia || !window.matchMedia('(max-width: 620px)').matches) return;
    rolagemTravada = window.scrollY || window.pageYOffset || 0;
    var b = document.body.style;
    b.position = 'fixed'; b.top = -rolagemTravada + 'px'; b.left = '0'; b.right = '0'; b.width = '100%';
  }
  function soltarPagina() {
    if (rolagemTravada === null) return;
    var y = rolagemTravada; rolagemTravada = null;
    var b = document.body.style;
    b.position = ''; b.top = ''; b.left = ''; b.right = ''; b.width = '';
    window.scrollTo(0, y);
  }
  function fecharPainel() {
    painel.hidden = true;
    document.body.classList.remove('adm-assist-aberto');
    soltarPagina();
    corDoSafari(false);
    painel.style.top = ''; painel.style.height = '';
    [botao, botaoTopo].forEach(function (b) { if (b) b.setAttribute('aria-expanded', 'false'); });
    var volta = quemAbriu && quemAbriu.offsetParent !== null ? quemAbriu : (botaoTopo && botaoTopo.offsetParent !== null ? botaoTopo : botao);
    if (volta) volta.focus();
  }
  botao.addEventListener('click', function () { if (painel.hidden) abrir(botao); else fecharPainel(); });
  if (botaoTopo) botaoTopo.addEventListener('click', function () { if (painel.hidden) abrir(botaoTopo); else fecharPainel(); });
  fechar.addEventListener('click', fecharPainel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !painel.hidden && !document.querySelector('.adm-modal-overlay.aberto')) { e.preventDefault(); fecharPainel(); }
  });
  nova.addEventListener('click', function () {
    if (ocupado) return;
    conversa = []; salvarConversa(); msgs.textContent = ''; atualizarVazio(); focarCampo();
  });

  // ---------- Markdown restrito ----------
  // Inline: **negrito**, `código`, [texto](/caminho). Links só com comLinks e só caminhos internos (começam com uma "/").
  var RE_INLINE = /\*\*([^*]+?)\*\*|`([^`]+)`|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g; // mesmo padrão do filtrarLinks do servidor
  function inline(pai, texto, comLinks) {
    var ultimo = 0; var m;
    RE_INLINE.lastIndex = 0;
    while ((m = RE_INLINE.exec(texto))) {
      if (m.index > ultimo) pai.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
      if (m[1] != null) pai.appendChild(el('strong', null, m[1]));
      else if (m[2] != null) pai.appendChild(el('code', null, m[2]));
      else if (comLinks && /^\/(?!\/)[^\s\\]*$/.test(m[4])) {
        var a = el('a', 'adm-assist-link', m[3]);
        a.href = m[4];
        a.appendChild(icone('fa-arrow-right'));
        pai.appendChild(a);
      } else pai.appendChild(document.createTextNode(m[3]));
      ultimo = RE_INLINE.lastIndex;
    }
    if (ultimo < texto.length) pai.appendChild(document.createTextNode(texto.slice(ultimo)));
  }
  function celulas(linha) {
    var s = linha.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.trim(); });
  }
  function markdown(texto, comLinks) {
    var frag = document.createDocumentFragment();
    var linhas = String(texto || '').replace(/\r/g, '').split('\n');
    var i = 0;
    while (i < linhas.length) {
      var l = linhas[i];
      if (!l.trim()) { i++; continue; }
      if (/^\s*\|/.test(l)) { // tabela
        var tabela = el('table'); var corpoT = null; var primeira = true;
        var caixa = el('div', 'adm-assist-tabela'); caixa.appendChild(tabela);
        while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
          var cs = celulas(linhas[i]);
          if (cs.every(function (c) { return /^:?-{2,}:?$/.test(c); })) { i++; continue; }
          var tr = el('tr');
          var cab = primeira && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}/.test(linhas[i + 1]);
          cs.forEach(function (c) { var td = el(cab ? 'th' : 'td'); inline(td, c, comLinks); tr.appendChild(td); });
          if (cab) { var th = el('thead'); th.appendChild(tr); tabela.appendChild(th); } else { if (!corpoT) { corpoT = el('tbody'); tabela.appendChild(corpoT); } corpoT.appendChild(tr); }
          primeira = false; i++;
        }
        frag.appendChild(caixa); continue;
      }
      var lista = /^\s*(\d+)[.)]\s+/.test(l) ? 'ol' : (/^\s*[-*•]\s+/.test(l) ? 'ul' : null);
      if (lista) {
        var ul = el(lista);
        var re = lista === 'ol' ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/;
        while (i < linhas.length && re.test(linhas[i])) { var li = el('li'); inline(li, linhas[i].replace(re, ''), comLinks); ul.appendChild(li); i++; }
        frag.appendChild(ul); continue;
      }
      var h = /^\s*#{1,6}\s+(.*)$/.exec(l);
      if (h) { var ph = el('p', 'adm-assist-subtit'); inline(ph, h[1], comLinks); frag.appendChild(ph); i++; continue; }
      var p = el('p'); var partes = [];
      while (i < linhas.length && linhas[i].trim() && !/^\s*(\||\d+[.)]\s|[-*•]\s|#{1,6}\s)/.test(linhas[i])) { partes.push(linhas[i].trim()); i++; }
      partes.forEach(function (t, k) { if (k) p.appendChild(el('br')); inline(p, t, comLinks); });
      // Parágrafo só de links (ex.: "[Abrir Pendentes](…)"): viram botões. Link no meio da frase fica como texto.
      var links = p.querySelectorAll('a');
      if (links.length) {
        var sobra = p.textContent;
        Array.prototype.forEach.call(links, function (a) { sobra = sobra.replace(a.textContent, ''); });
        if (!/[\p{L}\p{N}]/u.test(sobra)) {
          p.className = 'adm-assist-botoes';
          Array.prototype.forEach.call(p.childNodes, function (n) { if (n.nodeType === 3) n.textContent = ''; });
        }
      }
      frag.appendChild(p);
    }
    return frag;
  }

  // ---------- mensagens na tela ----------
  function atualizarVazio() { vazio.hidden = msgs.children.length > 0; }
  function rolarFim() { corpo.scrollTop = corpo.scrollHeight; }
  function bolhaEu(texto) { var b = el('div', 'adm-assist-eu', texto); msgs.appendChild(b); return b; }
  function bolhaIa(texto) { var b = el('div', 'adm-assist-ia'); b.appendChild(markdown(texto, true)); msgs.appendChild(b); return b; }
  function caixaErro(texto) { var b = el('div', 'adm-assist-erro'); b.setAttribute('role', 'alert'); b.appendChild(icone('fa-circle-exclamation')); b.appendChild(document.createTextNode(' ' + texto)); msgs.appendChild(b); return b; }
  function nota(texto) { var b = el('div', 'adm-assist-nota'); b.appendChild(icone('fa-circle-check')); b.appendChild(document.createTextNode(' ' + texto)); msgs.appendChild(b); atualizarVazio(); rolarFim(); }

  function valorLegivel(formulario, k, v, prop) {
    if (k === 'faqs') return v.length + (v.length === 1 ? ' dúvida' : ' dúvidas') + ': ' + v.map(function (f) { return f.pergunta; }).join(' · ');
    if (k === 'aulas') return v.length + (v.length === 1 ? ' aula' : ' aulas') + ': ' + v.map(function (a) { return dataBr(a.data) + ' ' + a.horario; }).join(' · ');
    if (k === 'cursoId') return prop.cursoNome || 'curso escolhido';
    if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
    if (/^(precoAvista|precoCheio|taxaMatricula)$/.test(k)) return 'R$ ' + String(v).replace('.', ',');
    if (k === 'inicioPrevisto') return dataBr(v);
    return String(v);
  }
  function dataBr(d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(d || ''); }

  function cartao(prop) {
    var c = el('div', 'adm-assist-cartao');
    var cabC = el('div', 'adm-assist-cartao-tit');
    cabC.appendChild(icone(prop.formulario === 'turma' ? 'fa-calendar-plus' : 'fa-file-pen'));
    var nomeForm = prop.formulario === 'turma' ? 'turma' : 'curso';
    cabC.appendChild(document.createTextNode(prop.editar ? ' Editar ' + nomeForm + ': ' + prop.editar.nome : (nomeForm === 'turma' ? ' Nova turma' : ' Novo curso')));
    c.appendChild(cabC);
    var dl = el('dl');
    var rot = ROTULOS[prop.formulario] || {};
    Object.keys(prop.campos || {}).forEach(function (k) {
      var v = prop.campos[k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
      var linha = el('div');
      linha.appendChild(el('dt', null, rot[k] || k));
      var t = valorLegivel(prop.formulario, k, v, prop);
      linha.appendChild(el('dd', null, t.length > 160 ? t.slice(0, 157) + '…' : t));
      dl.appendChild(linha);
    });
    c.appendChild(dl);
    var acoes = el('div', 'adm-assist-cartao-acoes');
    var f = acharFormulario(prop);
    if (f) {
      var b = el('button', 'adm-btn adm-assist-preencher'); b.type = 'button';
      b.appendChild(icone('fa-pen-to-square')); b.appendChild(document.createTextNode(' Preencher na tela'));
      b.addEventListener('click', function () {
        // Celular: fecha antes (destrava a página) para a rolagem até o primeiro campo preenchido valer.
        if (window.matchMedia && window.matchMedia('(max-width: 620px)').matches) fecharPainel();
        var r = preencher(f, prop);
        nota(r.faltaram.length ? 'Preenchi o formulário (não achei na tela: ' + r.faltaram.join(', ') + '). Confira e clique em Salvar.' : 'Preenchi o formulário. Confira e clique em Salvar.');
      });
      acoes.appendChild(b);
    } else {
      var d = destino(prop);
      var a = el('a', 'adm-btn adm-assist-abrir'); a.href = d.caminho;
      a.appendChild(icone('fa-arrow-up-right-from-square')); a.appendChild(document.createTextNode(' ' + d.rotulo));
      a.addEventListener('click', function () {
        gravar(CHAVE_PREENCHER, { formulario: prop.formulario, campos: prop.campos, editar: prop.editar, caminho: d.caminho, criadoEm: Date.now() });
      });
      acoes.appendChild(a);
    }
    acoes.appendChild(el('small', null, 'Nada é salvo até você clicar em Salvar.'));
    c.appendChild(acoes);
    msgs.appendChild(c);
    return c;
  }

  function desenharConversa() {
    msgs.textContent = '';
    conversa.forEach(function (m) {
      if (m.papel === 'pessoa') bolhaEu(m.texto);
      else if (m.papel === 'assistente') {
        if (m.texto) bolhaIa(m.texto);
        (m.preencher || []).forEach(cartao);
      } else if (m.papel === 'erro') caixaErro(m.texto);
    });
    atualizarVazio();
  }

  // ---------- preencher formulários ----------
  // Onde a proposta vale: edição de um curso/turma -> só na tela de edição DELE; senão -> só em Novo curso / Nova turma.
  // (Antes, qualquer formulário na tela servia: "mude o preço do Socorrista" podia cair num curso novo ou em outro curso.)
  function destino(prop) {
    if (prop.editar && /^\/(cursos|turmas)\/[0-9a-f-]{36}\/editar$/i.test(prop.editar.caminho)) {
      return { caminho: prop.editar.caminho, rotulo: 'Abrir a edição de ' + prop.editar.nome + ' e preencher' };
    }
    return DESTINO[prop.formulario] || DESTINO.curso;
  }
  function acharFormulario(prop) {
    if (location.pathname !== destino(prop).caminho) return null;
    return formularioDaTela(prop.formulario);
  }
  function formularioDaTela(tipo) {
    var c = tipo === 'turma' ? document.querySelector('form [name=cursoId]') : document.querySelector('form [name=cargaHoraria]');
    var f = c && c.form;
    if (!f) return null;
    if (tipo === 'curso' && !f.querySelector('[name=nome]')) return null;
    return f;
  }
  function avisar(e) {
    e.dispatchEvent(new Event('input', { bubbles: true }));
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function porNome(f, nome) { return f.querySelector('[name="' + nome + '"]'); }
  function definir(e, v) {
    if (!e) return false;
    if (e.type === 'checkbox') e.checked = !!v;
    else if (e.tagName === 'SELECT') {
      var ok = Array.prototype.some.call(e.options, function (o) { return o.value === String(v); });
      if (!ok) return false;
      e.value = String(v);
    } else e.value = String(v);
    avisar(e);
    return true;
  }
  function preencher(f, prop) {
    var faltaram = []; var primeiro = null;
    var rot = ROTULOS[prop.formulario] || {};
    Object.keys(prop.campos || {}).forEach(function (k) {
      var v = prop.campos[k];
      var ok;
      if (k === 'faqs') ok = preencherFaqs(f, v);
      else if (k === 'aulas') ok = preencherAulas(f, v);
      else { var e = porNome(f, k); ok = definir(e, v); if (ok && !primeiro) primeiro = e; }
      if (!ok) faltaram.push(rot[k] || k);
    });
    if (primeiro && primeiro.scrollIntoView) { try { primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { primeiro.scrollIntoView(); } }
    return { faltaram: faltaram };
  }
  function preencherFaqs(f, faqs) {
    if (!faqs || !faqs.length) return true;
    var bloco = f.querySelector('.ia-textos');
    if (bloco && bloco.hasAttribute('data-sem-faqs')) return false; // curso já criado: dúvidas ficam na seção própria
    var caixa = f.querySelector('.ia-faqs'); var lista = f.querySelector('.ia-faqs-lista');
    if (!lista) return false;
    lista.textContent = '';
    faqs.forEach(function (q, i) {
      var linha = el('div', 'ia-faq');
      var rotulo = el('label', 'check');
      var cb = el('input'); cb.type = 'checkbox'; cb.name = 'faqsIa[' + i + '][usar]'; cb.value = '1'; cb.checked = true;
      rotulo.appendChild(cb); rotulo.appendChild(document.createTextNode(' Usar'));
      var p = el('input'); p.type = 'text'; p.name = 'faqsIa[' + i + '][pergunta]'; p.maxLength = 200; p.value = q.pergunta;
      var r = el('textarea'); r.name = 'faqsIa[' + i + '][resposta]'; r.rows = 2; r.maxLength = 600; r.value = String(q.resposta || '').slice(0, 600);
      linha.appendChild(rotulo); linha.appendChild(p); linha.appendChild(r);
      lista.appendChild(linha);
    });
    if (caixa) caixa.hidden = false;
    return true;
  }
  function preencherAulas(f, aulas) {
    var lista = f.querySelector('#aulas-lista') || document.getElementById('aulas-lista');
    var adicionar = document.getElementById('btnAdicionarAula');
    if (!lista) return false;
    for (var k = 0; k < aulas.length; k++) {
      var linhas = lista.querySelectorAll('.aula-linha');
      var alvo = null;
      for (var j = 0; j < linhas.length; j++) {
        var d = linhas[j].querySelector('input[type=date]');
        if (d && !d.value && !linhas[j].hasAttribute('data-assist-usada')) { alvo = linhas[j]; break; }
      }
      if (!alvo) {
        if (!adicionar) return false;
        adicionar.click();
        linhas = lista.querySelectorAll('.aula-linha');
        alvo = linhas[linhas.length - 1];
      }
      if (!alvo) return false;
      alvo.setAttribute('data-assist-usada', '');
      var data = alvo.querySelector('input[type=date]'); var hora = alvo.querySelector('input[type=text]');
      if (data) { data.value = aulas[k].data; avisar(data); }
      if (hora) { hora.value = aulas[k].horario; avisar(hora); }
    }
    Array.prototype.forEach.call(lista.querySelectorAll('[data-assist-usada]'), function (l) { l.removeAttribute('data-assist-usada'); });
    return true;
  }

  // ---------- conversar ----------
  var ocupado = false;
  function ajustarAltura() { campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 160) + 'px'; }
  campo.addEventListener('input', ajustarAltura);
  campo.addEventListener('focus', sincronizarTeclado);
  campo.addEventListener('blur', sincronizarTeclado);
  campo.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(campo.value); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); enviar(campo.value); });

  function enviar(texto) {
    texto = String(texto || '').trim();
    if (!texto || ocupado) return;
    if (painel.hidden) abrir(botao);
    ocupado = true; enviarBtn.disabled = true; painel.classList.add('ocupado');
    campo.value = ''; ajustarAltura(); sincronizarTeclado();
    conversa.push({ papel: 'pessoa', texto: texto });
    salvarConversa();
    bolhaEu(texto); atualizarVazio();
    var bolha = el('div', 'adm-assist-ia escrevendo');
    var status = el('div', 'adm-assist-status'); status.appendChild(el('span', 'adm-assist-pontos')); status.appendChild(document.createTextNode(' Pensando…'));
    bolha.appendChild(status);
    msgs.appendChild(bolha); rolarFim();
    var parcial = ''; var final = null; var propostas = []; var erro = null;

    function mostrarParcial() {
      bolha.textContent = '';
      if (parcial) bolha.appendChild(markdown(parcial, false));
      bolha.appendChild(status);
    }
    function tratar(ev) {
      if (!ev || !ev.tipo) return;
      if (ev.tipo === 'texto') { parcial += ev.texto || ''; status.lastChild.textContent = ' Escrevendo…'; mostrarParcial(); }
      else if (ev.tipo === 'ferramenta') { status.lastChild.textContent = ' ' + (NOMES_FERRAMENTAS[ev.nome] || 'Consultando…'); }
      else if (ev.tipo === 'preencher') { // Mesmo formulário (e mesmo curso/turma, se for edição) na mesma resposta: junta num cartão só
        // (ex.: os textos do "Escrever com IA" + os valores), para um botão só preencher tudo.
        var alvoId = ev.editar ? ev.editar.id : null;
        var igual = propostas.filter(function (x) { return x.formulario === ev.formulario && (x.editar ? x.editar.id : null) === alvoId; })[0];
        if (igual) { Object.keys(ev.campos || {}).forEach(function (k) { igual.campos[k] = ev.campos[k]; }); if (ev.cursoNome) igual.cursoNome = ev.cursoNome; }
        else propostas.push({ formulario: ev.formulario, campos: Object.assign({}, ev.campos || {}), cursoNome: ev.cursoNome, editar: ev.editar }); }
      else if (ev.tipo === 'resposta') { final = String(ev.texto || ''); }
      else if (ev.tipo === 'erro') { erro = ev.mensagem || 'O assistente está fora do ar agora. Tente de novo em instantes.'; }
      rolarFim();
    }
    function terminar() {
      bolha.remove();
      // Sem a "resposta" final (já filtrada no servidor), o texto parcial fica sem links.
      var texto = final != null ? final : (erro ? '' : parcial.replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, '$1'));
      if (texto || propostas.length) {
        conversa.push({ papel: 'assistente', texto: texto, preencher: propostas.length ? propostas : undefined });
        if (texto) bolhaIa(texto);
        propostas.forEach(cartao);
      }
      if (erro) { conversa.push({ papel: 'erro', texto: erro }); caixaErro(erro); }
      salvarConversa();
      atualizarVazio(); rolarFim();
      ocupado = false; enviarBtn.disabled = false; painel.classList.remove('ocupado');
      sincronizarTeclado();
      if (!painel.hidden) focarCampo(); // no toque, não puxa o teclado de volta sozinho
    }

    var corpoPedido = {
      _csrf: CSRF,
      pagina: { caminho: location.pathname, busca: location.search },
      mensagens: conversa.filter(function (m) { return m.papel === 'pessoa' || m.papel === 'assistente'; })
        .slice(-20).map(function (m) { return { papel: m.papel, texto: m.texto }; })
        .filter(function (m) { return m.texto; }),
    };
    fetch('/assistente/mensagem', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify(corpoPedido),
    }).then(function (res) {
      var tipo = res.headers.get('content-type') || '';
      if (res.redirected || res.status === 401 || res.status === 403 || /text\/html/.test(tipo)) {
        throw new Error('sessao');
      }
      if (!res.ok || tipo.indexOf('ndjson') === -1) throw new Error('http');
      var resto = '';
      function linhasDe(pedaco) {
        resto += pedaco;
        var partes = resto.split('\n'); resto = partes.pop();
        partes.forEach(function (l) { if (l.trim()) { try { tratar(JSON.parse(l)); } catch (e) { /* linha quebrada: ignora */ } } });
      }
      if (!res.body || !res.body.getReader || typeof TextDecoder === 'undefined') return res.text().then(function (t) { linhasDe(t + '\n'); });
      var leitor = res.body.getReader(); var dec = new TextDecoder();
      function passo() {
        return leitor.read().then(function (r) {
          if (r.done) { linhasDe(dec.decode() + '\n'); return; }
          linhasDe(dec.decode(r.value, { stream: true }));
          return passo();
        });
      }
      return passo();
    }).catch(function (e) {
      if (final == null && !erro) erro = e && e.message === 'sessao'
        ? 'Sua sessão expirou. Recarregue a página e entre de novo.'
        : 'Não consegui falar com o assistente. Confira a internet e tente de novo.';
    }).then(function () {
      if (final == null && !erro && !parcial && !propostas.length) erro = 'O assistente está fora do ar agora. Tente de novo em instantes.';
      terminar();
    });
  }

  desenharConversa();

  // ---------- chegou de "Abrir … e preencher" ----------
  var pendente = ler(CHAVE_PREENCHER, window.sessionStorage);
  if (pendente) {
    gravar(CHAVE_PREENCHER, null); // uso único
    var valido = pendente.caminho === location.pathname && typeof pendente.criadoEm === 'number' && Date.now() - pendente.criadoEm < VALIDADE_PREENCHER;
    var fAlvo = valido && acharFormulario(pendente);
    if (fAlvo) {
      abrir(botao);
      var r = preencher(fAlvo, pendente);
      nota(r.faltaram.length ? 'Preenchi o formulário (não achei na tela: ' + r.faltaram.join(', ') + '). Confira e clique em Salvar.' : 'Preenchi o formulário. Confira e clique em Salvar.');
    }
  }
})();
