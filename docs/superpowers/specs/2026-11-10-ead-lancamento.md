# EAD, etapa 8: lançamento

Branch `ead-lancamento`, a partir de `ead-cupom` (etapa 7, PR #98). Decisões do Matheus em 10/11/2026.

## 1. Objetivo

Deixar o curso online pronto para ir ao ar:
- medir visitas e vendas;
- fechar as pendências que o aluno vê e as de dinheiro;
- documentar como publicar um curso;
- juntar tudo no `main` com um roteiro de deploy.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Escola digital | Fica de fora. Só o EAD desta série (PRs #92–#98) vai para o `main`; o branch `claude/ead-cvbrj-online` não é usado. |
| Painel do EAD | Continua só para contas DEV. |
| Medição | Analytics e Pixel nas páginas públicas do online, com eventos de início de compra e compra concluída. Só com o aceite de cookies. Nunca no link de teste. |
| Pendências | As que o aluno vê e as de dinheiro e travas (§4 e §5). As do painel ficam para depois. |
| Conteúdo | A equipe escreve no painel, com o passo a passo do §6. A criação de curso com IA é a etapa 9. |
| Main | Um PR único, do último branch para o `main`, com o roteiro de deploy. O Matheus revisa e faz o merge. |
| Fora desta etapa | IA (etapa 9); acesso da secretaria ao EAD; pendências do painel; eventos de compra no presencial. |

## 3. Medição e Google

### 3.1 Analytics e Pixel

- O layout do EAD (`views/ead-teste/_topo.ejs`) inclui `partials/rastreamento` só quando a página é do curso pago (`/online/...`). O link de teste continua sem medição, porque o código secreto está no endereço.
- A tela de retorno do pagamento já usa o layout do site e já tem medição.

### 3.2 Eventos

Saem com `gtag('event', …)` e `fbq('track', …)`. Ficam na fila até o aceite de cookies, como o resto.

- **Início da compra** (`begin_checkout` / `InitiateCheckout`):
  - na tela de retorno do pagamento (PIX ou cartão) de matrícula da turma ONLINE, uma vez por carregamento;
  - dados: `currency: 'BRL'`, `value` (o `valorCurso` da matrícula), `coupon` (código, se houver) e o item (`item_id` = id do curso, `item_name` = nome).
- **Compra concluída** (`purchase` / `Purchase`):
  - na primeira página do curso pago (capa ou tela) que a pessoa abre com acesso por matrícula PAGO ou PARCELADO confirmada há menos de 24 horas;
  - cobre o PIX pago depois, o cartão e a cortesia (valor 0);
  - dados: `transaction_id` (id da matrícula, também o `eventID` da Meta, para não contar duas vezes), `value` (`valorCurso`), `currency`, `coupon` e o item;
  - a sessão guarda as matrículas já medidas, para não repetir a cada página;
  - quem tem acesso por vaga de lote não gera compra.
- `src/lib/ead-medicao.js` monta os dados dos eventos. A view só os escreve com `<%- JSON.stringify(...) %>`, escapando `<` para não quebrar o `<script>`.

### 3.3 Google

- A capa pública do curso ganha dados estruturados JSON-LD `Course`: `name`, `description`, `provider` (Escola de Educação e Saúde CVB-RJ) e `offers` (`price`, `priceCurrency: BRL`, `category: Paid`).
- Sitemap e indexação ficam como estão (etapa 5).

## 4. Pendências que o aluno vê

1. **Compras estornadas ou canceladas:** voltam a aparecer na aba Cursos online (`lib/ead-meus-cursos.js`).
   - Situação `cancelado`, selo "CANCELADO", texto "Pagamento cancelado ou devolvido: o curso fica fechado." e link para a capa.
   - Ficam no fim da lista.
   - Se o curso tem outro acesso (vaga de escola ou nova compra paga), vale o acesso.
2. **Cupom inválido:**
   - não é guardado na sessão (só o válido é);
   - a mensagem de erro vem com o link "tirar" (`?cupom=`).
3. **Textos da capa:**
   - sem a frase "Pagamento único…" quando o curso parcela; com parcelas, fica "À vista no PIX ou em até Nx no cartão.";
   - o visitante com cupom de 100% vê o botão "Criar conta e liberar" (vai a `/criar-conta`; o cupom fica na sessão), e não "Comprar · R$ 0,00".
4. **"Minha escola" no celular:** a tabela da equipe do lote vira cartões abaixo de 640 px (CSS, mesma informação), sem rolagem lateral.
5. **Nome público das dúvidas:** o último sobrenome ignora Neto, Filho, Júnior/Junior, Sobrinho, Segundo e Terceiro (sem diferença de maiúsculas). "João Silva Neto" sai "João S."; "Ana Neto" sai "Ana N.".
6. **Dúvidas da aula:** o bloco mostra as 20 mais recentes e o link "Ver todas as N dúvidas" (`?duvidas=todas#duvidas`). As do próprio aluno não respondidas sempre aparecem.

## 5. Dinheiro e travas

1. **Compra e "Liberar curso" ao mesmo tempo:** `matriculaDaCompra` (`routes/ead-online.js`) usa a mesma trava `compra:<aluno>:<turma>`, dentro de `transacao()`. Matrícula já PAGO ou PARCELADO não volta a PENDENTE.
2. **Lote:**
   - "recebido em" no futuro é recusado ("A data de recebimento não pode ser no futuro."), na criação e na alteração;
   - lote novo com prazo já vencido é recusado ("O prazo precisa ser uma data futura.");
   - `criarLote` grava escola, lote, gestor e convite numa transação só. A conta nova do gestor é criada antes; se o lote falhar, ela é apagada, como no cadastro de funcionário;
   - `alterarLote` (vagas) e `removerGestor` passam pela trava do lote.
3. **Financeiro:**
   - **Pagamentos:** o lote a receber sai da tabela de pagamentos (`/financeiro`) e continua no total "a receber" e na sua lista;
   - **Estornos:** a lista inclui também a matrícula com um `Pagamento` ESTORNADO cujo status atual não é ESTORNADO (comprou de novo depois do estorno), com o valor e a data desse pagamento. Vale para o presencial também. O total estornado soma esses pagamentos uma vez só;
   - **OFX:** cada lote recebido entra como crédito, com a data de recebimento, o valor e a descrição "Lote: <escola> · <curso>". O identificador é `lote-<id>`.

## 6. Passo a passo de publicação

O guia `docs/ead/como-publicar-um-curso.md`, em português simples, para quem usa o painel (DEV). Os passos:
1. Criar o curso (curso existente ou "Curso só online").
2. Módulos, tópicos, telas, perguntas e cenários.
3. Validar cada módulo.
4. Testar pelo link de teste.
5. Preço, parcelas e cupons.
6. Desligar o link de teste.
7. Publicar.
8. Acompanhar alunos, dúvidas e escolas.

Também lista o que não fazer: publicar com o link de teste ligado, ou apagar um curso com alunos.

## 7. PR final para o `main`

- Depois do PR da etapa 8 (base `ead-cupom`), abro o PR `ead-lancamento` → `main`, com todas as etapas.
- **Roteiro de deploy** no PR e em `docs/ead/deploy.md`:
  1. Backup do banco.
  2. Conferir `_prisma_migrations` em produção: só as migrações do EAD (`2026110*_ead_*`) podem estar pendentes (o aviso do PR #92).
  3. `prisma migrate deploy`.
  4. Variáveis de ambiente (as de sempre; nenhuma nova).
  5. Deploy.
  6. Conferir o site e o painel.
  7. Desligar os links de teste.
  8. Não voltar para uma versão anterior depois que existir uma turma ONLINE.
- Os PRs #92 a #98 ficam abertos como histórico até o merge; depois eu os fecho.

## 8. Testes

- **Medição:**
  - a capa do curso pago tem a medição;
  - o link de teste não tem;
  - o retorno do online tem `begin_checkout` com valor e cupom;
  - `purchase` sai uma vez para a matrícula paga há menos de 24 h, com `transaction_id`, e não sai de novo na mesma sessão nem para a vaga de lote nem para pagamento antigo;
  - JSON com `</script>` no nome não quebra a página;
  - a capa tem o JSON-LD `Course` com o preço.
- **Aluno:**
  - estornado e cancelado aparecem com o selo;
  - cupom inválido não fica na sessão e tem "tirar";
  - textos da capa com parcelas e com 100% para visitante;
  - nomes com agnome;
  - 20 dúvidas e "ver todas";
  - cartões da equipe no celular (classe/CSS).
- **Dinheiro:**
  - PIX e "Liberar curso" ao mesmo tempo ⇒ a matrícula termina PAGO, sem voltar a PENDENTE;
  - recebido no futuro e prazo vencido são recusados;
  - falha no meio da criação do lote não deixa escola nem conta sobrando;
  - vagas e gestor sob trava;
  - lote a receber fora da tabela de pagamentos;
  - estorno antigo na lista depois da recompra (online e presencial), total sem duplicar;
  - OFX com o lote recebido.
- A suíte inteira passa.

## 9. Não muda

O painel do EAD (só DEV), o fluxo de compra, as dúvidas, os lotes e os cupons, fora o que está acima. O presencial, fora a lista de Estornos.
