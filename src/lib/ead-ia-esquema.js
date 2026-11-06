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

// ─── Roteiro ───────────────────────────────────────────────────────────────────────────────────
const MSG_ROTEIRO = {
  modulos: 'O roteiro precisa de 2 a 12 módulos.',
  topicos: 'Cada módulo precisa de 1 a 6 tópicos.',
  final: 'Só o último módulo pode ser o final.',
  cenarios: 'O módulo final precisa de 2 a 4 cenários.',
  titulo: 'Todo módulo e tópico precisa de título.',
};
const titulo = (t) => typeof t === 'string' && t.trim().length > 0;

function validarRoteiro(json) {
  const mods = json && Array.isArray(json.modulos) ? json.modulos : [];
  if (mods.length < 2 || mods.length > 12) return { ok: false, erro: MSG_ROTEIRO.modulos };
  if (mods.some((m) => !Array.isArray(m.topicos) || m.topicos.length < 1 || m.topicos.length > 6)) return { ok: false, erro: MSG_ROTEIRO.topicos };
  if (mods.some((m, i) => m.final && i !== mods.length - 1)) return { ok: false, erro: MSG_ROTEIRO.final };
  const ultimo = mods[mods.length - 1];
  if (ultimo.final && (!Array.isArray(ultimo.cenarios) || ultimo.cenarios.length < 2 || ultimo.cenarios.length > 4)) return { ok: false, erro: MSG_ROTEIRO.cenarios };
  if (mods.some((m) => !titulo(m.titulo) || m.topicos.some((t) => !titulo(t && t.titulo)) || (m.final && m.cenarios.some((c) => !titulo(c && c.titulo))))) return { ok: false, erro: MSG_ROTEIRO.titulo };
  return {
    ok: true,
    roteiro: {
      modulos: mods.map((m) => ({
        titulo: m.titulo.trim(),
        minutos: Math.max(0, Math.min(600, Number.parseInt(m.minutos, 10) || 0)),
        final: !!m.final,
        topicos: m.topicos.map((t) => ({ titulo: t.titulo.trim() })),
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
const Modulo = z.object({ introducao: z.string(), topicos: z.array(Topico), cenarios: z.array(Cenario) });

function validarModulo(json, moduloDoRoteiro) {
  const r = Modulo.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, erro: `A resposta da IA não segue as regras do curso (${i.path.join('.')}: ${i.message}).` };
  }
  const m = r.data;
  if (m.topicos.length !== moduloDoRoteiro.topicos.length) return { ok: false, erro: 'A resposta da IA não tem os tópicos do roteiro.' };
  if (moduloDoRoteiro.final) {
    if (m.cenarios.length < 2 || m.cenarios.length > 4) return { ok: false, erro: 'O módulo final precisa de 2 a 4 cenários.' };
  } else if (m.topicos.reduce((s, t) => s + t.perguntas.length, 0) < 8) {
    return { ok: false, erro: 'O módulo precisa de pelo menos 8 perguntas (para ter pré-teste).' };
  }
  return { ok: true, modulo: m };
}

// ─── Editor do roteiro (formulário) ─────────────────────────────────────────────────────────────
const comoLista = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v === undefined ? [] : [v]);
const limpos = (v) => comoLista(v).map((x) => String(x || '').trim()).filter(Boolean);

function roteiroDoFormulario(body) {
  const mods = comoLista(body && body.modulos);
  const ordem = comoLista(body && body.ordem).map((x) => Number.parseInt(x, 10)).filter((i) => Number.isInteger(i) && mods[i]);
  const indices = ordem.length ? ordem : mods.map((_, i) => i);
  return {
    modulos: indices.map((i) => mods[i]).filter((m) => m && m.remover !== '1').map((m) => {
      const final = m.final === '1' || m.final === 'on' || m.final === true;
      return {
        titulo: String(m.titulo || '').trim(),
        minutos: Number.parseInt(m.minutos, 10) || 0,
        final,
        topicos: limpos(m.topicos).map((t) => ({ titulo: t })),
        cenarios: final ? limpos(m.cenarios).map((t) => ({ titulo: t })) : [],
      };
    }),
  };
}

// ─── Custo (US$ por milhão de tokens, Claude Opus 5.5) ──────────────────────────────────────────
const PRECO = { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 };
function custoUsd(u = {}) {
  const v = ((u.input_tokens || 0) * PRECO.entrada + (u.output_tokens || 0) * PRECO.saida
    + (u.cache_read_input_tokens || 0) * PRECO.cacheLeitura + (u.cache_creation_input_tokens || 0) * PRECO.cacheEscrita) / 1e6;
  return Math.round(v * 1e4) / 1e4;
}

module.exports = { ESQUEMA_ROTEIRO, ESQUEMA_MODULO, MSG_ROTEIRO, validarRoteiro, validarModulo, roteiroDoFormulario, custoUsd, PRECO };
