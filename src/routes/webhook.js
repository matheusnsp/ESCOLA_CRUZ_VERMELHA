const express = require('express');
const prisma = require('../db');

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

        await prisma.matricula.update({
          where: { id: pagamento.matriculaId },
          data: dadosMatricula,
        });
        console.log(`[WEBHOOK] ✅ CURSO pago. Matrícula ${pagamento.matriculaId} → ${novoStatusMatricula}.`);
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