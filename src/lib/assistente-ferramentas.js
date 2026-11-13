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
  { name: 'listar_pendentes', strict: true, description: 'Quem está com pagamento pendente, igual à tela Pendentes. aba: com-taxa (pagou a inscrição e falta a matrícula; padrão), sem-taxa (nada pago, ainda dá tempo), fora-prazo. Filtra por curso (nome) ou turma.',
    input_schema: obj({ curso: { type: 'string' }, turmaId: { type: 'string' }, aba: { type: 'string', enum: ['com-taxa', 'sem-taxa', 'fora-prazo'] } }) },
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
    // Prefixo de até 4 letras de cada palavra (tolera erro no fim da palavra). Ordena no banco por quantas palavras
    // batem (prefixo e palavra inteira) antes do LIMIT: sem isso, "Maria …" trazia 400 Marias quaisquer e a pessoa sumia.
    const prefixos = ps.map((p) => regexSemAcento(p.slice(0, Math.min(4, p.length))));
    const inteiras = ps.map((p) => regexSemAcento(p));
    const re = prefixos.join('|');
    const ids = await prisma.$queryRaw`SELECT id FROM "Usuario" WHERE papel = 'ALUNO' AND nome ~* ${re}
      ORDER BY (SELECT count(*) FROM unnest(${inteiras}::text[]) r WHERE nome ~* r) DESC,
               (SELECT count(*) FROM unnest(${prefixos}::text[]) r WHERE nome ~* r) DESC
      LIMIT 400`;
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
  const qual = { 'com-taxa': r.comTaxa, 'sem-taxa': r.semTaxa, 'fora-prazo': r.foraDePrazo }[aba || 'com-taxa'] || r.comTaxa;
  const nc = normalizar(curso);
  const todos = qual.filter((m) => (!turmaId || m.turmaId === turmaId) && (!nc || normalizar(m.turma.curso.nome).includes(nc)));
  const lista = todos.slice(0, 60);
  anotar(ctx, 'alunos', lista.map((m) => m.alunoId)); anotar(ctx, 'turmas', lista.map((m) => m.turmaId));
  return {
    aba: aba || 'com-taxa',
    total: todos.length,
    ...(todos.length > lista.length ? { truncado: true, aviso: `Mostrando ${lista.length} de ${todos.length}; a lista completa está na tela Pendentes.` } : {}),
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
  if (!situacao) where.status = { in: [...ativa, 'CONGELADA'] }; // sem situação: as turmas atuais, não as de anos atrás
  const nc = normalizar(curso);
  if (nc) { // filtro do curso no banco (antes do take), sem acento: os cursos são poucos
    const cursos = await prisma.curso.findMany({ select: { id: true, nome: true } });
    where.cursoId = { in: cursos.filter((c) => normalizar(c.nome).includes(nc)).map((c) => c.id) };
  }
  const ts = await prisma.turma.findMany({
    where, orderBy: { inicioPrevisto: situacao === 'concluidas' || situacao === 'canceladas' ? 'desc' : 'asc' }, take: 80,
    include: { curso: { select: { nome: true } }, _count: { select: { matriculas: { where: { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } } } } },
  });
  const lista = ts.slice(0, 30);
  anotar(ctx, 'turmas', lista.map((t) => t.id));
  return {
    turmas: lista.map((t) => ({ id: t.id, curso: t.curso.nome, inicio: dia(t.inicioPrevisto), vagas: t.vagas, ocupadas: t._count.matriculas, minimo: t.minimoAlunos, status: t.status })),
    link: `/turmas${situacao && situacao !== 'por-comecar' ? `?aba=${situacao}` : ''}`,
  };
}

async function listarCursos({ termo }, ctx) {
  // Tela Cursos (cursos:gerenciar | painel:leitura) + quem monta formulário de curso/turma (precisa achar o curso).
  if (!pode(ctx, 'cursos:gerenciar', 'painel:leitura', 'cursos:criar', 'turmas:gerenciar')) return SEM_PERMISSAO;
  const { semSoOnline } = require('./ead-curso-online');
  const cs = await semSoOnline(await prisma.curso.findMany({ where: { ebook: null, webinario: null }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, cargaHoraria: true, ativo: true } }));
  const nt = normalizar(termo);
  return { cursos: cs.filter((c) => !nt || normalizar(c.nome).includes(nt) || pontuarNome(nt, c.nome) >= 0.6).slice(0, 30) };
}

