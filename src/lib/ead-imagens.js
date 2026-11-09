// lib/ead-imagens.js
//
// Imagens com IA (2026-11-09): a capa do curso e a imagem de abertura de cada módulo. O Claude (Anthropic) escreve o
// pedido de cada imagem; a API de imagens da OpenAI gera. As imagens entram em WebP (salvarFotoCurso).
// Spec: docs/superpowers/specs/2026-11-09-ead-ia-fotos.md

const E = require('./ead-ia-esquema');

const URL_OPENAI = 'https://api.openai.com/v1/images/generations';
const TIMEOUT_MS = 120 * 1000;

class ErroImagem extends Error {}

const temOpenAI = () => !!String(process.env.OPENAI_API_KEY || '').trim();
const modeloImagem = () => String(process.env.OPENAI_IMAGE_MODEL || '').trim() || 'gpt-image-1';

// Regras que o Claude segue em todo pedido (spec §2). Em inglês: o pedido vai para o gerador em inglês.
const SYSTEM_PEDIDOS = `You write image-generation prompts for the cover and the module images of an online first-aid and health course of the Escola de Educação e Saúde (Rio de Janeiro, Brazil).
For each image return:
- "pedido": the full prompt in English (max 600 characters);
- "pedidoCurto": a simpler, safer version in English (max 200 characters), used if the first one is refused;
- "descricao": what the image shows, in Brazilian Portuguese (max 200 characters).
Rules for every prompt (repeat them inside each prompt):
- realistic photography, natural light, horizontal framing, empty space on the left side;
- no written text, letters or numbers, and no other brands or logos anywhere in the image;
- no blood, no wounds, no people in pain or distress; no child face in the foreground (children only from behind, far away, or hands);
- follow the visual identity of the Cruz Vermelha Brasileira (Brazilian Red Cross) and its school website: red and white palette; the red cross on white may appear (instructors in white polo shirts with the red cross and red trousers, first-aid kits with a red cross, a Red Cross classroom); warm, professional, realistic style like the school site photos;
- Brazilian people with natural diversity and Brazilian settings (school, home, workplace) when it fits;
- the same visual style across all images of the course: define one style and apply it to every prompt.`;

// curso: { nome, descricao, categoria }; modulos: [{ id, titulo, topicos: [titulo] }] (vazio no curso presencial).
async function pedirAoClaude({ curso, modulos = [] }, opts = {}) {
  const IA = require('./ead-ia');
  const cliente = clienteDe(opts);
  const lista = modulos.map((m, i) => `${i + 1}. [moduloId: ${m.id}] ${m.titulo}${m.topicos && m.topicos.length ? `: ${m.topicos.join('; ')}` : ''}`).join('\n');
  const texto = [
    `Curso: ${curso.nome}`,
    curso.descricao ? `Descrição: ${curso.descricao}` : null,
    curso.categoria ? `Área: ${curso.categoria}` : null,
    modulos.length ? `Módulos:\n${lista}\n\nEscreva o pedido da capa e um pedido para cada módulo (use o moduloId exato).` : 'Escreva só o pedido da capa (a lista de módulos fica vazia).',
  ].filter(Boolean).join('\n');
  const { json, usage } = await IA.chamarClaude(cliente, {
    system: SYSTEM_PEDIDOS,
    messages: [{ role: 'user', content: [{ type: 'text', text: texto }] }],
    schema: E.ESQUEMA_PEDIDOS_IMAGENS,
    effort: 'low',
  });
  const v = E.validarPedidosImagens(json, modulos.map((m) => m.id));
  if (!v.ok) throw Object.assign(new IA.ErroIa(v.erro), { usage });
  return { pedidos: v.pedidos, usage };
}

