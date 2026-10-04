const express = require('express');
const prisma = require('../db');
const { aplicarStatus } = require('../lib/status-pagamento');
const unicopag = require('../lib/unicopag');

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
// A regra de como cada situação vira Pagamento/Matrícula está em lib/status-pagamento.js, a mesma
// que a reconciliação (lib/reconciliacao.js) usa para os avisos que se perdem.
// ─────────────────────────────────────────────────────────────────────────

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
      // Aviso de um pagamento feito na instituição (matrícula rápida, outra conta da Únicopag): não
      // é desta escola. Sem esta checagem ele casava por e-mail + R$ 99 com a taxa que a pessoa
      // deixou em aberto aqui e a marcava paga (contando o mesmo dinheiro duas vezes). Quem liga
      // esse pagamento à matrícula da escola é o batimento de lib/matricula-rapida.js.
      if (hash && unicopag.conta('segunda').token) {
        const lista = await unicopag.listarTransacoes('segunda', { forcar: true });
        if (lista.ok && lista.lista.some((t) => t.hash === hash)) {
          console.log(`[WEBHOOK] Aviso da conta da instituição (matrícula rápida), ignorado aqui. hash=${hash}`);
          return res.json({ ok: true, info: 'transação da conta da instituição' });
        }
      }
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

    const r = await aplicarStatus(pagamento, { status, payload, tx, origem: 'webhook' });
    if (r.info) return res.json({ ok: true, info: r.info });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[WEBHOOK] 💥 Erro interno no processamento do postback:', error);
    return res.status(500).json({ ok: false });
  }
});

module.exports = router; 