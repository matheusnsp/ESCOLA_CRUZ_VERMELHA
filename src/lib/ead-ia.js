// lib/ead-ia.js
//
// Criar curso com IA (etapa 9). A pessoa (DEV) dá o tema e, se quiser, um material (PDF, Word, texto colado); a IA
// propõe o roteiro; a pessoa ajusta e confirma; a IA escreve um módulo por vez (a fila, lib/ead-ia-fila.js, chama
// gerarRoteiro e gerarModulo). Tudo entra em RASCUNHO, com geradoPorIa, para a área técnica revisar e validar.
// O cliente da API é injetado ({ cliente }): os testes usam um falso e nunca chamam a API de verdade.
// Spec: docs/superpowers/specs/2026-11-11-ead-ia.md

const prisma = require('../db');
const { transacao } = require('./transacao');
const E = require('./ead-ia-esquema');

const MODELO = 'claude-opus-5-5';
const CHAVE_TETO = 'ead-ia:teto-mensal-usd';
const TETO_PADRAO = 50;
const EM_ANDAMENTO = ['PROPOSTA_GERANDO', 'PROPOSTA_PRONTA', 'ROTEIRO_GERANDO', 'ROTEIRO_PRONTO', 'MODULOS_GERANDO'];
const MSG_CHAVE = 'Configure a chave da API da Anthropic (ANTHROPIC_API_KEY) no servidor.';

class ErroIa extends Error {
  constructor(mensagem, usage) { super(mensagem); this.usage = usage || null; }
}

// Regras fixas do curso (o mesmo texto em todas as chamadas: fica em cache).
const REGRAS_SYSTEM = [
  'Você escreve cursos online da Escola de Educação e Saúde da Cruz Vermelha Brasileira, no Rio de Janeiro.',
  'Escreva em português do Brasil, para público leigo, em frases curtas e diretas.',
  'O curso é uma capacitação teórica, sem prática em manequim: não prometa habilitação prática.',
  'Não indique doses de medicamento nem procedimentos que só profissionais de saúde podem fazer.',
  'Quando houver material de base, siga o material; não invente dados técnicos, números ou protocolos que ele não traga.',
  'Cada tópico tem de 1 a 4 telas e de 3 a 6 perguntas de uma resposta, cada uma com 4 alternativas, só uma correta, e o porquê.',
  'Um módulo comum soma pelo menos 8 perguntas (para ter pré-teste).',
  'O módulo final não tem tópicos nem telas: reúne o curso em 2 a 4 cenários práticos, cada um com 3 a 5 decisões; cada decisão tem 3 opções, só uma correta, e o porquê de cada opção. O tempo sugerido de cada cenário fica entre 60 e 900 segundos.',
  'Responda só no formato JSON pedido.',
].join('\n');

const auditar = (atorId, acao, alvoId, detalhe) => prisma.logAuditoria.create({ data: { atorId: atorId || 'SISTEMA', acao, alvoTipo: 'GeracaoIaEad', alvoId, detalhe: detalhe || undefined } });

// ─── Material ──────────────────────────────────────────────────────────────────────────────────
async function prepararMaterial({ arquivos = [], texto = '' } = {}) {
  const partes = []; const materialPdfs = [];
  for (const a of arquivos) {
    const nome = String(a.nome || 'arquivo');
    if (/\.pdf$/i.test(nome) || a.mimetype === 'application/pdf') {
      materialPdfs.push({ nome, base64: a.buffer.toString('base64') });
    } else {
      const r = await require('mammoth').extractRawText({ buffer: a.buffer });
      partes.push(`Arquivo ${nome}:\n${String(r.value || '').trim()}`);
    }
  }
  const colado = String(texto || '').trim();
  if (colado) partes.push(`Texto colado:\n${colado}`);
  return { materialTexto: partes.length ? partes.join('\n\n') : null, materialPdfs };
}

// ─── Pedido ao Claude ──────────────────────────────────────────────────────────────────────────
// PDFs e texto do material vêm antes do pedido do passo, com cache no último bloco do material: eles se repetem em
// todas as chamadas da mesma geração.
function montarMensagens(geracao, pedidoDoPasso) {
  const conteudo = [];
  for (const p of geracao.materialPdfs || []) {
    conteudo.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } });
  }
  if (geracao.materialTexto) conteudo.push({ type: 'text', text: `Material de base:\n\n${geracao.materialTexto}` });
  if (conteudo.length) conteudo[conteudo.length - 1] = { ...conteudo[conteudo.length - 1], cache_control: { type: 'ephemeral' } };
  conteudo.push({ type: 'text', text: pedidoDoPasso });
  return {
    system: [{ type: 'text', text: REGRAS_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: conteudo }],
  };
}