// Modelo de imagem: OPENAI_IMAGE_MODEL ou gpt-image-1. Se a conta não tiver esse modelo ("does not exist"), o
// sistema consulta a lista de modelos da chave (/v1/models), escolhe o de imagem mais novo e guarda (2026-11-09).
let modeloDescoberto = null;
const esquecerModelo = () => { modeloDescoberto = null; };
const modeloAtual = () => modeloDescoberto || modeloImagem();
const versao = (id) => Number((String(id).match(/gpt-image-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
function escolherModelo(ids) {
  const gpt = ids.filter((id) => /^gpt-image/.test(id));
  const cheio = gpt.filter((id) => !/mini/.test(id)).sort((a, b) => versao(b) - versao(a) || b.length - a.length);
  if (cheio.length) return cheio[0];
  if (gpt.length) return gpt.sort((a, b) => versao(b) - versao(a))[0];
  return ids.includes('dall-e-3') ? 'dall-e-3' : null;
}
// dall-e-3 tem tamanhos e qualidades próprios.
const corpo = (model, prompt) => (/^dall-e/.test(model)
  ? { model, prompt, size: '1792x1024', quality: 'standard', n: 1, response_format: 'b64_json' }
  : { model, prompt, size: '1536x1024', quality: 'medium', n: 1 });
const naoExiste = (status, corpoResp) => (status === 400 || status === 404)
  && /does not exist|model_not_found/i.test(JSON.stringify((corpoResp && corpoResp.error) || ''));

// Gera uma imagem na OpenAI e devolve o Buffer (PNG). Lança ErroImagem em qualquer falha.
async function gerarNaOpenAI(prompt, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const auth = { Authorization: `Bearer ${String(process.env.OPENAI_API_KEY || '').trim()}` };
  const chamar = async (url, opts) => {
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      throw new ErroImagem(e.name === 'AbortError' ? 'A OpenAI demorou demais para gerar a imagem.' : `Não foi possível falar com a OpenAI: ${e.message}`);
    }
  };
  try {
    let model = modeloAtual();
    let r = await chamar(URL_OPENAI, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo(model, prompt)) });
    let resp = await r.json().catch(() => null);
    if (!r.ok && naoExiste(r.status, resp)) {
      const lista = await chamar('https://api.openai.com/v1/models', { method: 'GET', headers: auth });
      const dados = await lista.json().catch(() => null);
      const novo = escolherModelo(((dados && dados.data) || []).map((m) => m.id));
      if (!novo) throw new ErroImagem(`A sua conta da OpenAI não tem nenhum modelo de imagem disponível (o modelo "${model}" não existe para esta chave). Veja em platform.openai.com se o projeto da chave tem acesso a modelos de imagem.`);
      if (novo !== model) {
        console.log(`[EAD IMAGENS] Modelo "${model}" não existe nesta conta; usando "${novo}".`);
        modeloDescoberto = novo; model = novo;
        r = await chamar(URL_OPENAI, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo(model, prompt)) });
        resp = await r.json().catch(() => null);
      }
    }
    if (!r.ok) {
      const msg = resp && resp.error ? resp.error.message || resp.error.code : `HTTP ${r.status}`;
      throw new ErroImagem(`A OpenAI recusou ou falhou (${r.status}): ${msg}`);
    }
    const item = resp && Array.isArray(resp.data) ? resp.data[0] : null;
    if (item && item.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item && item.url) {
      const d = await chamar(item.url, { method: 'GET' });
      if (!d.ok) throw new ErroImagem(`Não foi possível baixar a imagem (${d.status}).`);
      const buf = Buffer.from(await d.arrayBuffer());
      if (buf.length) return buf;
    }
    throw new ErroImagem('A OpenAI respondeu sem imagem.');
  } finally {
    clearTimeout(timer);
  }
}

// opts.erros (lista, opcional) recebe o motivo de cada falha, para a tela mostrar o que a OpenAI respondeu.
async function gerarComReserva({ pedido, pedidoCurto }, opts = {}) {
  for (const p of [pedido, pedidoCurto].filter(Boolean)) {
    try {
      return await gerarNaOpenAI(p, opts);
    } catch (e) {
      if (!(e instanceof ErroImagem)) throw e;
      console.error('[EAD IMAGENS]', e.message);
      if (Array.isArray(opts.erros)) opts.erros.push(e.message);
    }
  }
  return null;
}

// ─── Banco: gravar, gerar outra, contar ─────────────────────────────────────────────────────────
const prisma = require('../db');
const { transacao } = require('./transacao');
const { salvarFotoCurso, removerFotoCurso } = require('./upload');

