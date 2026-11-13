// lib/webinario.js
//
// Webinários da Escola Digital (2026-11-13; spec docs/superpowers/specs/2026-11-13-escola-digital-webinarios-design.md).
// Como o e-book (lib/ebook.js): a tabela Webinario fica ligada a um Curso escondido (ativo false), com título,
// descrições, capa e dúvidas. A compra é uma Matricula na turma ONLINE desse curso (lib/turma-online.js).
// O acesso vem da InscricaoWebinario (grátis, ou criada quando o pagamento confirma), e a presença confirmada
// pela palavra-código vira o certificado. Horários sempre em America/Sao_Paulo (UTC-3, sem horário de verão).

const prisma = require('../db');
const { slugCurso } = require('./vitrine');
const { ONLINE } = require('./turma-online');
const { normalizarVideo } = require('./ead');

const MIN = 60 * 1000;
const JANELA_MIN = 30; // a transmissão abre 30 min antes do início e fecha 30 min depois do fim
const SITUACAO = { PAGO: 'pago', PARCELADO: 'pago', PENDENTE: 'pendente', CANCELADO: 'cancelado', ESTORNADO: 'cancelado' };
const INCLUIR = { curso: { select: { id: true, nome: true, descricao: true, descricaoLonga: true, imagemUrl: true } } };

const endereco = (nome) => slugCurso(nome);
// Relógio das rotas (testes trocam por um fixo).
const agora = () => new Date();
const cargaHorasDe = (duracaoMin) => Math.max(1, Math.ceil((Number(duracaoMin) || 0) / 60));

