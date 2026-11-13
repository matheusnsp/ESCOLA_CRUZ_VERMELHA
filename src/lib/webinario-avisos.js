// lib/webinario-avisos.js
//
// Webinários (2026-11-13; spec §5): confirmação da inscrição (grátis ou paga). A inscrição paga nasce aqui quando o
// pagamento confirma (lib/status-pagamento.js) ou quando um cupom de 100% libera (routes/webinarios.js).

const prisma = require('../db');
const wb = require('./webinario');
const { icsDoWebinario } = require('./agenda');

async function confirmarInscricao(w, usuarioId) {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true, email: true } });
  if (!u) return;
  const link = wb.linkPagina(w);
  await require('./email').enviarWebinarConfirmado(u.email, String(u.nome || '').split(' ')[0], {
    webinario: w.curso.nome, quando: wb.quandoTexto(w.inicioEm), link, ics: w.inicioEm ? icsDoWebinario(w, link) : null,
  });
}

// Matrícula paga na turma online de um webinário -> InscricaoWebinario (uma só) e e-mail de confirmação (só na primeira).
// Devolve true se a matrícula é de webinário (para o chamador não mandar outro aviso).
async function inscricaoPaga(matriculaId) {
  const m = await prisma.matricula.findUnique({ where: { id: matriculaId }, select: { alunoId: true, turma: { select: { cursoId: true } } } });
  if (!m) return false;
  const w = await prisma.webinario.findUnique({ where: { cursoId: m.turma.cursoId }, include: wb.INCLUIR });
  if (!w) return false;
  const ja = await prisma.inscricaoWebinario.findUnique({ where: { webinarioId_usuarioId: { webinarioId: w.id, usuarioId: m.alunoId } } });
  if (ja) return true;
  await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId: m.alunoId } }).catch(() => null);
  require('./cache-rapido').limparLinks(m.alunoId);
  await confirmarInscricao(w, m.alunoId);
  return true;
}

module.exports = { confirmarInscricao, inscricaoPaga };