const AVISO_SEM_CHAVE = 'Sem chave da OpenAI: as descrições do Claude estão em cada módulo, envie as imagens.';
let fetchFixo = null; // testes fixam um fetch falso (definirFetch)
const definirFetch = (f) => { fetchFixo = f || null; };
let clienteFixo = null; // e um cliente do Claude falso (definirCliente); senão, o cliente padrão da etapa 9
const definirCliente = (c) => { clienteFixo = c || null; };
const clienteDe = (o) => (o && o.cliente) || clienteFixo || require('./ead-ia').clientePadrao();
const fetchDe = (o) => (o && o.fetch) || fetchFixo || globalThis.fetch;

// Contadores (sem limite: o painel só mostra quantas foram geradas).
const chaveMes = () => `ead-ia:imagens:${require('./ead-ia').mesRio()}`;
const CHAVE_TOTAL = 'ead-ia:imagens:total';
async function contarImagem() {
  for (const chave of [chaveMes(), CHAVE_TOTAL]) {
    await transacao(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chave}))`;
      const c = await tx.configuracao.findUnique({ where: { chave } });
      const valor = String((c ? Number(c.valor) || 0 : 0) + 1);
      await tx.configuracao.upsert({ where: { chave }, update: { valor }, create: { chave, valor } });
    });
  }
}
async function contagem() {
  const ler = async (chave) => { const c = await prisma.configuracao.findUnique({ where: { chave } }).catch(() => null); return c ? Number(c.valor) || 0 : 0; };
  return { mes: await ler(chaveMes()), total: await ler(CHAVE_TOTAL) };
}

// A mensagem da tela quando a OpenAI não gera: com o motivo que ela devolveu (ex.: organização não verificada).
const msgFalha = (erros) => `A OpenAI não conseguiu gerar a imagem${erros && erros.length ? `: ${String(erros[erros.length - 1]).slice(0, 300)}` : ''}. Tente de novo ou envie uma imagem.`;

// Gera (com reserva) e guarda em WebP; null se a OpenAI não gerou.
// Regras acrescentadas no fim de todo pedido (2026-11-09), inclusive o escrito pela pessoa. Os cursos são da
// própria Cruz Vermelha: as imagens seguem a identidade do site e da instituição (vermelho e branco, a cruz vermelha
// liberada), sem texto escrito nem outras marcas, sem sangue e sem rosto de criança em destaque.
const REGRAS_IMAGEM = 'Rules: realistic photography, horizontal framing; follow the visual identity of the Cruz Vermelha Brasileira (Brazilian Red Cross) and its school: red and white palette, the red cross on white is allowed (instructors in white shirts with the red cross and red trousers, first-aid kits with a red cross); no written text, letters or numbers and no other brands; no blood, wounds or people in distress; no child face in the foreground.';
const comRegras = (t) => (t ? `${t}\n\n${REGRAS_IMAGEM}` : t);

async function gerarEGuardar(p, opts) {
  const buf = await gerarComReserva({ pedido: comRegras(p.pedido), pedidoCurto: comRegras(p.pedidoCurto) }, { fetch: fetchDe(opts), erros: opts && opts.erros });
  if (!buf) return null;
  const url = await salvarFotoCurso({ buffer: buf, mimetype: 'image/png' });
  await contarImagem();
  return url;
}

// Uma geração de imagens por alvo por vez (duplo clique; passo da fila + botão). Marca em Configuracao (como a fila
// da IA): criada no começo, **renovada** a cada `renovarMs` enquanto gera (revisão I3: uma geração longa não perde a
// trava) e apagada no fim; vence em `validadeMs` sem renovação (serviço que morreu no meio). Sem transação aberta.
let renovarMs = 60 * 1000;
let validadeMs = 3 * 60 * 1000;
const configurar = (o = {}) => { if (o.renovarMs) renovarMs = o.renovarMs; if (o.validadeMs) validadeMs = o.validadeMs; };
const OCUPADO = 'As imagens já estão sendo geradas. Aguarde um pouco e recarregue a página.';
const chaveTrava = (nome) => `ead-ia:imagens-ocupado:${nome}`;
const novoValorTrava = () => `${Date.now()}:${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
async function travaOcupada(nome) {
  const atual = await prisma.configuracao.findUnique({ where: { chave: chaveTrava(nome) } }).catch(() => null);
  return !!atual && Date.now() - (Number(String(atual.valor).split(':')[0]) || 0) < validadeMs;
}
async function comTrava(nome, fn, seOcupado) {
  const chave = chaveTrava(nome);
  let meu = novoValorTrava();
  try {
    await prisma.configuracao.create({ data: { chave, valor: meu } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    const atual = await prisma.configuracao.findUnique({ where: { chave } });
    const hora = atual ? Number(String(atual.valor).split(':')[0]) || 0 : 0;
    if (atual && Date.now() - hora < validadeMs) return seOcupado;
    const r = await prisma.configuracao.updateMany({ where: { chave, valor: atual ? atual.valor : '' }, data: { valor: meu } });
    if (!r.count) return seOcupado;
  }
  const timer = setInterval(async () => {
    const novo = novoValorTrava();
    const r = await prisma.configuracao.updateMany({ where: { chave, valor: meu }, data: { valor: novo } }).catch(() => ({ count: 0 }));
    if (r.count === 1) meu = novo;
  }, renovarMs);
  timer.unref();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await prisma.configuracao.deleteMany({ where: { chave, valor: meu } }).catch(() => {});
  }
}

// Revisão I4: os botões do painel não esperam as imagens (atrás do Cloudflare, mais de 100 s vira erro 524). O
// trabalho roda em segundo plano e o resultado fica em Configuracao `ead-ia:imagens-status:<nome>`, mostrado na
// página. `ocioso()` espera os trabalhos em andamento (testes).
const emAndamento = new Set();
const chaveStatus = (nome) => `ead-ia:imagens-status:${nome}`;
async function gravarStatus(nome, st) {
  const valor = JSON.stringify({ ...st, em: new Date().toISOString() });
  await prisma.configuracao.upsert({ where: { chave: chaveStatus(nome) }, update: { valor }, create: { chave: chaveStatus(nome), valor } }).catch((e) => console.error('[EAD IMAGENS] status:', e.message));
}
// fn() devolve { ok, msg }; trava = nome da trava que o trabalho usa (para a página saber se ainda está gerando).
function emSegundoPlano(nome, trava, fn) {
  const p = (async () => {
    await gravarStatus(nome, { estado: 'gerando', trava });
    let st;
    try {
      const r = await fn();
      st = { estado: r.ok ? 'ok' : 'erro', msg: r.msg };
    } catch (e) {
      console.error('[EAD IMAGENS] segundo plano:', e.message);
      st = { estado: 'erro', msg: 'Não foi possível gerar as imagens agora. Tente de novo em alguns minutos.' };
    }
    await gravarStatus(nome, st);
  })();
  emAndamento.add(p);
  p.finally(() => emAndamento.delete(p));
}
async function statusDe(nome) {
  const c = await prisma.configuracao.findUnique({ where: { chave: chaveStatus(nome) } }).catch(() => null);
  if (!c) return null;
  let st; try { st = JSON.parse(c.valor); } catch (e) { return null; }
  if (st.estado === 'gerando' && !(await travaOcupada(st.trava)) && Date.now() - new Date(st.em).getTime() > validadeMs) {
    return { estado: 'erro', msg: 'A geração das imagens foi interrompida (o servidor reiniciou). Clique de novo para continuar.', em: st.em };
  }
  return st;
}
const ocioso = async () => { while (emAndamento.size) await Promise.all([...emAndamento]); };

// Curso online: capa e abertura dos módulos, só o que está vazio. { geradas, descricoes, aviso }.
async function imagensDoCursoOnline(cursoOnlineId, { cliente, fetch, custo = () => {} } = {}) {
  return comTrava(`curso-online:${cursoOnlineId}`, async () => {
    const co = await prisma.cursoOnline.findUnique({
      where: { id: cursoOnlineId },
      include: { curso: true, modulos: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], include: { topicos: { orderBy: { ordem: 'asc' }, select: { titulo: true } } } } },
    });
    if (!co) return { geradas: 0, descricoes: 0, aviso: null };
    const vazios = co.modulos.filter((m) => !m.fotoIntroUrl);
    const capaVazia = !co.curso.imagemUrl;
    if (!capaVazia && !vazios.length) return { geradas: 0, descricoes: 0, aviso: null };
    const { pedidos, usage } = await pedirAoClaude({
      curso: { nome: co.curso.nome, descricao: co.curso.descricao, categoria: null },
      modulos: vazios.map((m) => ({ id: m.id, titulo: m.titulo, topicos: m.topicos.map((t) => t.titulo) })),
    }, { cliente });
    await custo(usage);
    const comChave = temOpenAI();
    const erros = [];
    let geradas = 0; let descricoes = 0;
    if (capaVazia) {
      descricoes++;
      const url = comChave ? await gerarEGuardar(pedidos.capa, { fetch, erros }) : null;
      // Só grava a imagem se a capa continua vazia (alguém pode ter enviado uma enquanto gerava).
      const r = await prisma.curso.updateMany({
        where: { id: co.curso.id, imagemUrl: null },
        data: { imagemPedido: pedidos.capa.pedido, imagemSugestao: pedidos.capa.descricao, ...(url ? { imagemUrl: url, imagemGeradaPorIa: true } : {}) },
      });
      if (url && r.count) geradas++; else if (url) await removerFotoCurso(url);
    }
    for (const p of pedidos.modulos) {
      descricoes++;
      const url = comChave ? await gerarEGuardar(p, { fetch, erros }) : null;
      // Revisão I2: imagem nova num módulo validado volta o módulo a rascunho (precisa de revisão), como toda
      // mudança de conteúdo do módulo.
      const r = await transacao(async (tx) => {
        const u = await tx.moduloEad.updateMany({
          where: { id: p.moduloId, fotoIntroUrl: null },
          data: { fotoPedido: p.pedido, fotoSugestao: p.descricao, ...(url ? { fotoIntroUrl: url, fotoGeradaPorIa: true } : {}) },
        });
        if (url && u.count) await require('./ead-db').invalidarSeValidado(tx, p.moduloId, 'SISTEMA', 'imagem de abertura gerada por IA');
        return u;
      });
      if (url && r.count) geradas++; else if (url) await removerFotoCurso(url);
    }
    return { geradas, descricoes, aviso: comChave ? null : AVISO_SEM_CHAVE, motivo: erros[0] || null };
  }, { geradas: 0, descricoes: 0, aviso: OCUPADO });
}

