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

// A equipe (Dev, secretaria) que faz o curso pelo link de teste fica fora dos relatórios (2026-11-09).
const SO_ALUNOS = { papel: 'ALUNO' };

async function alunosDoCurso(cursoOnlineId, { filtro = 'todos', agora = new Date() } = {}) {
  const r = await carregarCursoParaAluno(cursoOnlineId);
  if (!r) return [];
  const [matriculas, acs] = await Promise.all([
    prisma.matricula.findMany({ where: { turma: { cursoId: r.co.cursoId, status: 'ONLINE' } }, include: { aluno: { select: { id: true, nome: true, email: true } }, cupomEad: { select: { cupom: { select: { codigo: true } } } } } }),
    prisma.alunoCursoEad.findMany({ where: { cursoOnlineId, usuario: SO_ALUNOS }, include: INCLUDE_PROGRESSO }),
  ]);
  const acDe = new Map(acs.map((a) => [a.usuarioId, a]));
  // Etapa 6: quem entrou por lote de escola (vaga ativa).
  const vagas = await prisma.vagaLoteEad.findMany({ where: { removidaEm: null, lote: { cursoOnlineId } }, include: { lote: { select: { escola: { select: { nome: true } } } } } }).catch(() => []);
  const vagaDe = new Map(vagas.map((v) => [v.usuarioId, v]));
  const linhas = [];
  const montar = (usuario, m, a) => {
    const vaga = !m || !PAGOS.includes(m.statusPagamento) ? vagaDe.get(usuario.id) : null;
    const inicio = vaga ? vaga.criadoEm : m ? m.confirmadaEm : a ? a.iniciadoEm : null;
    const estado = a ? estadoDoCurso(r.curso, progressoDe(a, inicio), agora) : null;
    return {
      alunoCursoId: a ? a.id : null,
      usuario: { nome: usuario.nome, email: usuario.email },
      origem: vaga ? `Escola: ${vaga.lote.escola.nome}` : m ? 'Pago' : 'Teste',
      inscricaoEm: vaga ? vaga.criadoEm : m ? m.criadoEm : a.criadoEm,
      pagamento: m ? m.statusPagamento : null,
      cupom: m && m.cupomEad ? m.cupomEad.cupom.codigo : null, // etapa 7
      percentual: estado ? estado.percentual : 0,
      ultimoAcesso: a ? ultimoAcessoDe(a) : null,
      fase: faseDe(inicio, agora),
      concluidoEm: a ? a.concluidoEm : null,
      cancelado: !vaga && !!m && CANCELADOS.includes(m.statusPagamento),
      liberado: !!vaga || !m || PAGOS.includes(m.statusPagamento),
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
  // Escola Digital (2026-11, vistoria P10): a mesma regra da lista (alunosDoCurso) para quem veio de escola.
  const vaga = !matricula || !PAGOS.includes(matricula.statusPagamento)
    ? await prisma.vagaLoteEad.findFirst({ where: { usuarioId: ac.usuarioId, removidaEm: null, lote: { cursoOnlineId } }, include: { lote: { select: { escola: { select: { nome: true } } } } } }).catch(() => null)
    : null;
  const inicio = vaga ? vaga.criadoEm : matricula ? matricula.confirmadaEm : ac.iniciadoEm;
  const estado = estadoDoCurso(r.curso, progressoDe(ac, inicio), agora);
  const modulos = new Map(r.co.modulos.map((m, i) => [m.id, { titulo: m.titulo, numero: i + 1 }]));
  const topicos = new Map(r.co.modulos.flatMap((m) => m.topicos).map((t) => [t.id, t.titulo]));
  const cenariosDoCurso = new Map(r.co.modulos.flatMap((m) => m.cenarios).map((c) => [c.id, c]));
  return {
    usuario: ac.usuario, alunoCurso: ac, matricula, origem: vaga ? `Escola: ${vaga.lote.escola.nome}` : matricula ? 'Pago' : 'Teste', fase: faseDe(inicio, agora), estado,
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
    where: { cursoOnlineId, concluidoEm: { not: null }, usuario: SO_ALUNOS },
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

const MIN_RESPOSTAS = 5; // abaixo disso o % de erro ainda não diz nada
const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);

// Como o conteúdo está indo: perguntas que mais erram (quiz + pré-teste, 5+ respostas), cenários (tempo
// médio, % acima do tempo sugerido, erros médios; só os concluídos) e pré-teste por módulo.
// Erros por decisão não existem no banco (o cenário guarda só o total da jogada): ficam os erros médios.
async function desempenhoDoCurso(cursoOnlineId) {
  if (!ehId(cursoOnlineId)) return { perguntas: [], cenarios: [], preTestes: [], duvidasPorTela: [] };
  const [tentativas, perguntas, cenarios, feitos, modulos] = await Promise.all([
    prisma.tentativaEad.findMany({ where: { alunoCurso: { cursoOnlineId, usuario: SO_ALUNOS } }, select: { tipo: true, moduloId: true, aprovado: true, concluidaEm: true, respostas: true } }),
    prisma.perguntaEad.findMany({ where: { topico: { modulo: { cursoOnlineId } } }, select: { id: true, enunciado: true, topico: { select: { titulo: true } } } }),
    prisma.cenarioEad.findMany({ where: { modulo: { cursoOnlineId } }, select: { id: true, titulo: true, tempoSugeridoSeg: true }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
    prisma.cenarioFeitoEad.findMany({ where: { cenario: { modulo: { cursoOnlineId } }, concluidoEm: { not: null }, alunoCurso: { usuario: SO_ALUNOS } }, select: { cenarioId: true, tempoSeg: true, erros: true } }),
    prisma.moduloEad.findMany({ where: { cursoOnlineId, final: false }, select: { id: true, titulo: true }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
  ]);

  const contas = new Map();
  for (const t of tentativas) {
    for (const r of Array.isArray(t.respostas) ? t.respostas : []) {
      const c = contas.get(r.perguntaId) || { respostas: 0, erros: 0 };
      c.respostas += 1; if (!r.correta) c.erros += 1;
      contas.set(r.perguntaId, c);
    }
  }
  const listaPerguntas = perguntas
    .map((p) => ({ id: p.id, enunciado: p.enunciado, topico: p.topico.titulo, ...(contas.get(p.id) || { respostas: 0, erros: 0 }) }))
    .filter((p) => p.respostas >= MIN_RESPOSTAS)
    .map((p) => ({ ...p, pctErro: pct(p.erros, p.respostas) }))
    .sort((a, b) => b.pctErro - a.pctErro || b.respostas - a.respostas);

  const listaCenarios = cenarios.map((c) => {
    const f = feitos.filter((x) => x.cenarioId === c.id);
    const comTempo = f.filter((x) => x.tempoSeg !== null);
    return {
      id: c.id, titulo: c.titulo, tempoSugeridoSeg: c.tempoSugeridoSeg, feitos: f.length,
      tempoMedioSeg: comTempo.length ? Math.round(comTempo.reduce((s, x) => s + x.tempoSeg, 0) / comTempo.length) : null,
      pctEstourou: pct(comTempo.filter((x) => x.tempoSeg > c.tempoSugeridoSeg).length, comTempo.length),
      errosMedios: f.length ? Math.round((f.reduce((s, x) => s + x.erros, 0) / f.length) * 10) / 10 : null,
    };
  });

  const preTestes = modulos.map((m) => {
    const ts = tentativas.filter((t) => t.tipo === 'PRE_TESTE' && t.moduloId === m.id && t.concluidaEm);
    return { moduloId: m.id, titulo: m.titulo, tentativas: ts.length, pctAprovacao: pct(ts.filter((t) => t.aprovado).length, ts.length) };
  }).filter((p) => p.tentativas > 0);

  // Etapa 5: as 10 telas com mais dúvidas (todas as situações contam: é onde o aluno travou).
  const grupos = await prisma.duvidaEad.groupBy({ by: ['telaId'], where: { tela: { topico: { modulo: { cursoOnlineId } } } }, _count: { _all: true } });
  const telas = grupos.length ? await prisma.telaEad.findMany({ where: { id: { in: grupos.map((g) => g.telaId) } }, select: { id: true, titulo: true, topico: { select: { modulo: { select: { titulo: true } } } } } }) : [];
  const porId = new Map(telas.map((t) => [t.id, t]));
  const duvidasPorTela = grupos
    .map((g) => ({ telaId: g.telaId, titulo: porId.get(g.telaId)?.titulo || '(apagada)', modulo: porId.get(g.telaId)?.topico.modulo.titulo || '', total: g._count._all }))
    .sort((a, b) => b.total - a.total || a.titulo.localeCompare(b.titulo, 'pt-BR'))
    .slice(0, 10);

  return { perguntas: listaPerguntas, cenarios: listaCenarios, preTestes, duvidasPorTela };
}

// Excel com o que as telas mostram: Alunos, Concluintes e Perguntas.
async function planilhaDoCurso(cursoOnlineId) {
  const ExcelJS = require('exceljs');
  const [alunos, concluintes, desempenho] = await Promise.all([alunosDoCurso(cursoOnlineId), concluintesDoCurso(cursoOnlineId), desempenhoDoCurso(cursoOnlineId)]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escola CVB-RJ';
  const aba = (nome, colunas, linhas) => {
    const ws = wb.addWorksheet(nome);
    ws.columns = colunas.map(([header, width, numFmt]) => ({ header, width, style: numFmt ? { numFmt } : {} }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    linhas.forEach((l) => ws.addRow(l));
  };
  const DATA = 'dd/mm/yyyy'; const DATA_HORA = 'dd/mm/yyyy hh:mm';
  const ROT_PAG = { PAGO: 'Pago', PARCELADO: 'Pago', PENDENTE: 'Aguardando', CANCELADO: 'Cancelado', ESTORNADO: 'Estornado' };
  aba('Alunos', [['Nome', 32], ['E-mail', 34], ['Origem', 10], ['Inscrição', 12, DATA], ['Pagamento', 13], ['% concluído', 12], ['Último acesso', 17, DATA_HORA], ['Fase', 11], ['Concluiu em', 12, DATA]],
    alunos.map((l) => [l.usuario.nome, l.usuario.email, l.origem, l.inscricaoEm, l.pagamento ? ROT_PAG[l.pagamento] || l.pagamento : '', l.percentual, l.ultimoAcesso, l.fase || '', l.concluidoEm]));
  aba('Concluintes', [['Nome', 32], ['E-mail', 34], ['Concluiu em', 12, DATA], ['Livro', 8], ['Registro', 10], ['Código da Redação', 18]],
    concluintes.map((c) => [c.nome, c.email, c.concluidoEm, c.livro, c.registro, c.codigoRedacao || '']));
  aba('Perguntas', [['Pergunta', 60], ['Tópico', 28], ['Respostas', 11], ['Erros', 8], ['% de erro', 10]],
    desempenho.perguntas.map((p) => [p.enunciado, p.topico, p.respostas, p.erros, p.pctErro]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { alunosDoCurso, detalheDoAluno, concluintesDoCurso, desempenhoDoCurso, planilhaDoCurso, INCLUDE_PROGRESSO, progressoDe, ultimoAcessoDe };
