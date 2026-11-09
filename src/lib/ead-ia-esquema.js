// lib/ead-ia-esquema.js
//
// Criar curso com IA (etapa 9): os esquemas JSON que a API do Claude segue na resposta (structured outputs),
// a validação das regras que o esquema não garante (quantas perguntas, uma alternativa correta, módulo final só
// no fim…) e a conta de custo. O esquema da API só aceita tipos e campos; as contagens ficam aqui, com zod.
// Spec: docs/superpowers/specs/2026-11-11-ead-ia.md §5.4

const { z } = require('zod');

// ─── Esquemas da API (todo objeto fecha com additionalProperties: false e lista todos os campos em required) ──
const objeto = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const lista = (items) => ({ type: 'array', items });
const texto = { type: 'string' };
const textoOuNulo = { type: ['string', 'null'] };

const ESQUEMA_ROTEIRO = objeto({
  modulos: lista(objeto({
    titulo: texto,
    minutos: { type: 'integer' },
    final: { type: 'boolean' },
    topicos: lista(objeto({ titulo: texto })),
    cenarios: lista(objeto({ titulo: texto })),
  })),
});

const ESQUEMA_MODULO = objeto({
  introducao: texto,
  topicos: lista(objeto({
    titulo: texto,
    telas: lista(objeto({
      titulo: texto, texto, revisaoTitulo: textoOuNulo, revisaoItens: lista(texto), alerta: textoOuNulo, dica: textoOuNulo,
    })),
    perguntas: lista(objeto({
      enunciado: texto,
      alternativas: lista(objeto({ texto, correta: { type: 'boolean' } })),
      porque: texto,
    })),
  })),
  cenarios: lista(objeto({
    titulo: texto,
    cena: texto,
    tempoSugeridoSeg: { type: 'integer' },
    decisoes: lista(objeto({
      pergunta: texto,
      opcoes: lista(objeto({ texto, correta: { type: 'boolean' }, porque: texto })),
    })),
  })),
});

// Criação passo a passo (2026-11): a proposta do curso a partir da ideia (passo 2).
const ESQUEMA_PROPOSTA = objeto({
  nome: texto, descricao: texto, cargaHoraria: { type: 'integer' }, publico: texto, tema: texto,
  nModulos: { type: 'integer' }, precoSugerido: { type: 'number' }, maxParcelas: { type: 'integer' }, observacoes: texto,
  porqueCargaHoraria: texto, porqueModulos: texto, porquePreco: texto,
  // Escrever com IA (2026-11-09): as dúvidas frequentes do curso vêm na proposta e entram no curso ao criar.
  faqs: lista(objeto({ pergunta: texto, resposta: texto })),
});

// Proposta da IA: números ajustados às faixas do formulário; nome e tema obrigatórios.
// Imagens com IA (2026-11-09): o pedido de cada imagem (capa e abertura dos módulos), escrito pelo Claude.
const PEDIDO_IMAGEM = { pedido: texto, pedidoCurto: texto, descricao: texto };
const ESQUEMA_PEDIDOS_IMAGENS = objeto({
  capa: objeto(PEDIDO_IMAGEM),
  modulos: lista(objeto({ moduloId: texto, ...PEDIDO_IMAGEM })),
});

