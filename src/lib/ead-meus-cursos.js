// lib/ead-meus-cursos.js
//
// Minha conta → aba "Cursos online" (etapa 7). Junta os cursos online da pessoa: comprados (matrícula paga na
// turma ONLINE, "cortesia" quando o cupom zerou o preço), liberados pela escola (vaga de lote) e os de
// pagamento pendente (só quem chegou a gerar uma cobrança). Um item por curso; o comprado vale mais que a vaga.
// Spec: docs/superpowers/specs/2026-11-09-ead-cupom.md §7

const prisma = require('../db');
const { ehId } = require('./ead-db');
const { estadoDoCurso } = require('./ead-progresso');
const { carregarCursoParaAluno } = require('./ead-progresso-db');
const { INCLUDE_PROGRESSO, progressoDe, ultimoAcessoDe } = require('./ead-relatorios');
const { vagasDoAluno } = require('./ead-lote');

const PAGOS = ['PAGO', 'PARCELADO'];
const ORDEM = { andamento: 0, novo: 1, concluido: 2, pendente: 3 };

async function meusCursosOnline(usuarioId, agora = new Date()) {
  if (!ehId(usuarioId)) return [];
  const [matriculas, vagas] = await Promise.all([
    prisma.matricula.findMany({
      where: { alunoId: usuarioId, turma: { status: 'ONLINE' }, statusPagamento: { in: [...PAGOS, 'PENDENTE'] } },
      include: { cupomEad: { select: { precoFinal: true } }, pagamentos: { where: { status: 'PENDENTE' }, select: { id: true }, take: 1 }, turma: { select: { cursoId: true } } },
    }),
    vagasDoAluno(usuarioId),
  ]);

  // Por curso: { cursoId, origem, escola?, inicio, pendente }
  const porCurso = new Map();
  for (const m of matriculas) {
    if (PAGOS.includes(m.statusPagamento)) {
      const cortesia = m.cupomEad && Number(m.cupomEad.precoFinal) === 0;
      porCurso.set(m.turma.cursoId, { cursoId: m.turma.cursoId, origem: cortesia ? 'cortesia' : 'comprado', inicio: m.confirmadaEm });
    }
  }
  for (const v of vagas) {
    if (!porCurso.has(v.cursoId)) porCurso.set(v.cursoId, { cursoId: v.cursoId, origem: 'escola', escola: v.escola, inicio: v.desde });
  }
  for (const m of matriculas) {
    if (m.statusPagamento === 'PENDENTE' && m.pagamentos.length && !porCurso.has(m.turma.cursoId)) {
      porCurso.set(m.turma.cursoId, { cursoId: m.turma.cursoId, origem: 'comprado', pendente: true });
    }
  }
  if (!porCurso.size) return [];

  const cos = await prisma.cursoOnline.findMany({ where: { cursoId: { in: [...porCurso.keys()] } }, include: { curso: { select: { nome: true, imagemUrl: true } } } });
  const itens = [];
  for (const co of cos) {
    const base = porCurso.get(co.cursoId);
    const item = {
      cursoId: co.cursoId, curso: co.curso.nome, imagemUrl: co.curso.imagemUrl, origem: base.origem, escola: base.escola || null,
      situacao: 'pendente', percentual: 0, ultimoAcesso: null, concluidoEm: null, link: `/online/${co.cursoId}`,
    };
    if (!base.pendente) {
      const ac = await prisma.alunoCursoEad.findUnique({ where: { usuarioId_cursoOnlineId: { usuarioId, cursoOnlineId: co.id } }, include: INCLUDE_PROGRESSO });
      if (ac && ac.concluidoEm) {
        Object.assign(item, { situacao: 'concluido', percentual: 100, concluidoEm: ac.concluidoEm, ultimoAcesso: ultimoAcessoDe(ac) });
      } else if (ac) {
        const r = await carregarCursoParaAluno(co.id);
        const estado = estadoDoCurso(r.curso, progressoDe(ac, base.inicio), agora);
        const ultimo = ultimoAcessoDe(ac);
        Object.assign(item, { situacao: ultimo ? 'andamento' : 'novo', percentual: estado.percentual, ultimoAcesso: ultimo, link: `/online/${co.cursoId}/continuar` });
      } else {
        Object.assign(item, { situacao: 'novo', link: `/online/${co.cursoId}/continuar` });
      }
    }
    itens.push(item);
  }
  return itens.sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao]
    || (b.ultimoAcesso ? b.ultimoAcesso.getTime() : 0) - (a.ultimoAcesso ? a.ultimoAcesso.getTime() : 0)
    || a.curso.localeCompare(b.curso, 'pt-BR'));
}

module.exports = { meusCursosOnline };