const CONSULTAS = { buscar_alunos: buscarAlunos, ver_aluno: verAluno, listar_pendentes: listarPendentesFerramenta, listar_turmas: listarTurmas, listar_cursos: listarCursos };

async function executarConsulta(nome, entrada, ctx) {
  const fn = CONSULTAS[nome];
  if (!fn) return { erro: 'ferramenta_desconhecida' };
  return fn(entrada && typeof entrada === 'object' ? entrada : {}, ctx || {});
}

// ---- Formulários: preparar o preenchimento de curso/turma (nunca grava) ------------------------------------
const CATEGORIAS_CURSO = require('./vitrine').CATEGORIAS;
const ESCOLARIDADES_CURSO = ['', 'Ensino Fundamental', 'Ensino Médio', 'Ensino Superior'];
const STATUS_TURMA = ['ABERTA', 'CONFIRMADA', 'CONGELADA', 'CANCELADA', 'ENCERRADA'];

// Tamanho máximo fica só no servidor: o modo estrito da API não aceita maxLength (o valor é cortado na validação).
// Formulários SEM strict: a API recusa o pedido inteiro quando as ferramentas strict somam mais de 24 parâmetros
// opcionais (estes três têm 30). Tudo é validado aqui (validarCurso/validarTurma), então o strict não faz falta.
const str = () => ({ type: 'string' });
const DEFINICOES_FORMULARIO = [
  { name: 'escrever_textos_curso', description: 'Escreve o resumo, o texto completo, o conteúdo programático e as dúvidas frequentes de um curso presencial, no padrão dos cursos do site (a mesma função do botão "Escrever com IA"). É o ÚNICO jeito de preencher resumo e texto completo. Em ideias, passe tudo que a pessoa contou sobre o curso (observações, público, temas, onde vai atuar, dúvidas). Depois os textos vão para o formulário com o botão "Preencher na tela".',
    input_schema: obj({ nome: str(120), cargaHoraria: { type: 'number' }, escolaridade: str(40), categoria: str(60), ideias: str(1500), cursoId: str(40) }, ['nome']) },
  { name: 'preencher_curso', description: 'Prepara o preenchimento do formulário de curso (novo ou edição) com os dados que a pessoa deu. Só os campos citados. Resumo e texto completo NÃO entram aqui: use escrever_textos_curso. Para MUDAR um curso que já existe, passe editarCursoId (da página atual ou de listar_cursos); sem ele, é um curso novo. Não salva: a pessoa confere e clica em Salvar. Preços em reais (número).',
    input_schema: obj({ campos: obj({
      nome: str(120), cargaHoraria: { type: 'number' }, escolaridadeMinima: { type: 'string', enum: ESCOLARIDADES_CURSO },
      categoria: { type: 'string', enum: ['', ...CATEGORIAS_CURSO] }, precoAvista: { type: 'number' }, precoCheio: { type: 'number' }, parcelas: { type: 'integer' }, taxaMatricula: { type: 'number' },
      nomeCertificado: str(160), conteudoProgramatico: str(4000), certificadoValidade: str(80), exigeComprovanteSaude: { type: 'boolean' }, pedido: str(600), ativo: { type: 'boolean' },
      faqs: { type: 'array', items: obj({ pergunta: str(200), resposta: str(1000) }, ['pergunta', 'resposta']) },
    }), editarCursoId: str() }, ['campos']) },
  { name: 'preencher_turma', description: 'Prepara o preenchimento do formulário de turma (nova ou edição). cursoId vem de listar_cursos. Datas AAAA-MM-DD; horário "HH:MM – HH:MM". Para "toda terça e quinta de dezembro", liste cada aula. Para MUDAR uma turma que já existe, passe editarTurmaId (da página atual ou de listar_turmas); sem ele, é uma turma nova. Não salva.',
    input_schema: obj({ campos: obj({
      cursoId: str(40), inicioPrevisto: str(10), vagas: { type: 'integer' }, minimoAlunos: { type: 'integer' }, instrutorNome: str(120), instrutorRegistro: str(60),
      status: { type: 'string', enum: STATUS_TURMA }, aulas: { type: 'array', items: obj({ data: str(10), horario: str(20) }, ['data', 'horario']) },
    }), editarTurmaId: str() }, ['campos']) },
];

