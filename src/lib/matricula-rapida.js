// lib/matricula-rapida.js
//
// Aba Turmas → Matrícula rápida. Quem paga a inscrição no site da instituição
// (cruzvermelhariodejaneiro.org/matricula-cursos-presenciais) não cria conta nem escolhe turma: diz
// os horários que pode e sugere uma turma. Aqui a secretaria vê todo mundo e encaixa na turma.
//
//   - Pessoas: a mesma leitura da aba Horários (lib/horarios-site.js: respostas + sem_resposta).
//   - Pagamentos: as transações da conta da Únicopag da instituição (UNICOPAG_API_TOKEN_2, conta
//     'segunda' em lib/unicopag.js), ligadas à pessoa pelo e-mail (ou telefone). Transação sem
//     pessoa (PIX gerado e não pago, cartão recusado…) aparece à parte: "mostra tudo".
//   - Encaixar: conta da pessoa na escola (a que já existe com o e-mail, ou uma nova), matrícula
//     PARCELADO com a taxa já paga (Pagamento TAXA PAGO, gateway 'unicopag-2') e e-mail para criar
//     a senha e pagar o curso. O encaixe fica anotado em Configuracao 'matricularapida:<inscrição>'.
//   - Mover / Voltar para a espera: valem para toda matrícula do curso (encaixe daqui ou feita pelo
//     site da escola). Nada é apagado: a matrícula só troca de turma, e a lista de espera é a turma
//     EM_ESPERA do curso (lib/turma-espera.js). Encaixar quem está na espera move essa matrícula.

const prisma = require('../db');
const horariosSite = require('./horarios-site');
const unicopag = require('./unicopag');
const { calcularValores } = require('./matricula');
const { validarCpfCnpj } = require('./documento');
const { hashSenha } = require('./password');
const { criarTokenReset } = require('./tokens');
const { ehEspera, turmaDeEspera } = require('./turma-espera');
const {
  enviarEncaixeMatriculaRapida, enviarMudancaTurmaMatriculaRapida, enviarEntradaNaEspera, enviarTurmaDefinida,
} = require('./email');

const CHAVE = (inscricaoId) => 'matricularapida:' + inscricaoId;
const ler = (v) => { try { return JSON.parse(v); } catch (e) { return {}; } };
const digitos = (s) => String(s || '').replace(/\D/g, '');
const PAGO = ['paid', 'approved', 'authorized', 'captured', 'pago'];
const DESFEITA = ['CANCELADO', 'ESTORNADO']; // matrícula que não vale mais (trata-se em Inscrições)
// Anotação só de histórico: matrícula feita pelo site da escola, gravada ao mover / mandar para a espera.
const soHistorico = (a) => !!a && !!a.naEscola && !a.ligado;

// Transações da pessoa: as do e-mail dela; só sem nenhuma pelo e-mail, as do telefone — e então só
// transação sem e-mail, ou com e-mail que não é de outra pessoa da lista e com o mesmo primeiro nome.
function transacoesDaPessoa(pessoa, transacoes, { usadas = new Set(), emailsDaLista = new Set() } = {}) {
  const email = String(pessoa.email || '').trim().toLowerCase();
  const tel = digitos(pessoa.telefone);
  const livres = transacoes.filter((t) => !usadas.has(t.hash));
  let minhas = email ? livres.filter((t) => t.email === email) : [];
  if (!minhas.length && tel.length >= 10) {
    const primeiro = (n) => String(n || '').trim().split(/\s+/)[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    minhas = livres.filter((t) => t.telefone && t.telefone.endsWith(tel.slice(-9))
      && (!t.email || !emailsDaLista.has(t.email))
      && (!t.email || primeiro(t.nome) === primeiro(pessoa.nome))); // telefone + e-mail diferente: só se o nome bate
  }
  // a paga primeiro; depois a mais recente
  return minhas.sort((a, b) => (situacaoPagamento(b.status) === 'pago') - (situacaoPagamento(a.status) === 'pago') || String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

// Situação de um status da Únicopag, para a tela.
function situacaoPagamento(status) {
  const s = String(status || '').toLowerCase();
  if (PAGO.includes(s)) return 'pago';
  if (['refunded', 'chargeback', 'charged_back', 'reversed'].includes(s)) return 'estornado';
  if (['canceled', 'cancelled', 'refused', 'rejected', 'failed', 'expired', 'voided'].includes(s)) return 'recusado';
  return 'pendente';
}

async function encaixes() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'matricularapida:' } } });
  return Object.fromEntries(cfgs.map((c) => [c.chave.slice('matricularapida:'.length), ler(c.valor)]));
}

