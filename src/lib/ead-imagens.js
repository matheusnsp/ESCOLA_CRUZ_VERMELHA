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
async function pedirAoClaude({ curso, modulos = [] }, { cliente }) {
  const IA = require('./ead-ia');
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

module.exports = { ErroImagem, temOpenAI, modeloImagem, pedirAoClaude, gerarNaOpenAI, gerarComReserva, SYSTEM_PEDIDOS };