// Curso presencial (só a imagem do curso): sempre gera e troca; a antiga é apagada depois de gravar a nova.
async function imagemDoCurso(cursoId, { cliente, fetch, custo = () => {} } = {}) {
  if (!temOpenAI()) return { ok: false, erro: 'Sem chave da OpenAI: configure OPENAI_API_KEY no Render para gerar imagens.' };
  return comTrava(`curso:${cursoId}`, async () => {
    const c = await prisma.curso.findUnique({ where: { id: cursoId } });
    if (!c) return { ok: false, erro: 'Curso não encontrado.' };
    const extras = await require('./extras').lerExtra('curso', c.id).catch(() => ({}));
    const { pedidos, usage } = await pedirAoClaude({ curso: { nome: c.nome, descricao: c.descricao, categoria: (extras && extras.categoria) || null } }, { cliente });
    await custo(usage);
    const erros = [];
    const url = await gerarEGuardar(pedidos.capa, { fetch, erros });
    if (!url) return { ok: false, erro: msgFalha(erros) };
    await prisma.curso.update({ where: { id: c.id }, data: { imagemUrl: url, imagemPedido: pedidos.capa.pedido, imagemSugestao: pedidos.capa.descricao, imagemGeradaPorIa: true } });
    if (c.imagemUrl) await removerFotoCurso(c.imagemUrl).catch(() => {});
    return { ok: true };
  }, { ok: false, erro: OCUPADO });
}

