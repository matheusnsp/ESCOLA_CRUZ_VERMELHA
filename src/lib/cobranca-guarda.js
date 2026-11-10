// Proteção contra rajadas de cobrança no site do aluno.
//
// Caso real (06/08/2026): com a Únicopag falhando, uma aluna reapertou "Pagar" dezenas de vezes e
// gerou ~50 Pagamento CANCELADO da mesma matrícula (12 em 4 s), todos sem resposta do gateway.
// Nada foi cobrado, mas o mesmo buraco permitia gerar dezenas de PIX reais. As camadas daqui:
//
//   1. podeCobrar: antes de criar, reaproveita o PIX recente com QR (o mesmo `pixRecente` que as
//      rotas já tinham), e recusa se o gateway está sem responder (disjuntor) ou se a matrícula
//      passou do limite de tentativas.
//   2. criarCobrancaTravada: o "acha pendente ou cria" com um lock de aviso do Postgres por
//      matrícula, para pedidos simultâneos (duplo clique, rajada) virarem um só Pagamento.
//   3. registrarRajada: grava UMA LogAuditoria RAJADA_PAGAMENTO por janela, que o Painel e a ficha
//      do aluno mostram para a secretaria.
//
// O limite por IP (express-rate-limit) fica nas rotas (routes/cursos.js).
const crypto = require('crypto');
const prisma = require('../db');

const MIN = 60 * 1000;

const JANELA_PIX_MIN = 30;        // QR mais novo que isso é reaproveitado (o PIX expira na Woovi)
const JANELA_LIMITE_MIN = 15;     // no máximo MAX_TENTATIVAS cobranças criadas nessa janela
const MAX_TENTATIVAS = 5;
const JANELA_DISJUNTOR_MIN = 10;  // SEM_RESPOSTA_SEGUIDAS falhas dentro desse intervalo...
const SEM_RESPOSTA_SEGUIDAS = 3;
const BLOQUEIO_DISJUNTOR_MIN = 15; // ...bloqueiam novas tentativas por esse tempo, desde a última
const JANELA_EM_VOO_MIN = 2;      // Pagamento PENDENTE ainda sem gatewayRef: pedido em andamento
const JANELA_RAJADA_MIN = 15;     // uma LogAuditoria RAJADA_PAGAMENTO por matrícula nesse tempo

const MSG_LIMITE = 'Muitas tentativas de pagamento. Aguarde alguns minutos ou fale com a secretaria pelo WhatsApp (21) 99992-2864.';
const MSG_GATEWAY = 'O pagamento está instável neste momento. Tente de novo em alguns minutos.';

const atras = (min) => new Date(Date.now() - min * MIN);

// LogAuditoria.detalhe é Json: os registros daqui chegam como objeto; os gravados por auditar()
// (routes/admin.js) chegam como texto. Aceita os dois.
function lerDetalhe(d) {
  if (!d) return {};
  if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
  return d;
}

// PIX da mesma matrícula e tipo, ainda em aberto, com QR gerado há menos de 30 minutos.
// Com `valor`, só o QR desse valor serve (cupom aplicado ou tirado, preço mudado: gera outro,
// como lib/cobranca-avista.js já fazia).
function pixReaproveitavel(matriculaId, tipo, { valor = null } = {}) {
  return prisma.pagamento.findFirst({
    where: {
      matriculaId,
      tipo,
      status: 'PENDENTE',
      metodo: 'PIX',
      ...(valor != null ? { valor } : {}),
      gatewayRef: { not: null },
      pixQrCode: { not: null },   // só serve se o QR de fato existe
      criadoEm: { gt: atras(JANELA_PIX_MIN) },
    },
    orderBy: { criadoEm: 'desc' },
  });
}

// O gateway deixou as últimas cobranças da matrícula sem resposta? Olha as 3 mais recentes: todas
// CANCELADO sem gatewayRef (o catch das rotas cancela quando a Únicopag não respondeu), feitas num
// intervalo de até 10 min, e a última há menos de 15 min. Assim o bloqueio dura 15 min a partir da
// última falha, e uma cobrança que deu certo no meio zera a conta.
async function disjuntorAberto(matriculaId) {
  const ultimas = await prisma.pagamento.findMany({
    where: { matriculaId },
    orderBy: { criadoEm: 'desc' },
    take: SEM_RESPOSTA_SEGUIDAS,
    select: { status: true, gatewayRef: true, criadoEm: true },
  });
  if (ultimas.length < SEM_RESPOSTA_SEGUIDAS) return false;
  if (!ultimas.every((p) => p.status === 'CANCELADO' && !p.gatewayRef)) return false;
  const maisNova = new Date(ultimas[0].criadoEm).getTime();
  const maisVelha = new Date(ultimas[ultimas.length - 1].criadoEm).getTime();
  return maisNova > Date.now() - BLOQUEIO_DISJUNTOR_MIN * MIN
    && maisNova - maisVelha <= JANELA_DISJUNTOR_MIN * MIN;
}