const faixa = (v, min, max, padrao) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const corta = (v, max) => String(v || '').trim().slice(0, max);
// Escrever com IA (2026-11-09): textos do curso (presencial e só online) e as dúvidas frequentes.
const FAQ = objeto({ pergunta: texto, resposta: texto });
const ESQUEMA_TEXTOS_PRESENCIAL = objeto({ descricao: texto, descricaoLonga: texto, conteudoProgramatico: texto, faqs: lista(FAQ) });
const ESQUEMA_TEXTOS_ONLINE = objeto({ descricao: texto, faqs: lista(FAQ) });
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
// Dúvidas: sem vazias nem repetidas, cortes nos limites, no máximo `max`.
function limparFaqs(lista, max = 6) {
  const vistas = new Set();
  const r = [];
  for (const f of Array.isArray(lista) ? lista : []) {
    const pergunta = corta(f && f.pergunta, 200); const resposta = corta(f && f.resposta, 600);
    if (!pergunta || !resposta || vistas.has(semAcento(pergunta))) continue;
    vistas.add(semAcento(pergunta));
    r.push({ pergunta, resposta });
    if (r.length >= max) break;
  }
  return r;
}
function validarTextos(json, tipo) {
  const j = json || {};
  if (tipo === 'online') return { descricao: corta(j.descricao, 1000), faqs: limparFaqs(j.faqs) };
  return { descricao: corta(j.descricao, 300), descricaoLonga: corta(j.descricaoLonga, 3000), conteudoProgramatico: String(j.conteudoProgramatico || '').replace(/\r\n/g, '\n').trim().slice(0, 4000), faqs: limparFaqs(j.faqs) };
}

function validarPedidosImagens(json, moduloIds) {
  const limpo = (x) => ({ pedido: corta(x.pedido, 600), pedidoCurto: corta(x.pedidoCurto, 200), descricao: corta(x.descricao, 200) });
  if (!json || !json.capa || !corta(json.capa.pedido, 600)) return { ok: false, erro: 'A IA não devolveu o pedido da imagem da capa.' };
  const validos = new Set(moduloIds || []);
  const vistos = new Set();
  const modulos = (Array.isArray(json.modulos) ? json.modulos : [])
    .filter((m) => m && validos.has(m.moduloId) && corta(m.pedido, 600) && !vistos.has(m.moduloId) && vistos.add(m.moduloId))
    .map((m) => ({ moduloId: m.moduloId, ...limpo(m) }));
  return { ok: true, pedidos: { capa: limpo(json.capa), modulos } };
}

function validarProposta(json) {
  const j = json || {};
  const nome = corta(j.nome, 120); const tema = corta(j.tema, 300);
  if (!nome || !tema) return { ok: false, erro: 'A proposta da IA veio sem nome ou sem tema. Peça outra proposta.' };
  return {
    ok: true,
    proposta: {
      nome, tema, descricao: corta(j.descricao, 500), publico: corta(j.publico, 200), observacoes: corta(j.observacoes, 2000),
      cargaHoraria: Math.round(faixa(j.cargaHoraria, 1, 600, 4)), nModulos: Math.round(faixa(j.nModulos, 2, 12, 4)),
      precoSugerido: Math.round(faixa(j.precoSugerido, 0, 10000, 0) * 100) / 100, maxParcelas: Math.round(faixa(j.maxParcelas, 1, 12, 1)),
      porqueCargaHoraria: corta(j.porqueCargaHoraria, 300), porqueModulos: corta(j.porqueModulos, 300), porquePreco: corta(j.porquePreco, 300),
      faqs: limparFaqs(j.faqs),
    },
  };
}

// ─── Roteiro ───────────────────────────────────────────────────────────────────────────────────
const MSG_ROTEIRO = {
  modulos: 'O roteiro precisa de 2 a 12 módulos.',
  topicos: 'Cada módulo comum precisa de 1 a 6 tópicos.',
  final: 'Só o último módulo pode ser o final.',
  cenarios: 'O módulo final precisa de 2 a 4 cenários.',
  titulo: 'Todo módulo e tópico precisa de título.',
};
const titulo = (t) => typeof t === 'string' && t.trim().length > 0;

