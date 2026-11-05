// lib/ead-relatorios.js
//
// Painel do EAD (etapa 4, só DEV): quem está no curso online e como está indo.
//   alunosDoCurso: matrículas da turma online (origem "Pago") + quem entrou pelo link de teste ("Teste").
//   detalheDoAluno: progresso por módulo e tópico, tentativas e cenários.
//   concluintesDoCurso: concluídos com Livro/Registro e o código da Redação.
// O percentual e a fase vêm das regras do aluno (lib/ead-progresso.js), com o início de cada um: no
// pago, o pagamento confirmado; no teste, o primeiro acesso.

const prisma = require('../db');
const { estadoDoCurso, DIAS_SEQUENCIAIS } = require('./ead-progresso');
const { carregarCursoParaAluno } = require('./ead-progresso-db');
const { ehId } = require('./ead-db');
const cert = require('./certificado');
const redacao = require('./redacao');

const DIA_MS = 24 * 3600 * 1000;
const CANCELADOS = ['CANCELADO', 'ESTORNADO'];
const PAGOS = ['PAGO', 'PARCELADO'];

const INCLUDE_PROGRESSO = {
  usuario: { select: { id: true, nome: true, email: true } },
  telasVistas: { select: { telaId: true, vistaEm: true } },
  tentativas: { select: { id: true, tipo: true, moduloId: true, topicoId: true, aprovado: true, acertos: true, total: true, concluidaEm: true, criadoEm: true, atualizadoEm: true } },
  cenarios: { select: { cenarioId: true, concluidoEm: true, atualizadoEm: true, tempoSeg: true, erros: true } },
};

const progressoDe = (ac, inicio) => ({
  iniciadoEm: inicio || ac.iniciadoEm,
  telasVistas: new Set(ac.telasVistas.map((t) => t.telaId)),
  tentativas: ac.tentativas,
  cenarios: ac.cenarios,
});

function ultimoAcessoDe(ac) {
  const datas = [...ac.telasVistas.map((t) => t.vistaEm), ...ac.tentativas.map((t) => t.atualizadoEm), ...ac.cenarios.map((c) => c.atualizadoEm)];
  return datas.length ? new Date(Math.max(...datas.map((d) => new Date(d).getTime()))) : null;
}

const faseDe = (inicio, agora) => (inicio ? (agora.getTime() < new Date(inicio).getTime() + DIAS_SEQUENCIAIS * DIA_MS ? 'Nos 7 dias' : 'Livre') : null);

async function alunosDoCurso(cursoOnlineId, { filtro = 'todos', agora = new Date() } = {}) {
  const r = await carregarCursoParaAluno(cursoOnlineId);
  if (!r) return [];
  const [matriculas, acs] = await Promise.all([
    prisma.matricula.findMany({ where: { turma: { cursoId: r.co.cursoId, status: 'ONLINE' } }, include: { aluno: { select: { id: true, nome: true, email: true } } } }),
    prisma.alunoCursoEad.findMany({ where: { cursoOnlineId }, include: INCLUDE_PROGRESSO }),
  ]);
  const acDe = new Map(acs.map((a) => [a.usuarioId, a]));
  const linhas = [];
  const montar = (usuario, m, a) => {
    const inicio = m ? m.confirmadaEm : a ? a.iniciadoEm : null;
    const estado = a ? estadoDoCurso(r.curso, progressoDe(a, inicio), agora) : null;
    return {
      alunoCursoId: a ? a.id : null,
      usuario: { nome: usuario.nome, email: usuario.email },
      origem: m ? 'Pago' : 'Teste',
      inscricaoEm: m ? m.criadoEm : a.criadoEm,
      pagamento: m ? m.statusPagamento : null,
      percentual: estado ? estado.percentual : 0,
      ultimoAcesso: a ? ultimoAcessoDe(a) : null,
      fase: faseDe(inicio, agora),
      concluidoEm: a ? a.concluidoEm : null,
      cancelado: !!m && CANCELADOS.includes(m.statusPagamento),
      liberado: !m || PAGOS.includes(m.statusPagamento),
    };
  };
  for (const m of matriculas) linhas.push(montar(m.aluno, m, acDe.get(m.alunoId)));
  const comMatricula = new Set(matriculas.map((m) => m.alunoId));
  for (const a of acs) if (!comMatricula.has(a.usuarioId)) linhas.push(montar(a.usuario, null, a));

  const filtros = {
    andamento: (l) => !l.concluidoEm && !l.cancelado && l.liberado,
    concluidos: (l) => !!l.concluidoEm && !l.cancelado,
    cancelados: (l) => l.cancelado,
  };
  return linhas.filter(filtros[filtro] || (() => true)).sort((a, b) => a.usuario.nome.localeCompare(b.usuario.nome, 'pt-BR'));
}

