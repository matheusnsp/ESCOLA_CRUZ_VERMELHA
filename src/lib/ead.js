// lib/ead.js
//
// Regras do conteúdo do EAD (curso 100% online), sem banco: link de vídeo, alternativas das perguntas,
// pendências que impedem validar um módulo, avisos e os esquemas Zod dos formulários do painel.
// O acesso ao banco fica em lib/ead-db.js. Spec: docs/superpowers/specs/2026-11-05-ead-estrutura-conteudo.md

const { z } = require('zod');

const MINIMO_POR_TOPICO = 3;  // o quiz do tópico sorteia 3
const MINIMO_POR_MODULO = 8;  // o pré-teste sorteia de 8 a 12
const META_POR_TOPICO = 10;   // meta do documento (Modelo 3); só aviso

// ─── Vídeo ────────────────────────────────────────────────────────────────────────────────────────
const ERRO_VIDEO = 'Use um link do YouTube ou do Vimeo.';
const HOSTS_YT = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const ID_YT = /^[A-Za-z0-9_-]{11}$/;

// Devolve { url } com o endereço do player (o que vai no <iframe>) ou { erro }.
function normalizarVideo(entrada) {
  let u;
  try { u = new URL(String(entrada || '').trim()); } catch (e) { return { erro: ERRO_VIDEO }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { erro: ERRO_VIDEO };
  const host = u.hostname.toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);

  let idYt = null;
  if (host === 'youtu.be') idYt = partes[0];
  else if (HOSTS_YT.includes(host)) {
    if (partes[0] === 'watch') idYt = u.searchParams.get('v');
    else if (['shorts', 'embed'].includes(partes[0])) idYt = partes[1];
  }
  if (idYt !== null) return ID_YT.test(idYt || '') ? { url: `https://www.youtube-nocookie.com/embed/${idYt}` } : { erro: ERRO_VIDEO };

  let num = null; let hash = null;
  if (host === 'vimeo.com' || host === 'www.vimeo.com') [num, hash] = partes;
  else if (host === 'player.vimeo.com' && partes[0] === 'video') { num = partes[1]; hash = u.searchParams.get('h'); }
  if (num === null || !/^\d+$/.test(num || '')) return { erro: ERRO_VIDEO };
  if (hash && !/^[a-f0-9]+$/.test(hash)) return { erro: ERRO_VIDEO };
  return { url: `https://player.vimeo.com/video/${num}` + (hash ? `?h=${hash}` : '') };
}