function validarRoteiro(json) {
  const mods = json && Array.isArray(json.modulos) ? json.modulos : [];
  if (mods.length < 2 || mods.length > 12) return { ok: false, erro: MSG_ROTEIRO.modulos };
  // Módulo final tem cenários e não tem tópicos (regra do editor, lib/ead-db.js): os tópicos dele são ignorados.
  if (mods.some((m) => !m.final && (!Array.isArray(m.topicos) || m.topicos.length < 1 || m.topicos.length > 6))) return { ok: false, erro: MSG_ROTEIRO.topicos };
  if (mods.some((m, i) => m.final && i !== mods.length - 1)) return { ok: false, erro: MSG_ROTEIRO.final };
  const ultimo = mods[mods.length - 1];
  if (ultimo.final && (!Array.isArray(ultimo.cenarios) || ultimo.cenarios.length < 2 || ultimo.cenarios.length > 4)) return { ok: false, erro: MSG_ROTEIRO.cenarios };
  if (mods.some((m) => !titulo(m.titulo) || (!m.final && m.topicos.some((t) => !titulo(t && t.titulo))) || (m.final && m.cenarios.some((c) => !titulo(c && c.titulo))))) return { ok: false, erro: MSG_ROTEIRO.titulo };
  return {
    ok: true,
    roteiro: {
      modulos: mods.map((m) => ({
        titulo: m.titulo.trim(),
        minutos: Math.max(0, Math.min(600, Number.parseInt(m.minutos, 10) || 0)),
        final: !!m.final,
        topicos: m.final ? [] : m.topicos.map((t) => ({ titulo: t.titulo.trim() })),
        cenarios: m.final ? m.cenarios.map((c) => ({ titulo: c.titulo.trim() })) : [],
      })),
    },
  };
}

// ─── Módulo ────────────────────────────────────────────────────────────────────────────────────
const naoVazio = z.string().trim().min(1);
const umaCorreta = (itens) => itens.filter((x) => x.correta).length === 1;

const Tela = z.object({
  titulo: naoVazio, texto: naoVazio, revisaoTitulo: z.string().nullable(), revisaoItens: z.array(z.string()), alerta: z.string().nullable(), dica: z.string().nullable(),
});
const Pergunta = z.object({
  enunciado: naoVazio,
  alternativas: z.array(z.object({ texto: naoVazio, correta: z.boolean() })).length(4).refine(umaCorreta, 'Cada pergunta precisa de exatamente uma alternativa correta.'),
  porque: naoVazio,
});
const Topico = z.object({ titulo: naoVazio, telas: z.array(Tela).min(1).max(4), perguntas: z.array(Pergunta).min(3).max(6) });
const Decisao = z.object({
  pergunta: naoVazio,
  opcoes: z.array(z.object({ texto: naoVazio, correta: z.boolean(), porque: naoVazio })).length(3).refine(umaCorreta, 'Cada decisão precisa de exatamente uma opção correta.'),
});
const Cenario = z.object({ titulo: naoVazio, cena: naoVazio, tempoSugeridoSeg: z.number().int().min(60).max(900), decisoes: z.array(Decisao).min(3).max(5) });
const ModuloComum = z.object({ introducao: z.string(), topicos: z.array(Topico), cenarios: z.any() });
const ModuloFinal = z.object({ introducao: z.string(), topicos: z.array(z.any()).max(0, 'O módulo final não tem tópicos, só cenários.'), cenarios: z.array(Cenario) });

function validarModulo(json, moduloDoRoteiro) {
  const r = (moduloDoRoteiro.final ? ModuloFinal : ModuloComum).safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, erro: `A resposta da IA não segue as regras do curso (${i.path.join('.')}: ${i.message}).` };
  }
  const m = r.data;
  if (moduloDoRoteiro.final) {
    if (m.cenarios.length !== moduloDoRoteiro.cenarios.length) return { ok: false, erro: 'A resposta da IA não tem os cenários do roteiro.' };
    return { ok: true, modulo: { ...m, topicos: [] } };
  }
  if (m.topicos.length !== moduloDoRoteiro.topicos.length) return { ok: false, erro: 'A resposta da IA não tem os tópicos do roteiro.' };
  if (m.topicos.reduce((s, t) => s + t.perguntas.length, 0) < 8) return { ok: false, erro: 'O módulo precisa de pelo menos 8 perguntas (para ter pré-teste).' };
  return { ok: true, modulo: { ...m, cenarios: [] } };
}

