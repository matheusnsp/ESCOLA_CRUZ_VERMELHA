# Alterações aplicadas neste src/ — Escola CVB-RJ

Pacote da auditoria. Cada mudança no código tem um comentário `💡 CORRIGIDO (Xn)`
ou `💡 Mn` referenciando o número do achado no PDF `Auditoria_Tecnica_Escola_CVB.pdf`.

## RODADA 1 — Críticos + Altos (já testados rodando contra o banco)

| Achado | Arquivo | O que mudou | Status |
|---|---|---|---|
| C4 | `server.js`, `lib/asyncHandler.js`(novo), routers | Middleware de erro + handlers de processo; wrap async nos 4 routers | ✅ testado |
| B4 | `server.js` | Sessão 1 ano → 90 dias | ✅ |
| A1 | `lib/permissoes.js` | Secretaria perde cancelar/estornar; Coordenador ganha criar curso | ✅ testado |
| A2 | `routes/admin.js` | Ledger de Pagamento nas ações manuais | ✅ testado (divergência exposta) |
| A3 | `routes/admin.js`, `lib/unicopag.js` | Refund real no estorno (`estornarTransacao`) + opção contábil | ⚠️ escrito, NÃO testado (depende do 403 do gateway) |
| A4 | `routes/admin.js` | Soma do financeiro corrigida | ✅ testado (R$ 2.500 fantasmas a menos em 25 matrículas) |
| A5 | `routes/cursos.js` | Nº de parcelas travado ao curso (não vem do form) | ✅ testado |
| A6 | `routes/cursos.js` | Checagem de vagas da turma | ✅ testado |
| A7 | `lib/matricula.js` | Isenção de taxa só com `taxaConfirmada` | ✅ testado (dado real) |
| A8 | `routes/admin.js` | Passaporte não é mais apagado na edição | ✅ |
| PIX/webhook | `lib/unicopag.js`, `routes/webhook.js`, `views/inscricao-retorno.ejs` | installments no PIX, webhook por hash/e-mail, polling | ✅ testado (simulado) |

## RODADA 2 — Médios (implementados nesta entrega)

| Achado | Arquivo | O que mudou |
|---|---|---|
| M1 | — | **NÃO INCLUÍDO.** Plano Presencial exige migration no enum `PlanoPagamento` do Prisma (mexe no schema do banco de PRODUÇÃO). Deixado de fora de propósito — precisa ser feito com você rodando a migration e revisando. Ver nota abaixo. |
| M2 | — | **NÃO INCLUÍDO.** Rota de "pagar novamente" gera cobrança nova e depende do gateway (403 aberto). Prematuro soltar agora. |
| M4 | `routes/auth.js` | Verificação de e-mail RELIGADA no cadastro (entra logado mas não-verificado; recebe o e-mail) |
| M5 | `routes/auth.js` | Lockout POR CONTA no login do aluno (8 tentativas → 15 min), reusa campos do schema |
| M7 | `lib/reconciliacao.js`(novo), `lib/unicopag.js` | Reconciliação com o gateway: `consultarTransacao` + job que varre PENDENTE e confirma os já pagos |
| M8 | `lib/unicopag.js`, `lib/email.js` | Log do PIX sem PII; link de reset/2FA nunca logado em produção |
| M9 | `lib/email.js` | Escape de HTML nas variáveis dos e-mails (anti-injeção/phishing) |
| M11 | `routes/webhook.js` | `pre_chargeback`/`med_*` viram ALERTA com log destacado |

## NÃO INCLUÍDOS de propósito (precisam de decisão fora do código)

- **M3** (não apagar registro financeiro na exclusão de conta) e **M10** (escopo
  PCI) têm implicação **jurídica/fiscal**. Como anonimizar dados de aluno e como
  tratar retenção não é decisão de quem escreve o código — precisa de uma linha
  do jurídico/DPO da CVB. O código entra assim que houver essa definição.
- **M6** (ThreatMetrix): resolvido pelo dev, conforme informado. Nada a fazer aqui.
- **M1**: precisa de migration no enum `PlanoPagamento` (adicionar `PRESENCIAL`).
  Como é alteração de schema em produção, deve ser feita com você rodando
  `prisma migrate` e conferindo, não empacotada às cegas.

## COMO USAR A RECONCILIAÇÃO (M7) — resolve as 25 divergências antigas

Depois do deploy e com o 403 do gateway resolvido, rode uma vez para varrer o
passivo (idadeMinMinutos: 0 pega tudo):

    node -e "require('./src/lib/reconciliacao').reconciliarPendentes({ idadeMinMinutos: 0 }).then(r => { console.log(r); process.exit(0); })"

Para deixar rodando como job (opcional), no server.js:

    const { reconciliarPendentes } = require('./lib/reconciliacao');
    setInterval(() => reconciliarPendentes().catch(e => console.error(e)), 15 * 60 * 1000);

## AÇÕES QUE NÃO SÃO CÓDIGO (continuam pendentes)

- **C1** — apontar o `DATABASE_URL` de desenvolvimento para banco separado.
- **C2** — rotacionar segredos: FEITO (informado pelo Matheus).
- **C3** — deploy + reconciliação (M7) dos PENDENTE antigos, após o 403 cair.

## Detalhe de UI pendente (A3)

A rota de estorno aceita `apenasContabil` (pagamentos fora do gateway). O checkbox
correspondente ainda não foi adicionado à view do form de estorno.