// Tudo o que a aba mostra. { erro } se o site da instituição não respondeu.
async function carregar({ forcar = false } = {}) {
  const site = await horariosSite.buscar({ forcar });
  if (!site.ok) return { erro: site.erro };
  const pagamentos = await unicopag.listarTransacoes('segunda', { forcar });
  const transacoes = pagamentos.ok ? pagamentos.lista : [];

  // A pessoa (com ou sem resposta de horários), com a resposta junto quando houver.
  const pessoas = [
    ...site.dados.respostas.map((r) => ({ ...r, respondeu: true })),
    ...site.dados.semResposta.map((r) => ({ ...r, respondeu: false, horarios: [] })),
  ];

  // Uma transação liga a uma pessoa só. Primeiro todo mundo pelo e-mail; depois o telefone.
  const usadas = new Set();
  const emailsDaLista = new Set(pessoas.map((p) => String(p.email || '').trim().toLowerCase()).filter(Boolean));
  const doPessoa = (p) => {
    const minhas = transacoesDaPessoa(p, transacoes, { usadas, emailsDaLista });
    minhas.forEach((t) => usadas.add(t.hash));
    return minhas;
  };
  const anotados = await encaixes();
  await corrigirTotais(anotados).catch((e) => console.error('[MATRICULA-RAPIDA] correção dos totais:', e.message));
  const ordem = [...pessoas].sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0)); // quem tem e-mail escolhe primeiro
  for (const p of ordem) {
    p.transacoes = doPessoa(p);
    p.pagamento = p.transacoes[0] || null;
    p.encaixe = anotados[String(p.inscricaoId)] || null;
  }
  // Matrícula de cada vínculo: status e turma ATUAL (a anotação pode ter ficado para trás, ex.:
  // Transferir em Inscrições). Lida antes do semEncaixe para a matrícula desfeita não prender a chave.
  const vinculos = {};
  const lerVinculos = async (lista) => {
    const ids = [...new Set(lista.filter((id) => id && !vinculos[id]))];
    if (!ids.length) return;
    const ms = await prisma.matricula.findMany({ where: { id: { in: ids } }, select: { id: true, statusPagamento: true, turma: { select: { id: true, inicioPrevisto: true, status: true } } } });
    for (const x of ms) vinculos[x.id] = x;
  };
  await lerVinculos(pessoas.filter((p) => p.encaixe).map((p) => p.encaixe.matriculaId));
  for (const p of pessoas) {
    const v = p.encaixe, mv = v && vinculos[v.matriculaId];
    if (!mv || !DESFEITA.includes(mv.statusPagamento)) continue;
    p.encaixe = null;
    // Só histórico: a chave não vale; o bloco semEncaixe abaixo decide como antes.
    if (soHistorico(v)) continue;
    // Encaixe / ligado cancelado ou estornado: nem "em turma" nem "aguardando"; trata-se em Inscrições.
    p.cancelada = { matriculaId: v.matriculaId, alunoId: v.alunoId, status: mv.statusPagamento, naEscola: !!v.naEscola };
  }
  // Quem também tem matrícula no mesmo curso feita pela escola (criou conta e se inscreveu lá, ou a
  // secretaria matriculou à mão): não espera encaixe. Liga pelo e-mail e pelo curso e, se a
  // inscrição foi paga aqui, junta sozinho a taxa da matrícula rápida à matrícula da escola
  // (ligarComEscola).
  const semEncaixe = pessoas.filter((p) => !p.encaixe && !p.cancelada && p.email && p.cursoId);
  if (semEncaixe.length) {
    const naEscola = await prisma.matricula.findMany({
      where: {
        aluno: { email: { in: [...new Set(semEncaixe.map((p) => p.email.trim()))], mode: 'insensitive' } },
        turma: { cursoId: { in: [...new Set(semEncaixe.map((p) => p.cursoId))] } },
        statusPagamento: { notIn: ['CANCELADO', 'ESTORNADO'] },
      },
      orderBy: [{ taxaConfirmada: 'desc' }, { criadoEm: 'desc' }],
      include: { aluno: { select: { email: true } }, turma: { include: { curso: true } }, pagamentos: true },
    });
    for (const p of semEncaixe) {
      const m = naEscola.find((x) => x.turma.cursoId === p.cursoId && String(x.aluno.email).toLowerCase() === p.email.trim().toLowerCase());
      if (!m) continue;
      const base = { matriculaId: m.id, turmaId: m.turmaId, alunoId: m.alunoId, naEscola: true };
      const pago = p.transacoes.find((t) => situacaoPagamento(t.status) === 'pago');
      if (pago) {
        try {
          const r = await ligarComEscola(p, pago, m);
          p.encaixe = r.dobro ? { ...base, dobro: r.dobro } : { ...base, ...r.anotado };
        } catch (e) {
          console.error('[MATRICULA-RAPIDA] ligar com a escola falhou:', e.message);
          p.encaixe = { ...base, erroLigar: String(e.message || e).split('\n').filter(Boolean).slice(-1)[0].slice(0, 200) };
        }
      } else if (m.taxaConfirmada || ['PAGO', 'PARCELADO'].includes(m.statusPagamento) || ehEspera(m.turma)) {
        p.encaixe = base; // pagou a inscrição pela escola (ou está na espera); não há pagamento daqui para ligar
      }
    }
  }

  // Turma de cada vínculo (data e status, para a tela): a turma atual da matrícula; sem matrícula,
  // a turma anotada.
  const comVinculo = pessoas.filter((p) => p.encaixe);
  await lerVinculos(comVinculo.map((p) => p.encaixe.matriculaId));
  const turmaDaMat = Object.fromEntries(Object.values(vinculos).map((x) => [x.id, x.turma]));
  const idsTurma = [...new Set(comVinculo.filter((p) => !turmaDaMat[p.encaixe.matriculaId]).map((p) => p.encaixe.turmaId).filter(Boolean))];
  const turmasEnc = idsTurma.length ? await prisma.turma.findMany({ where: { id: { in: idsTurma } }, select: { id: true, inicioPrevisto: true, status: true } }) : [];
  const porId = Object.fromEntries(turmasEnc.map((t) => [t.id, t]));
  for (const p of comVinculo) {
    const t = turmaDaMat[p.encaixe.matriculaId] || porId[p.encaixe.turmaId] || null;
    if (ehEspera(t)) {
      // Na lista de espera: a matrícula (e o que foi pago) continua, mas a pessoa aguarda encaixe.
      const v = p.encaixe;
      p.espera = { matriculaId: v.matriculaId, alunoId: v.alunoId, desde: v.esperaDesde || null, naEscola: !!v.naEscola };
      p.encaixe = null;
      continue;
    }
    p.encaixe.turma = t;
    if (t) p.encaixe.turmaId = t.id;
  }

  // Turmas abertas de cada curso (para o encaixe), a partir de hoje.
  const idsCurso = [...new Set(pessoas.map((p) => p.cursoId).filter(Boolean))];
  const hoje = new Date(); hoje.setUTCHours(0, 0, 0, 0);
  const turmas = idsCurso.length ? await prisma.turma.findMany({
    where: { cursoId: { in: idsCurso }, status: { in: ['ABERTA', 'CONFIRMADA'] }, inicioPrevisto: { gte: hoje } },
    orderBy: { inicioPrevisto: 'asc' },
    include: { aulas: { orderBy: { data: 'asc' }, take: 1 }, _count: { select: { matriculas: { where: { taxaConfirmada: true } } } } },
  }) : [];
  const turmasPorCurso = {};
  for (const t of turmas) (turmasPorCurso[t.cursoId] = turmasPorCurso[t.cursoId] || []).push(t);

  return {
    dados: site.dados,
    pessoas: pessoas.sort((a, b) => String(b.pagoEm).localeCompare(String(a.pagoEm))),
    soltas: transacoes.filter((t) => !usadas.has(t.hash)).sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm))),
    pagamentosOk: pagamentos.ok,
    pagamentosErro: pagamentos.ok ? null : pagamentos.erro,
    turmasPorCurso,
  };
}