const temMaterial = (messages) => (messages[0] && Array.isArray(messages[0].content) ? messages[0].content.length > 1 : false);

async function chamarClaude(cliente, { system, messages, schema }) {
  let msg;
  try {
    const stream = cliente.beta.messages.stream({
      model: MODELO,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages,
    });
    msg = await stream.finalMessage();
  } catch (e) {
    const Anthropic = require('@anthropic-ai/sdk');
    if (e instanceof Anthropic.BadRequestError && temMaterial(messages)) throw new ErroIa(`O material não pôde ser lido: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new ErroIa(`A API da Anthropic falhou: ${e.message}`);
    throw e;
  }
  const usage = msg.usage || {};
  if (msg.stop_reason === 'refusal') {
    const cat = msg.stop_details && msg.stop_details.category;
    throw new ErroIa(cat ? `A IA recusou: ${cat}` : 'A IA recusou o pedido.', usage);
  }
  if (msg.stop_reason === 'max_tokens') throw new ErroIa('A resposta da IA ficou longa demais.', usage);
  const texto = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { json: JSON.parse(texto), usage };
  } catch (e) {
    throw new ErroIa('A IA devolveu uma resposta fora do formato.', usage);
  }
}

const ehChaveConfigurada = () => !!String(process.env.ANTHROPIC_API_KEY || '').trim();
const clientePadrao = () => new (require('@anthropic-ai/sdk'))();

// ─── Custo e teto ──────────────────────────────────────────────────────────────────────────────
function inicioDoMesRio(agora = new Date()) {
  const ym = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  return new Date(`${ym}-01T00:00:00-03:00`);
}
async function gastoDoMes(agora = new Date()) {
  const r = await prisma.geracaoIaEad.aggregate({ where: { criadoEm: { gte: inicioDoMesRio(agora) } }, _sum: { custoUsd: true } });
  return Math.round(Number(r._sum.custoUsd || 0) * 1e4) / 1e4;
}
async function tetoMensal() {
  const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE_TETO } }).catch(() => null);
  const v = c ? Number(c.valor) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : TETO_PADRAO;
}
async function definirTeto(valor, atorId) {
  const v = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 1000) return { ok: false, erro: 'Teto: de US$ 0 a US$ 1000.' };
  await prisma.configuracao.upsert({ where: { chave: CHAVE_TETO }, update: { valor: String(v) }, create: { chave: CHAVE_TETO, valor: String(v) } });
  await auditar(atorId, 'EAD_IA_TETO', CHAVE_TETO, { teto: v });
  return { ok: true };
}
const msgTeto = (teto) => `O teto de gasto com IA deste mês (US$ ${teto.toFixed(2)}) foi atingido.`;
async function dentroDoTeto() {
  const teto = await tetoMensal();
  return (await gastoDoMes()) < teto ? { ok: true } : { ok: false, erro: msgTeto(teto) };
}

async function podeComecar(usuarioId) {
  if (!ehChaveConfigurada()) return { ok: false, erro: MSG_CHAVE };
  const t = await dentroDoTeto();
  if (!t.ok) return t;
  if (await prisma.geracaoIaEad.count({ where: { criadoPor: usuarioId, status: { in: EM_ANDAMENTO } } })) {
    return { ok: false, erro: 'Você já tem uma geração em andamento. Termine ou cancele antes de começar outra.' };
  }
  return { ok: true };
}

async function somarCusto(geracaoId, usage) {
  if (!usage) return;
  const t = E.tokensDe(usage); // com o fallback, soma todas as tentativas (usage.iterations)
  await prisma.geracaoIaEad.update({
    where: { id: geracaoId },
    data: { tokensEntrada: { increment: t.entrada }, tokensSaida: { increment: t.saida }, tokensCache: { increment: t.cache }, custoUsd: { increment: E.custoUsd(usage) } },
  });
}

// ─── Geração ───────────────────────────────────────────────────────────────────────────────────
async function criarGeracao({ pedido, material, criadoPor }) {
  const g = await prisma.geracaoIaEad.create({
    // Passo a passo (2026-11): o pedido do passo 1 só tem a ideia, e a IA propõe o resto antes do roteiro.
    data: { criadoPor, status: pedido.ideia ? 'PROPOSTA_GERANDO' : 'ROTEIRO_GERANDO', pedido, materialTexto: material.materialTexto || null, materialPdfs: material.materialPdfs && material.materialPdfs.length ? material.materialPdfs : undefined },
  });
  await auditar(criadoPor, 'EAD_IA_PEDIU', g.id, { tema: pedido.tema || null, ideia: pedido.ideia ? String(pedido.ideia).slice(0, 200) : null, destino: pedido.destino && pedido.destino.tipo, nModulos: pedido.nModulos || null });
  return g;
}

function descricaoDoPedido(p) {
  return [
    `Tema do curso: ${p.tema}`,
    p.publico ? `Público: ${p.publico}` : null,
    p.observacoes ? `Observações de quem pediu: ${p.observacoes}` : null,
  ].filter(Boolean).join('\n');
}

async function gerarRoteiro(geracaoId, { cliente }) {
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId } });
  if (!g || g.status !== 'ROTEIRO_GERANDO') return;
  const pedido = [
    descricaoDoPedido(g.pedido),
    `Proponha o roteiro do curso com cerca de ${g.pedido.nModulos} módulos: o último é o módulo final ("Juntando tudo"), com 2 a 4 cenários.`,
    'Para cada módulo comum: título, minutos estimados e de 1 a 6 tópicos. O módulo final (só o último) não tem tópicos: só os títulos dos cenários.',
  ].join('\n\n');
  try {
    const { system, messages } = montarMensagens(g, pedido);
    const { json, usage } = await chamarClaude(cliente, { system, messages, schema: E.ESQUEMA_ROTEIRO });
    await somarCusto(geracaoId, usage);
    const v = E.validarRoteiro(json);
    if (!v.ok) {
      await prisma.geracaoIaEad.update({ where: { id: geracaoId }, data: { status: 'ERRO_ROTEIRO', erro: v.erro } });
      return;
    }
    await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'ROTEIRO_GERANDO' }, data: { status: 'ROTEIRO_PRONTO', roteiro: v.roteiro, erro: null } });
  } catch (e) {
    if (!(e instanceof ErroIa)) console.error('[EAD IA] roteiro:', e);
    await somarCusto(geracaoId, e.usage);
    await prisma.geracaoIaEad.update({ where: { id: geracaoId }, data: { status: 'ERRO_ROTEIRO', erro: e instanceof ErroIa ? e.message : 'Erro inesperado ao gerar o roteiro.' } });
  }
}

// ─── Passo 2: a proposta (criação passo a passo, 2026-11) ──────────────────────────────────────
async function gerarProposta(geracaoId, { cliente }) {
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId } });
  if (!g || g.status !== 'PROPOSTA_GERANDO') return;
  const existente = g.pedido.destino && g.pedido.destino.tipo === 'existente';
  const pedido = [
    `Ideia de quem pediu: ${g.pedido.ideia}`,
    existente
      ? 'Proponha os módulos novos para um curso online que já existe: tema, público, número de módulos (2 a 12) e observações para o roteiro. Os campos nome, descrição, carga horária, preço e parcelas podem repetir o óbvio (não serão usados).'
      : 'Proponha o curso online: nome curto (até 80 caracteres), descrição de uma ou duas frases para a página de venda, carga horária em horas, público, tema detalhado, número de módulos (2 a 12, o último é o módulo final com cenários), preço sugerido em reais (cursos online da escola costumam ficar entre R$ 29,90 e R$ 99,90) e parcelas no cartão (1 a 12).',
    'Para carga horária, número de módulos e preço, explique a sugestão numa frase curta e simples (porqueCargaHoraria, porqueModulos, porquePreco). Proponha o curso.',
  ].join('\n\n');
  try {
    const { system, messages } = montarMensagens(g, pedido);
    const { json, usage } = await chamarClaude(cliente, { system, messages, schema: E.ESQUEMA_PROPOSTA });
    await somarCusto(geracaoId, usage);
    const v = E.validarProposta(json);
    if (!v.ok) {
      await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'PROPOSTA_GERANDO' }, data: { status: 'ERRO_PROPOSTA', erro: v.erro } });
      return;
    }
    await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'PROPOSTA_GERANDO' }, data: { status: 'PROPOSTA_PRONTA', pedido: { ...g.pedido, proposta: v.proposta }, erro: null } });
  } catch (e) {
    if (!(e instanceof ErroIa)) console.error('[EAD IA] proposta:', e);
    await somarCusto(geracaoId, e.usage);
    await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'PROPOSTA_GERANDO' }, data: { status: 'ERRO_PROPOSTA', erro: e instanceof ErroIa ? e.message : 'Erro inesperado ao gerar a proposta.' } });
  }
}

// "Pedir outra proposta" (ou de novo depois de um erro): conta no teto.
async function pedirOutraProposta(geracaoId, atorId) {
  const t = await dentroDoTeto();
  if (!t.ok) return t;
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: { in: ['PROPOSTA_PRONTA', 'ERRO_PROPOSTA'] } }, data: { status: 'PROPOSTA_GERANDO', erro: null } });
  if (!r.count) return { ok: false, erro: 'Esta geração não está na proposta.' };
  await auditar(atorId, 'EAD_IA_OUTRA_PROPOSTA', geracaoId, null);
  return { ok: true };
}

// A pessoa conferiu a proposta: grava os campos no pedido (o roteiro usa tema, público, módulos, observações e
// o destino) e passa ao roteiro. `pedidoNovo` vem já conferido pela rota (mesmas regras do formulário antigo).
async function confirmarProposta(geracaoId, pedidoNovo, atorId) {
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId } });
  if (!g || g.status !== 'PROPOSTA_PRONTA') return { ok: false, erro: 'Esta geração não está esperando a proposta.' };
  const pedido = { ...g.pedido, ...pedidoNovo, ideia: g.pedido.ideia, proposta: g.pedido.proposta };
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'PROPOSTA_PRONTA' }, data: { status: 'ROTEIRO_GERANDO', pedido, roteiro: require('@prisma/client').Prisma.DbNull, erro: null } });
  if (!r.count) return { ok: false, erro: 'Esta geração não está esperando a proposta.' };
  await auditar(atorId, 'EAD_IA_CONFIRMOU_PROPOSTA', geracaoId, { tema: pedido.tema, nModulos: pedido.nModulos, destino: pedido.destino && pedido.destino.tipo });
  return { ok: true };
}

// "← Voltar à proposta" (antes de começar a escrita): o roteiro é descartado; a proposta fica.
async function voltarParaProposta(geracaoId, atorId) {
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId }, select: { pedido: true, status: true } });
  if (!g || !g.pedido || !g.pedido.proposta) return { ok: false, erro: 'Esta geração não tem proposta para voltar.' };
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: { in: ['ROTEIRO_PRONTO', 'ERRO_ROTEIRO'] } }, data: { status: 'PROPOSTA_PRONTA', erro: null } });
  if (!r.count) return { ok: false, erro: 'Só dá para voltar à proposta antes de começar a escrita.' };
  await auditar(atorId, 'EAD_IA_VOLTOU_PROPOSTA', geracaoId, null);
  return { ok: true };
}

// "Gerar outro roteiro" (ou de novo depois de um erro): conta no teto.
async function pedirOutroRoteiro(geracaoId, atorId) {
  const t = await dentroDoTeto();
  if (!t.ok) return t;
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: { in: ['ROTEIRO_PRONTO', 'ERRO_ROTEIRO'] } }, data: { status: 'ROTEIRO_GERANDO', erro: null } });
  if (!r.count) return { ok: false, erro: 'Esta geração não está esperando um roteiro.' };
  await auditar(atorId, 'EAD_IA_TENTOU_DE_NOVO', geracaoId, { passo: 'roteiro' });
  return { ok: true };
}

async function confirmarRoteiro(geracaoId, roteiroEditado, atorId) {
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId } });
  if (!g || g.status !== 'ROTEIRO_PRONTO') return { ok: false, erro: 'Esta geração não está esperando confirmação.' };
  const v = E.validarRoteiro(roteiroEditado);
  if (!v.ok) return v;
  let cursoOnlineId;
  const d = g.pedido.destino || {};
  if (d.tipo === 'novo') {
    const r = await require('./ead-curso-online').criarCursoOnline({ nome: d.nome, descricao: d.descricao, cargaHoraria: d.cargaHoraria });
    if (!r.ok) return r;
    const dados = { maxParcelas: Math.min(12, Math.max(1, Number(d.maxParcelas) || 1)) };
    if (Number(d.precoOnline) > 0) dados.precoOnline = Number(d.precoOnline);
    await prisma.cursoOnline.update({ where: { id: r.co.id }, data: dados });
    cursoOnlineId = r.co.id;
  } else {
    const co = d.cursoOnlineId ? await prisma.cursoOnline.findUnique({ where: { id: d.cursoOnlineId } }) : null;
    if (!co) return { ok: false, erro: 'O curso online escolhido não existe mais.' };
    // Um só módulo final por curso (lib/ead-db.js).
    if (v.roteiro.modulos.some((m) => m.final) && await prisma.moduloEad.count({ where: { cursoOnlineId: co.id, final: true } })) {
      return { ok: false, erro: 'Este curso já tem um módulo final: desmarque "final" no roteiro.' };
    }
    cursoOnlineId = co.id;
  }
  const modulos = v.roteiro.modulos.map((m, i) => ({ ordem: i, titulo: m.titulo, status: 'pendente' }));
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: 'ROTEIRO_PRONTO' }, data: { status: 'MODULOS_GERANDO', roteiro: v.roteiro, cursoOnlineId, modulos } });
  if (!r.count) return { ok: false, erro: 'Esta geração não está esperando confirmação.' };
  await auditar(atorId, 'EAD_IA_CONFIRMOU', geracaoId, { cursoOnlineId, modulos: modulos.length });
  return { ok: true, cursoOnlineId };
}

// Lê e muda um módulo da lista sob a trava da geração (a fila e o painel mexem na mesma lista).
async function mudarModulo(geracaoId, ordem, fn) {
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ia:' + geracaoId}))`;
    const g = await tx.geracaoIaEad.findUnique({ where: { id: geracaoId } });
    if (!g || !Array.isArray(g.modulos)) return null;
    const mods = g.modulos.map((m) => ({ ...m }));
    const m = mods.find((x) => x.ordem === ordem);
    if (!m) return null;
    const r = fn(m, g);
    if (r === false) return { g, m, mudou: false };
    await tx.geracaoIaEad.update({ where: { id: geracaoId }, data: { modulos: mods } });
    return { g, m, mudou: true };
  });
}

