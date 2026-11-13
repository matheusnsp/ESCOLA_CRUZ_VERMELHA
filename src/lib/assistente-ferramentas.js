// lib/assistente-ferramentas.js
//
// Assistente da secretaria (2026-11-13; spec docs/superpowers/specs/2026-11-13-assistente-secretaria-design.md §2).
// Ferramentas que o Claude pode chamar. Todas só LEEM o sistema (ou preparam um preenchimento de formulário, sem
// salvar). Cada uma confere a permissão da ROTA da tela correspondente e devolve só o que aquela tela mostra.
// ctx = { pode(perm) -> bool, vistos: { alunos: Set, turmas: Set }, documentoAluno(u) -> { tipo, numero } | null }

const prisma = require('../db');
const { FORA_DO_PRESENCIAL } = require('./turma-online');

const pode = (ctx, ...perms) => perms.some((p) => ctx && typeof ctx.pode === 'function' && ctx.pode(p));
const SEM_PERMISSAO = { erro: 'sem_permissao' };

// ---- Texto: normalizar e comparar nomes ---------------------------------------------------------------------
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const palavras = (t) => normalizar(t).split(' ').filter((p) => p.length >= 2);

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let ant = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const atual = [i];
    for (let j = 1; j <= n; j++) atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = atual;
  }
  return ant[n];
}

// 0..1: para cada palavra procurada, a palavra mais parecida do nome (ordem livre); média das palavras procuradas.
function pontuarNome(termo, nome) {
  const t = palavras(termo), n = palavras(nome);
  if (!t.length || !n.length) return 0;
  const notas = t.map((pt) => Math.max(...n.map((pn) => {
    if (pn === pt) return 1;
    if (pt.length >= 3 && pn.startsWith(pt)) return 0.95;
    return 1 - levenshtein(pt, pn) / Math.max(pt.length, pn.length);
  })));
  return notas.reduce((s, x) => s + x, 0) / notas.length;
}

