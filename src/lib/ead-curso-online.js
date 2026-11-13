// lib/ead-curso-online.js
//
// Curso que só existe online (etapa 5). Por baixo é um Curso (certificado, Livro, matrícula, Financeiro
// dependem dele) com ativo false e o CursoOnline com somenteOnline true. O presencial o esconde (painel e
// site); o catálogo o mostra, publicado, com link para /online/<id>. As consultas de "quais são só
// online" são tolerantes a erro, como o selo da etapa 4: se falharem, o presencial segue como antes.

const crypto = require('crypto');
const prisma = require('../db');
const { slugCurso } = require('./vitrine');

function validar({ nome, descricao, cargaHoraria }) {
  const n = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!n) return { erro: 'Dê um nome ao curso.' };
  if (n.length < 3 || n.length > 120) return { erro: 'O nome deve ter de 3 a 120 caracteres.' };
  const ch = Number(cargaHoraria);
  if (!Number.isInteger(ch) || ch < 1 || ch > 999) return { erro: 'Carga horária: um número inteiro de horas, de 1 a 999.' };
  const d = String(descricao || '').trim();
  if (d.length > 1000) return { erro: 'A descrição pode ter até 1000 caracteres.' };
  return { dados: { nome: n, descricao: d || null, cargaHoraria: ch } };
}

// O endereço /cursos/<endereço> sai do nome: dois cursos com o mesmo endereço não podem existir.
async function nomeEmUso(nome, ignorarCursoId = null) {
  const slug = slugCurso(nome);
  const cursos = await prisma.curso.findMany({ select: { id: true, nome: true } });
  return cursos.some((c) => c.id !== ignorarCursoId && slugCurso(c.nome) === slug);
}

async function criarCursoOnline({ nome, descricao, cargaHoraria, imagemUrl = null }) {
  const v = validar({ nome, descricao, cargaHoraria });
  if (v.erro) return { ok: false, erro: v.erro };
  if (await nomeEmUso(v.dados.nome)) return { ok: false, erro: 'Já existe um curso com esse nome (ou com o mesmo endereço no site).' };
  const cursoId = crypto.randomUUID();
  const [, co] = await prisma.$transaction([
    prisma.curso.create({ data: { id: cursoId, ...v.dados, imagemUrl, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } }),
    prisma.cursoOnline.create({ data: { cursoId, somenteOnline: true } }),
  ]);
  return { ok: true, co };
}

async function editarCursoOnline(cursoOnlineId, campos) {
  const co = await prisma.cursoOnline.findUnique({ where: { id: cursoOnlineId } });
  if (!co || !co.somenteOnline) return { ok: false, erro: 'Só o curso que existe apenas online tem os dados editados aqui.' };
  const v = validar(campos);
  if (v.erro) return { ok: false, erro: v.erro };
  if (await nomeEmUso(v.dados.nome, co.cursoId)) return { ok: false, erro: 'Já existe um curso com esse nome (ou com o mesmo endereço no site).' };
  const dados = { ...v.dados };
  if (campos.imagemUrl !== undefined) dados.imagemUrl = campos.imagemUrl;
  const antes = await prisma.curso.findUnique({ where: { id: co.cursoId }, select: { nome: true } });
  await prisma.curso.update({ where: { id: co.cursoId }, data: dados });
  await require('./ead-acesso').guardarEnderecoAntigo(co.cursoId, antes && antes.nome, dados.nome); // links antigos continuam abrindo
  return { ok: true };
}

// Desativar o EAD de um curso só online apaga também o Curso (fora do site e sem matrícula).
async function apagarCursoSoOnline(cursoOnlineId) {
  const co = await prisma.cursoOnline.findUnique({ where: { id: cursoOnlineId } });
  if (!co || !co.somenteOnline) return { ok: false, erro: 'Não é um curso só online.' };
  if (co.publicado) return { ok: false, erro: 'Tire o curso do site antes de desativar o EAD.' };
  if (await prisma.matricula.count({ where: { turma: { cursoId: co.cursoId } } })) return { ok: false, erro: 'Este curso online já tem alunos inscritos: o conteúdo não pode ser apagado.' };
  await prisma.$transaction([
    prisma.cursoOnline.delete({ where: { id: co.id } }),
    prisma.turma.deleteMany({ where: { cursoId: co.cursoId } }),
    prisma.curso.delete({ where: { id: co.cursoId } }),
  ]);
  return { ok: true };
}

async function idsSoOnline() {
  try {
    // E-books (2026-11-09): o curso escondido do e-book também fica fora do presencial (listas, turmas, contagem).
    // Webinários (2026-11-13): idem.
    const [so, ebooks, webinarios] = await Promise.all([
      prisma.cursoOnline.findMany({ where: { somenteOnline: true }, select: { cursoId: true } }),
      prisma.ebook.findMany({ select: { cursoId: true } }),
      prisma.webinario.findMany({ select: { cursoId: true } }),
    ]);
    return new Set([...so, ...ebooks, ...webinarios].map((c) => c.cursoId));
  } catch (e) {
    console.error('[EAD] cursos só online:', e.message);
    return new Set();
  }
}
const semSoOnline = async (lista) => { const ids = await idsSoOnline(); return lista.filter((c) => !ids.has(c.id)); };
const ehSoOnline = async (cursoId) => (await idsSoOnline()).has(cursoId);

// Os publicados (com preço), no formato do card do catálogo. Tolerante a erro (lista vazia).
async function cursosSoOnlinePublicados() {
  try {
    const lista = await prisma.cursoOnline.findMany({
      where: { somenteOnline: true, publicado: true, OR: [{ gratuito: true }, { precoOnline: { gt: 0 } }] }, // grátis entra (vitrine 2026-11-09)
      include: { curso: { select: { id: true, nome: true, descricao: true, imagemUrl: true, cargaHoraria: true, escolaridadeMinima: true } } },
      orderBy: { curso: { nome: 'asc' } },
    });
    return lista.map((co) => ({ ...co.curso, turmas: [], online: { preco: co.gratuito ? 0 : Number(co.precoOnline), gratis: co.gratuito, somenteOnline: true } }));
  } catch (e) {
    console.error('[EAD] catálogo de cursos só online:', e.message);
    return [];
  }
}

module.exports = { criarCursoOnline, editarCursoOnline, apagarCursoSoOnline, idsSoOnline, semSoOnline, ehSoOnline, cursosSoOnlinePublicados, validar, nomeEmUso };