function pedidoDoModulo(g, ordem) {
  const rot = g.roteiro.modulos;
  const m = rot[ordem];
  const sumario = rot.map((x, i) => `${i + 1}. ${x.titulo}${x.final ? ' (final)' : ''}: ${x.topicos.map((t) => t.titulo).join('; ')}`).join('\n');
  return [
    descricaoDoPedido(g.pedido),
    `Roteiro do curso:\n${sumario}`,
    m.final
      ? `Escreva agora o módulo ${ordem + 1}, o módulo final: "${m.titulo}" (${m.minutos} minutos). Ele não tem tópicos (a lista de tópicos fica vazia); escreva exatamente estes cenários, nesta ordem: ${m.cenarios.map((c) => `"${c.titulo}"`).join(', ')}.`
      : `Escreva agora o módulo ${ordem + 1}: "${m.titulo}" (${m.minutos} minutos), com exatamente estes tópicos, nesta ordem: ${m.topicos.map((t) => `"${t.titulo}"`).join(', ')}. Não é o módulo final: a lista de cenários fica vazia.`,
  ].join('\n\n');
}

// Grava o módulo e marca "pronto" na mesma transação, sob a trava da geração (revisão I8): um módulo gravado nunca
// fica sem a marca (e nunca é refeito).
async function gravarModulo(g, ordem, m) {
  const doRoteiro = g.roteiro.modulos[ordem];
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ia:' + g.id}))`;
    const ultimo = await tx.moduloEad.findFirst({ where: { cursoOnlineId: g.cursoOnlineId }, orderBy: { ordem: 'desc' }, select: { ordem: true } });
    const mod = await tx.moduloEad.create({
      data: {
        cursoOnlineId: g.cursoOnlineId, ordem: (ultimo ? ultimo.ordem : -1) + 1, titulo: doRoteiro.titulo, minutosEstimados: doRoteiro.minutos,
        introducao: m.introducao || null, final: doRoteiro.final, status: 'RASCUNHO', geradoPorIa: true,
      },
    });
    for (const [i, t] of m.topicos.entries()) {
      const top = await tx.topicoEad.create({ data: { moduloId: mod.id, ordem: i, titulo: doRoteiro.topicos[i].titulo } });
      for (const [j, tl] of t.telas.entries()) {
        await tx.telaEad.create({ data: { topicoId: top.id, ordem: j, titulo: tl.titulo, ancora: tl.texto, revisaoTitulo: tl.revisaoTitulo || null, revisaoItens: tl.revisaoItens || [], alerta: tl.alerta || null, dicaProfissional: tl.dica || null } });
      }
      for (const p of t.perguntas) {
        await tx.perguntaEad.create({ data: { topicoId: top.id, tipo: 'UNICA', enunciado: p.enunciado, feedback: p.porque, alternativas: { create: p.alternativas.map((a, k) => ({ ordem: k, texto: a.texto, correta: a.correta })) } } });
      }
    }
    for (const [i, c] of (doRoteiro.final ? m.cenarios : []).entries()) {
      await tx.cenarioEad.create({
        data: {
          moduloId: mod.id, ordem: i, titulo: doRoteiro.cenarios[i] ? doRoteiro.cenarios[i].titulo : c.titulo, cena: c.cena, tempoSugeridoSeg: c.tempoSugeridoSeg,
          decisoes: { create: c.decisoes.map((d, k) => ({ ordem: k, pergunta: d.pergunta, opcoes: { create: d.opcoes.map((o, n) => ({ ordem: n, texto: o.texto, correta: o.correta, feedback: o.porque })) } })) },
        },
      });
    }
    const atual = await tx.geracaoIaEad.findUnique({ where: { id: g.id }, select: { modulos: true } });
    const mods = atual.modulos.map((x) => (x.ordem === ordem ? { ...x, status: 'pronto', moduloId: mod.id, erro: null } : x));
    await tx.geracaoIaEad.update({ where: { id: g.id }, data: { modulos: mods } });
    return mod;
  });
}