// Encaixa a pessoa (inscrição do site) na turma. Devolve { ok, msg } para a tela.
// Quem está na lista de espera já tem matrícula (na turma EM_ESPERA do curso): ela é MOVIDA para a
// turma escolhida, sem conta, matrícula ou pagamento novos ({ daEspera: true, de }).
async function encaixar({ inscricaoId, turmaId, porUsuarioId, appUrl }) {
  const site = await horariosSite.buscar({ forcar: true });
  if (!site.ok) return { ok: false, msg: 'O site da instituição não respondeu. Tente de novo em instantes.' };
  const pessoa = [...site.dados.respostas, ...site.dados.semResposta].find((p) => String(p.inscricaoId) === String(inscricaoId));
  if (!pessoa) return { ok: false, msg: 'Inscrição não encontrada no site da instituição.' };

  const turma = await prisma.turma.findUnique({ where: { id: String(turmaId || '') }, include: { curso: true } });
  if (!turma || !['ABERTA', 'CONFIRMADA'].includes(turma.status)) return { ok: false, msg: 'Escolha uma turma aberta.' };
  if (pessoa.cursoId && turma.cursoId !== pessoa.cursoId) return { ok: false, msg: 'A turma escolhida é de outro curso.' };

  // Na espera? Então só muda a matrícula de turma (antes de qualquer criação).
  const atual = await matriculaDoCurso(inscricaoId, { pessoa });
  if (!atual.erro && ehEspera(atual.m.turma)) {
    const r = await moverMatricula({ inscricaoId, alvo: atual, destino: turma, porUsuarioId, appUrl });
    if (!r.ok) return r;
    return { ...r, alunoId: atual.m.alunoId, msg: `${pessoa.nome || atual.m.aluno.nome} encaixado(a) na turma de ${r.inicio} (saiu da lista de espera).` };
  }

  const ja = await prisma.configuracao.findUnique({ where: { chave: CHAVE(inscricaoId) } });
  if (ja) {
    // Anotação só de histórico (matrícula da escola) cuja matrícula foi cancelada/estornada ou não existe
    // mais: não vale, segue como se não houvesse chave (ela é sobrescrita ao gravar o encaixe, abaixo).
    const a = ler(ja.valor);
    const mAnt = soHistorico(a) && a.matriculaId
      ? await prisma.matricula.findUnique({ where: { id: a.matriculaId }, select: { statusPagamento: true } })
      : null;
    const historicoVelho = soHistorico(a) && (!mAnt || DESFEITA.includes(mAnt.statusPagamento));
    if (!historicoVelho) return { ok: false, msg: `${pessoa.nome} já foi encaixado(a) numa turma.` };
  }
  const email = String(pessoa.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, msg: 'A inscrição não tem um e-mail válido; fale com a pessoa antes de encaixar.' };

  // Pagamento na Únicopag da instituição (se a chave estiver no Render): CPF e forma de pagamento.
  const lista = await unicopag.listarTransacoes('segunda');
  const tel = digitos(pessoa.telefone);
  const emailsDaLista = new Set([...site.dados.respostas, ...site.dados.semResposta].map((l) => String(l.email || '').trim().toLowerCase()).filter(Boolean));
  const pago = transacoesDaPessoa(pessoa, lista.ok ? lista.lista : [], { emailsDaLista }).find((t) => situacaoPagamento(t.status) === 'pago');

  // Conta na escola: a do e-mail, ou uma nova. Com CPF válido do pagamento, a senha inicial é a do
  // cadastro normal (4 últimos dígitos); sem CPF, a pessoa cria a senha pelo link do e-mail.
  let aluno = await prisma.usuario.findUnique({ where: { email } });
  if (aluno && aluno.papel !== 'ALUNO') return { ok: false, msg: 'Esse e-mail é de uma conta da secretaria, não de aluno.' };
  let criada = false, senhaPeloCpf = false;
  if (!aluno) {
    const doc = pago && pago.documento ? validarCpfCnpj(pago.documento) : { ok: false };
    const cpfLivre = doc.ok && !(await prisma.usuario.findUnique({ where: { cpfCnpj: doc.normalizado } }));
    aluno = await prisma.usuario.create({
      data: {
        nome: pessoa.nome || email, email, papel: 'ALUNO', emailVerificado: false,
        celular: tel || null,
        ...(cpfLivre ? { tipoDocumento: doc.normalizado.length === 14 ? 'CNPJ' : 'CPF', cpfCnpj: doc.normalizado, senhaHash: await hashSenha(doc.normalizado.slice(-4)) } : { senhaHash: null }),
      },
    });
    criada = true; senhaPeloCpf = !!cpfLivre;
  }

  const existente = await prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId: aluno.id, turmaId: turma.id } } });
  if (existente && !(existente.statusPagamento === 'PENDENTE' && !existente.taxaConfirmada)) {
    return { ok: false, msg: `${pessoa.nome} já está matriculado(a) nessa turma.` };
  }
  const outraTurma = await prisma.matricula.findFirst({
    where: {
      alunoId: aluno.id, turma: { cursoId: turma.cursoId }, id: existente ? { not: existente.id } : undefined,
      OR: [{ taxaConfirmada: true }, { statusPagamento: { in: ['PAGO', 'PARCELADO'] } }],
      statusPagamento: { notIn: ['CANCELADO', 'ESTORNADO'] },
    },
  });
  if (outraTurma) return { ok: false, msg: `${pessoa.nome} já tem matrícula ativa noutra turma desse curso.` };
  const valores = await calcularValores(turma.curso, 'PARCELADO', aluno.id);
  // O que a pessoa pagou de fato: no cartão, com a taxa de processamento (ex.: R$ 103,95 por R$ 99).
  const taxa = pago && (pago.valorTotal || pago.valor) ? (pago.valorTotal || pago.valor) : Number(valores.valorTaxaMatricula);
  const confirmadaEm = pessoa.pagoEm ? new Date(pessoa.pagoEm) : new Date();
  const dados = {
    plano: 'PARCELADO', forma: 'CREDITO', // a taxa já foi paga; o curso a pessoa paga depois, pela escola
    // Como em toda matrícula da escola (routes/cursos.js), valorCurso é o TOTAL: curso + taxa.
    valorCurso: Math.round((Number(valores.valorCurso) + Number(taxa)) * 100) / 100, valorTaxaMatricula: taxa,
    statusPagamento: 'PENDENTE',
    taxaConfirmada: true, taxaConfirmadaPor: porUsuarioId, taxaConfirmadaEm: Number.isNaN(confirmadaEm.getTime()) ? new Date() : confirmadaEm,
  };
  const matricula = existente
    ? await prisma.matricula.update({ where: { id: existente.id }, data: dados })
    : await prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: turma.id, ...dados } });
  await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id, tipo: 'TAXA',
      metodo: pago && pago.metodo === 'credit_card' ? 'CREDITO' : 'PIX',
      valor: taxa, status: 'PAGO',
      gateway: unicopag.conta('segunda').gateway, // conta da instituição (matrícula rápida)
      gatewayRef: pago ? pago.hash : null, gatewayHash: pago ? pago.hash : null,
      gatewayStatus: pago ? pago.status : 'matricula-rapida',
    },
  });
  // upsert: se havia uma chave só de histórico de matrícula desfeita, o encaixe novo a sobrescreve.
  const valorChave = JSON.stringify({ matriculaId: matricula.id, turmaId: turma.id, alunoId: aluno.id, por: porUsuarioId, em: new Date().toISOString(), contaCriada: criada, totalComTaxa: true });
  await prisma.configuracao.upsert({
    where: { chave: CHAVE(inscricaoId) },
    create: { chave: CHAVE(inscricaoId), valor: valorChave },
    update: { valor: valorChave },
  });

  // E-mail: criar a senha (conta nova sem CPF), ou entrar (conta que já existia / senha pelo CPF).
  const base = (appUrl || process.env.APP_URL || 'https://escola.cruzvermelhariodejaneiro.org').replace(/\/+$/, '');
  let link = `${base}/minha-conta?sec=inscricoes`;
  if (criada && !senhaPeloCpf) link = `${base}/redefinir-senha?token=${await criarTokenReset(aluno.id)}`;
  const inicio = new Date(turma.inicioPrevisto).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  try {
    await enviarEncaixeMatriculaRapida(email, String(aluno.nome).split(' ')[0], { curso: turma.curso.nome, inicio, link, criarSenha: criada && !senhaPeloCpf });
  } catch (e) {
    console.error('[MATRICULA-RAPIDA] e-mail do encaixe falhou:', e.message);
  }
  return {
    ok: true, matriculaId: matricula.id, alunoId: aluno.id,
    msg: `${pessoa.nome} encaixado(a) na turma de ${inicio}.`
      + (criada ? (senhaPeloCpf ? ' Conta criada: entra com o CPF e os 4 últimos dígitos dele como senha.' : ' Conta criada: enviamos o link para criar a senha.') : ' Usou a conta que já existia.'),
  };
}