// Expressão para o Postgres achar candidatos ignorando acento: "joao" -> "j[oóòôõö][aáàâãä][oóòôõö]".
const CLASSES = { a: 'aáàâãä', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç', n: 'nñ' };
const regexSemAcento = (p) => p.split('').map((ch) => (CLASSES[ch] ? `[${CLASSES[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');

// ---- Definições (JSON schema estrito) -----------------------------------------------------------------------
const obj = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const DEFINICOES_CONSULTA = [
  { name: 'buscar_alunos', strict: true, description: 'Procura alunos pelo nome (aceita erro de digitação e falta de acento), e-mail, celular ou CPF. Devolve até 5, do mais parecido para o menos. Use antes de ver_aluno.',
    input_schema: obj({ termo: { type: 'string', description: 'Nome, e-mail, celular ou CPF, como a pessoa escreveu.' } }, ['termo']) },
  { name: 'ver_aluno', strict: true, description: 'Mostra o cadastro e as matrículas de um aluno (os mesmos dados da tela Inscrições do aluno). Precisa do id que veio de buscar_alunos.',
    input_schema: obj({ alunoId: { type: 'string' } }, ['alunoId']) },
  { name: 'listar_pendentes', strict: true, description: 'Quem está com pagamento pendente, igual à tela Pendentes. aba: com-taxa (pagou a inscrição e falta a matrícula; padrão), sem-taxa (nada pago, ainda dá tempo), fora-de-prazo. Filtra por curso (nome) ou turma.',
    input_schema: obj({ curso: { type: 'string' }, turmaId: { type: 'string' }, aba: { type: 'string', enum: ['com-taxa', 'sem-taxa', 'fora-de-prazo'] } }) },
  { name: 'listar_turmas', strict: true, description: 'Turmas presenciais, como na tela Turmas: curso, início, vagas ocupadas e situação. situacao: por-comecar, andamento, congeladas, concluidas, canceladas.',
    input_schema: obj({ situacao: { type: 'string', enum: ['por-comecar', 'andamento', 'congeladas', 'concluidas', 'canceladas'] }, curso: { type: 'string' } }) },
  { name: 'listar_cursos', strict: true, description: 'Cursos presenciais (id, nome, carga horária, se está ativo). Use para achar o curso de uma turma.',
    input_schema: obj({ termo: { type: 'string' } }) },
];

// ---- Execução ----------------------------------------------------------------------------------------------
const digitos = (t) => String(t || '').replace(/\D/g, '');
const anotar = (ctx, tipo, ids) => { if (ctx && ctx.vistos && ctx.vistos[tipo]) ids.forEach((id) => ctx.vistos[tipo].add(id)); };
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function buscarAlunos({ termo }, ctx) {
  if (!pode(ctx, 'aluno:gerenciar', 'painel:leitura')) return SEM_PERMISSAO;
  const t = String(termo || '').trim();
  const dig = digitos(t);
  if (normalizar(t).replace(/\s/g, '').length < 3) return { erro: 'termo_curto' };
  const sel = { id: true, nome: true, email: true, celular: true, cpfCnpj: true, tipoDocumento: true, passaporte: true, paisOrigem: true, _count: { select: { matriculas: true } } };
  let lista; let parecidos = false;
  if (t.includes('@')) {
    lista = await prisma.usuario.findMany({ where: { papel: 'ALUNO', email: { contains: t, mode: 'insensitive' } }, select: sel, take: 5 });
  } else if (dig.length >= 8 && dig.length >= t.replace(/\s/g, '').length - 6) {
    lista = await prisma.usuario.findMany({ where: { papel: 'ALUNO', OR: [{ celular: { contains: dig } }, { cpfCnpj: { contains: dig } }] }, select: sel, take: 5 });
  } else {
    // Candidatos: o começo (3-4 letras, sem acento) de qualquer palavra; a nota decide.
    const ps = palavras(t).filter((p) => p.length >= 3).slice(0, 4);
    if (!ps.length) return { erro: 'termo_curto' };
    const re = ps.map((p) => regexSemAcento(p.slice(0, Math.min(4, p.length)))).join('|');
    const ids = await prisma.$queryRaw`SELECT id FROM "Usuario" WHERE papel = 'ALUNO' AND nome ~* ${re} LIMIT 400`;
    const cand = ids.length ? await prisma.usuario.findMany({ where: { id: { in: ids.map((x) => x.id) } }, select: sel }) : [];
    const pontuados = cand.map((u) => ({ u, nota: pontuarNome(t, u.nome) })).filter((x) => x.nota >= 0.5).sort((a, b) => b.nota - a.nota).slice(0, 5);
    parecidos = !pontuados.length || pontuados[0].nota < 0.99;
    lista = pontuados.map((x) => ({ ...x.u, nota: Math.round(x.nota * 100) / 100 }));
  }
  anotar(ctx, 'alunos', lista.map((u) => u.id));
  const doc = (u) => (ctx && typeof ctx.documentoAluno === 'function' ? ctx.documentoAluno(u) : null);
  return {
    alunos: lista.map((u) => ({ id: u.id, nome: u.nome, email: u.email, celular: u.celular || null, documento: doc(u), matriculas: u._count.matriculas, ...(u.nota !== undefined ? { semelhanca: u.nota } : {}) })),
    parecidos,
    link: `/alunos?q=${encodeURIComponent(t)}`,
  };
}

const ROTULO_PAG = { PAGO: 'paga', PARCELADO: 'parcelada', PENDENTE: 'pendente', CANCELADO: 'cancelada', ESTORNADO: 'estornada' };
async function verAluno({ alunoId }, ctx) {
  if (!pode(ctx, 'aluno:gerenciar', 'painel:leitura')) return SEM_PERMISSAO;
  const u = /^[0-9a-f-]{36}$/i.test(String(alunoId || '')) ? await prisma.usuario.findUnique({ where: { id: alunoId } }) : null;
  if (!u || u.papel !== 'ALUNO') return { erro: 'nao_encontrado' };
  const ms = await prisma.matricula.findMany({ where: { alunoId: u.id }, include: { turma: { include: { curso: { select: { nome: true } } } } }, orderBy: { criadoEm: 'desc' } });
  anotar(ctx, 'alunos', [u.id]); anotar(ctx, 'turmas', ms.map((m) => m.turmaId));
  return {
    aluno: { id: u.id, nome: u.nome, email: u.email, celular: u.celular || null, documento: ctx && ctx.documentoAluno ? ctx.documentoAluno(u) : null,
      escolaridade: u.escolaridade || null, cadastradoEm: dia(u.criadoEm), bloqueado: !!u.bloqueioTotal },
    matriculas: ms.map((m) => ({
      id: m.id, curso: m.turma.curso.nome, turmaId: m.turmaId, inicioTurma: dia(m.turma.inicioPrevisto), situacaoTurma: m.turma.status,
      inscricao: m.taxaConfirmada ? 'paga' : 'não paga', matricula: ROTULO_PAG[m.statusPagamento] || m.statusPagamento,
      valorCurso: Number(m.valorCurso), taxaInscricao: Number(m.valorTaxaMatricula), forma: m.forma, plano: m.plano,
      alimentoEntregue: m.alimentoEntregue, nota: m.nota, situacaoAcademica: m.situacao || null,
    })),
    link: `/alunos/${u.id}/matriculas`,
  };
}

async function listarPendentesFerramenta({ curso, turmaId, aba }, ctx) {
  if (!pode(ctx, 'pendentes:gerenciar')) return SEM_PERMISSAO;
  const { listarPendentes } = require('./pendentes');
  const { faltaReceber } = require('./matricula');
  const agora = new Date();
  const r = await listarPendentes(agora);
  const qual = { 'com-taxa': r.comTaxa, 'sem-taxa': r.semTaxa, 'fora-de-prazo': r.foraDePrazo }[aba || 'com-taxa'] || r.comTaxa;
  const nc = normalizar(curso);
  const lista = qual.filter((m) => (!turmaId || m.turmaId === turmaId) && (!nc || normalizar(m.turma.curso.nome).includes(nc))).slice(0, 60);
  anotar(ctx, 'alunos', lista.map((m) => m.alunoId)); anotar(ctx, 'turmas', lista.map((m) => m.turmaId));
  return {
    aba: aba || 'com-taxa',
    total: lista.length,
    pessoas: lista.map((m) => ({
      aluno: { id: m.alunoId, nome: m.aluno.nome, celular: m.aluno.celular || null },
      turma: { id: m.turmaId, curso: m.turma.curso.nome, inicio: dia(m.turma.inicioPrevisto) },
      falta: Math.round(Number(faltaReceber(m)) * 100) / 100,
      diasAteAula: Math.ceil((new Date(m.turma.inicioPrevisto) - agora) / 86400000),
    })),
    link: `/pendentes${aba && aba !== 'com-taxa' ? `?aba=${aba}` : ''}`,
  };
}

async function listarTurmas({ situacao, curso }, ctx) {
  if (!pode(ctx, 'turmas:gerenciar', 'painel:leitura')) return SEM_PERMISSAO;
  const agora = new Date();
  const ativa = ['ABERTA', 'CONFIRMADA'];
  const where = { status: { notIn: FORA_DO_PRESENCIAL } };
  if (situacao === 'por-comecar') Object.assign(where, { status: { in: ativa }, inicioPrevisto: { gt: agora } });
  if (situacao === 'andamento') Object.assign(where, { status: { in: ativa }, inicioPrevisto: { lte: agora } });
  if (situacao === 'congeladas') where.status = 'CONGELADA';
  if (situacao === 'concluidas') where.status = 'ENCERRADA';
  if (situacao === 'canceladas') where.status = 'CANCELADA';
  const ts = await prisma.turma.findMany({
    where, orderBy: { inicioPrevisto: situacao === 'concluidas' || situacao === 'canceladas' ? 'desc' : 'asc' }, take: 80,
    include: { curso: { select: { nome: true } }, _count: { select: { matriculas: { where: { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } } } } },
  });
  const nc = normalizar(curso);
  const lista = ts.filter((t) => !nc || normalizar(t.curso.nome).includes(nc)).slice(0, 30);
  anotar(ctx, 'turmas', lista.map((t) => t.id));
  return {
    turmas: lista.map((t) => ({ id: t.id, curso: t.curso.nome, inicio: dia(t.inicioPrevisto), vagas: t.vagas, ocupadas: t._count.matriculas, minimo: t.minimoAlunos, status: t.status })),
    link: `/turmas${situacao && situacao !== 'por-comecar' ? `?aba=${situacao}` : ''}`,
  };
}

async function listarCursos({ termo }, ctx) {
  if (!pode(ctx, 'cursos:criar', 'cursos:gerenciar', 'turmas:gerenciar')) return SEM_PERMISSAO;
  const { semSoOnline } = require('./ead-curso-online');
  const cs = await semSoOnline(await prisma.curso.findMany({ where: { ebook: null }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, cargaHoraria: true, ativo: true } }));
  const nt = normalizar(termo);
  return { cursos: cs.filter((c) => !nt || normalizar(c.nome).includes(nt) || pontuarNome(nt, c.nome) >= 0.6).slice(0, 30) };
}

const CONSULTAS = { buscar_alunos: buscarAlunos, ver_aluno: verAluno, listar_pendentes: listarPendentesFerramenta, listar_turmas: listarTurmas, listar_cursos: listarCursos };

async function executarConsulta(nome, entrada, ctx) {
  const fn = CONSULTAS[nome];
  if (!fn) return { erro: 'ferramenta_desconhecida' };
  return fn(entrada && typeof entrada === 'object' ? entrada : {}, ctx || {});
}

module.exports = { DEFINICOES_CONSULTA, executarConsulta, pontuarNome, normalizar, levenshtein };
