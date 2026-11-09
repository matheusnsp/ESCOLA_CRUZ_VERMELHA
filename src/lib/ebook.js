// lib/ebook.js
//
// E-books da Escola Digital (2026-11-09; spec 2026-11-09-escola-digital-ebooks.md). O e-book é a tabela Ebook ligada
// a um Curso escondido (ativo false) que guarda nome, descrições, capa e dúvidas. Comprar = Matricula na turma ONLINE
// desse curso (lib/turma-online.js), como o curso online: pagamento, webhook, Financeiro e estorno de sempre.

const prisma = require('../db');
const arq = require('./ebook-arquivo');
const { slugCurso } = require('./vitrine');
const { ONLINE } = require('./turma-online');

const MAX_PDF = 50 * 1024 * 1024;
const LIMITE_HORA = 20;
const SITUACAO = { PAGO: 'pago', PARCELADO: 'pago', PENDENTE: 'pendente', CANCELADO: 'cancelado', ESTORNADO: 'cancelado' };
const INCLUIR = { curso: { select: { id: true, nome: true, descricao: true, descricaoLonga: true, imagemUrl: true } } };

const endereco = (nome) => slugCurso(nome);

function valor(v) {
  const n = Number(String(v || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const inteiro = (v, min, max, padrao) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao; };
const corta = (v, n) => String(v || '').trim().slice(0, n);

// Lê e confere o formulário. { dados } ou { erro }.
function lerDados(d) {
  const nome = corta(d.nome, 120);
  if (!nome) return { erro: 'Escreva o título do e-book.' };
  const gratuito = ['1', 'on', 'true', true].includes(d.gratuito);
  const preco = gratuito ? 0 : valor(d.preco);
  if (!gratuito && !(preco > 0)) return { erro: 'Informe o preço do e-book (ou marque "Grátis").' };
  return {
    dados: {
      nome, descricao: corta(d.descricao, 300) || null, descricaoLonga: corta(d.descricaoLonga, 3000) || null,
      gratuito, preco, maxParcelas: inteiro(d.maxParcelas, 1, 12, 1), ordemVitrine: inteiro(d.ordemVitrine, -999, 999, 0),
      publicado: ['1', 'on', 'true', true].includes(d.publicado),
    },
  };
}

// Cria (sem ebookId) ou atualiza. arquivo = { buffer, originalname } do multer (opcional). { ebook } ou { erro }.
async function salvar(entrada, arquivo = null, ebookId = null) {
  const lido = lerDados(entrada || {});
  if (lido.erro) return lido;
  const d = lido.dados;
  const atual = ebookId ? await prisma.ebook.findUnique({ where: { id: ebookId }, include: INCLUIR }) : null;
  if (ebookId && !atual) return { erro: 'E-book não encontrado.' };
  // Endereço único entre os e-books (dois iguais fariam um link abrir o outro).
  const outros = await prisma.ebook.findMany({ where: ebookId ? { id: { not: ebookId } } : {}, select: { curso: { select: { nome: true } } } });
  if (outros.some((o) => endereco(o.curso.nome) === endereco(d.nome))) return { erro: 'Já existe um e-book com este nome. Escolha outro título.' };

  let pdf = null;
  if (arquivo && arquivo.buffer && arquivo.buffer.length) {
    if (arquivo.buffer.length > MAX_PDF) return { erro: 'PDF muito grande (máximo 50 MB).' };
    try {
      pdf = { ...(await arq.lerPdf(arquivo.buffer)), tamanhoBytes: arquivo.buffer.length, arquivoNome: corta(arquivo.originalname, 200) || 'ebook.pdf' };
    } catch (e) {
      return { erro: 'Este arquivo não é um PDF válido.' };
    }
  }
  if (d.publicado && !pdf && !(atual && atual.arquivoPdf)) return { erro: 'Envie o PDF do e-book antes de publicar.' };
  if (pdf) pdf.arquivoPdf = await arq.guardar(arquivo.buffer);

  const dadosCurso = { nome: d.nome, descricao: d.descricao, descricaoLonga: d.descricaoLonga };
  const dadosEbook = {
    precoOnline: d.preco, gratuito: d.gratuito, maxParcelas: d.gratuito ? 1 : d.maxParcelas, ordemVitrine: d.ordemVitrine, publicado: d.publicado,
    ...(pdf ? { arquivoPdf: pdf.arquivoPdf, arquivoNome: pdf.arquivoNome, paginas: pdf.paginas, tamanhoBytes: pdf.tamanhoBytes } : {}),
  };
  try {
    let ebook;
    if (atual) {
      ebook = await prisma.$transaction(async (tx) => {
        await tx.curso.update({ where: { id: atual.cursoId }, data: dadosCurso });
        return tx.ebook.update({ where: { id: atual.id }, data: dadosEbook, include: INCLUIR });
      });
      if (pdf && atual.arquivoPdf) await arq.apagar(atual.arquivoPdf); // o antigo sai só depois de gravar o novo
    } else {
      ebook = await prisma.$transaction(async (tx) => {
        const curso = await tx.curso.create({ data: { ...dadosCurso, cargaHoraria: 0, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
        return tx.ebook.create({ data: { ...dadosEbook, cursoId: curso.id }, include: INCLUIR });
      });
    }
    return { ebook };
  } catch (e) {
    if (pdf) await arq.apagar(pdf.arquivoPdf);
    throw e;
  }
}

// E-book pelo endereço (nome sem acento). Só publicado, a não ser com incluirRascunho (DEV).
async function doEndereco(end, { incluirRascunho = false } = {}) {
  const e = String(end || '').toLowerCase();
  const lista = await prisma.ebook.findMany({ where: incluirRascunho ? {} : { publicado: true }, include: INCLUIR, orderBy: { criadoEm: 'asc' } });
  return lista.find((x) => endereco(x.curso.nome) === e) || null;
}

const porId = (id) => prisma.ebook.findUnique({ where: { id }, include: INCLUIR });

// { situacao: 'sem'|'gratis'|'pendente'|'pago'|'cancelado', desde, matricula }
async function acesso(usuarioId, ebook) {
  if (!usuarioId) return { situacao: 'sem', desde: null, matricula: null };
  if (ebook.gratuito) {
    const posse = await prisma.acessoEbook.findUnique({ where: { ebookId_usuarioId: { ebookId: ebook.id, usuarioId } } });
    return { situacao: 'gratis', desde: posse ? posse.criadoEm : null, matricula: null };
  }
  const matricula = await prisma.matricula.findFirst({
    where: { alunoId: usuarioId, turma: { cursoId: ebook.cursoId, status: ONLINE } }, orderBy: { criadoEm: 'asc' },
  });
  if (!matricula) return { situacao: 'sem', desde: null, matricula: null };
  const situacao = SITUACAO[matricula.statusPagamento] || 'cancelado';
  return { situacao, desde: situacao === 'pago' ? matricula.confirmadaEm || matricula.criadoEm : null, matricula };
}
const podeBaixar = (a) => a.situacao === 'gratis' || a.situacao === 'pago';

// Conta o download (limite por hora) e, no grátis, grava a posse (única por pessoa). { ok } ou { erro: 'LIMITE' }.
async function registrarDownload(usuarioId, ebook) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ebook-download:${usuarioId}`}))`;
    const naHora = await tx.downloadEbook.count({ where: { usuarioId, criadoEm: { gte: new Date(Date.now() - 3600 * 1000) } } });
    if (naHora >= LIMITE_HORA) return { erro: 'LIMITE' };
    await tx.downloadEbook.create({ data: { ebookId: ebook.id, usuarioId } });
    if (ebook.gratuito) {
      await tx.acessoEbook.upsert({ where: { ebookId_usuarioId: { ebookId: ebook.id, usuarioId } }, update: {}, create: { ebookId: ebook.id, usuarioId } });
    }
    return { ok: true };
  });
}

// E-books da vitrine: publicados, com PDF e preço (ou grátis), na ordem.
async function daVitrine() {
  try {
    return await prisma.ebook.findMany({
      where: { publicado: true, arquivoPdf: { not: null }, OR: [{ gratuito: true }, { precoOnline: { gt: 0 } }] },
      include: INCLUIR, orderBy: [{ ordemVitrine: 'asc' }, { curso: { nome: 'asc' } }],
    });
  } catch (e) {
    console.error('[EBOOK] vitrine:', e.message);
    return [];
  }
}

// E-books da pessoa: os grátis já baixados e os pagos (matrícula paga), sem repetir, do mais novo para o mais antigo.
async function meus(usuarioId) {
  const [gratis, pagos] = await Promise.all([
    prisma.acessoEbook.findMany({ where: { usuarioId }, include: { ebook: { include: INCLUIR } } }),
    prisma.matricula.findMany({
      where: { alunoId: usuarioId, statusPagamento: { in: ['PAGO', 'PARCELADO'] }, turma: { status: ONLINE, curso: { ebook: { isNot: null } } } },
      include: { turma: { include: { curso: { include: { ebook: { include: INCLUIR } } } } } },
    }),
  ]);
  const lista = [
    ...gratis.map((g) => ({ ...g.ebook, desde: g.criadoEm })),
    ...pagos.map((m) => ({ ...m.turma.curso.ebook, desde: m.confirmadaEm || m.criadoEm })),
  ];
  const vistos = new Set();
  return lista.filter((e) => !vistos.has(e.id) && vistos.add(e.id)).sort((a, b) => b.desde - a.desde);
}

// Só sem compras (nem pendentes: o pagamento segura a turma). Com compras: despublicar.
async function excluir(id) {
  const e = await prisma.ebook.findUnique({ where: { id } });
  if (!e) return { erro: 'E-book não encontrado.' };
  if (await prisma.matricula.count({ where: { turma: { cursoId: e.cursoId } } })) return { erro: 'Este e-book já tem compras: despublique em vez de excluir.' };
  if (await prisma.cupomEad.count({ where: { ebookId: id } })) return { erro: 'Este e-book tem cupons: apague os cupons antes.' };
  await prisma.$transaction([
    prisma.turma.deleteMany({ where: { cursoId: e.cursoId } }),
    prisma.ebook.delete({ where: { id } }),
    prisma.faqCurso.deleteMany({ where: { cursoId: e.cursoId } }),
    prisma.curso.delete({ where: { id: e.cursoId } }),
  ]);
  if (e.arquivoPdf) await arq.apagar(e.arquivoPdf);
  return { ok: true };
}

module.exports = { MAX_PDF, LIMITE_HORA, endereco, salvar, doEndereco, porId, acesso, podeBaixar, registrarDownload, daVitrine, meus, excluir };