// A matrícula da pessoa no curso da inscrição, venha ela do encaixe daqui ou do site da escola:
//   - anotação gravada com matriculaId ('matricularapida:<inscrição>') → essa matrícula;
//   - senão, a matrícula do ALUNO com o e-mail da inscrição numa turma do curso, não cancelada nem
//     estornada (a de taxa confirmada primeiro, depois a mais nova), como o bloco semEncaixe do carregar().
// `pessoa` (a inscrição do site) evita ler o site de novo quando quem chama já leu.
// Devolve { erro } ou { cfg, anotado, m, origem: 'encaixe' | 'escola' }.
async function matriculaDoCurso(inscricaoId, { pessoa } = {}) {
  const include = { aluno: true, turma: { include: { curso: true } }, pagamentos: true, avaliacoes: true };
  const cfg = await prisma.configuracao.findUnique({ where: { chave: CHAVE(inscricaoId) } });
  const anotado = cfg ? ler(cfg.valor) : null;
  if (anotado && anotado.matriculaId) {
    const m = await prisma.matricula.findUnique({ where: { id: anotado.matriculaId }, include });
    // Anotação só de histórico com a matrícula desfeita: não vale (como no carregar); segue pelo e-mail.
    const ignorar = soHistorico(anotado) && (!m || DESFEITA.includes(m.statusPagamento));
    if (!ignorar) {
      if (!m) return { erro: 'A matrícula anotada não existe mais. Clique em "Atualizar".' };
      return { cfg, anotado, m, origem: anotado.ligado || anotado.naEscola ? 'escola' : 'encaixe' };
    }
  }
  if (!pessoa) {
    const site = await horariosSite.buscar();
    if (!site.ok) return { erro: 'O site da instituição não respondeu. Tente de novo em instantes.' };
    pessoa = [...site.dados.respostas, ...site.dados.semResposta].find((p) => String(p.inscricaoId) === String(inscricaoId));
    if (!pessoa) return { erro: 'Inscrição não encontrada no site da instituição.' };
  }
  const semMatricula = { erro: 'Essa pessoa não tem matrícula nesse curso. Clique em "Atualizar".' };
  const email = String(pessoa.email || '').trim();
  if (!email || !pessoa.cursoId) return semMatricula;
  const m = await prisma.matricula.findFirst({
    where: {
      aluno: { papel: 'ALUNO', email: { equals: email, mode: 'insensitive' } },
      turma: { cursoId: pessoa.cursoId },
      statusPagamento: { notIn: ['CANCELADO', 'ESTORNADO'] },
    },
    orderBy: [{ taxaConfirmada: 'desc' }, { criadoEm: 'desc' }],
    include,
  });
  if (!m) return semMatricula;
  return { cfg, anotado, m, origem: 'escola' };
}

const temNota = (m) => m.nota != null || !!m.situacao || (m.avaliacoes && m.avaliacoes.length > 0);
const diaBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
const linkConta = (appUrl) => (appUrl || process.env.APP_URL || 'https://escola.cruzvermelhariodejaneiro.org').replace(/\/+$/, '') + '/minha-conta?sec=inscricoes';

// A anotação de partida para mover / mandar para a espera: a gravada, se é desta matrícula; senão
// (matrícula feita pelo site da escola e nunca ligada, ou anotação de outra matrícula já desfeita),
// uma nova com naEscola, para o histórico, guardando a anterior em `anterior`. totalComTaxa: a
// matrícula da escola já guarda o total (curso + taxa), então a correção única (corrigirTotais) não
// mexe nela.
function anotacaoBase(anotado, m, porUsuarioId, agora) {
  if (anotado && anotado.matriculaId === m.id) return { ...anotado };
  return {
    matriculaId: m.id, turmaId: m.turmaId, alunoId: m.alunoId, naEscola: true, por: porUsuarioId, em: agora, totalComTaxa: true,
    ...(anotado ? { anterior: anotado } : {}),
  };
}

