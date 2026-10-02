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

const prisma = require('../db');
const horariosSite = require('./horarios-site');
const unicopag = require('./unicopag');
const { calcularValores } = require('./matricula');
const { validarCpfCnpj } = require('./documento');
const { hashSenha } = require('./password');
const { criarTokenReset } = require('./tokens');
const { enviarEncaixeMatriculaRapida } = require('./email');

const CHAVE = (inscricaoId) => 'matricularapida:' + inscricaoId;
const ler = (v) => { try { return JSON.parse(v); } catch (e) { return {}; } };
const digitos = (s) => String(s || '').replace(/\D/g, '');
const PAGO = ['paid', 'approved', 'authorized', 'captured', 'pago'];

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
  const ordem = [...pessoas].sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0)); // quem tem e-mail escolhe primeiro
  for (const p of ordem) {
    p.transacoes = doPessoa(p);
    p.pagamento = p.transacoes[0] || null;
    p.encaixe = anotados[String(p.inscricaoId)] || null;
  }
  // Quem também tem matrícula no mesmo curso feita pela escola (criou conta e se inscreveu lá, ou a
  // secretaria matriculou à mão): não espera encaixe. Liga pelo e-mail e pelo curso e, se a
  // inscrição foi paga aqui, junta sozinho a taxa da matrícula rápida à matrícula da escola
  // (ligarComEscola).
  const semEncaixe = pessoas.filter((p) => !p.encaixe && p.email && p.cursoId);
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
          p.encaixe = r.dobro ? { ...base, dobro: true } : { ...base, ...r.anotado };
        } catch (e) {
          console.error('[MATRICULA-RAPIDA] ligar com a escola falhou:', e.message);
          p.encaixe = base;
        }
      } else if (m.taxaConfirmada || ['PAGO', 'PARCELADO'].includes(m.statusPagamento)) {
        p.encaixe = base; // pagou a inscrição pela escola; não há pagamento daqui para ligar
      }
    }
  }

  // Turmas dos encaixes (data e curso, para a tela)
  const idsTurma = [...new Set(pessoas.filter((p) => p.encaixe).map((p) => p.encaixe.turmaId))];
  const turmasEnc = idsTurma.length ? await prisma.turma.findMany({ where: { id: { in: idsTurma } }, select: { id: true, inicioPrevisto: true } }) : [];
  const porId = Object.fromEntries(turmasEnc.map((t) => [t.id, t]));
  for (const p of pessoas) if (p.encaixe) p.encaixe.turma = porId[p.encaixe.turmaId] || null;

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
async function encaixar({ inscricaoId, turmaId, porUsuarioId, appUrl }) {
  const site = await horariosSite.buscar({ forcar: true });
  if (!site.ok) return { ok: false, msg: 'O site da instituição não respondeu. Tente de novo em instantes.' };
  const pessoa = [...site.dados.respostas, ...site.dados.semResposta].find((p) => String(p.inscricaoId) === String(inscricaoId));
  if (!pessoa) return { ok: false, msg: 'Inscrição não encontrada no site da instituição.' };
  const ja = await prisma.configuracao.findUnique({ where: { chave: CHAVE(inscricaoId) } });
  if (ja) return { ok: false, msg: `${pessoa.nome} já foi encaixado(a) numa turma.` };
  const email = String(pessoa.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, msg: 'A inscrição não tem um e-mail válido; fale com a pessoa antes de encaixar.' };

  const turma = await prisma.turma.findUnique({ where: { id: String(turmaId || '') }, include: { curso: true } });
  if (!turma || !['ABERTA', 'CONFIRMADA'].includes(turma.status)) return { ok: false, msg: 'Escolha uma turma aberta.' };
  if (pessoa.cursoId && turma.cursoId !== pessoa.cursoId) return { ok: false, msg: 'A turma escolhida é de outro curso.' };

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
  if (outraTurma) return { ok: false, msg: `${pessoa.nome} já tem matrícula numa turma desse curso pela escola.` };
  const valores = await calcularValores(turma.curso, 'PARCELADO', aluno.id);
  // O que a pessoa pagou de fato: no cartão, com a taxa de processamento (ex.: R$ 103,95 por R$ 99).
  const taxa = pago && (pago.valorTotal || pago.valor) ? (pago.valorTotal || pago.valor) : Number(valores.valorTaxaMatricula);
  const confirmadaEm = pessoa.pagoEm ? new Date(pessoa.pagoEm) : new Date();
  const dados = {
    plano: 'PARCELADO', forma: 'CREDITO', // a taxa já foi paga; o curso a pessoa paga depois, pela escola
    valorCurso: valores.valorCurso, valorTaxaMatricula: taxa,
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
  await prisma.configuracao.create({
    data: { chave: CHAVE(inscricaoId), valor: JSON.stringify({ matriculaId: matricula.id, turmaId: turma.id, alunoId: aluno.id, por: porUsuarioId, em: new Date().toISOString(), contaCriada: criada }) },
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

// Liga sozinho a inscrição paga pela matrícula rápida à matrícula da mesma pessoa na escola.
// A taxa é a que a pessoa pagou (R$ 99 pelo site da escola ou, por aqui, o valor da instituição,
// ex.: R$ 103,95 no cartão); o curso, o preço do curso. Então:
//   - taxa da matrícula = o pagamento da matrícula rápida (conta da instituição, com o hash);
//   - valor do curso = o preço do curso no plano da matrícula (a secretaria às vezes lançava curso
//     + taxa como curso, ex.: R$ 249 em vez de R$ 150); lançamentos de curso à mão acompanham.
//   - o curso segue cobrado como sempre (site, maquininha confirmada pela secretaria…).
// Se a escola já recebeu a taxa online (ou o à vista online, que inclui a taxa), é pagamento em
// dobro: não mexe e a tela avisa. Fica anotado em 'matricularapida:<inscrição>', com o "antes".
async function ligarComEscola(pessoa, pago, m) {
  const segunda = unicopag.conta('segunda').gateway;
  const online = m.pagamentos.filter((pg) => pg.status === 'PAGO' && pg.gateway && !['manual', segunda].includes(pg.gateway));
  if (online.some((pg) => pg.tipo === 'TAXA' || m.plano === 'A_VISTA')) return { dobro: true };

  const taxa = pago.valorTotal || pago.valor;
  const valores = await calcularValores(m.turma.curso, m.plano === 'PARCELADO' ? 'PARCELADO' : 'A_VISTA', m.alunoId);
  const cursoOnline = online.some((pg) => pg.tipo === 'CURSO');
  const valorCurso = cursoOnline ? Number(m.valorCurso) : Number(valores.valorCurso);
  const anotado = {
    matriculaId: m.id, turmaId: m.turmaId, alunoId: m.alunoId, por: 'automatico', em: new Date().toISOString(),
    ligado: true, taxa, valorCurso,
    antes: { valorCurso: Number(m.valorCurso), valorTaxa: Number(m.valorTaxaMatricula), taxaConfirmada: m.taxaConfirmada, status: m.statusPagamento },
  };
  const taxaDados = {
    tipo: 'TAXA', metodo: pago.metodo === 'credit_card' ? 'CREDITO' : 'PIX', valor: taxa, status: 'PAGO',
    gateway: segunda, gatewayRef: pago.hash, gatewayHash: pago.hash, gatewayStatus: pago.status,
  };
  const confirmadaEm = dataPago(pessoa.pagoEm) || new Date();
  await prisma.$transaction(async (tx) => {
    // Outra tela (ou outro serviço) pode ter ligado no mesmo instante: a anotação é a trava.
    await tx.configuracao.create({ data: { chave: CHAVE(pessoa.inscricaoId), valor: JSON.stringify(anotado) } });
    await tx.matricula.update({
      where: { id: m.id },
      data: {
        valorTaxaMatricula: taxa, valorCurso,
        taxaConfirmada: true, taxaConfirmadaEm: m.taxaConfirmadaEm || confirmadaEm,
      },
    });
    const taxas = m.pagamentos.filter((pg) => pg.tipo === 'TAXA' && pg.gateway !== segunda);
    const jaLigada = m.pagamentos.find((pg) => pg.tipo === 'TAXA' && pg.gateway === segunda && pg.gatewayRef === pago.hash);
    if (jaLigada) {
      await tx.pagamento.update({ where: { id: jaLigada.id }, data: taxaDados });
    } else if (taxas.length) {
      await tx.pagamento.update({ where: { id: taxas[0].id }, data: taxaDados });
    } else {
      await tx.pagamento.create({ data: { matriculaId: m.id, ...taxaDados } });
    }
    // Lançamento de taxa à mão que sobrou (o pagamento daqui ocupou o lugar dele).
    const sobra = taxas.slice(jaLigada ? 0 : 1).filter((pg) => pg.status !== 'CANCELADO').map((pg) => pg.id);
    if (sobra.length) await tx.pagamento.updateMany({ where: { id: { in: sobra } }, data: { status: 'CANCELADO', gatewayStatus: 'manual:substituido-matricula-rapida' } });
    // Curso lançado à mão: acompanha o valor do curso.
    const cursoManual = m.pagamentos.filter((pg) => pg.tipo === 'CURSO' && (!pg.gateway || pg.gateway === 'manual')).map((pg) => pg.id);
    if (cursoManual.length && !cursoOnline) await tx.pagamento.updateMany({ where: { id: { in: cursoManual } }, data: { valor: valorCurso } });
  });
  console.log(`[MATRICULA-RAPIDA] inscrição ${pessoa.inscricaoId} ligada à matrícula ${m.id}: taxa ${taxa}, curso ${valorCurso} (antes ${anotado.antes.valorCurso}).`);
  return { anotado };
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
  return {
    ok: true,
    pagamentosOk: d.pagamentosOk,
    hoje: desde(inicioHoje).length,
    semana: desde(inicioSemana).length,
    aguardando: pessoas.filter((p) => !p.encaixe).length,
    // Recebido no mês de quem não foi encaixado por aqui (o encaixado conta pela matrícula que o
    // encaixe criou; quem também se matriculou pela escola pagou lá à parte, então conta).
    recebidoMes: doMes.filter((p) => !p.encaixe || p.encaixe.naEscola).reduce((t, p) => t + valor(p), 0),
    mesCount: doMes.length,
    // Matrículas da escola da mesma pessoa: o Painel não conta de novo nem lista duas vezes.
    matriculaIds: pessoas.filter((p) => p.encaixe && p.encaixe.matriculaId).map((p) => p.encaixe.matriculaId),
    matriculaIdsEncaixe: pessoas.filter((p) => p.encaixe && p.encaixe.matriculaId && !p.encaixe.naEscola).map((p) => p.encaixe.matriculaId),
    recentes: pessoas.filter((p) => !p.encaixe && p.pagoData)
      .sort((a, b) => b.pagoData - a.pagoData)
      .map((p) => ({ nome: p.nome, curso: p.cursoNome, quando: p.pagoData, valor: valor(p) || null })),
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

module.exports = { carregar, encaixar, situacaoPagamento, dataPago, resumoPainel, taxaPaga };