// "Gerar outra": mesmo pedido, imagem nova; a antiga é apagada. tipo 'curso' (id do Curso) ou 'modulo'.
// "Escrever pedido com o Claude" (2026-11-09): o Claude escreve o pedido de UM alvo (curso ou módulo) e devolve,
// sem gerar a imagem nem gravar nada; a pessoa edita e confirma em "Gerar com este pedido". { pedido, descricao, usage }.
async function sugerirPedido({ tipo, id }, opts = {}) {
  if (tipo === 'modulo') {
    const m = await prisma.moduloEad.findUnique({ where: { id }, include: { topicos: { orderBy: { ordem: 'asc' }, select: { titulo: true } }, cursoOnline: { include: { curso: true } } } });
    if (!m) throw new ErroImagem('Módulo não encontrado.');
    const c = m.cursoOnline.curso;
    const { pedidos, usage } = await pedirAoClaude({ curso: { nome: c.nome, descricao: c.descricao }, modulos: [{ id: m.id, titulo: m.titulo, topicos: m.topicos.map((t) => t.titulo) }] }, opts);
    const p = pedidos.modulos[0] || pedidos.capa;
    return { pedido: p.pedido, descricao: p.descricao, usage };
  }
  const c = await prisma.curso.findUnique({ where: { id } });
  if (!c) throw new ErroImagem('Curso não encontrado.');
  const ex = await require('./extras').lerExtra('curso', c.id).catch(() => ({}));
  const { pedidos, usage } = await pedirAoClaude({ curso: { nome: c.nome, descricao: c.descricao, categoria: (ex && ex.categoria) || null } }, opts);
  return { pedido: pedidos.capa.pedido, descricao: pedidos.capa.descricao, usage };
}