// A anotação nova: só o que mudou (`mudancas`) por cima da versão LIDA AGORA (não a do começo da
// ação): o carregar() de outra tela pode ter criado a chave ligada (ligarComEscola) no meio do
// caminho, e ela não pode se perder. Como a gravação é em lote (array, sem transação interativa),
// sobra uma janela pequena entre esta leitura e o $transaction em que isso ainda pode acontecer:
// nesse caso vale a última gravação (aceito: duas telas na mesma pessoa no mesmo instante).
async function anotacaoNova(inscricaoId, m, porUsuarioId, agora, mudancas) {
  const fresca = await prisma.configuracao.findUnique({ where: { chave: CHAVE(inscricaoId) } });
  return { ...anotacaoBase(fresca ? ler(fresca.valor) : null, m, porUsuarioId, agora), ...mudancas };
}

// A gravação da anotação para o $transaction em lote. Função comum (não async) de propósito: a
// consulta do Prisma só roda dentro do $transaction; devolvida por uma async, ela rodaria sozinha antes.
const gravarAnotacao = (inscricaoId, valor) => prisma.configuracao.upsert({
  where: { chave: CHAVE(inscricaoId) },
  create: { chave: CHAVE(inscricaoId), valor: JSON.stringify(valor) },
  update: { valor: JSON.stringify(valor) },
});

// Muda a matrícula `alvo.m` (resolvida por matriculaDoCurso) para a turma `destino`, do MESMO curso.
// O preço não muda (mesmo curso), então valorCurso e diferencaTransferencia ficam como estão; para
// outro curso, o caminho é Transferir em Inscrições. Vale também para sair da lista de espera
// (turma atual EM_ESPERA): aí o e-mail é "Sua turma foi definida" e a resposta traz daEspera.
async function moverMatricula({ inscricaoId, alvo, destino, porUsuarioId, appUrl }) {
  const { m } = alvo;
  // Destino: só turma de verdade (ABERTA/CONFIRMADA; a de espera nunca é destino de Mover).
  if (!destino || !['ABERTA', 'CONFIRMADA'].includes(destino.status)) return { ok: false, msg: 'Escolha uma turma aberta.' };
  if (destino.cursoId !== m.turma.cursoId) return { ok: false, msg: 'A turma escolhida é de outro curso. Para trocar de curso, use Transferir em Inscrições.' };
  if (destino.id === m.turmaId) return { ok: false, msg: `${m.aluno.nome} já está nessa turma.` };
  if (['CANCELADO', 'ESTORNADO'].includes(m.statusPagamento)) return { ok: false, msg: 'Essa matrícula está cancelada ou estornada; não dá para mover.' };
  if (temNota(m)) return { ok: false, msg: `${m.aluno.nome} já tem nota lançada nessa turma; não dá para mover.` };
  if (m.turma.status === 'ENCERRADA') return { ok: false, msg: 'A turma já foi encerrada; não dá para mover.' };
  const jaNaOutra = await prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId: m.alunoId, turmaId: destino.id } } });
  if (jaNaOutra) return { ok: false, msg: `${m.aluno.nome} já tem matrícula na turma de ${diaBR(destino.inicioPrevisto)}.` };
  const daEspera = ehEspera(m.turma);
  if (daEspera) {
    // Quem saiu da espera não pode ficar com duas matrículas valendo no mesmo curso.
    const outra = await prisma.matricula.findFirst({
      where: {
        alunoId: m.alunoId, id: { not: m.id }, turma: { cursoId: m.turma.cursoId, status: { not: 'EM_ESPERA' } },
        OR: [{ taxaConfirmada: true }, { statusPagamento: { in: ['PAGO', 'PARCELADO'] } }],
        statusPagamento: { notIn: ['CANCELADO', 'ESTORNADO'] },
      },
    });
    if (outra) return { ok: false, msg: `${m.aluno.nome} já tem matrícula ativa noutra turma desse curso.` };
  }
  // Vaga ocupada = o mesmo critério do FILTRO_VAGA de routes/admin.js (não o _count do select da tela).
  const ocupadas = await prisma.matricula.count({ where: { turmaId: destino.id, taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } });
  if (ocupadas >= destino.vagas) return { ok: false, msg: `A turma de ${diaBR(destino.inicioPrevisto)} está cheia (${ocupadas}/${destino.vagas}).` };

  const agora = new Date().toISOString();
  const mudancas = {
    turmaId: destino.id,
    ...(daEspera
      ? { encaixadoDaEsperaEm: agora, encaixadoDaEsperaPor: porUsuarioId }
      : { movidoDe: m.turmaId, movidoPor: porUsuarioId, movidoEm: agora }),
  };
  const novo = await anotacaoNova(inscricaoId, m, porUsuarioId, agora, mudancas);
  // Gravação em lote, como no ligarComEscola (transação interativa estourava o tempo no Render).
  await prisma.$transaction([
    // lembreteVesperaEm zerado: o lembrete da véspera é da turma nova.
    prisma.matricula.update({ where: { id: m.id }, data: { turmaId: destino.id, lembreteVesperaEm: null } }),
    gravarAnotacao(inscricaoId, novo),
  ]);
  idsCache = null;

  const de = diaBR(m.turma.inicioPrevisto), para = diaBR(destino.inicioPrevisto);
  const nome = String(m.aluno.nome).split(' ')[0];
  try {
    if (daEspera) await enviarTurmaDefinida(m.aluno.email, nome, { curso: m.turma.curso.nome, inicio: para, link: linkConta(appUrl) });
    else await enviarMudancaTurmaMatriculaRapida(m.aluno.email, nome, { curso: m.turma.curso.nome, inicioAntigo: de, inicioNovo: para, link: linkConta(appUrl) });
  } catch (err) {
    console.error('[MATRICULA-RAPIDA] e-mail da mudança de turma falhou:', err.message);
  }
  return { ok: true, daEspera, matriculaId: m.id, de: m.turmaId, para: destino.id, inicio: para };
}

// Botão Mover: a matrícula do curso (encaixe ou escola) vai para outra turma aberta do mesmo curso.
// Se ela estava na espera, é o mesmo que Encaixar (daEspera).
async function moverEncaixe({ inscricaoId, turmaId, porUsuarioId, appUrl }) {
  const alvo = await matriculaDoCurso(inscricaoId);
  if (alvo.erro) return { ok: false, msg: alvo.erro };
  const destino = await prisma.turma.findUnique({ where: { id: String(turmaId || '') } });
  const r = await moverMatricula({ inscricaoId, alvo, destino, porUsuarioId, appUrl });
  if (!r.ok) return r;
  return {
    ...r, origem: alvo.origem,
    msg: r.daEspera
      ? `${alvo.m.aluno.nome} encaixado(a) na turma de ${r.inicio} (saiu da lista de espera).`
      : `${alvo.m.aluno.nome} movido(a) para a turma de ${r.inicio}. A pessoa recebeu o aviso por e-mail.`,
  };
}