// Detalhe de um aluno deste curso (null se o alunoCursoId não é do curso).
async function detalheDoAluno(cursoOnlineId, alunoCursoId, { agora = new Date() } = {}) {
  if (!ehId(cursoOnlineId) || !ehId(alunoCursoId)) return null;
  const ac = await prisma.alunoCursoEad.findFirst({ where: { id: alunoCursoId, cursoOnlineId }, include: INCLUDE_PROGRESSO });
  if (!ac) return null;
  const r = await carregarCursoParaAluno(cursoOnlineId);
  const matricula = await prisma.matricula.findFirst({ where: { alunoId: ac.usuarioId, turma: { cursoId: r.co.cursoId, status: 'ONLINE' } } });
  const inicio = matricula ? matricula.confirmadaEm : ac.iniciadoEm;
  const estado = estadoDoCurso(r.curso, progressoDe(ac, inicio), agora);
  const modulos = new Map(r.co.modulos.map((m, i) => [m.id, { titulo: m.titulo, numero: i + 1 }]));
  const topicos = new Map(r.co.modulos.flatMap((m) => m.topicos).map((t) => [t.id, t.titulo]));
  const cenariosDoCurso = new Map(r.co.modulos.flatMap((m) => m.cenarios).map((c) => [c.id, c]));
  return {
    usuario: ac.usuario, alunoCurso: ac, matricula, origem: matricula ? 'Pago' : 'Teste', fase: faseDe(inicio, agora), estado,
    co: r.co,
    tentativas: ac.tentativas
      .slice().sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
      .map((t) => ({ ...t, modulo: modulos.get(t.moduloId) || null, topico: t.topicoId ? topicos.get(t.topicoId) || null : null })),
    cenarios: ac.cenarios.map((c) => {
      const x = cenariosDoCurso.get(c.cenarioId);
      return { ...c, titulo: x ? x.titulo : '(apagado)', tempoSugeridoSeg: x ? x.tempoSugeridoSeg : null };
    }),
  };
}

// Concluídos (mais recentes primeiro), com Livro/Registro e o código da Redação (null se ainda não há).
async function concluintesDoCurso(cursoOnlineId) {
  if (!ehId(cursoOnlineId)) return [];
  const acs = await prisma.alunoCursoEad.findMany({
    where: { cursoOnlineId, concluidoEm: { not: null } },
    include: { usuario: { select: { nome: true, email: true } } },
    orderBy: { concluidoEm: 'desc' },
  });
  const codigos = await redacao.codigosRegistrados(acs.map((a) => a.id));
  const lista = [];
  for (const a of acs) {
    const n = await cert.lerNumero(a.id);
    lista.push({
      alunoCursoId: a.id, nome: a.usuario.nome, email: a.usuario.email, concluidoEm: a.concluidoEm,
      livro: n ? n.livro : null, registro: n ? n.registro : null, codigoRedacao: codigos[a.id] ? codigos[a.id].codigo : null,
    });
  }
  return lista;
}

module.exports = { alunosDoCurso, detalheDoAluno, concluintesDoCurso };