// ─── Tempo mm:ss ──────────────────────────────────────────────────────────────────────────────────
function lerMmSs(txt) {
  const t = String(txt || '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(\d+):(\d{2})$/);
  if (!m || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
const mmSs = (seg) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;

// ─── Perguntas ────────────────────────────────────────────────────────────────────────────────────
// itens: [{ texto, correta }] como vieram do formulário. Devolve { alternativas } ou { erro }.
function normalizarAlternativas(tipo, itens) {
  if (tipo === 'VF') {
    const idx = (itens || []).findIndex((i) => i && i.correta);
    if (idx !== 0 && idx !== 1) return { erro: 'Marque se a resposta certa é Verdadeiro ou Falso.' };
    return { alternativas: ['Verdadeiro', 'Falso'].map((texto, ordem) => ({ texto, correta: ordem === idx, ordem })) };
  }
  const alternativas = (itens || [])
    .map((i) => ({ texto: String((i && i.texto) || '').trim(), correta: !!(i && i.correta) }))
    .filter((i) => i.texto)
    .map((i, ordem) => ({ ...i, ordem }));
  if (alternativas.length < 2) return { erro: 'Preencha pelo menos 2 alternativas.' };
  if (alternativas.length > 5) return { erro: 'No máximo 5 alternativas.' };
  const corretas = alternativas.filter((a) => a.correta).length;
  if (tipo === 'UNICA' && corretas !== 1) return { erro: 'Pergunta de resposta única: marque exatamente 1 alternativa correta.' };
  if (tipo === 'MULTIPLA' && corretas < 1) return { erro: 'Marque pelo menos 1 alternativa correta.' };
  return { alternativas };
}

// ─── Pendências e avisos ──────────────────────────────────────────────────────────────────────────
const vazio = (s) => !String(s || '').trim();
const ativas = (topico) => (topico.perguntas || []).filter((p) => p.ativa);

// O que impede validar o módulo. modulo = árvore carregada (lib/ead-db.js carregarModulo).
function pendencias(modulo) {
  const p = [];
  if (vazio(modulo.titulo)) p.push('Módulo sem título.');
  if (vazio(modulo.introducao)) p.push('Módulo sem introdução.');

  if (modulo.final) {
    const cenarios = modulo.cenarios || [];
    if (!cenarios.length) p.push('O módulo final precisa de pelo menos 1 cenário.');
    for (const c of cenarios) {
      if (vazio(c.cena)) p.push(`Cenário '${c.titulo}': sem a cena.`);
      if (!(c.decisoes || []).length) p.push(`Cenário '${c.titulo}': sem decisões.`);
      (c.decisoes || []).forEach((d, i) => {
        const nome = `Cenário '${c.titulo}', decisão ${i + 1}`;
        const opcoes = d.opcoes || [];
        if (opcoes.length !== 3) p.push(`${nome}: precisa de exatamente 3 opções (tem ${opcoes.length}).`);
        if (opcoes.filter((o) => o.correta).length !== 1) p.push(`${nome}: marque exatamente 1 correta.`);
        if (opcoes.some((o) => vazio(o.feedback))) p.push(`${nome}: toda opção precisa da fala do instrutor.`);
      });
    }
    return p;
  }

  if (!(modulo.minutosEstimados > 0)) p.push('Módulo sem tempo estimado.');
  const topicos = modulo.topicos || [];
  if (!topicos.length) p.push('O módulo precisa de pelo menos 1 tópico.');
  let total = 0;
  for (const t of topicos) {
    if (!(t.telas || []).length) p.push(`Tópico '${t.titulo}': sem telas.`);
    for (const tela of t.telas || []) {
      if (vazio(tela.titulo)) p.push(`Tópico '${t.titulo}': tela sem título.`);
      if (vazio(tela.ancora)) p.push(`Tela '${tela.titulo}': sem a âncora.`);
      if (vazio(tela.videoUrl)) p.push(`Tela '${tela.titulo}': sem vídeo.`);
    }
    const at = ativas(t);
    total += at.length;
    if (at.length < MINIMO_POR_TOPICO) p.push(`Tópico '${t.titulo}': só ${at.length} perguntas ativas (mínimo ${MINIMO_POR_TOPICO}).`);
    for (const q of at) {
      const nome = `Pergunta '${String(q.enunciado).slice(0, 60)}'`;
      if (vazio(q.feedback)) p.push(`${nome}: sem feedback (o porquê).`);
      const r = normalizarAlternativas(q.tipo, (q.alternativas || []).map((a) => ({ texto: a.texto, correta: a.correta })));
      if (r.erro) p.push(`${nome}: ${r.erro}`);
    }
  }
  if (topicos.length && total < MINIMO_POR_MODULO) p.push(`O módulo tem ${total} perguntas ativas (mínimo ${MINIMO_POR_MODULO}, para o pré-teste).`);
  return p;
}

// O que não impede validar, mas convém melhorar.
function avisos(modulo) {
  if (modulo.final) return [];
  return (modulo.topicos || [])
    .filter((t) => ativas(t).length < META_POR_TOPICO)
    .map((t) => `Tópico '${t.titulo}': ${ativas(t).length} perguntas ativas (meta do documento: ${META_POR_TOPICO}; com poucas, o quiz repete as mesmas perguntas a cada tentativa).`);
}

// ─── Esquemas dos formulários ─────────────────────────────────────────────────────────────────────
const obrig = (max) => z.string().trim().min(1, 'Campo obrigatório.').max(max, `No máximo ${max} caracteres.`);
const opc = (max) => z.preprocess((v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim()),
  z.string().max(max, `No máximo ${max} caracteres.`).nullable());
const inteiro = (min, max) => z.coerce.number().int('Use um número inteiro.').min(min).max(max);

const schemaCursoOnline = z.object({ notaMinimaQuiz: inteiro(50, 100) });
const schemaModulo = z.object({ titulo: obrig(120), minutosEstimados: inteiro(0, 600), introducao: opc(3000), final: z.boolean().default(false) });
const schemaTopico = z.object({ titulo: obrig(120) });
const schemaTela = z.object({
  titulo: obrig(120), ancora: opc(600), videoTitulo: opc(120), revisaoTitulo: opc(120),
  alerta: opc(400), dicaProfissional: opc(400),
  revisaoItens: z.array(z.string().trim().max(200, 'Cada item da revisão: no máximo 200 caracteres.')).max(4).default([])
    .transform((l) => l.filter(Boolean)),
});
const schemaPergunta = z.object({ tipo: z.enum(['UNICA', 'MULTIPLA', 'VF']), enunciado: obrig(600), feedback: opc(800) });
const schemaAlternativaTexto = z.string().trim().max(300, 'Alternativa: no máximo 300 caracteres.');
const schemaCenario = z.object({ titulo: obrig(120), cena: opc(1000) });
const schemaDecisao = z.object({
  pergunta: obrig(600),
  opcoes: z.array(z.object({ texto: obrig(300), feedback: opc(800), correta: z.boolean() })).length(3),
});

// Primeira mensagem de erro de um safeParse, para mostrar no formulário.
const primeiroErro = (r) => (r.success ? null : r.error.issues[0].message);

module.exports = {
  MINIMO_POR_TOPICO, MINIMO_POR_MODULO, META_POR_TOPICO,
  normalizarVideo, lerMmSs, mmSs, normalizarAlternativas, pendencias, avisos,
  schemaCursoOnline, schemaModulo, schemaTopico, schemaTela, schemaPergunta, schemaAlternativaTexto,
  schemaCenario, schemaDecisao, primeiroErro,
};