// Botão Voltar para a espera: a matrícula do curso (encaixe ou escola) vai para a turma de espera do
// curso (lib/turma-espera.js). Nada é apagado: pagamentos, valores e histórico ficam na matrícula, e
// a pessoa volta para "Aguardando encaixe"; o Encaixar seguinte só a muda de turma de novo.
async function voltarParaEspera({ inscricaoId, motivo, porUsuarioId, appUrl }) {
  motivo = String(motivo || '').trim().slice(0, 200);
  if (!motivo) return { ok: false, msg: 'Diga por que a pessoa está voltando para a espera.' };
  const alvo = await matriculaDoCurso(inscricaoId);
  if (alvo.erro) return { ok: false, msg: alvo.erro };
  const { m, origem } = alvo;
  if (['CANCELADO', 'ESTORNADO'].includes(m.statusPagamento)) return { ok: false, msg: 'Essa matrícula está cancelada ou estornada; não dá para voltar para a espera.' };
  if (temNota(m)) return { ok: false, msg: `${m.aluno.nome} já tem nota lançada nessa turma; não dá para voltar para a espera.` };
  if (m.turma.status === 'ENCERRADA') return { ok: false, msg: 'A turma já foi encerrada; não dá para voltar para a espera.' };
  if (ehEspera(m.turma)) return { ok: false, msg: `${m.aluno.nome} já está na lista de espera.` };

  // Fora da transação: turmaDeEspera abre a sua própria (lock por curso).
  const espera = await turmaDeEspera(m.turma.cursoId);
  const agora = new Date().toISOString();
  const mudancas = { turmaId: espera.id, esperaDesde: agora, esperaMotivo: motivo, esperaPor: porUsuarioId, esperaDe: m.turmaId };
  const novo = await anotacaoNova(inscricaoId, m, porUsuarioId, agora, mudancas);
  await prisma.$transaction([
    // lembreteVesperaEm zerado: na espera não há véspera; a turma seguinte começa do zero.
    prisma.matricula.update({ where: { id: m.id }, data: { turmaId: espera.id, lembreteVesperaEm: null } }),
    gravarAnotacao(inscricaoId, novo),
  ]);
  idsCache = null;

  try {
    await enviarEntradaNaEspera(m.aluno.email, String(m.aluno.nome).split(' ')[0], { curso: m.turma.curso.nome, link: linkConta(appUrl) });
  } catch (err) {
    console.error('[MATRICULA-RAPIDA] e-mail da lista de espera falhou:', err.message);
  }
  return {
    ok: true, matriculaId: m.id, de: m.turmaId, esperaTurmaId: espera.id, origem,
    msg: `${m.aluno.nome} voltou para a lista de espera. O que já foi pago continua valendo: é só encaixar numa turma.`,
  };
}

// Liga sozinho a inscrição paga pela matrícula rápida à matrícula da mesma pessoa na escola.
// A taxa é a que a pessoa pagou (R$ 99 pelo site da escola ou, por aqui, o valor da instituição,
// ex.: R$ 103,95 no cartão); o curso, o preço do curso. Então:
//   - taxa da matrícula = o pagamento da matrícula rápida (conta da instituição, com o hash);
//   - valor do curso = o preço do curso no plano da matrícula (a secretaria às vezes lançava curso
//     + taxa como curso, ex.: R$ 249 em vez de R$ 150); lançamentos de curso à mão acompanham.
//   - o curso segue cobrado como sempre (site, maquininha confirmada pela secretaria…).
// Se a escola já recebeu a taxa online (ou o à vista online, que inclui a taxa), é pagamento em
// dobro: não mexe e a tela avisa. Fica anotado em 'matricularapida:<inscrição>', com o "antes".
// Pago online de verdade: a própria Únicopag disse que foi pago (webhook 'paid'/'approved'…, ou a
// reconciliação, 'reconciliado:paid'). Uma cobrança online que a secretaria confirmou à mão (pagou
// em outro banco, na maquininha) fica PAGO mas com outro status do gateway: "Confirmar pagamento"
// grava 'manual:pago', e avisos seguintes da Únicopag sobre a cobrança em aberto ('waiting_payment'…)
// podem trocar essa marca. Então: conta como à mão tudo o que a Únicopag não confirmou como pago.
const SUCESSO_GATEWAY = ['paid', 'pago', 'success', 'captured', 'approved', 'authorized'];
const pagoNoGateway = (pg) => !!pg.gateway && pg.gateway !== 'manual'
  && SUCESSO_GATEWAY.includes(String(pg.gatewayStatus || '').toLowerCase().replace(/^reconciliado:/, ''));
const aMao = (pg) => !pagoNoGateway(pg);

// O aviso (postback) do pagamento feito na instituição pode chegar ao webhook da escola: sem um hash
// conhecido, ele casa por e-mail + valor base (R$ 99) com a taxa que a pessoa deixou em aberto no
// site da escola e a marca como paga. É o MESMO dinheiro: reconhece pelo hash da transação, gravado
// no pagamento (gatewayRef/gatewayHash) ou na resposta do aviso (gatewayResponse).
function mesmaTransacao(pg, hash) {
  if (!hash) return false;
  if (pg.gatewayRef === hash || pg.gatewayHash === hash) return true;
  const r = pg.gatewayResponse && typeof pg.gatewayResponse === 'object' ? pg.gatewayResponse : null;
  if (!r) return false;
  const t = r.transaction || r.result || r;
  return [t && t.hash, t && t.id, r.hash, r.id].some((v) => v != null && String(v) === String(hash));
}

