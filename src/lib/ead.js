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
// Escola Digital (2026-11): a validação pede só o que o aluno precisa para o curso funcionar ("Para validar");
// o resto vira aviso ("Recomendado"), sem travar. A página do módulo mostra as duas listas desde o começo.
// Cada item: { texto, ok, detalhe? } (detalhe = onde falta, para a mensagem).
const MIN_OPCOES = 2;
const MAX_OPCOES = 4;
const item = (texto, faltam) => ({ texto, ok: !faltam.length, detalhe: faltam.length ? faltam.slice(0, 5).join(', ') + (faltam.length > 5 ? '…' : '') : null });
const nomeTela = (t) => `'${t.titulo}'`;

function checklist(modulo) {
  const titulo = { texto: 'Título', ok: !vazio(modulo.titulo), detalhe: null };
  const introducao = { texto: 'Introdução do módulo', ok: !vazio(modulo.introducao), detalhe: null };
  if (modulo.final) {
    const cenarios = modulo.cenarios || [];
    const decisoes = cenarios.flatMap((c) => (c.decisoes || []).map((d, i) => ({ c, d, nome: `'${c.titulo}', decisão ${i + 1}` })));
    const opcoesRuins = decisoes.filter(({ d }) => {
      const o = d.opcoes || [];
      return o.length < MIN_OPCOES || o.length > MAX_OPCOES || o.filter((x) => x.correta).length !== 1;
    });
    return {
      paraValidar: [
        titulo,
        { texto: 'Pelo menos 1 cenário', ok: cenarios.length > 0, detalhe: null },
        item('Todo cenário tem decisão', cenarios.filter((c) => !(c.decisoes || []).length).map((c) => `'${c.titulo}'`)),
        item(`Toda decisão tem de ${MIN_OPCOES} a ${MAX_OPCOES} opções e 1 correta`, opcoesRuins.map((x) => x.nome)),
      ],
      recomendado: [
        introducao,
        item('Cena em todos os cenários', cenarios.filter((c) => vazio(c.cena)).map((c) => `'${c.titulo}'`)),
        item('Fala do instrutor em todas as opções', decisoes.filter(({ d }) => (d.opcoes || []).some((o) => vazio(o.feedback))).map((x) => x.nome)),
      ],
    };
  }
  const topicos = modulo.topicos || [];
  const telas = topicos.flatMap((t) => t.telas || []);
  const perguntas = topicos.flatMap((t) => ativas(t));
  const altRuins = perguntas.filter((q) => normalizarAlternativas(q.tipo, (q.alternativas || []).map((a) => ({ texto: a.texto, correta: a.correta }))).erro);
  return {
    paraValidar: [
      titulo,
      { texto: 'Pelo menos 1 tópico com 1 tela', ok: topicos.some((t) => (t.telas || []).length), detalhe: null },
      item('Todo tópico tem pelo menos 1 tela', topicos.filter((t) => !(t.telas || []).length).map((t) => `'${t.titulo}'`)),
      item('Perguntas com alternativas válidas', altRuins.map((q) => `'${String(q.enunciado).slice(0, 40)}'`)),
    ],
    recomendado: [
      item('Vídeo em todas as telas', telas.filter((t) => vazio(t.videoUrl)).map(nomeTela)),
      item('Âncora em todas as telas', telas.filter((t) => vazio(t.ancora)).map(nomeTela)),
      introducao,
      item(`${MINIMO_POR_TOPICO} perguntas ou mais por tópico (o teste sorteia as que houver)`, topicos.filter((t) => ativas(t).length < MINIMO_POR_TOPICO).map((t) => `'${t.titulo}'`)),
      { texto: `${MINIMO_POR_MODULO} perguntas ou mais no módulo (libera o pré-teste "Já sei isso?")`, ok: perguntas.length >= MINIMO_POR_MODULO, detalhe: perguntas.length < MINIMO_POR_MODULO ? `tem ${perguntas.length}` : null },
      item('O porquê em todas as perguntas', perguntas.filter((q) => vazio(q.feedback)).map((q) => `'${String(q.enunciado).slice(0, 40)}'`)),
    ],
  };
}

const textoDe = (i) => (i.detalhe ? `${i.texto}: ${i.detalhe}` : i.texto);
// O que impede validar (lista vazia = pode validar).
const pendencias = (modulo) => checklist(modulo).paraValidar.filter((i) => !i.ok).map(textoDe);
// O que não impede validar, mas convém melhorar.
const avisos = (modulo) => checklist(modulo).recomendado.filter((i) => !i.ok).map(textoDe);

// Tempo do módulo: o digitado; vazio (0), 3 min por tela, 1 por pergunta ativa e 3 por cenário.
function minutosDoModulo(modulo) {
  if (modulo.minutosEstimados > 0) return modulo.minutosEstimados;
  // Aceita a árvore completa (painel), a do aluno (perguntas já ativas, só o id) e a de contagens (painel).
  if (modulo.nTelas !== undefined) return 3 * modulo.nTelas + (modulo.nPerguntas || 0) + 3 * (modulo.nCenarios || 0);
  const topicos = modulo.topicos || [];
  const telas = topicos.reduce((n, t) => n + (t.telas || []).length, 0);
  const perguntas = topicos.reduce((n, t) => n + (t.perguntas || []).filter((q) => q.ativa !== false).length, 0);
  return 3 * telas + perguntas + 3 * (modulo.cenarios || []).length;
}

// Texto que o aluno vê quando a opção do cenário não tem a fala do instrutor.
const FALA_PADRAO = { certa: 'Certo!', errada: 'Não é a melhor escolha. Tente de novo.' };

// ─── Esquemas dos formulários ─────────────────────────────────────────────────────────────────────
const obrig = (max) => z.string().trim().min(1, 'Campo obrigatório.').max(max, `No máximo ${max} caracteres.`);
const opc = (max) => z.preprocess((v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim()),
  z.string().max(max, `No máximo ${max} caracteres.`).nullable());
const inteiro = (min, max) => z.coerce.number({ invalid_type_error: 'Use um número.' }).int('Use um número inteiro.').min(min, `No mínimo ${min}.`).max(max, `No máximo ${max}.`);

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
  // O formulário tem 3 campos; a opção deixada em branco é ignorada (mínimo 2, como a validação do módulo).
  opcoes: z.preprocess((l) => (Array.isArray(l) ? l.filter((o) => o && String(o.texto || '').trim()) : l),
    z.array(z.object({ texto: obrig(300), feedback: opc(800), correta: z.boolean() })).min(MIN_OPCOES, `Escreva pelo menos ${MIN_OPCOES} opções.`).max(MAX_OPCOES)),
});

// Primeira mensagem de erro de um safeParse, para mostrar no formulário.
const primeiroErro = (r) => (r.success ? null : r.error.issues[0].message);

module.exports = {
  MINIMO_POR_TOPICO, MINIMO_POR_MODULO, META_POR_TOPICO,
  normalizarVideo, lerMmSs, mmSs, normalizarAlternativas, pendencias, avisos, checklist, minutosDoModulo, FALA_PADRAO, MIN_OPCOES, MAX_OPCOES,
  schemaCursoOnline, schemaModulo, schemaTopico, schemaTela, schemaPergunta, schemaAlternativaTexto,
  schemaCenario, schemaDecisao, primeiroErro,
};