async function gerarModulo(geracaoId, ordem, { cliente }) {
  const ini = await mudarModulo(geracaoId, ordem, (m, ger) => {
    if (m.status !== 'pendente' || ger.status !== 'MODULOS_GERANDO') return false;
    m.status = 'gerando'; m.erro = null;
    return true;
  });
  if (!ini || !ini.mudou) return;
  const g = await prisma.geracaoIaEad.findUnique({ where: { id: geracaoId } });
  try {
    const { system, messages } = montarMensagens(g, pedidoDoModulo(g, ordem));
    const { json, usage } = await chamarClaude(cliente, { system, messages, schema: E.ESQUEMA_MODULO });
    await somarCusto(geracaoId, usage);
    const v = E.validarModulo(json, g.roteiro.modulos[ordem]);
    if (!v.ok) throw new ErroIa(v.erro);
    const mod = await gravarModulo(g, ordem, v.modulo);
    await auditar('SISTEMA', 'EAD_IA_MODULO_GERADO', geracaoId, { ordem, moduloId: mod.id }).catch((e) => console.error('[EAD IA] auditoria:', e.message));
  } catch (e) {
    if (!(e instanceof ErroIa)) console.error('[EAD IA] módulo:', e);
    if (e.usage) await somarCusto(geracaoId, e.usage);
    await mudarModulo(geracaoId, ordem, (m) => { m.status = 'erro'; m.erro = e instanceof ErroIa ? e.message : 'Erro inesperado ao gerar o módulo.'; });
  }
}

