// lib/escola-digital/pagamento.js
//
// Pagamento da Escola Digital (spec §5.3): cobra a InscricaoOnline pela Únicopag (ou pelo pagamento
// simulado, fora de produção), aplica a resposta e ativa o curso. Não conhece o Express.
//
//   cobrar({ inscricaoId, plano, parcelas, forma, dadosCartao?, origem? }) -> PagamentoOnline
//     (+ `reaproveitado` quando devolve a cobrança pendente que já existia, + `motivo` no cartão recusado)
//   aplicarStatusOnline(pagamento, { status, payload, origem }) -> { info? , novoStatus?, situacao? }
//   acharPorIdentificador({ hash, orderId }) / acharPorEmailEValor({ hash, email, valor })
//     -> PagamentoOnline | null   (routes/webhook.js: os exatos antes, e-mail + valor por último)
//   reconciliarOnline(opts) -> resumo                                           (lib/reconciliacao.js)
//
// O que vale aqui, e por quê:
//   - Mesma conta da Únicopag da escola (principal) e o mesmo jeito de cobrar da inscrição presencial
//     (routes/cursos.js): no parcelado vai o valor BASE e o número de parcelas; a Únicopag aplica os
//     juros (o aviso traz amount = base, amount_total = com juros). PagamentoOnline.valor guarda o
//     base, que é o que o aviso ecoa e o que o webhook usa para casar por e-mail + valor.
//   - A referência mandada à Únicopag (order_id e item do carrinho) é "ED-" + id do PagamentoOnline:
//     um order_id de aviso nunca casa com uma matrícula presencial por engano.
//   - A mesma trava de idempotência de lib/status-pagamento.js (updateMany com status diferente do
//     novo): de dois avisos iguais, só um ativa o curso e manda o e-mail.
//   - Dados do cartão só passam por aqui a caminho da Únicopag: nunca vão para o banco nem para o log.

const prisma = require('../../db');
const unicopag = require('../unicopag');
const email = require('../email');
const config = require('./config');
const regras = require('./regras');
const { classificarStatus } = require('../status-pagamento');
const reconciliacao = require('../reconciliacao');

const PREFIXO_REF = 'ED-';
// PIX: a mesma janela da inscrição presencial (routes/cursos.js, JANELA_PIX_MS). Depois disso o QR
// pode ter vencido do lado da Únicopag; mostrar um vencido é pior do que gerar outro.
const JANELA_PIX_MS = 30 * 60 * 1000;
// PIX ainda sem QR: a chamada à Únicopag pode estar em andamento (ela leva até ~35 s, mais a espera
// pelo aviso). Passado isso sem QR, a cobrança não saiu: é cancelada e sai outra.
const JANELA_PIX_SEM_QR_MS = 2 * 60 * 1000;
// Cartão: a mesma trava contra cobrança em dobro da inscrição presencial (3 minutos).
const JANELA_CARTAO_MS = 3 * 60 * 1000;
// PIX que deu erro do nosso lado: espera o aviso da Únicopag gravar o hash antes de desistir, como
// a inscrição presencial (15 x 2 s). Os testes encurtam.
const ESPERA_PIX = { tentativas: 15, intervaloMs: 2000 };

const CHAVE_RODADA = 'reconciliacao-online:rodada';
const CHAVE_ULTIMA = 'reconciliacao-online:ultima';

const MSG_RECUSADO = 'O banco recusou a cobrança. Confira os dados ou tente outro cartão.';
const MSG_ERRO_CARTAO = 'Não conseguimos processar essa cobrança. Confira os dados ou tente outro cartão.';

// Dados do aluno que a Únicopag recebe (os mesmos de SELECT_ALUNO_CHECKOUT em routes/cursos.js).
const SELECT_ALUNO = {
  nome: true, email: true, tipoDocumento: true, cpfCnpj: true, celular: true,
  cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true,
};

// Valor em reais como texto com 2 casas, para filtrar coluna Decimal: com um número do JS o Prisma 5
// compara o double inteiro (89.9 vira 89.900000000000005…) e não acha a linha de R$ 89,90.
const emDecimal = (v) => Number(v).toFixed(2);

function erro(codigo, mensagem) {
  const e = new Error(mensagem);
  e.codigo = codigo; // 'invalido' | 'situacao' | 'indisponivel' | 'gateway'
  return e;
}