function contarTentativas(matriculaId) {
  return prisma.pagamento.count({ where: { matriculaId, criadoEm: { gt: atras(JANELA_LIMITE_MIN) } } });
}

// Grava a LogAuditoria RAJADA_PAGAMENTO, no máximo uma por matrícula a cada 15 min. Mesmo padrão
// de lib/turma-espera.js (outro ramo): $transaction em array com lock de aviso por matrícula e
// INSERT ... WHERE NOT EXISTS, para dois pedidos barrados ao mesmo tempo não gravarem duas linhas.
async function registrarRajada({ matriculaId, alunoId, motivo, ip }) {
  try {
    let atorId = alunoId;
    if (!atorId) {
      const m = await prisma.matricula.findUnique({ where: { id: matriculaId }, select: { alunoId: true } });
      atorId = m?.alunoId || 'SISTEMA';
    }
    const janelaMin = motivo === 'gateway' ? JANELA_DISJUNTOR_MIN : JANELA_LIMITE_MIN;
    const [tentativas, semResposta] = await Promise.all([
      prisma.pagamento.count({ where: { matriculaId, criadoEm: { gt: atras(janelaMin) } } }),
      prisma.pagamento.count({
        where: { matriculaId, status: 'CANCELADO', gatewayRef: null, criadoEm: { gt: atras(janelaMin) } },
      }),
    ]);
    const detalhe = { tentativas, janelaMin, semResposta, ip: ip || null, motivo };
    const [, gravadas] = await prisma.$transaction([
      prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rajada:' + matriculaId}::text))`,
      prisma.$executeRaw`
        INSERT INTO "LogAuditoria" ("id", "atorId", "acao", "alvoTipo", "alvoId", "detalhe", "criadoEm")
        SELECT ${crypto.randomUUID()}::text, ${atorId}::text, 'RAJADA_PAGAMENTO', 'Matricula', ${matriculaId}::text,
               ${JSON.stringify(detalhe)}::jsonb, (now() AT TIME ZONE 'UTC')
        WHERE NOT EXISTS (
          SELECT 1 FROM "LogAuditoria"
          WHERE "acao" = 'RAJADA_PAGAMENTO' AND "alvoId" = ${matriculaId}::text
            AND "criadoEm" > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${JANELA_RAJADA_MIN}::int))`,
    ]);
    if (gravadas) console.warn(`[COBRANÇA] Rajada na matrícula ${matriculaId} (${motivo}): ${tentativas} tentativas em ${janelaMin} min, ${semResposta} sem resposta, IP ${ip}.`);
    return { ok: true, gravou: gravadas > 0 };
  } catch (e) {
    // O aviso para a secretaria não pode derrubar a resposta ao aluno.
    console.error('[COBRANÇA] Erro ao registrar rajada:', e.message);
    return { ok: false, msg: e.message };
  }
}

// Pode criar uma cobrança nova para esta matrícula?
//   { ok: true, reaproveitar: Pagamento } → PIX recente com QR: mostra o mesmo, não cria outro
//   { ok: false, motivo: 'gateway' | 'limite', msg } → recusar com 429 e msg
//   { ok: true } → pode criar (com criarCobrancaTravada)
// `gateway: false` para cobranças que não passam pela Únicopag (passaporte, curso presencial):
// essas não têm por que parar quando o gateway está instável. `valor`: só reaproveita o QR desse valor.
async function podeCobrar({ matriculaId, tipo, metodo, ip, alunoId, gateway = true, valor = null }) {
  if (metodo === 'PIX' && gateway) {
    const reaproveitar = await pixReaproveitavel(matriculaId, tipo, { valor });
    if (reaproveitar) return { ok: true, reaproveitar };
  }
  if (gateway && await disjuntorAberto(matriculaId)) {
    await registrarRajada({ matriculaId, alunoId, motivo: 'gateway', ip });
    return { ok: false, motivo: 'gateway', msg: MSG_GATEWAY };
  }
  if (await contarTentativas(matriculaId) >= MAX_TENTATIVAS) {
    await registrarRajada({ matriculaId, alunoId, motivo: 'limite', ip });
    return { ok: false, motivo: 'limite', msg: MSG_LIMITE };
  }
  return { ok: true };
}