function valor(v) {
  const n = Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const inteiro = (v, min, max, padrao) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const corta = (v, n) => String(v || '').trim().slice(0, n);
const marcado = (v) => ['1', 'on', 'true', true].includes(v);

// "2026-12-01T19:00" (campo datetime-local, horário de Brasília) -> Date em UTC. Vazio -> null; inválido -> NaN.
function dataBrasilia(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  const d = new Date(`${s}:00-03:00`);
  return Number.isNaN(d.getTime()) ? NaN : d;
}
// Date -> "2026-12-01T19:00" no horário de Brasília (para preencher o campo do formulário).
function paraCampo(d) {
  if (!d) return '';
  const b = new Date(new Date(d).getTime() - 3 * 60 * MIN);
  return b.toISOString().slice(0, 16);
}

// "20/11/2026 às 19h" / "às 19h30" em Brasília; null sem data (só gravado).
function quandoTexto(d, { curto = false } = {}) {
  if (!d) return null;
  const b = new Date(new Date(d).getTime() - 3 * 60 * MIN);
  const p2 = (n) => String(n).padStart(2, '0');
  const dia = `${p2(b.getUTCDate())}/${p2(b.getUTCMonth() + 1)}${curto ? '' : '/' + b.getUTCFullYear()}`;
  return `${dia} às ${b.getUTCHours()}h${b.getUTCMinutes() ? p2(b.getUTCMinutes()) : ''}`;
}
// Link absoluto da página (e-mails).
const linkPagina = (w) => `${(process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com').replace(/\/+$/, '')}${require('./vitrine').urlWebinario(w.curso)}`;

// Comparação da palavra-código: sem maiúsculas, sem acentos e sem espaços nas pontas (espaços internos contam).
const normalizarPalavra = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Lê e confere o formulário. { dados } ou { erro }.
function lerDados(d) {
  const nome = corta(d.nome, 120);
  if (!nome) return { erro: 'Escreva o título do webinário.' };
  const gratuito = marcado(d.gratuito);
  const preco = gratuito ? 0 : valor(d.preco);
  if (!gratuito && !(preco > 0)) return { erro: 'Informe o preço do webinário (ou marque "Grátis").' };
  const duracaoMin = parseInt(d.duracaoMin, 10);
  if (!(duracaoMin > 0 && duracaoMin <= 24 * 60)) return { erro: 'Informe a duração em minutos.' };
  const inicioEm = dataBrasilia(d.inicioEm);
  if (Number.isNaN(inicioEm)) return { erro: 'Data e hora de início inválidas.' };
  const linkAoVivo = corta(d.linkAoVivo, 500) || null;
  if (linkAoVivo && !/^https:\/\/[^\s"'<>]+$/i.test(linkAoVivo)) return { erro: 'O link da transmissão precisa começar com https://' };
  let gravacaoUrl = null;
  if (corta(d.gravacaoUrl, 500)) {
    const v = normalizarVideo(corta(d.gravacaoUrl, 500));
    if (v.erro) return { erro: v.erro };
    gravacaoUrl = v.url;
  }
  const palavraCodigo = corta(d.palavraCodigo, 60) || null;
  const publicado = marcado(d.publicado);
  if (publicado && !palavraCodigo) return { erro: 'Para publicar, defina a palavra-código.' };
  if (publicado && !inicioEm && !gravacaoUrl) return { erro: 'Para publicar, informe a data do ao vivo ou o link da gravação.' };
  return {
    dados: {
      nome, descricao: corta(d.descricao, 300) || null, descricaoLonga: corta(d.descricaoLonga, 3000) || null,
      apresentador: corta(d.apresentador, 120) || null, inicioEm, duracaoMin, linkAoVivo, gravacaoUrl, palavraCodigo,
      gratuito, preco, maxParcelas: inteiro(d.maxParcelas, 1, 12, 1), ordemVitrine: inteiro(d.ordemVitrine, -999, 999, 0), publicado,
    },
  };
}

async function temInscricaoOuCompra(w) {
  const [i, m] = await Promise.all([
    prisma.inscricaoWebinario.count({ where: { webinarioId: w.id } }),
    prisma.matricula.count({ where: { turma: { cursoId: w.cursoId } } }),
  ]);
  return i + m > 0;
}

// Cria (sem id) ou atualiza. foto: tratada pela rota (salvarFotoCurso). { webinario, antes? } ou { erro }.
// "antes" (só na edição) é o webinário como estava, para a rota decidir os avisos (gravação nova, novo horário).
async function salvar(entrada, foto = null, id = null) {
  const lido = lerDados(entrada || {});
  if (lido.erro) return lido;
  const d = lido.dados;
  const atual = id ? await prisma.webinario.findUnique({ where: { id }, include: INCLUIR }) : null;
  if (id && !atual) return { erro: 'Webinário não encontrado.' };
  const outros = await prisma.webinario.findMany({ where: id ? { id: { not: id } } : {}, select: { curso: { select: { nome: true } } } });
  if (outros.some((o) => endereco(o.curso.nome) === endereco(d.nome))) return { erro: 'Já existe um webinário com este nome. Escolha outro título.' };
  if (atual && atual.gratuito !== d.gratuito && await temInscricaoOuCompra(atual)) {
    return { erro: 'Não dá para trocar entre grátis e pago depois que alguém se inscreveu.' };
  }

  const dadosCurso = { nome: d.nome, descricao: d.descricao, descricaoLonga: d.descricaoLonga, cargaHoraria: cargaHorasDe(d.duracaoMin), ...(foto ? { imagemUrl: foto } : {}) };
  const dadosW = {
    apresentador: d.apresentador, inicioEm: d.inicioEm, duracaoMin: d.duracaoMin, linkAoVivo: d.linkAoVivo, gravacaoUrl: d.gravacaoUrl,
    palavraCodigo: d.palavraCodigo, precoOnline: d.preco, gratuito: d.gratuito, maxParcelas: d.gratuito ? 1 : d.maxParcelas,
    ordemVitrine: d.ordemVitrine, publicado: d.publicado,
  };
  if (atual) {
    const webinario = await prisma.$transaction(async (tx) => {
      await tx.curso.update({ where: { id: atual.cursoId }, data: dadosCurso });
      return tx.webinario.update({ where: { id: atual.id }, data: dadosW, include: INCLUIR });
    });
    return { webinario, antes: atual };
  }
  const webinario = await prisma.$transaction(async (tx) => {
    const curso = await tx.curso.create({ data: { ...dadosCurso, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    return tx.webinario.create({ data: { ...dadosW, cursoId: curso.id }, include: INCLUIR });
  });
  return { webinario };
}

// Webinário pelo endereço. Só publicado, a não ser com incluirRascunho.
async function doEndereco(end, { incluirRascunho = false } = {}) {
  const e = String(end || '').toLowerCase();
  const lista = await prisma.webinario.findMany({ where: incluirRascunho ? {} : { publicado: true }, include: INCLUIR, orderBy: { criadoEm: 'asc' } });
  return lista.find((x) => endereco(x.curso.nome) === e) || null;
}
const porId = (id) => prisma.webinario.findUnique({ where: { id }, include: INCLUIR });

// { situacao: 'sem'|'gratis'|'pendente'|'pago'|'cancelado', matricula }
async function acesso(usuarioId, w) {
  if (!usuarioId) return { situacao: 'sem', matricula: null };
  if (w.gratuito) {
    const i = await prisma.inscricaoWebinario.findUnique({ where: { webinarioId_usuarioId: { webinarioId: w.id, usuarioId } } });
    return { situacao: i ? 'gratis' : 'sem', matricula: null };
  }
  const matricula = await prisma.matricula.findFirst({
    where: { alunoId: usuarioId, turma: { cursoId: w.cursoId, status: ONLINE } }, orderBy: { criadoEm: 'asc' },
  });
  if (!matricula) return { situacao: 'sem', matricula: null };
  return { situacao: SITUACAO[matricula.statusPagamento] || 'cancelado', matricula };
}
const temAcesso = (a) => !!a && (a.situacao === 'gratis' || a.situacao === 'pago');

// 'sem-data' (só gravado) | 'antes' | 'dentro' | 'depois'
function janela(w, agora = new Date()) {
  if (!w.inicioEm) return 'sem-data';
  const ini = new Date(w.inicioEm).getTime();
  const abre = ini - JANELA_MIN * MIN;
  const fecha = ini + (Number(w.duracaoMin) || 0) * MIN + JANELA_MIN * MIN;
  const t = agora.getTime();
  if (t < abre) return 'antes';
  if (t <= fecha) return 'dentro';
  return 'depois';
}

// Qual cartão a página mostra (spec §3; vale a primeira que bater). a = acesso() ou null (sem login).
function situacaoCartao(w, a, agora = new Date()) {
  const j = janela(w, agora);
  if (!a) return 'visitante';
  if (!temAcesso(a)) {
    if (j === 'depois' && !w.gravacaoUrl) return 'encerrado-sem-gravacao';
    if (a.situacao === 'pendente') return 'pendente';
    return w.gratuito ? 'inscrever' : 'comprar';
  }
  if (j === 'sem-data') return 'gravacao';
  if (j === 'antes') return 'inscrito-antes';
  if (j === 'dentro') return w.linkAoVivo ? 'transmissao' : 'transmissao-sem-link';
  return w.gravacaoUrl ? 'gravacao' : 'gravacao-em-breve';
}

// Vitrine (spec §6): publicados; primeiro os próximos (mais perto primeiro), depois os já realizados com gravação e os
// só gravados (por ordemVitrine). Realizado sem gravação fica de fora. Com usuarioId, marca "inscrito".
async function daVitrine(agora = new Date(), usuarioId = null) {
  try {
    const lista = await prisma.webinario.findMany({
      where: { publicado: true, OR: [{ gratuito: true }, { precoOnline: { gt: 0 } }] }, include: INCLUIR, orderBy: [{ ordemVitrine: 'asc' }, { criadoEm: 'asc' }],
    });
    const proximos = lista.filter((w) => w.inicioEm && janela(w, agora) !== 'depois').sort((a, b) => new Date(a.inicioEm) - new Date(b.inicioEm));
    const gravados = lista.filter((w) => (!w.inicioEm || janela(w, agora) === 'depois') && w.gravacaoUrl);
    const out = [];
    for (const w of [...proximos, ...gravados]) {
      out.push({ ...w, quando: quandoTexto(w.inicioEm, { curto: true }), inscrito: usuarioId ? temAcesso(await acesso(usuarioId, w)) : false });
    }
    return out;
  } catch (e) {
    console.error('[WEBINARIO] vitrine:', e.message);
    return [];
  }
}

// Minha conta: webinários com inscrição (grátis ou paga com acesso) ou presença, do mais novo para o mais antigo.
async function meus(usuarioId) {
  const [insc, pres] = await Promise.all([
    prisma.inscricaoWebinario.findMany({ where: { usuarioId }, include: { webinario: { include: INCLUIR } } }),
    prisma.presencaWebinario.findMany({ where: { usuarioId }, include: { webinario: { include: INCLUIR } } }),
  ]);
  const comPresenca = new Set(pres.map((p) => p.webinarioId));
  const porId = new Map();
  for (const i of insc) {
    if (comPresenca.has(i.webinarioId) || temAcesso(await acesso(usuarioId, i.webinario))) porId.set(i.webinarioId, { w: i.webinario, desde: i.criadoEm });
  }
  for (const p of pres) if (!porId.has(p.webinarioId)) porId.set(p.webinarioId, { w: p.webinario, desde: p.confirmadaEm });
  return [...porId.values()].sort((a, b) => b.desde - a.desde)
    .map(({ w, desde }) => ({ ...w, desde, quando: quandoTexto(w.inicioEm), temCertificado: comPresenca.has(w.id) }));
}

// Palavra-código (spec §3): grava a tentativa antes de comparar; 10 por pessoa por webinário por hora.
// { ok: true, nova } | { ok: false, erro: 'sem-acesso'|'cedo'|'tentativas'|'nao-confere' }
const LIMITE_TENTATIVAS = 10;
async function confirmarPresenca(usuarioId, w, palavra, agora = new Date()) {
  if (!usuarioId || !temAcesso(await acesso(usuarioId, w))) return { ok: false, erro: 'sem-acesso' };
  if (w.inicioEm && agora < new Date(w.inicioEm)) return { ok: false, erro: 'cedo' };
  const chave = { webinarioId_usuarioId: { webinarioId: w.id, usuarioId } };
  if (await prisma.presencaWebinario.findUnique({ where: chave })) return { ok: true, nova: false };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`webinario-palavra:${w.id}:${usuarioId}`}))`;
    await tx.tentativaPalavraWebinario.create({ data: { webinarioId: w.id, usuarioId } });
    const naHora = await tx.tentativaPalavraWebinario.count({ where: { webinarioId: w.id, usuarioId, criadoEm: { gte: new Date(Date.now() - 3600 * 1000) } } });
    if (naHora > LIMITE_TENTATIVAS) return { ok: false, erro: 'tentativas' };
    if (!w.palavraCodigo || normalizarPalavra(palavra) !== normalizarPalavra(w.palavraCodigo)) return { ok: false, erro: 'nao-confere' };
    const ja = await tx.presencaWebinario.findUnique({ where: chave });
    if (ja) return { ok: true, nova: false };
    await tx.presencaWebinario.create({ data: { webinarioId: w.id, usuarioId } });
    return { ok: true, nova: true };
  });
}

// Só sem inscrições, compras (nem pendentes) e cupons. Com isso tudo: despublicar.
async function excluir(id) {
  const w = await prisma.webinario.findUnique({ where: { id } });
  if (!w) return { erro: 'Webinário não encontrado.' };
  if (await temInscricaoOuCompra(w)) return { erro: 'Este webinário já tem inscrições ou compras: despublique em vez de excluir.' };
  if (await prisma.cupomEad.count({ where: { webinarioId: id } })) return { erro: 'Este webinário tem cupons: apague os cupons antes.' };
  await prisma.$transaction([
    prisma.turma.deleteMany({ where: { cursoId: w.cursoId } }),
    prisma.webinario.delete({ where: { id } }),
    prisma.faqCurso.deleteMany({ where: { cursoId: w.cursoId } }),
    prisma.curso.delete({ where: { id: w.cursoId } }),
  ]);
  return { ok: true };
}

module.exports = {
  agora, JANELA_MIN, INCLUIR, endereco, quandoTexto, linkPagina, cargaHorasDe, dataBrasilia, paraCampo, normalizarPalavra, salvar, doEndereco, porId,
  acesso, temAcesso, janela, situacaoCartao, confirmarPresenca, daVitrine, meus, LIMITE_TENTATIVAS, excluir,
};