// Por onde a cobrança passa agora: 'simulado', 'unicopag' (conta principal) ou null (nenhum).
function gatewayAtual() {
  if (config.pagamentoSimulado()) return 'simulado';
  if (unicopag.conta('principal').token) return 'unicopag';
  return null;
}
const disponivel = () => gatewayAtual() !== null;

// Confere a escolha do aluno. À vista: PIX ou cartão; parcelado: só cartão, de 2 até curso.parcelas.
// Devolve { valor, parcelas } (regras.valorCobranca) ou lança erro 'invalido'.
function conferirEscolha(curso, { plano, parcelas, forma }) {
  if (forma !== 'PIX' && forma !== 'CREDITO') throw erro('invalido', 'Escolha PIX ou cartão de crédito.');
  if (plano === 'PARCELADO' && forma !== 'CREDITO') throw erro('invalido', 'O pagamento parcelado é só no cartão de crédito.');
  try {
    return regras.valorCobranca(curso, { plano, parcelas });
  } catch (e) {
    throw erro('invalido', 'Escolha uma das opções de pagamento.');
  }
}

// A cobrança pendente ainda serve? (a mesma regra para reaproveitar e para mostrar na tela)
function aindaValida(p, agora = Date.now()) {
  const idade = agora - new Date(p.criadoEm).getTime();
  if (p.metodo === 'PIX') return p.pixQrCode ? idade < JANELA_PIX_MS : idade < JANELA_PIX_SEM_QR_MS;
  // No simulado o cartão fica esperando o Aprovar/Recusar de quem testa.
  return idade < JANELA_CARTAO_MS || p.gateway === 'simulado';
}

// Cobrança pendente que a tela deve mostrar (QR do PIX, cartão em análise) ou null.
async function pendenteAtual(inscricaoId) {
  const p = await prisma.pagamentoOnline.findFirst({ where: { inscricaoId, status: 'PENDENTE' }, orderBy: { criadoEm: 'desc' } });
  return p && aindaValida(p) ? p : null;
}

