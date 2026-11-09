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
- no text, no letters, no numbers, no logos, no brands anywhere in the image;
- no blood, no wounds, no people in pain or distress; no child face in the foreground (children only from behind, far away, or hands);
- never the Red Cross emblem (a red cross on white is protected by law): first-aid kits with a green or white cross, or no cross at all;
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

// Gera uma imagem na OpenAI e devolve o Buffer (PNG). Lança ErroImagem em qualquer falha.
async function gerarNaOpenAI(prompt, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let r;
    try {
      r = await fetch(URL_OPENAI, {
        method: 'POST',
        headers: { Authorization: `Bearer ${String(process.env.OPENAI_API_KEY || '').trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modeloImagem(), prompt, size: '1536x1024', quality: 'medium', n: 1 }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ErroImagem(e.name === 'AbortError' ? 'A OpenAI demorou demais para gerar a imagem.' : `Não foi possível falar com a OpenAI: ${e.message}`);
    }
    const corpo = await r.json().catch(() => null);
    if (!r.ok) {
      const msg = corpo && corpo.error ? corpo.error.message || corpo.error.code : `HTTP ${r.status}`;
      throw new ErroImagem(`A OpenAI recusou ou falhou (${r.status}): ${msg}`);
    }
    const item = corpo && Array.isArray(corpo.data) ? corpo.data[0] : null;
    if (item && item.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item && item.url) {
      const d = await fetch(item.url, { signal: ctrl.signal }).catch((e) => { throw new ErroImagem(`Não foi possível baixar a imagem: ${e.message}`); });
      if (!d.ok) throw new ErroImagem(`Não foi possível baixar a imagem (${d.status}).`);
      const buf = Buffer.from(await d.arrayBuffer());
      if (buf.length) return buf;
    }
    throw new ErroImagem('A OpenAI respondeu sem imagem.');
  } finally {
    clearTimeout(timer);
  }
}

// Tenta o pedido; se falhar, o pedido curto; as duas falham → null (o alvo fica vazio, com a descrição).
async function gerarComReserva({ pedido, pedidoCurto }, opts = {}) {
  for (const p of [pedido, pedidoCurto].filter(Boolean)) {
    try {
      return await gerarNaOpenAI(p, opts);
    } catch (e) {
      if (!(e instanceof ErroImagem)) throw e;
      console.error('[EAD IMAGENS]', e.message);
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

// Gera (com reserva) e guarda em WebP; null se a OpenAI não gerou.
async function gerarEGuardar(p, opts) {
  const buf = await gerarComReserva(p, { fetch: fetchDe(opts) });
  if (!buf) return null;
  const url = await salvarFotoCurso({ buffer: buf, mimetype: 'image/png' });
  await contarImagem();
  return url;
}

// Uma geração de imagens por alvo por vez (duplo clique; passo da fila + botão). Marca em Configuracao (como a fila
// da IA): criada no começo, apagada no fim; vence em 15 min (serviço que morreu no meio). Sem transação longa aberta.
const VALIDADE_TRAVA_MS = 15 * 60 * 1000;
const OCUPADO = 'As imagens já estão sendo geradas. Aguarde um pouco e recarregue a página.';
async function comTrava(nome, fn, seOcupado) {
  const chave = `ead-ia:imagens-ocupado:${nome}`;
  const meu = `${Date.now()}:${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await prisma.configuracao.create({ data: { chave, valor: meu } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    const atual = await prisma.configuracao.findUnique({ where: { chave } });
    const hora = atual ? Number(String(atual.valor).split(':')[0]) || 0 : 0;
    if (atual && Date.now() - hora < VALIDADE_TRAVA_MS) return seOcupado;
    const r = await prisma.configuracao.updateMany({ where: { chave, valor: atual ? atual.valor : '' }, data: { valor: meu } });
    if (!r.count) return seOcupado;
  }
  try {
    return await fn();
  } finally {
    await prisma.configuracao.deleteMany({ where: { chave, valor: meu } }).catch(() => {});
  }
}

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
    let geradas = 0; let descricoes = 0;
    if (capaVazia) {
      descricoes++;
      const url = comChave ? await gerarEGuardar(pedidos.capa, { fetch }) : null;
      // Só grava a imagem se a capa continua vazia (alguém pode ter enviado uma enquanto gerava).
      const r = await prisma.curso.updateMany({
        where: { id: co.curso.id, imagemUrl: null },
        data: { imagemPedido: pedidos.capa.pedido, imagemSugestao: pedidos.capa.descricao, ...(url ? { imagemUrl: url, imagemGeradaPorIa: true } : {}) },
      });
      if (url && r.count) geradas++; else if (url) await removerFotoCurso(url);
    }
    for (const p of pedidos.modulos) {
      descricoes++;
      const url = comChave ? await gerarEGuardar(p, { fetch }) : null;
      const r = await prisma.moduloEad.updateMany({
        where: { id: p.moduloId, fotoIntroUrl: null },
        data: { fotoPedido: p.pedido, fotoSugestao: p.descricao, ...(url ? { fotoIntroUrl: url, fotoGeradaPorIa: true } : {}) },
      });
      if (url && r.count) geradas++; else if (url) await removerFotoCurso(url);
    }
    return { geradas, descricoes, aviso: comChave ? null : AVISO_SEM_CHAVE };
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
    const url = await gerarEGuardar(pedidos.capa, { fetch });
    if (!url) return { ok: false, erro: 'A OpenAI não conseguiu gerar a imagem. Tente de novo ou envie uma imagem.' };
    await prisma.curso.update({ where: { id: c.id }, data: { imagemUrl: url, imagemPedido: pedidos.capa.pedido, imagemSugestao: pedidos.capa.descricao, imagemGeradaPorIa: true } });
    if (c.imagemUrl) await removerFotoCurso(c.imagemUrl).catch(() => {});
    return { ok: true };
  }, { ok: false, erro: OCUPADO });
}

// "Gerar outra": mesmo pedido, imagem nova; a antiga é apagada. tipo 'curso' (id do Curso) ou 'modulo'.
async function gerarOutra({ tipo, id }, opts = {}) {
  const semPedido = { ok: false, erro: 'Ainda não há pedido de imagem: use Gerar imagens com IA.' };
  if (!temOpenAI()) return { ok: false, erro: 'Sem chave da OpenAI: configure OPENAI_API_KEY no Render para gerar imagens.' };
  return comTrava(`${tipo}:${id}`, async () => {
    const alvo = tipo === 'modulo'
      ? await prisma.moduloEad.findUnique({ where: { id }, select: { fotoPedido: true, fotoIntroUrl: true } })
      : await prisma.curso.findUnique({ where: { id }, select: { imagemPedido: true, imagemUrl: true } });
    if (!alvo) return { ok: false, erro: 'Não encontrado.' };
    const pedido = tipo === 'modulo' ? alvo.fotoPedido : alvo.imagemPedido;
    if (!pedido) return semPedido;
    const url = await gerarEGuardar({ pedido }, opts);
    if (!url) return { ok: false, erro: 'A OpenAI não conseguiu gerar a imagem. Tente de novo ou envie uma imagem.' };
    const antiga = tipo === 'modulo' ? alvo.fotoIntroUrl : alvo.imagemUrl;
    if (tipo === 'modulo') await prisma.moduloEad.update({ where: { id }, data: { fotoIntroUrl: url, fotoGeradaPorIa: true } });
    else await prisma.curso.update({ where: { id }, data: { imagemUrl: url, imagemGeradaPorIa: true } });
    if (antiga) await removerFotoCurso(antiga).catch(() => {});
    return { ok: true };
  }, { ok: false, erro: OCUPADO });
}

module.exports = {
  ErroImagem, temOpenAI, modeloImagem, pedirAoClaude, gerarNaOpenAI, gerarComReserva, SYSTEM_PEDIDOS,
  AVISO_SEM_CHAVE, OCUPADO, definirFetch, definirCliente, contagem, imagensDoCursoOnline, imagemDoCurso, gerarOutra,
};