async function ligarComEscola(pessoa, pago, m) {
  const segunda = unicopag.conta('segunda').gateway;
  const doAqui = m.pagamentos.filter((pg) => pg.gateway !== segunda && mesmaTransacao(pg, pago.hash));
  const online = m.pagamentos.filter((pg) => pg.status === 'PAGO' && pg.gateway !== segunda && !aMao(pg) && !doAqui.includes(pg));
  const emDobro = online.filter((pg) => pg.tipo === 'TAXA' || m.plano === 'A_VISTA');
  if (emDobro.length) {
    return { dobro: emDobro.map((pg) => ({ tipo: pg.tipo, valor: Number(pg.valor), metodo: pg.metodo, status: pg.gatewayStatus, em: pg.criadoEm })) };
  }

  const taxa = pago.valorTotal || pago.valor;
  const valores = await calcularValores(m.turma.curso, m.plano === 'PARCELADO' ? 'PARCELADO' : 'A_VISTA', m.alunoId);
  const cursoOnline = online.some((pg) => pg.tipo === 'CURSO');
  // valorCurso (o curso) é o anotado e o dos lançamentos de curso à mão; a matrícula guarda o TOTAL
  // (curso + taxa), como toda matrícula da escola (routes/cursos.js grava valorCurso: total).
  const valorCurso = Number(valores.valorCurso);
  const totalMatricula = cursoOnline ? Number(m.valorCurso) : Math.round((valorCurso + Number(taxa)) * 100) / 100;
  const anotado = {
    matriculaId: m.id, turmaId: m.turmaId, alunoId: m.alunoId, por: 'automatico', em: new Date().toISOString(),
    ligado: true, taxa, valorCurso, total: totalMatricula, totalComTaxa: true,
    antes: { valorCurso: Number(m.valorCurso), valorTaxa: Number(m.valorTaxaMatricula), taxaConfirmada: m.taxaConfirmada, status: m.statusPagamento },
  };
  const taxaDados = {
    tipo: 'TAXA', metodo: pago.metodo === 'credit_card' ? 'CREDITO' : 'PIX', valor: taxa, status: 'PAGO',
    gateway: segunda, gatewayRef: pago.hash, gatewayHash: pago.hash, gatewayStatus: pago.status,
  };
  const confirmadaEm = dataPago(pessoa.pagoEm) || new Date();
  // Tudo numa gravação em lote (uma ida ao banco). Transação interativa não: entre o Render e o
  // banco ela passava do tempo-limite e falhava calada.
  const ops = [
    // A anotação vai primeiro e é a trava: se outra tela já ligou, a chave existe e nada é gravado.
    prisma.configuracao.create({ data: { chave: CHAVE(pessoa.inscricaoId), valor: JSON.stringify(anotado) } }),
    prisma.matricula.update({
      where: { id: m.id },
      data: {
        valorTaxaMatricula: taxa, valorCurso: totalMatricula,
        taxaConfirmada: true, taxaConfirmadaEm: m.taxaConfirmadaEm || confirmadaEm,
      },
    }),
  ];
  // Taxa da escola anulada: lançamento à mão é reaproveitado; cobrança online da escola que ficou
  // em aberto (PIX gerado e não pago) é cancelada, para não ser paga de novo.
  const pendentesOnline = m.pagamentos.filter((pg) => pg.tipo === 'TAXA' && pg.gateway && !['manual', segunda].includes(pg.gateway) && pg.status === 'PENDENTE' && !doAqui.includes(pg)).map((pg) => pg.id);
  if (pendentesOnline.length) ops.push(prisma.pagamento.updateMany({ where: { id: { in: pendentesOnline } }, data: { status: 'CANCELADO', gatewayStatus: 'cancelado:pago-pela-matricula-rapida' } }));
  const taxas = m.pagamentos.filter((pg) => pg.tipo === 'TAXA' && pg.gateway !== segunda && pg.status !== 'PENDENTE' && aMao(pg) && !doAqui.includes(pg));
  // Já ligada: a taxa com o hash daqui (gravada por um batimento anterior ou casada pelo webhook).
  const jaLigada = m.pagamentos.find((pg) => pg.tipo === 'TAXA' && pg.gateway === segunda && pg.gatewayRef === pago.hash)
    || doAqui.find((pg) => pg.tipo === 'TAXA');
  if (jaLigada) ops.push(prisma.pagamento.update({ where: { id: jaLigada.id }, data: taxaDados }));
  else if (taxas.length) ops.push(prisma.pagamento.update({ where: { id: taxas[0].id }, data: taxaDados }));
  else ops.push(prisma.pagamento.create({ data: { matriculaId: m.id, ...taxaDados } }));
  // Lançamento de taxa à mão que sobrou (o pagamento daqui ocupou o lugar dele).
  const sobra = taxas.slice(jaLigada ? 0 : 1).filter((pg) => pg.status !== 'CANCELADO').map((pg) => pg.id);
  if (sobra.length) ops.push(prisma.pagamento.updateMany({ where: { id: { in: sobra } }, data: { status: 'CANCELADO', gatewayStatus: 'manual:substituido-matricula-rapida' } }));
  // Curso lançado à mão: acompanha o valor do curso.
  const cursoManual = m.pagamentos.filter((pg) => pg.tipo === 'CURSO' && aMao(pg)).map((pg) => pg.id);
  if (cursoManual.length && !cursoOnline) ops.push(prisma.pagamento.updateMany({ where: { id: { in: cursoManual } }, data: { valor: valorCurso } }));
  await prisma.$transaction(ops);
  console.log(`[MATRICULA-RAPIDA] inscrição ${pessoa.inscricaoId} ligada à matrícula ${m.id}: taxa ${taxa}, curso ${valorCurso} (antes ${anotado.antes.valorCurso}).`);
  return { anotado };
}

// Correção única: encaixes e batimentos antigos gravaram na matrícula só o curso (ex.: R$ 150), mas a
// escola guarda o total (curso + taxa). Soma a taxa uma vez e marca a anotação (totalComTaxa).
async function corrigirTotais(anotados) {
  const pendentes = Object.entries(anotados).filter(([, a]) => a && a.matriculaId && !a.totalComTaxa);
  if (!pendentes.length) return;
  const mats = await prisma.matricula.findMany({
    where: { id: { in: pendentes.map(([, a]) => a.matriculaId) } },
    select: { id: true, valorCurso: true, valorTaxaMatricula: true },
  });
  const porId = Object.fromEntries(mats.map((x) => [x.id, x]));
  for (const [inscricaoId, a] of pendentes) {
    const m = porId[a.matriculaId];
    if (!m) continue;
    const curso = Number(m.valorCurso), taxa = Number(m.valorTaxaMatricula) || 0;
    // Só soma se a matrícula ainda está com o valor só do curso que o encaixe/batimento gravou.
    const soCurso = a.ligado ? Math.abs(curso - Number(a.valorCurso)) < 0.005 : true;
    const novo = { ...a, totalComTaxa: true, ...(soCurso && taxa ? { total: Math.round((curso + taxa) * 100) / 100 } : {}) };
    const ops = [prisma.configuracao.update({ where: { chave: CHAVE(inscricaoId) }, data: { valor: JSON.stringify(novo) } })];
    if (soCurso && taxa) ops.push(prisma.matricula.update({ where: { id: m.id }, data: { valorCurso: novo.total } }));
    try {
      await prisma.$transaction(ops);
      anotados[inscricaoId] = novo;
      if (soCurso && taxa) console.log(`[MATRICULA-RAPIDA] matrícula ${m.id}: valor ${curso} -> ${novo.total} (curso + taxa).`);
    } catch (e) {
      console.error('[MATRICULA-RAPIDA] correção do total falhou:', e.message);
    }
  }
}

