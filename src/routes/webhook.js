const express = require('express');
const prisma = require('../db');
const { enviarEmailMatriculaConfirmada } = require('../lib/email');
const { formatBRL } = require('../lib/matricula');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// FORMATO REAL DO POSTBACK (confirmado em capturas de log de produção):
// payload ACHATADO, sem envelope "transaction"/"result":
//   { event, id, hash, payment_method, payment_status, amount, amount_total,
//     customer: { name, email, ... }, items: [...] }
// - NÃO vem metadata/order_id nem customer.document.
// - "amount" é o valor BASE (o mesmo que enviamos e salvamos em
//   Pagamento.valor); "amount_total" inclui juros de parcelamento e NÃO
//   serve pro matching (ex.: amount 1000, amount_total 1060 em 2x).
// O parsing abaixo também aceita variações com envelope, por segurança.
// ─────────────────────────────────────────────────────────────────────────

function classificarStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['paid', 'pago', 'success', 'captured', 'approved', 'authorized'].includes(s)) return 'SUCESSO';
  if (['refunded', 'reembolsado', 'refund', 'chargeback', 'charged_back', 'estornado', 'reversed'].includes(s)) return 'REEMBOLSO';
  if (['canceled', 'cancelled', 'cancelado', 'voided', 'void', 'refused', 'rejected', 'failed', 'expired'].includes(s)) return 'CANCELAMENTO';
  // 💡 M11: contestação em andamento — exige reação rápida da equipe.
  if (['pre_chargeback', 'pre-chargeback', 'med_analysis', 'med_received'].includes(s)) return 'ALERTA';
  return 'PENDENTE'; // waiting_payment, pending e desconhecidos
}

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — E-mail de matrícula confirmada.
//
// Disparado quando o pagamento do CURSO vira PAGO — o momento em que a
// matrícula de fato existe. Antes disto o aluno pagava e não recebia nada:
// só via a tela mudar, sem comprovante nenhum no e-mail.
//
// TUDO aqui roda dentro de try/catch e NUNCA propaga erro. Se o e-mail
// falhar, o webhook precisa responder 200 assim mesmo: o pagamento já foi
// confirmado no banco, e um não-2xx faria o gateway reenviar o postback
// indefinidamente por causa de um problema que não é dele.
// ─────────────────────────────────────────────────────────────────────────
async function avisarMatriculaConfirmada(matriculaId) {
  try {
    const m = await prisma.matricula.findUnique({
      where: { id: matriculaId },
      include: {
        aluno: { select: { nome: true, email: true } },
        turma: {
          include: {
            curso: true,
            aulas: { orderBy: { data: 'asc' } },
          },
        },
      },
    });

    if (!m || !m.aluno || !m.aluno.email) {
      console.warn(`[WEBHOOK] Sem e-mail pra avisar da matrícula ${matriculaId}.`);
      return;
    }

    const base = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';

    // ── Duas formatações de data, e a diferença importa ──────────────────
    //
    // Turma.inicioPrevisto é um TIMESTAMP (gravado ao meio-dia). Representa
    // um instante, então converter pro fuso de Brasília é o certo.
    const dataBR = (d) =>
      new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // AulaData.data é uma coluna DATE — sem hora nenhuma. O Prisma a
    // devolve como meia-noite UTC, e aplicar timeZone ali subtrai 3 horas,
    // jogando a data pro DIA ANTERIOR: uma aula do dia 24 chegava no e-mail
    // como 23. Data pura não é um instante, é um dia do calendário — então
    // lemos os componentes em UTC, sem conversão nenhuma.
    const p2 = (n) => String(n).padStart(2, '0');
    const dataPuraBR = (d) => {
      const dt = new Date(d);
      return `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
    };

    await enviarEmailMatriculaConfirmada(m.aluno.email, String(m.aluno.nome).split(' ')[0], {
      curso: m.turma.curso.nome,
      inicioTurma: dataBR(m.turma.inicioPrevisto),
      // Cronograma completo quando a turma tem aulas cadastradas — evita o
      // aluno aparecer no dia errado, que é caro pra secretaria resolver.
      aulas: (m.turma.aulas || []).map((a) => ({
        data: dataPuraBR(a.data),   // coluna DATE — sem conversão de fuso
        horario: a.horario || '',
      })),
      valorPago: formatBRL(Number(m.valorCurso)),
      plano: m.plano,
      parcelas: Number(m.turma.curso.parcelas) || 1,
      // O 1kg de alimento só é pedido em turma que registra a entrega.
      alimento: m.alimentoEntregue === false || m.alimentoEntregue === true,
      link: `${base.replace(/\/+$/, '')}/minha-conta?sec=inscricoes`,
    });
  } catch (e) {
    console.error('[WEBHOOK] Falha ao enviar e-mail de matrícula confirmada:', e.message);
  }
}

// SEM requireLogin — quem chama é o gateway, não o aluno.
// express.json() inline garante o parse mesmo que a montagem mude de lugar.
router.post('/webhook/unicopag', express.json(), async (req, res) => {
  try {
    const payload = req.body || {};
    const tx = payload.transaction || payload.result || payload;

    const hash = String(tx.hash || tx.id || payload.hash || payload.id || '');
    const status = tx.payment_status || tx.status || payload.payment_status || payload.status || '';
    const amountBase = Number(tx.amount ?? payload.amount ?? tx.amount_total ?? payload.amount_total ?? 0) / 100;
    const emailCliente = String(tx.customer?.email || payload.customer?.email || '').trim().toLowerCase();
    // Hoje o postback não ecoa metadata; fica como 3ª via caso passe a ecoar.
    const orderId = tx.metadata?.order_id || payload.metadata?.order_id || null;

    console.log(`[WEBHOOK] Postback recebido. hash: ${hash || '-'} | status: ${status || '-'} | email: ${emailCliente || '-'} | valorBase: ${amountBase}`);

    if (!hash && !emailCliente && !orderId) {
      console.warn('[WEBHOOK] Postback sem hash/email/order_id. Body:', JSON.stringify(payload).slice(0, 500));
      return res.status(400).json({ ok: false });
    }

    // 1) Caminho normal: hash da transação (gravado como gatewayRef/gatewayHash
    //    na criação). SEM filtro de status, de propósito: um pagamento marcado
    //    CANCELADO pelo timeout do nosso lado ainda precisa ser confirmável
    //    quando o webhook "paid" chegar depois.
    let pagamento = null;
    if (hash) {
      pagamento = await prisma.pagamento.findFirst({
        where: { OR: [{ gatewayHash: hash }, { gatewayRef: hash }] },
        orderBy: { criadoEm: 'desc' },
      });
    }

    // 2) metadata.order_id (se o gateway passar a ecoar): PENDENTE mais recente da matrícula.
    if (!pagamento && orderId) {
      pagamento = await prisma.pagamento.findFirst({
        where: { matriculaId: String(orderId), status: 'PENDENTE' },
        orderBy: { criadoEm: 'desc' },
      });
    }

    // 3) Corrida de dados: o webhook chegou antes de o gatewayRef ser gravado
    //    (a linha PENDENTE já existe; só falta o ref). Casa por e-mail do
    //    cliente + valor BASE + PENDENTE mais recente.
    if (!pagamento && emailCliente) {
      const aluno = await prisma.usuario.findUnique({ where: { email: emailCliente } });
      if (aluno) {
        pagamento = await prisma.pagamento.findFirst({
          where: { status: 'PENDENTE', valor: amountBase, matricula: { alunoId: aluno.id } },
          orderBy: { criadoEm: 'desc' },
        });
        if (pagamento) {
          console.log(`[WEBHOOK] Casado por e-mail (corrida de dados) — Pagamento ${pagamento.id}`);
        }
      }
    }

    if (!pagamento) {
      // Pode ser corrida ainda mais apertada. Não-2xx induz retry do gateway.
      console.error(`[WEBHOOK] Pagamento não identificado. hash=${hash} email=${emailCliente} valorBase=${amountBase}. Respondendo 404 pra induzir retry.`);
      return res.status(404).json({ ok: false });
    }

    // Grava o hash JÁ, mesmo em webhook ainda pendente (waiting_payment).
    // Essencial pro PIX: se a criação estourou timeout/504 do nosso lado,
    // cursos.js marca a linha como CANCELADO — sem o hash gravado aqui, o
    // webhook "paid" posterior não teria mais linha PENDENTE pra casar por
    // e-mail. Com o hash gravado, ele casa direto no passo 1.
    if (hash && !pagamento.gatewayRef) {
      await prisma.pagamento.updateMany({
        where: { id: pagamento.id, gatewayRef: null },
        data: { gatewayRef: hash, gatewayHash: pagamento.gatewayHash || hash },
      });
      pagamento.gatewayRef = hash;
    }

    const classe = classificarStatus(status);

    // Idempotência POR STATUS (fast-path): só ignora se o status recebido é o
    // MESMO já salvo. (Um "se já está PAGO, retorna" seco bloquearia um estorno
    // depois.) A trava atômica mais abaixo é a proteção de verdade contra
    // postbacks concorrentes; este early-return só poupa trabalho no caso comum.
    if (
      (pagamento.status === 'PAGO' && classe === 'SUCESSO') ||
      (pagamento.status === 'ESTORNADO' && classe === 'REEMBOLSO') ||
      (pagamento.status === 'CANCELADO' && classe === 'CANCELAMENTO')
    ) {
      return res.json({ ok: true, info: 'já processado' });
    }

    // 💡 M11: contestação/análise em andamento (pre_chargeback, med_*). NÃO muda
    // o status do pagamento, mas registra e loga com DESTAQUE para a equipe agir
    // rápido (janela de contestação costuma ser curta). Aqui fica só o log de
    // alerta; conectar a um canal real (e-mail/Slack) é o passo natural seguinte.
    if (classe === 'ALERTA') {
      console.warn(`[WEBHOOK] 🚨 ALERTA de contestação/análise — status "${status}" | Pagamento ${pagamento.id} | Matrícula ${pagamento.matriculaId}. Ação da equipe pode ser necessária.`);
      await prisma.pagamento.updateMany({
        where: { id: pagamento.id },
        data: { gatewayStatus: String(status || ''), gatewayResponse: payload },
      });
      return res.json({ ok: true, info: 'alerta registrado' });
    }

    // Status ainda pendente: registra a resposta bruta e aguarda o próximo.
    if (classe === 'PENDENTE') {
      await prisma.pagamento.updateMany({
        where: { id: pagamento.id },
        data: { gatewayStatus: String(status || ''), gatewayResponse: payload },
      });
      return res.json({ ok: true, info: 'aguardando confirmação' });
    }

    const novoStatus =
      classe === 'SUCESSO' ? 'PAGO' :
      classe === 'REEMBOLSO' ? 'ESTORNADO' : 'CANCELADO';

    // ── TRAVA DE IDEMPOTÊNCIA ATÔMICA ──────────────────────────────────────
    // Vira o status SÓ se o pagamento ainda não estiver nesse status. De dois
    // postbacks idênticos concorrentes, apenas um consegue count: 1 e segue pro
    // reflexo na matrícula; o outro pega count: 0 e para aqui. Fecha a corrida
    // sem depender da ordem de chegada — e sem risco de rodar o reflexo (ou um
    // futuro efeito colateral: e-mail, certificado) duas vezes.
    const upd = await prisma.pagamento.updateMany({
      where: { id: pagamento.id, status: { not: novoStatus } },
      data: { status: novoStatus, gatewayStatus: String(status || ''), gatewayResponse: payload },
    });
    if (upd.count === 0) {
      console.log(`[WEBHOOK] Corrida — Pagamento ${pagamento.id} já estava em ${novoStatus}. Ignorando reflexo.`);
      return res.json({ ok: true, info: 'corrida — já processado' });
    }

    // ── Reflexo na Matrícula, ciente do TIPO (TAXA x CURSO) ────────────────
    if (novoStatus === 'PAGO') {
      if (pagamento.tipo === 'TAXA') {
        // É isto que libera a etapa 3 (/pagar-curso checa taxaConfirmada).
        await prisma.matricula.update({
          where: { id: pagamento.matriculaId },
          data: {
            taxaConfirmada: true,
            taxaConfirmadaPor: 'webhook unicopag',
            taxaConfirmadaEm: new Date(),
          },
        });
        console.log(`[WEBHOOK] ✅ TAXA confirmada. Matrícula ${pagamento.matriculaId} liberada pra etapa 3.`);
      } else {
        const m = await prisma.matricula.findUnique({ where: { id: pagamento.matriculaId } });
        const novoStatusMatricula = m?.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';

        const dadosMatricula = {
          statusPagamento: novoStatusMatricula,
          confirmadaEm: new Date(),
          confirmadaPor: 'unicopag',
        };

        // À VISTA: curso + taxa vêm na MESMA transação (não há Pagamento tipo
        // TAXA separado nesse fluxo). Confirma a taxa aqui também — senão a
        // matrícula fica PAGA mas com "taxa aguardando confirmação" pra sempre.
        if (m?.plano === 'A_VISTA' && !m?.taxaConfirmada) {
          dadosMatricula.taxaConfirmada = true;
          dadosMatricula.taxaConfirmadaPor = 'webhook unicopag (à vista)';
          dadosMatricula.taxaConfirmadaEm = new Date();
        }

        // 💡 NOVO — PARCELADO: só AGORA o valorCurso recebe o total com juros.
        //
        // Isto ficava em cursos.js, no momento de ENVIAR o cartão pro gateway
        // — ou seja, antes de saber se seria aprovado. Um aluno com três
        // recusas do emissor ficava com juros gravados de um parcelamento que
        // nunca existiu, e a secretaria cobraria esse valor se ele fosse pagar
        // em dinheiro.
        //
        // Aqui estamos depois da trava atômica de idempotência: a cobrança foi
        // confirmada de fato, e só um postback chega até esta linha.
        //
        // amount_total do postback já vem com juros; se não vier, cai no valor
        // base + taxa, que é o pior caso aceitável (nunca infla).
        if (m?.plano === 'PARCELADO') {
          const totalComJuros = Number(tx.amount_total ?? payload.amount_total ?? 0) / 100;
          const base = Number(pagamento.valor || 0);
          const taxa = Number(m.valorTaxaMatricula || 0);
          dadosMatricula.valorCurso = (totalComJuros > 0 ? totalComJuros : base) + taxa;
        }

        await prisma.matricula.update({
          where: { id: pagamento.matriculaId },
          data: dadosMatricula,
        });
        console.log(`[WEBHOOK] ✅ CURSO pago. Matrícula ${pagamento.matriculaId} → ${novoStatusMatricula}.`);

        // 💡 NOVO — Comprovante por e-mail: matrícula confirmada, com data,
        // local e o que levar. Vem DEPOIS do update e dentro da própria
        // função protegida por try/catch: nada aqui pode derrubar o webhook.
        //
        // Fica atrás da trava atômica acima de propósito — só o postback que
        // conseguiu virar o status chega até aqui, então dois postbacks
        // concorrentes não geram dois e-mails.
        await avisarMatriculaConfirmada(pagamento.matriculaId);
      }
    } else if (novoStatus === 'ESTORNADO') {
      if (pagamento.tipo === 'CURSO') {
        const m = await prisma.matricula.findUnique({ where: { id: pagamento.matriculaId } });

        const dadosEstorno = { statusPagamento: 'ESTORNADO' };

        // À VISTA: o estorno devolve curso + taxa (tudo veio numa transação só),
        // então a taxa deixa de estar confirmada. No PARCELADO a taxa é uma
        // transação separada que continua paga — não se mexe nela aqui.
        if (m?.plano === 'A_VISTA') {
          dadosEstorno.taxaConfirmada = false;
          dadosEstorno.taxaConfirmadaPor = null;
          dadosEstorno.taxaConfirmadaEm = null;
        }

        await prisma.matricula.update({
          where: { id: pagamento.matriculaId },
          data: dadosEstorno,
        });
        console.log(`[WEBHOOK] 💸 CURSO estornado. Matrícula ${pagamento.matriculaId} → ESTORNADO.`);
      } else {
        // Estorno de TAXA não mexe na matrícula automaticamente — decisão de
        // negócio (cancelar inscrição? cobrar de novo?) fica com a secretaria.
        console.warn(`[WEBHOOK] ⚠️ TAXA estornada (Pagamento ${pagamento.id}, Matrícula ${pagamento.matriculaId}). Tratar manualmente na secretaria.`);
      }
    } else {
      // CANCELAMENTO (recusa/expiração) fica SÓ no Pagamento, de propósito:
      // marcar a Matrícula como CANCELADO travaria o aluno de tentar pagar de
      // novo (os guards de /pagar-taxa e /pagar-curso barram esses status).
      console.log(`[WEBHOOK] 🚫 Pagamento ${pagamento.id} (${pagamento.tipo}) → CANCELADO. Matrícula intacta pra nova tentativa.`);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[WEBHOOK] 💥 Erro interno no processamento do postback:', error);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router; 