// ─── Editor do roteiro (formulário) ─────────────────────────────────────────────────────────────
const comoLista = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v === undefined ? [] : [v]);
const limpos = (v) => comoLista(v).map((x) => String(x || '').trim()).filter(Boolean);

function roteiroDoFormulario(body) {
  // body.modulos vem do qs como lista (índices 0, 1, 2…) ou como objeto (quando o editor acrescenta um módulo com
  // índice "n<hora>"); ordem[] traz os índices na ordem da tela.
  const bruto = (body && body.modulos) || {};
  const porIndice = new Map(Array.isArray(bruto) ? bruto.map((m, i) => [String(i), m]) : Object.entries(bruto));
  const ordem = comoLista(body && body.ordem).map(String).filter((k) => porIndice.has(k));
  const indices = ordem.length ? ordem : [...porIndice.keys()];
  return {
    modulos: indices.map((k) => porIndice.get(k)).filter((m) => m && m.remover !== '1').map((m) => {
      const final = m.final === '1' || m.final === 'on' || m.final === true;
      return {
        titulo: String(m.titulo || '').trim(),
        minutos: Number.parseInt(m.minutos, 10) || 0,
        final,
        topicos: final ? [] : limpos(m.topicos).map((t) => ({ titulo: t })),
        cenarios: final ? limpos(m.cenarios).map((t) => ({ titulo: t })) : [],
      };
    }),
  };
}

// ─── Custo (US$ por milhão de tokens) ───────────────────────────────────────────────────────────
// Com o fallback do servidor (recusa), usage.iterations traz cada tentativa com o próprio modelo: a recusada no
// meio também é cobrada, e a de reserva pelo preço do modelo de reserva (revisão I6). Sem iterations, o modelo
// é o Claude Opus 5.5.
const PRECOS = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-opus-5': { entrada: 5, saida: 25, cacheLeitura: 0.5, cacheEscrita: 6.25 },
  'claude-fable-5-1': { entrada: 10, saida: 50, cacheLeitura: 1, cacheEscrita: 12.5 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
};
const PRECO = PRECOS['claude-opus-5-5'];
const partes = (u) => (Array.isArray(u && u.iterations) && u.iterations.length ? u.iterations : [u || {}]);
function custoUsd(u = {}) {
  const v = partes(u).reduce((t, x) => {
    const p = PRECOS[x.model] || (x.model ? PRECOS['claude-fable-5-1'] : PRECO); // modelo desconhecido: o mais caro (não subconta o teto)
    return t + ((x.input_tokens || 0) * p.entrada + (x.output_tokens || 0) * p.saida
      + (x.cache_read_input_tokens || 0) * p.cacheLeitura + (x.cache_creation_input_tokens || 0) * p.cacheEscrita);
  }, 0) / 1e6;
  return Math.round(v * 1e4) / 1e4;
}
const tokensDe = (u) => partes(u).reduce((t, x) => ({
  entrada: t.entrada + (x.input_tokens || 0),
  saida: t.saida + (x.output_tokens || 0),
  cache: t.cache + (x.cache_read_input_tokens || 0) + (x.cache_creation_input_tokens || 0),
}), { entrada: 0, saida: 0, cache: 0 });

module.exports = {
  ESQUEMA_TEXTOS_PRESENCIAL, ESQUEMA_TEXTOS_ONLINE, validarTextos, limparFaqs, semAcento, ESQUEMA_PEDIDOS_IMAGENS, validarPedidosImagens, ESQUEMA_PROPOSTA, validarProposta, ESQUEMA_ROTEIRO, ESQUEMA_MODULO, MSG_ROTEIRO, validarRoteiro, validarModulo, roteiroDoFormulario, custoUsd, tokensDe, PRECO, PRECOS };