// Data do pagamento no site. Sem fuso ("2026-09-29 14:00:00"), é hora de Brasília.
function dataPago(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s) ? new Date(s.replace(' ', 'T') + '-03:00') : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Para o Painel: inscrições da matrícula rápida no dia, na semana e no mês, quem espera encaixe e
// as mais recentes. O Painel não espera mais que `limiteMs` pelo site e pela Únicopag: passou
// disso, mostra sem esses números ({ ok: false }). Quem já foi encaixado vira matrícula da
// escola; `matriculaIds` deixa o Painel não contar a mesma pessoa duas vezes.
async function resumoPainel({ inicioHoje, inicioSemana, inicioMes, limiteMs = 4000 } = {}) {
  let timer;
  const tempo = new Promise((r) => { timer = setTimeout(() => r({ erro: 'tempo' }), limiteMs); });
  let d;
  try {
    d = await Promise.race([carregar(), tempo]);
  } catch (e) {
    d = { erro: e.message };
  } finally {
    clearTimeout(timer);
  }
  if (!d || d.erro) return { ok: false };
  const pessoas = d.pessoas.map((p) => ({ ...p, pagoData: dataPago(p.pagoEm) }));
  const desde = (ini) => pessoas.filter((p) => p.pagoData && p.pagoData >= ini);
  const valor = (p) => (p.pagamento && situacaoPagamento(p.pagamento.status) === 'pago' ? (p.pagamento.valorTotal || p.pagamento.valor || 0) : 0);
  const doMes = desde(inicioMes);
  // Matrícula da pessoa na escola: a da turma (encaixe) ou a da lista de espera, que continua sendo
  // matrícula (com o que foi pago); só o "aguardando" olha a turma.
  const vinculo = (p) => p.encaixe || p.espera || p.cancelada || null;
  return {
    ok: true,
    pagamentosOk: d.pagamentosOk,
    hoje: desde(inicioHoje).length,
    semana: desde(inicioSemana).length,
    aguardando: pessoas.filter((p) => !p.encaixe && !p.cancelada).length, // inclui quem está na lista de espera
    // Recebido no mês de quem não foi encaixado por aqui (o encaixado conta pela matrícula que o
    // encaixe criou; quem também se matriculou pela escola pagou lá à parte, então conta).
    recebidoMes: doMes.filter((p) => !vinculo(p) || vinculo(p).naEscola).reduce((t, p) => t + valor(p), 0),
    mesCount: doMes.length,
    // Matrículas da escola da mesma pessoa: o Painel não conta de novo nem lista duas vezes.
    matriculaIds: pessoas.filter((p) => vinculo(p) && vinculo(p).matriculaId).map((p) => vinculo(p).matriculaId),
    matriculaIdsEncaixe: pessoas.filter((p) => vinculo(p) && vinculo(p).matriculaId && !vinculo(p).naEscola).map((p) => vinculo(p).matriculaId),
    // Sem matrícula na escola (a da espera e a desfeita já contam pela matrícula, como a do encaixe).
    recentes: pessoas.filter((p) => !vinculo(p) && p.pagoData)
      .sort((a, b) => b.pagoData - a.pagoData)
      .map((p) => ({ nome: p.nome, email: p.email || '', curso: p.cursoNome, quando: p.pagoData, valor: valor(p) || null, metodo: p.pagamento ? p.pagamento.metodo : null })),
  };
}

// Taxa de inscrição que a pessoa pagou de fato, para a tela de pagar o curso. Quem veio da
// matrícula rápida pagou na Únicopag da instituição; no cartão o valor inclui a taxa de
// processamento, que a matrícula pode ter guardado sem (encaixes antigos guardavam só a base).
async function taxaPaga(matricula) {
  const guardada = Number(matricula.valorTaxaMatricula) || null;
  try {
    const pg = await prisma.pagamento.findFirst({
      where: { matriculaId: matricula.id, tipo: 'TAXA', status: 'PAGO', gateway: unicopag.conta('segunda').gateway },
      orderBy: { criadoEm: 'desc' },
    });
    if (!pg || !pg.gatewayRef) return guardada;
    const lista = await unicopag.listarTransacoes('segunda');
    const t = lista.ok && lista.lista.find((x) => x.hash === pg.gatewayRef);
    const total = t ? (t.valorTotal || t.valor) : null;
    return total && total > (guardada || 0) ? total : guardada;
  } catch (e) {
    return guardada;
  }
}

// Matrículas da escola que vieram da matrícula rápida (encaixe) ou foram ligadas a ela (batimento).
// Nas listas da secretaria o valor delas aparece somado: curso + taxa paga na instituição.
// Guardado 30 s: as telas consultam a cada abertura.
let idsCache = null;
async function idsMatriculas() {
  if (idsCache && Date.now() - idsCache.em < 30000) return idsCache.ids;
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'matricularapida:' } } });
  // A anotação só de histórico de uma matrícula da escola (naEscola, gravada ao mover / mandar para a
  // espera) não conta: essa matrícula não tem taxa paga na instituição.
  const ids = new Set(cfgs.map((c) => ler(c.valor)).filter((a) => !(a.naEscola && !a.ligado)).map((a) => a.matriculaId).filter(Boolean));
  idsCache = { em: Date.now(), ids };
  return ids;
}

module.exports = { idsMatriculas, carregar, encaixar, matriculaDoCurso, moverEncaixe, voltarParaEspera, situacaoPagamento, dataPago, resumoPainel, taxaPaga, pagoNoGateway };