// pedidoNovo (opcional): o pedido escrito ou editado pela pessoa (até 1000 caracteres). É guardado e usado no lugar
// do anterior; a descrição antiga do Claude sai (não vale para o pedido novo).
async function gerarOutra({ tipo, id, pedido: pedidoNovo }, opts = {}) {
  const semPedido = { ok: false, erro: 'Ainda não há pedido de imagem: use Gerar imagens com IA.' };
  if (!temOpenAI()) return { ok: false, erro: 'Sem chave da OpenAI: configure OPENAI_API_KEY no Render para gerar imagens.' };
  return comTrava(`${tipo}:${id}`, async () => {
    const alvo = tipo === 'modulo'
      ? await prisma.moduloEad.findUnique({ where: { id }, select: { fotoPedido: true, fotoIntroUrl: true } })
      : await prisma.curso.findUnique({ where: { id }, select: { imagemPedido: true, imagemUrl: true } });
    if (!alvo) return { ok: false, erro: 'Não encontrado.' };
    const escrito = String(pedidoNovo || '').trim().slice(0, 1000);
    if (escrito) {
      if (tipo === 'modulo') await prisma.moduloEad.update({ where: { id }, data: { fotoPedido: escrito, fotoSugestao: null } });
      else await prisma.curso.update({ where: { id }, data: { imagemPedido: escrito, imagemSugestao: null } });
    }
    const pedido = escrito || (tipo === 'modulo' ? alvo.fotoPedido : alvo.imagemPedido);
    if (!pedido) return semPedido;
    const erros = [];
    const url = await gerarEGuardar({ pedido }, { ...opts, erros });
    if (!url) return { ok: false, erro: msgFalha(erros) };
    const antiga = tipo === 'modulo' ? alvo.fotoIntroUrl : alvo.imagemUrl;
    if (tipo === 'modulo') {
      await transacao(async (tx) => {
        await tx.moduloEad.update({ where: { id }, data: { fotoIntroUrl: url, fotoGeradaPorIa: true } });
        await require('./ead-db').invalidarSeValidado(tx, id, 'SISTEMA', 'imagem de abertura gerada por IA');
      });
    }
    else await prisma.curso.update({ where: { id }, data: { imagemUrl: url, imagemGeradaPorIa: true } });
    if (antiga) await removerFotoCurso(antiga).catch(() => {});
    return { ok: true };
  }, { ok: false, erro: OCUPADO });
}

module.exports = {
  ErroImagem, temOpenAI, modeloImagem, esquecerModelo, escolherModelo, pedirAoClaude, gerarNaOpenAI, gerarComReserva, SYSTEM_PEDIDOS,
  AVISO_SEM_CHAVE, OCUPADO, msgFalha, REGRAS_IMAGEM, definirFetch, definirCliente, configurar, emSegundoPlano, statusDe, ocioso, travaOcupada, contagem, imagensDoCursoOnline, imagemDoCurso, gerarOutra, sugerirPedido,
};