const dataValida = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '')); if (!m) return false; const d = new Date(`${v}T12:00:00Z`); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() + 1 === +m[2] && d.getUTCDate() === +m[3]; };
const horarioNorm = (v) => { const m = /^\s*(\d{1,2})[:h](\d{2})\s*(?:–|-|às|a|até)\s*(\d{1,2})[:h](\d{2})\s*$/i.exec(String(v || '')); if (!m) return null; const p = (h, mi) => `${String(h).padStart(2, '0')}:${mi}`; if (+m[1] > 23 || +m[3] > 23) return null; return `${p(m[1], m[2])} – ${p(m[3], m[4])}`; };
const numero = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/\./g, '').replace(',', '.')));

function validarCurso(campos) {
  const ok = {}, erros = {}, ignorados = [];
  const conhecidos = new Set(['nome', 'cargaHoraria', 'escolaridadeMinima', 'categoria', 'precoAvista', 'precoCheio', 'parcelas', 'taxaMatricula', 'nomeCertificado', 'conteudoProgramatico', 'certificadoValidade', 'exigeComprovanteSaude', 'pedido', 'ativo', 'faqs']);
  for (const [k, v] of Object.entries(campos || {})) {
    if (!conhecidos.has(k)) { ignorados.push(k); continue; }
    if (['nome', 'nomeCertificado', 'conteudoProgramatico', 'certificadoValidade', 'pedido'].includes(k)) { ok[k] = String(v ?? '').replace(/\r\n/g, '\n').slice(0, 4000); continue; }
    if (k === 'cargaHoraria') { const n = numero(v); if (!(n >= 1 && n <= 2000)) erros[k] = 'carga horária deve ser um número de horas maior que zero'; else ok[k] = String(Math.round(n)); continue; }
    if (k === 'parcelas') { const n = numero(v); if (!(Number.isInteger(n) && n >= 1 && n <= 12)) erros[k] = 'parcelas: de 1 a 12'; else ok[k] = String(n); continue; }
    if (['precoAvista', 'precoCheio', 'taxaMatricula'].includes(k)) { const n = numero(v); if (!(n >= 0 && n < 100000)) erros[k] = 'valor em reais inválido'; else ok[k] = n.toFixed(2); continue; }
    if (k === 'escolaridadeMinima') { if (!ESCOLARIDADES_CURSO.includes(v)) erros[k] = `use: ${ESCOLARIDADES_CURSO.filter(Boolean).join(', ')} ou nenhuma`; else ok[k] = v; continue; }
    if (k === 'categoria') { if (!['', ...CATEGORIAS_CURSO].includes(v)) erros[k] = `use: ${CATEGORIAS_CURSO.join(', ')}`; else ok[k] = v; continue; }
    if (k === 'exigeComprovanteSaude' || k === 'ativo') { ok[k] = v === true || v === 'true'; continue; }
    if (k === 'faqs') { const l = (Array.isArray(v) ? v : []).filter((x) => x && String(x.pergunta || '').trim() && String(x.resposta || '').trim()).slice(0, 12).map((x) => ({ pergunta: String(x.pergunta).trim().slice(0, 200), resposta: String(x.resposta).trim().slice(0, 1000) })); ok[k] = l; continue; }
  }
  return { ok, erros, ignorados };
}