// Cria o Pagamento PENDENTE, um por vez por matrícula.
//
// Sem transação interativa (neste projeto elas estouram o tempo-limite entre o Render e o banco;
// ver lib/matricula-rapida.js), então a decisão "cria ou não" vai inteira no SQL: um $transaction
// em array (uma ida ao banco) pega pg_advisory_xact_lock('cobranca:' + matriculaId) e faz
// INSERT ... SELECT ... WHERE <ainda cabe> . Um segundo pedido simultâneo espera o lock; quando
// entra, o INSERT dele (novo snapshot em READ COMMITTED) já enxerga a linha do primeiro e não
// grava. Depois lemos a linha pelo id gerado aqui. Funciona também atrás de pgbouncer em modo
// transação (o lote vai numa só transação, numa só conexão).
//
// Não grava quando:
//   - já existe um Pagamento PENDENTE da mesma matrícula, tipo e método em andamento: sem
//     gatewayRef criado há menos de 2 min (o pedido ainda está no gateway, ou é um registro
//     local recém-feito) ou PIX com QR há menos de 30 min do mesmo valor (de outro valor não
//     serve: o cupom entrou ou saiu, e o QR antigo cobraria errado);
//   - a matrícula já teve 5 cobranças criadas nos últimos 15 min (qualquer status).
// Colunas iguais às que o prisma.pagamento.create gravaria (criadoEm/atualizadoEm em UTC).
//
// Retorna { ok: true, pagamento } | { ok: false, motivo: 'andamento', pagamento } |
//         { ok: false, motivo: 'limite', msg }
async function criarCobrancaTravada({ matriculaId, tipo, metodo, valor, gateway = null, ip, alunoId }) {
  const id = crypto.randomUUID();
  await prisma.$transaction([
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cobranca:' + matriculaId}::text))`,
    prisma.$executeRaw`
      INSERT INTO "Pagamento" ("id", "matriculaId", "tipo", "gateway", "metodo", "valor", "status", "criadoEm", "atualizadoEm")
      SELECT ${id}::text, ${matriculaId}::text, ${tipo}::"TipoPagamento", ${gateway}::text, ${metodo}::"FormaPagamento",
             CAST(${String(valor)} AS DECIMAL(10,2)), 'PENDENTE'::"StatusPagamento",
             (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      WHERE (
          SELECT count(*) FROM "Pagamento"
          WHERE "matriculaId" = ${matriculaId}::text
            AND "criadoEm" > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${JANELA_LIMITE_MIN}::int)
        ) < ${MAX_TENTATIVAS}::int
        AND NOT EXISTS (
          SELECT 1 FROM "Pagamento"
          WHERE "matriculaId" = ${matriculaId}::text AND "tipo" = ${tipo}::"TipoPagamento"
            AND "metodo" = ${metodo}::"FormaPagamento" AND "status" = 'PENDENTE'::"StatusPagamento"
            AND (
              ("gatewayRef" IS NULL
                AND "criadoEm" > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${JANELA_EM_VOO_MIN}::int))
              OR ("metodo" = 'PIX'::"FormaPagamento" AND "gatewayRef" IS NOT NULL AND "pixQrCode" IS NOT NULL
                AND "valor" = CAST(${String(valor)} AS DECIMAL(10,2))
                AND "criadoEm" > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${JANELA_PIX_MIN}::int))
            ))`,
  ]);

  const pagamento = await prisma.pagamento.findUnique({ where: { id } });
  if (pagamento) return { ok: true, pagamento };

  // Não gravou: ou estourou o limite, ou há outro pedido em andamento (devolvemos ele). Conta de
  // novo em vez de procurar o "em andamento" primeiro: ele pode ter acabado de virar CANCELADO.
  if (await contarTentativas(matriculaId) >= MAX_TENTATIVAS) {
    await registrarRajada({ matriculaId, alunoId, motivo: 'limite', ip });
    return { ok: false, motivo: 'limite', msg: MSG_LIMITE };
  }
  const emAndamento = await prisma.pagamento.findFirst({
    where: { matriculaId, tipo, metodo },
    orderBy: { criadoEm: 'desc' },
  });
  console.log(`[COBRANÇA] Pedido simultâneo na matrícula ${matriculaId}: usando o Pagamento em andamento ${emAndamento?.id}.`);
  return { ok: false, motivo: 'andamento', pagamento: emAndamento };
}