// Acha a cobrança PENDENTE igual (mesma forma, parcelas e valor) ou cria uma nova, com a inscrição
// travada (SELECT ... FOR UPDATE): dois cliques ao mesmo tempo esperam um pelo outro aqui, e o
// segundo encontra a linha do primeiro. A chamada à Únicopag fica de fora da trava.
async function acharOuCriarPendente({ inscricaoId, metodo, parcelas, valor, gateway }) {
  return prisma.$transaction(async (tx) => {
    const travada = await tx.$queryRaw`SELECT "situacao"::text AS situacao FROM "InscricaoOnline" WHERE "id" = ${inscricaoId} FOR UPDATE`;
    if (!travada.length) throw erro('situacao', 'Inscrição não encontrada.');
    if (travada[0].situacao !== 'AGUARDANDO_PAGAMENTO') throw erro('situacao', 'Esta inscrição não está aguardando pagamento.');

    const agora = Date.now();
    const pendentes = await tx.pagamentoOnline.findMany({
      // Mesmo gateway: um PENDENTE do simulado nunca serve quando a Únicopag está ativa, e vice-versa.
      where: { inscricaoId, metodo, parcelas, valor: emDecimal(valor), gateway, status: 'PENDENTE' },
      orderBy: { criadoEm: 'desc' },
    });
    for (const p of pendentes) {
      if (aindaValida(p, agora)) return { pagamento: p, reaproveitado: true };
      // PIX vencido (ou que nunca ganhou QR): cancela e gera outro. Se o aviso de "pago" chegar
      // depois, o webhook ainda o acha pelo hash (sem filtro de status) e ativa o curso.
      if (metodo === 'PIX') {
        await tx.pagamentoOnline.updateMany({ where: { id: p.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
      }
      // Cartão antigo fica como está: a reconciliação resolve com a Únicopag.
    }
    const novo = await tx.pagamentoOnline.create({
      data: { inscricaoId, metodo, parcelas, valor: emDecimal(valor), status: 'PENDENTE', gateway },
    });
    return { pagamento: novo, reaproveitado: false };
  });
}

// Mensagem da recusa: a da operadora, quando vier no corpo do erro ("Gateway: {...}"), com o texto padrão.
function motivoDoErro(err) {
  const texto = String((err && err.message) || '').replace(/^Gateway( Pix)?:\s*/, '');
  let msg = null;
  try {
    const j = JSON.parse(texto);
    const r = (j && j.result) || j || {};
    msg = r.message || (r.error && (r.error.message || r.error)) || null;
  } catch (e) { /* não era JSON: fica só o texto padrão */ }
  if (typeof msg !== 'string' || !msg.trim()) return MSG_ERRO_CARTAO;
  return `${MSG_ERRO_CARTAO} Motivo informado pela operadora: ${msg.trim().replace(/\s+/g, ' ').slice(0, 160)}`;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Pagamento simulado: nada sai daqui. O PIX ganha um "código" de mentira para a tela ter o que
// mostrar; a resposta vem dos botões Aprovar/Recusar de /digital/simulado/:id.
async function cobrarSimulado(pagamento) {
  if (pagamento.metodo !== 'PIX') return { ...pagamento, reaproveitado: false };
  const p = await prisma.pagamentoOnline.update({
    where: { id: pagamento.id },
    data: { pixQrCode: `SIMULADO-${PREFIXO_REF}${pagamento.id}`, gatewayStatus: 'waiting_payment' },
  });
  return { ...p, reaproveitado: false };
}

async function cobrarUnicopag(pagamento, inscricao, { dadosCartao, origem }) {
  const ehCartao = pagamento.metodo === 'CREDITO';
  const ref = PREFIXO_REF + pagamento.id;
  let resultado;
  try {
    resultado = await unicopag.criarTransacao({
      matriculaId: ref, // vira metadata.order_id e o item do carrinho
      nomeCurso: inscricao.curso.nome,
      valorTotal: Number(pagamento.valor), // valor base: a Únicopag aplica os juros do parcelado
      forma: pagamento.metodo,
      aluno: { ...inscricao.aluno, cidade: inscricao.aluno.cidade || 'Rio de Janeiro' },
      dadosCartao: ehCartao ? { ...dadosCartao, parcelas: pagamento.parcelas } : null,
      tipoPagamento: 'ESCOLA_DIGITAL',
      conta: 'principal',
      origem,
    });
  } catch (err) {
    // Nunca logar dadosCartao. A mensagem é a resposta da Únicopag, como na inscrição presencial.
    console.error(`[ESCOLA-DIGITAL] Erro no gateway (${pagamento.metodo}) do PagamentoOnline ${pagamento.id}:`, err.message);
    if (!ehCartao) {
      // PIX: a Únicopag pode ter criado a cobrança e só a resposta se perdeu (timeout). O aviso dela
      // casa esta linha por e-mail + valor e grava o hash; esperamos um pouco por isso.
      for (let i = 0; i < ESPERA_PIX.tentativas; i++) {
        const atual = await prisma.pagamentoOnline.findUnique({ where: { id: pagamento.id } });
        if (atual && atual.gatewayRef) return { ...atual, reaproveitado: false };
        await dormir(ESPERA_PIX.intervaloMs);
      }
    }
    await prisma.pagamentoOnline.updateMany({ where: { id: pagamento.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    if (!ehCartao) throw erro('gateway', 'Não foi possível gerar o PIX agora. Tente de novo em instantes.');
    const atual = await prisma.pagamentoOnline.findUnique({ where: { id: pagamento.id } });
    return { ...atual, reaproveitado: false, motivo: motivoDoErro(err) };
  }

  // O resultado de criarTransacao não traz dados do cartão (só ids, situação e o PIX).
  await prisma.pagamentoOnline.update({
    where: { id: pagamento.id },
    data: {
      gatewayRef: String(resultado.gatewayRef || resultado.id || resultado.hash || ref),
      gatewayHash: resultado.hash || null,
      gatewayStatus: resultado.paymentStatus || null,
      gatewayResponse: resultado,
      pixQrCode: resultado.pixQrCode || null,
      pixUrl: resultado.pixUrl || null,
      pixBase64: resultado.pixBase64 || null,
    },
  });

  // Cartão: a resposta já vem na hora (aprovado ou recusado). Aplica com a mesma regra do aviso;
  // quando o aviso chegar depois, a trava de idempotência o ignora.
  let motivo;
  if (ehCartao && classificarStatus(resultado.paymentStatus) !== 'PENDENTE') {
    const atual = await prisma.pagamentoOnline.findUnique({ where: { id: pagamento.id } });
    await aplicarStatusOnline(atual, { status: resultado.paymentStatus, payload: resultado, origem: 'cartao' });
    if (classificarStatus(resultado.paymentStatus) === 'CANCELAMENTO') motivo = MSG_RECUSADO;
  }
  const final = await prisma.pagamentoOnline.findUnique({ where: { id: pagamento.id } });
  return { ...final, reaproveitado: false, ...(motivo ? { motivo } : {}) };
}

/**
 * Cobra a inscrição. Reaproveita a cobrança PENDENTE da mesma forma, parcelas e valor (PIX dentro
 * da validade do QR; cartão nos 3 minutos da trava contra cobrança em dobro).
 * Erros (com `codigo`): 'invalido' (escolha não permitida), 'situacao' (inscrição não aguarda
 * pagamento), 'indisponivel' (sem simulado e sem Únicopag), 'gateway' (PIX não saiu).
 */
async function cobrar({ inscricaoId, plano, parcelas, forma, dadosCartao, origem } = {}) {
  const inscricao = await prisma.inscricaoOnline.findUnique({
    where: { id: String(inscricaoId || '') },
    include: { curso: true, aluno: { select: SELECT_ALUNO } },
  });
  if (!inscricao) throw erro('situacao', 'Inscrição não encontrada.');
  const cobranca = conferirEscolha(inscricao.curso, { plano, parcelas, forma });

  const gateway = gatewayAtual();
  if (!gateway) throw erro('indisponivel', 'Pagamento indisponível no momento.');
  if (gateway === 'unicopag' && forma === 'CREDITO' && !dadosCartao) throw erro('invalido', 'Preencha os dados do cartão.');

  const { pagamento, reaproveitado } = await acharOuCriarPendente({
    inscricaoId: inscricao.id, metodo: forma, parcelas: cobranca.parcelas, valor: cobranca.valor, gateway,
  });
  if (reaproveitado) {
    console.log(`[ESCOLA-DIGITAL] Reaproveitando a cobrança pendente ${pagamento.id} da inscrição ${inscricao.id}.`);
    return { ...pagamento, reaproveitado: true };
  }
  if (gateway === 'simulado') return cobrarSimulado(pagamento);
  return cobrarUnicopag(pagamento, inscricao, { dadosCartao, origem });
}

// Prefixo do log conforme o caminho.
const QUEM = { webhook: 'WEBHOOK', reconciliacao: 'RECONCILIACAO', simulado: 'SIMULADO', cartao: 'CARTAO' };

const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null);

// E-mail de matrícula confirmada. Nunca lança: o pagamento já está gravado, e um erro aqui faria a
// Únicopag reenviar o aviso por um problema que não é dela.
async function avisarAtivacao(inscricaoId) {
  try {
    const i = await prisma.inscricaoOnline.findUnique({
      where: { id: inscricaoId },
      include: { aluno: { select: { nome: true, email: true } }, curso: { select: { nome: true } } },
    });
    if (!i || !i.aluno || !i.aluno.email) return;
    const base = (process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com').replace(/\/+$/, '');
    // Pelo objeto do módulo (e não desestruturado) para os testes poderem espionar o envio.
    await email.enviarMatriculaOnlineConfirmada(i.aluno.email, String(i.aluno.nome).trim().split(/\s+/)[0], {
      curso: i.curso.nome,
      link: `${base}/digital/estudo/${i.id}`,
      acessoAte: dataBR(i.acessoAte),
    });
  } catch (e) {
    console.error('[ESCOLA-DIGITAL] Falha ao enviar o e-mail de matrícula online confirmada:', e.message);
  }
}

/**
 * Aplica a situação informada (Únicopag, reconciliação, cartão na hora ou simulado) a um
 * PagamentoOnline e reflete na inscrição (regras.efeitoNaInscricao), numa transação só.
 * @param {object} pagamento  linha de PagamentoOnline
 * @param {object} o
 * @param {string} o.status   paid, refunded, refused, waiting_payment…
 * @param {object} o.payload  o que veio (fica em gatewayResponse)
 * @param {'webhook'|'reconciliacao'|'cartao'|'simulado'} o.origem
 * @param {boolean} [o.gravarPendente=true]
 * @returns {Promise<{info?: string, novoStatus?: string, situacao?: string}>}
 */
async function aplicarStatusOnline(pagamento, { status, payload, origem = 'webhook', gravarPendente = true } = {}) {
  const log = `ESCOLA-DIGITAL ${QUEM[origem] || 'WEBHOOK'}`;
  payload = payload || {};
  const classe = classificarStatus(status);

  // Atalho: o mesmo status já gravado. A proteção de verdade é a trava atômica mais abaixo.
  if (
    (pagamento.status === 'PAGO' && classe === 'SUCESSO') ||
    (pagamento.status === 'ESTORNADO' && classe === 'REEMBOLSO') ||
    (pagamento.status === 'CANCELADO' && classe === 'CANCELAMENTO')
  ) {
    return { info: 'já processado' };
  }

  if (classe === 'ALERTA') {
    console.warn(`[${log}] 🚨 ALERTA de contestação/análise — status "${status}" | PagamentoOnline ${pagamento.id} | Inscrição ${pagamento.inscricaoId}. Ação da equipe pode ser necessária.`);
    await prisma.pagamentoOnline.updateMany({ where: { id: pagamento.id }, data: { gatewayStatus: String(status || ''), gatewayResponse: payload } });
    return { info: 'alerta registrado' };
  }

  if (classe === 'PENDENTE') {
    if (gravarPendente) {
      await prisma.pagamentoOnline.updateMany({ where: { id: pagamento.id }, data: { gatewayStatus: String(status || ''), gatewayResponse: payload } });
    }
    return { info: 'aguardando confirmação' };
  }

  const novoStatus = classe === 'SUCESSO' ? 'PAGO' : classe === 'REEMBOLSO' ? 'ESTORNADO' : 'CANCELADO';
  const agora = new Date();

  const r = await prisma.$transaction(async (db) => {
    // TRAVA DE IDEMPOTÊNCIA: só um de dois avisos iguais consegue count 1 e segue.
    const upd = await db.pagamentoOnline.updateMany({
      where: { id: pagamento.id, status: { not: novoStatus } },
      data: { status: novoStatus, gatewayStatus: String(status || ''), gatewayResponse: payload },
    });
    if (upd.count === 0) return null;

    const insc = await db.inscricaoOnline.findUnique({ where: { id: pagamento.inscricaoId }, include: { curso: true } });
    let efeito = regras.efeitoNaInscricao(insc.situacao, novoStatus);

    // Estorno de um pagamento em dobro (dois PIX pagos, a secretaria devolve um): a inscrição
    // continua paga pelo outro e não é cancelada.
    if (efeito === 'CANCELADA') {
      const outrosPagos = await db.pagamentoOnline.count({ where: { inscricaoId: insc.id, status: 'PAGO', id: { not: pagamento.id } } });
      if (outrosPagos) {
        console.warn(`[${log}] PagamentoOnline ${pagamento.id} estornado, mas a inscrição ${insc.id} tem outro pagamento pago: continua ${insc.situacao}.`);
        efeito = null;
      }
    }

    // As mudanças na inscrição também são condicionais (updateMany com a situação esperada): dois
    // pagamentos diferentes aprovados ao mesmo tempo ativam uma vez só.
    let mudou = false;
    if (efeito === 'ATIVA') {
      const parcelado = pagamento.parcelas > 1;
      const u = await db.inscricaoOnline.updateMany({
        where: { id: insc.id, situacao: 'AGUARDANDO_PAGAMENTO' },
        data: {
          situacao: 'ATIVA',
          ativadaEm: agora,
          acessoAte: regras.calcularAcessoAte(agora, insc.curso.prazoAcessoDias ?? 365),
          plano: parcelado ? 'PARCELADO' : 'A_VISTA',
          forma: pagamento.metodo,
          parcelas: pagamento.parcelas,
          // O valor cobrado (base: precoAvista ou precoCheio), igual em todos os caminhos.
          valor: Number(pagamento.valor),
        },
      });
      mudou = u.count === 1;
    } else if (efeito === 'CANCELADA') {
      const u = await db.inscricaoOnline.updateMany({
        where: { id: insc.id, situacao: { in: ['ATIVA', 'CONCLUIDA'] } },
        data: { situacao: 'CANCELADA', acessoAte: agora },
      });
      mudou = u.count === 1;
    }

    await db.logAuditoria.create({
      data: {
        atorId: 'SISTEMA', acao: 'PAGAMENTO_ONLINE', alvoTipo: 'PagamentoOnline', alvoId: pagamento.id,
        detalhe: {
          inscricaoId: insc.id, origem, de: pagamento.status, para: novoStatus, statusUnicopag: String(status || ''),
          inscricao: mudou ? { de: insc.situacao, para: efeito } : null,
        },
      },
    });
    return { efeito: mudou ? efeito : null, inscricaoId: insc.id };
  });

  if (!r) {
    console.log(`[${log}] Corrida — PagamentoOnline ${pagamento.id} já estava em ${novoStatus}. Ignorando reflexo.`);
    return { info: 'corrida — já processado' };
  }
  console.log(`[${log}] PagamentoOnline ${pagamento.id} → ${novoStatus}${r.efeito ? ` | inscrição ${r.inscricaoId} → ${r.efeito}` : ''}.`);

  // Só depois do commit, e só quando o curso foi de fato liberado agora.
  if (r.efeito === 'ATIVA') await avisarAtivacao(r.inscricaoId);
  return r.efeito ? { novoStatus, situacao: r.efeito } : { novoStatus };
}

/**
 * Identificadores exatos de um aviso da Únicopag: o hash gravado num PagamentoOnline (sem filtro de
 * status, como o webhook presencial) ou o order_id "ED-<id>" (PENDENTE). O webhook procura aqui
 * logo depois dos identificadores exatos do Pagamento presencial e antes de qualquer e-mail + valor.
 */
async function acharPorIdentificador({ hash, orderId } = {}) {
  const h = String(hash || '');
  if (h) {
    const p = await prisma.pagamentoOnline.findFirst({
      where: { OR: [{ gatewayHash: h }, { gatewayRef: h }] },
      orderBy: { criadoEm: 'desc' },
    });
    if (p) return p;
  }
  const pedido = String(orderId || '');
  if (pedido.startsWith(PREFIXO_REF) && pedido.length > PREFIXO_REF.length) {
    const p = await prisma.pagamentoOnline.findFirst({ where: { id: pedido.slice(PREFIXO_REF.length), status: 'PENDENTE' } });
    if (p) return p;
  }
  return null;
}

/**
 * Corrida de dados (o aviso chegou antes de a cobrança gravar o hash): e-mail do aluno + valor base,
 * PENDENTE mais recente, e só entre as cobranças ainda sem referência da Únicopag. Não casa nada
 * quando o hash do aviso já está gravado em algum Pagamento ou PagamentoOnline (é de outra cobrança).
 */
async function acharPorEmailEValor({ hash, email: emailCliente, valor } = {}) {
  const e = String(emailCliente || '').trim().toLowerCase();
  const v = Number(valor);
  if (!e || !Number.isFinite(v) || v <= 0) return null;

  const h = String(hash || '');
  if (h) {
    const comHash = { OR: [{ gatewayHash: h }, { gatewayRef: h }] };
    const [presenciais, online] = await Promise.all([
      prisma.pagamento.count({ where: comHash }),
      prisma.pagamentoOnline.count({ where: comHash }),
    ]);
    if (presenciais || online) return null;
  }

  const aluno = await prisma.usuario.findUnique({ where: { email: e }, select: { id: true } });
  if (!aluno) return null;
  const p = await prisma.pagamentoOnline.findFirst({
    where: {
      status: 'PENDENTE', valor: emDecimal(v), inscricao: { alunoId: aluno.id },
      // Cobrança que já tem a referência dela na Únicopag não é a deste aviso.
      gatewayRef: null, gatewayHash: null,
    },
    orderBy: { criadoEm: 'desc' },
  });
  if (p) console.log(`[ESCOLA-DIGITAL WEBHOOK] Casado por e-mail (corrida de dados) — PagamentoOnline ${p.id}`);
  return p;
}

// Os dois, na ordem: identificador exato, depois e-mail + valor.
async function acharPorAviso(aviso = {}) {
  return (await acharPorIdentificador(aviso)) || acharPorEmailEValor(aviso);
}

/**
 * Reconciliação dos PagamentoOnline pendentes (laço próprio, chamado por lib/reconciliacao.js logo
 * depois do dos Pagamentos). Mesmos filtros de idade de reconciliarPendentes; trava própria entre
 * serviços. Sem a chave da Únicopag (rodando local) não faz nada; sem pendentes, não grava nada.
 * @param {object} opts  idadeMinMinutos (10), idadeMaxDias (7), limite (100), forcar (ignora a trava)
 */
async function reconciliarOnline(opts = {}) {
  if (!unicopag.conta('principal').token) return { semChave: true };
  const idadeMinMinutos = opts.idadeMinMinutos != null ? opts.idadeMinMinutos : 10;
  const idadeMaxDias = opts.idadeMaxDias || 7;
  const limite = opts.limite || 100;

  const agora = Date.now();
  const pendentes = await prisma.pagamentoOnline.findMany({
    where: {
      status: 'PENDENTE',
      gateway: 'unicopag', // só a conta principal; 'simulado' nunca passou pela Únicopag
      gatewayRef: { not: null },
      criadoEm: { lt: new Date(agora - idadeMinMinutos * 60000), gt: new Date(agora - idadeMaxDias * 86400000) },
    },
    orderBy: { criadoEm: 'desc' },
    take: limite,
  });
  const resumo = { em: new Date().toISOString(), verificados: 0, atualizados: 0, falhas: 0, porStatus: {} };
  if (!pendentes.length) return resumo;

  if (!opts.forcar && !(await reconciliacao.pegarVez(CHAVE_RODADA))) return { pulada: true };

  for (const pag of pendentes) {
    resumo.verificados++;
    const info = await unicopag.consultarTransacao(pag.gatewayRef, 'principal');
    if (!info) { resumo.falhas++; continue; }
    let r;
    try {
      r = await aplicarStatusOnline(pag, { status: info.status, payload: info.raw, origem: 'reconciliacao', gravarPendente: false });
    } catch (e) {
      resumo.falhas++;
      console.error(`[RECONCILIACAO-ONLINE] PagamentoOnline ${pag.id}:`, e.message);
      continue;
    }
    if (!r.novoStatus) continue;
    resumo.atualizados++;
    resumo.porStatus[r.novoStatus] = (resumo.porStatus[r.novoStatus] || 0) + 1;
  }

  if (resumo.verificados) {
    console.log(`[RECONCILIACAO-ONLINE] ${resumo.verificados} verificados, ${resumo.atualizados} atualizados, ${resumo.falhas} sem resposta.`, resumo.porStatus);
  }
  const valor = JSON.stringify(resumo);
  await prisma.configuracao.upsert({ where: { chave: CHAVE_ULTIMA }, update: { valor }, create: { chave: CHAVE_ULTIMA, valor } }).catch(() => {});
  return resumo;
}

// Opções de pagamento da tela: à vista e de 2 até curso.parcelas no cartão. Com a Únicopag, as
// parcelas vêm com os juros dela (uma consulta guardada por 10 min); sem ela (simulado), sem juros.
const TTL_PARCELAMENTO_MS = 10 * 60 * 1000;
const cacheParcelamento = new Map();
async function tabelaParcelamento(centavos) {
  const guardado = cacheParcelamento.get(centavos);
  if (guardado && Date.now() - guardado.em < TTL_PARCELAMENTO_MS) return guardado.tabela;
  let tabela = null;
  try { tabela = await unicopag.consultarParcelamento(centavos, 'principal'); } catch (e) { tabela = null; }
  if (Array.isArray(tabela)) cacheParcelamento.set(centavos, { tabela, em: Date.now() });
  return Array.isArray(tabela) ? tabela : null;
}

async function opcoesDePagamento(curso) {
  const precoCheio = Number(curso.precoCheio);
  const n = Number(curso.parcelas) || 1;
  const tabela = n > 1 && gatewayAtual() === 'unicopag' ? await tabelaParcelamento(Math.round(precoCheio * 100)) : null;
  const parceladas = [];
  for (let k = 2; k <= n; k++) {
    const o = tabela && tabela.find((x) => x.installments === k);
    parceladas.push({
      parcelas: k,
      valorParcela: o ? o.installment_amount / 100 : Math.round((precoCheio / k) * 100) / 100,
      total: o ? o.total_amount / 100 : precoCheio,
      comJuros: !!o,
    });
  }
  return { aVista: Number(curso.precoAvista), parceladas };
}

module.exports = {
  PREFIXO_REF, ESPERA_PIX,
  disponivel, conferirEscolha, pendenteAtual, opcoesDePagamento,
  cobrar, aplicarStatusOnline, acharPorAviso, acharPorIdentificador, acharPorEmailEValor, reconciliarOnline,
};