async function tentarDeNovo(geracaoId, ordem, atorId) {
  const r = await mudarModulo(geracaoId, ordem, (m, g) => {
    if (m.status !== 'erro' || g.status !== 'MODULOS_GERANDO') return false;
    m.status = 'pendente'; m.erro = null;
    return true;
  });
  if (!r || !r.mudou) return { ok: false, erro: 'Só um módulo com erro pode ser tentado de novo.' };
  await auditar(atorId, 'EAD_IA_TENTOU_DE_NOVO', geracaoId, { ordem });
  return { ok: true };
}

async function cancelar(geracaoId, atorId) {
  const r = await prisma.geracaoIaEad.updateMany({ where: { id: geracaoId, status: { in: EM_ANDAMENTO.concat('ERRO_ROTEIRO', 'ERRO_PROPOSTA') } }, data: { status: 'CANCELADA', materialPdfs: require('@prisma/client').Prisma.DbNull } });
  if (!r.count) return { ok: false, erro: 'Esta geração já terminou.' };
  await auditar(atorId, 'EAD_IA_CANCELOU', geracaoId, null);
  return { ok: true };
}

module.exports = {
  MODELO, REGRAS_SYSTEM, MSG_CHAVE, EM_ANDAMENTO, ErroIa,
  prepararMaterial, montarMensagens, chamarClaude, ehChaveConfigurada, clientePadrao,
  gastoDoMes, tetoMensal, definirTeto, dentroDoTeto, podeComecar,
  criarGeracao, gerarProposta, pedirOutraProposta, confirmarProposta, voltarParaProposta, gerarRoteiro, pedirOutroRoteiro, confirmarRoteiro, gerarModulo, tentarDeNovo, cancelar,
};