async function validarTurma(campos) {
  const ok = {}, erros = {}, ignorados = [];
  const conhecidos = new Set(['cursoId', 'inicioPrevisto', 'vagas', 'minimoAlunos', 'instrutorNome', 'instrutorRegistro', 'status', 'aulas']);
  for (const [k, v] of Object.entries(campos || {})) {
    if (!conhecidos.has(k)) { ignorados.push(k); continue; }
    if (k === 'inicioPrevisto') { if (!dataValida(v)) erros[k] = 'data inválida (AAAA-MM-DD)'; else ok[k] = v; continue; }
    if (k === 'vagas') { const n = numero(v); if (!(Number.isInteger(n) && n >= 1 && n <= 500)) erros[k] = 'vagas: de 1 a 500'; else ok[k] = String(n); continue; }
    if (k === 'minimoAlunos') { const n = numero(v); if (!(Number.isInteger(n) && n >= 0 && n <= 500)) erros[k] = 'mínimo: de 0 a 500'; else ok[k] = String(n); continue; }
    if (k === 'instrutorNome' || k === 'instrutorRegistro') { ok[k] = String(v ?? '').slice(0, 120); continue; }
    if (k === 'status') { if (!STATUS_TURMA.includes(v)) erros[k] = `use: ${STATUS_TURMA.join(', ')}`; else ok[k] = v; continue; }
    if (k === 'aulas') {
      const lista = (Array.isArray(v) ? v : []).slice(0, 60); const ruins = [];
      const aulas = lista.map((a, i) => { const h = horarioNorm(a && a.horario); if (!dataValida(a && a.data) || !h) ruins.push(i + 1); return { data: a && a.data, horario: h }; });
      if (ruins.length) erros[k] = `aula(s) ${ruins.join(', ')}: data AAAA-MM-DD e horário "HH:MM – HH:MM"`; else ok[k] = aulas;
      continue;
    }
    if (k === 'cursoId') {
      const c = /^[0-9a-f-]{36}$/i.test(String(v || '')) ? await prisma.curso.findUnique({ where: { id: v }, select: { id: true, nome: true, ebook: { select: { id: true } } } }) : null;
      const soOnline = c ? await require('./ead-curso-online').ehSoOnline(c.id).catch(() => false) : false;
      if (!c || c.ebook || soOnline) erros[k] = 'curso não encontrado entre os presenciais (use listar_cursos)'; else { ok[k] = c.id; ok.cursoNome = c.nome; }
    }
  }
  return { ok, erros, ignorados };
}

const dia2 = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
// Alvo da edição: curso presencial ou turma que existem -> { id, caminho, nome } (o navegador abre a tela de edição dele).
async function alvoEdicao(tipo, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  if (tipo === 'curso') {
    const c = await prisma.curso.findUnique({ where: { id }, select: { id: true, nome: true, ebook: { select: { id: true } } } });
    const soOnline = c ? await require('./ead-curso-online').ehSoOnline(c.id).catch(() => false) : false;
    return c && !c.ebook && !soOnline ? { id: c.id, caminho: `/cursos/${c.id}/editar`, nome: c.nome } : null;
  }
  const t = await prisma.turma.findUnique({ where: { id }, select: { id: true, status: true, inicioPrevisto: true, curso: { select: { nome: true } } } });
  return t && !FORA_DO_PRESENCIAL.includes(t.status) ? { id: t.id, caminho: `/turmas/${t.id}/editar`, nome: `${t.curso.nome} · ${dia2(t.inicioPrevisto)}` } : null;
}
async function comEdicao(tipo, idEditar, resposta) {
  if (idEditar == null || idEditar === '') return resposta;
  const campo = tipo === 'curso' ? 'editarCursoId' : 'editarTurmaId';
  const alvo = await alvoEdicao(tipo, idEditar).catch(() => null);
  if (!alvo) {
    const erros = { ...((resposta.resultado && resposta.resultado.erros) || {}), [campo]: `${tipo} não encontrado (use ${tipo === 'curso' ? 'listar_cursos' : 'listar_turmas'})` };
    return { resultado: { preparado: false, erros } };
  }
  if (!resposta.evento) return resposta;
  return { resultado: { ...resposta.resultado, editando: alvo.nome }, evento: { ...resposta.evento, editar: alvo } };
}