// Pedido simultâneo de PIX: o primeiro ainda está esperando a Únicopag. Espera o QR dele (ou o
// cancelamento) por até ~40 s, como o catch das rotas já espera o webhook, para o aluno cair na
// tela do QR em vez de "Processando…". Retorna o Pagamento como ficou.
async function aguardarPagamento(pagamentoId, { tentativas = 20, intervaloMs = 2000 } = {}) {
  let atual = null;
  for (let i = 0; i < tentativas; i++) {
    atual = await prisma.pagamento.findUnique({ where: { id: pagamentoId } });
    if (!atual || atual.status !== 'PENDENTE' || atual.pixQrCode || atual.gatewayRef) return atual;
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
  return atual;
}

// Para o Painel: RAJADA_PAGAMENTO das últimas 24 h, com o nome do aluno (uma consulta nos logs e
// uma nos nomes). Uma entrada por aluno, com quantos registros teve.
async function rajadasDoDia() {
  const logs = await prisma.logAuditoria.findMany({
    where: { acao: 'RAJADA_PAGAMENTO', alvoTipo: 'Matricula', criadoEm: { gte: new Date(Date.now() - 24 * 60 * MIN) } },
    orderBy: { criadoEm: 'desc' },
    select: { atorId: true, criadoEm: true },
    take: 200,
  });
  if (!logs.length) return { total: 0, alunos: [] };
  const ids = [...new Set(logs.map((l) => l.atorId))];
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
  const nomes = Object.fromEntries(usuarios.map((u) => [u.id, u.nome]));
  const porAluno = new Map();
  for (const l of logs) {
    const a = porAluno.get(l.atorId) || { id: l.atorId, nome: nomes[l.atorId] || 'Aluno', vezes: 0, ultima: l.criadoEm };
    a.vezes += 1;
    porAluno.set(l.atorId, a);
  }
  return { total: logs.length, alunos: [...porAluno.values()] };
}

// Para a ficha do aluno: { matriculaId: [ { criadoEm, tentativas, janelaMin } ] }.
async function rajadasDasMatriculas(matriculaIds) {
  if (!matriculaIds.length) return {};
  const logs = await prisma.logAuditoria.findMany({
    where: { acao: 'RAJADA_PAGAMENTO', alvoTipo: 'Matricula', alvoId: { in: matriculaIds } },
    orderBy: { criadoEm: 'desc' },
    select: { alvoId: true, criadoEm: true, detalhe: true },
    take: 100,
  });
  const r = {};
  for (const l of logs) {
    const d = lerDetalhe(l.detalhe);
    (r[l.alvoId] = r[l.alvoId] || []).push({
      criadoEm: l.criadoEm,
      tentativas: Number(d.tentativas) || 0,
      janelaMin: Number(d.janelaMin) || JANELA_LIMITE_MIN,
    });
  }
  return r;
}

// Para a aba Suspeitos (só Dev): os RAJADA_PAGAMENTO dos últimos `dias` dias, mais novo primeiro,
// com aluno (nome, e-mail, se está banido) e curso/turma da matrícula.
async function listarSuspeitos({ dias = 90 } = {}) {
  const logs = await prisma.logAuditoria.findMany({
    where: { acao: 'RAJADA_PAGAMENTO', alvoTipo: 'Matricula', criadoEm: { gte: new Date(Date.now() - dias * 24 * 60 * MIN) } },
    orderBy: { criadoEm: 'desc' },
    select: { id: true, atorId: true, alvoId: true, criadoEm: true, detalhe: true },
    take: 500,
  });
  if (!logs.length) return [];
  const matriculas = await prisma.matricula.findMany({
    where: { id: { in: [...new Set(logs.map((l) => l.alvoId).filter(Boolean))] } },
    select: {
      id: true,
      aluno: { select: { id: true, nome: true, email: true, bloqueioTotal: true } },
      turma: { select: { id: true, inicioPrevisto: true, curso: { select: { nome: true } } } },
    },
  });
  const porId = Object.fromEntries(matriculas.map((m) => [m.id, m]));
  return logs.map((l) => {
    const d = lerDetalhe(l.detalhe);
    const m = porId[l.alvoId] || null;
    return {
      id: l.id,
      criadoEm: l.criadoEm,
      matriculaId: l.alvoId,
      aluno: m ? m.aluno : null,
      curso: m?.turma?.curso?.nome || null,
      turmaInicio: m?.turma?.inicioPrevisto || null,
      tentativas: Number(d.tentativas) || 0,
      janelaMin: Number(d.janelaMin) || JANELA_LIMITE_MIN,
      semResposta: Number(d.semResposta) > 0,
      motivo: d.motivo || null,
      ip: d.ip || null,
    };
  });
}

module.exports = {
  podeCobrar, registrarRajada, criarCobrancaTravada, aguardarPagamento,
  rajadasDoDia, rajadasDasMatriculas, listarSuspeitos,
  MSG_LIMITE, MSG_GATEWAY,
};