function respostaPreencher(formulario, { ok, erros, ignorados }) {
  if (Object.keys(erros).length) return { resultado: { preparado: false, erros, ignorados } };
  const campos = { ...ok }; const cursoNome = campos.cursoNome; delete campos.cursoNome;
  // Resumo e texto completo seguem o padrão do site: só o escrever_textos_curso escreve.
  const semTexto = formulario === 'curso' && ignorados.some((k) => k === 'descricao' || k === 'descricaoLonga')
    ? 'Resumo e texto completo não entram por aqui: chame escrever_textos_curso (com as observações da pessoa em ideias). ' : '';
  return { resultado: { preparado: true, formulario, campos: Object.keys(campos), ...(cursoNome ? { curso: cursoNome } : {}), ignorados, aviso: `${semTexto}Ainda não está salvo: a pessoa precisa clicar em "Preencher na tela", conferir e clicar em ${formulario === 'turma' ? 'Criar turma' : 'Criar curso'} (numa edição, "Salvar alterações").` },
    evento: { tipo: 'preencher', formulario, campos, ...(cursoNome ? { cursoNome } : {}) } };
}

async function escreverTextos(entrada, ctx) {
  const ia = require('./ead-ia');
  const t = await ia.dentroDoTeto();
  if (!t.ok) return { resultado: { erro: 'teto_ia', mensagem: t.erro } };
  const txt = require('./ia-textos');
  const cursoId = /^[0-9a-f-]{36}$/i.test(String(entrada.cursoId || '')) ? entrada.cursoId : null;
  const dados = { nome: String(entrada.nome || '').slice(0, 120), cargaHoraria: entrada.cargaHoraria || null, escolaridade: entrada.escolaridade || null, categoria: entrada.categoria || null };
  try {
    const r = await txt.escrever({ tipo: 'presencial', dados, ideias: String(entrada.ideias || '').slice(0, 1500), cursoId }, ctx && ctx.cliente ? { cliente: ctx.cliente } : {});
    await ia.somarCustoAvulso(r.usage);
    const campos = { descricao: r.textos.descricao, descricaoLonga: r.textos.descricaoLonga, conteudoProgramatico: r.textos.conteudoProgramatico, faqs: r.textos.faqs || [] };
    const resp = { resultado: { preparado: true, formulario: 'curso', textos: campos, aviso: 'Textos prontos; vão para o formulário com "Preencher na tela". Nada foi salvo.' }, evento: { tipo: 'preencher', formulario: 'curso', campos } };
    return cursoId ? comEdicao('curso', cursoId, resp) : resp; // textos de um curso que já existe: vão para a edição dele
  } catch (e) {
    if (e.usage) await ia.somarCustoAvulso(e.usage).catch(() => {});
    return { resultado: { erro: 'ia_falhou', mensagem: 'A IA não conseguiu escrever os textos agora.' } };
  }
}

async function executarFormulario(nome, entrada, ctx) {
  const e = entrada && typeof entrada === 'object' ? { ...entrada } : {};
  if (typeof e.campos === 'string') { try { e.campos = JSON.parse(e.campos); } catch (x) { e.campos = {}; } } // sem strict, pode vir como texto
  if (nome === 'escrever_textos_curso') return pode(ctx, 'cursos:criar', 'cursos:gerenciar') ? escreverTextos(e, ctx) : { resultado: SEM_PERMISSAO };
  if (nome === 'preencher_curso') return pode(ctx, 'cursos:criar', 'cursos:gerenciar') ? comEdicao('curso', e.editarCursoId, respostaPreencher('curso', validarCurso(e.campos))) : { resultado: SEM_PERMISSAO };
  if (nome === 'preencher_turma') return pode(ctx, 'turmas:gerenciar') ? comEdicao('turma', e.editarTurmaId, respostaPreencher('turma', await validarTurma(e.campos))) : { resultado: SEM_PERMISSAO };
  return { resultado: { erro: 'ferramenta_desconhecida' } };
}

module.exports = { DEFINICOES_CONSULTA, DEFINICOES_FORMULARIO, executarConsulta, executarFormulario, pontuarNome, normalizar, levenshtein };
