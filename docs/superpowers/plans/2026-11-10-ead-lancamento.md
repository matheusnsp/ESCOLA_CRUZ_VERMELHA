# EAD etapa 8 (lançamento) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medição de visitas e vendas do curso online, as pendências que o aluno vê e as de dinheiro, o guia de publicação e o roteiro de deploy.

**Architecture:**
- `src/lib/ead-medicao.js` monta os dados dos eventos e do JSON-LD; as views só escrevem.
- As correções ficam onde o defeito está: `ead-meus-cursos`, capa, `ead-duvidas`, `ead-online`, `ead-lote` e `/financeiro` em `admin.js`, além de `relatorio.js` (OFX).
- A documentação fica em `docs/ead/`.

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5/Postgres, node:test.

**Spec:** `docs/superpowers/specs/2026-11-10-ead-lancamento.md`

## Global Constraints

- Painel do EAD continua só DEV; nenhuma migração nesta etapa.
- Medição só nas páginas do curso pago (`req.ead.modo === 'pago'`) e na tela de retorno; nunca no link de teste.
- Eventos: `begin_checkout`/`InitiateCheckout` e `purchase`/`Purchase`, `currency: 'BRL'`, `transaction_id` = id da matrícula (também `eventID` da Meta).
- JSON dentro de `<script>`: sempre por `jsonSeguro()` (troca `<` por `<`).
- Mensagens exatas:
  - "A data de recebimento não pode ser no futuro.";
  - "O prazo precisa ser uma data futura.";
  - "Pagamento cancelado ou devolvido: o curso fica fechado.";
  - "À vista no PIX ou em até Nx no cartão.";
  - "Criar conta e liberar";
  - "Ver todas as N dúvidas".
- Agnomes ignorados: Neto, Filho, Júnior, Junior, Sobrinho, Segundo, Terceiro.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01CfLp5MfEj2LNthwUowXT7T`.

## Review Focus

1. Nome com `</script>` ou aspas (nome do curso, código de cupom) dentro do JSON dos eventos: a página não pode quebrar nem executar nada → teste na Task 1.
2. Nome só com agnome depois do primeiro ("João Neto", duas palavras): sai "João N.", sem sumir o sobrenome → teste na Task 2.
3. Matrícula estornada de novo depois da recompra (status ESTORNADO, com dois `Pagamento` ESTORNADO): o total estornado não pode contar duas vezes o mesmo dinheiro → teste na Task 4.
4. Aluno com compra cancelada e vaga de escola no mesmo curso: vale o acesso pela escola, um item só → teste na Task 2.
5. "Recebido em" = hoje (data do formulário, meio-dia no Rio) não pode ser recusado como futuro → teste na Task 3.

---

### Task 1: Medição (Analytics/Pixel, eventos, JSON-LD)

**Files:**
- Create: `src/lib/ead-medicao.js`
- Modify:
  - `src/views/ead-teste/_topo.ejs`: inclui `partials/rastreamento` quando `typeof medir !== 'undefined' && medir`; escreve os eventos de `eventosMedicao`;
  - `src/routes/ead-teste.js`: no modo pago, passa `medir: true`, o `purchase` (`compraParaMedir`) e o JSON-LD na capa;
  - `src/views/ead-teste/capa.ejs`: o `<script type="application/ld+json">`;
  - `src/routes/cursos.js` e `src/views/inscricao-retorno.ejs`: o `begin_checkout` na tela de retorno da turma ONLINE.
- Test: `test/ead-medicao.test.js`

**Interfaces:**
- Produces:
  - `jsonSeguro(obj) → string`: `JSON.stringify` com `<` virando `<`.
  - `dadosItem(co, curso) → { item_id, item_name }`: `item_id` = `co.cursoId`, `item_name` = `curso.nome`.
  - `eventoInicioCompra(matricula, cursoNome, cupomCodigo|null) → { ga: ['begin_checkout', {...}], meta: ['InitiateCheckout', {...}] }`.
  - `async compraParaMedir(req, co, acesso) → { ga: ['purchase', {...}], meta: ['Purchase', {...}, { eventID }] } | null`. Regras:
    - só com `acesso.matricula` PAGO/PARCELADO e `confirmadaEm` há menos de 24 h;
    - `req.session.eadMedidas` (array de ids, guarda no máximo os 50 últimos) ainda sem esse id; ao devolver, grava o id;
    - `coupon` vem de `CupomMatriculaEad`;
    - vaga de lote ⇒ `null`.
  - `jsonLdCurso(co, curso, urlSite) → object`: `@type: 'Course'`, `name`, `description`, `provider: { @type: 'Organization', name: 'Escola de Educação e Saúde CVB-RJ' }`, `offers: { @type: 'Offer', price, priceCurrency: 'BRL', category: 'Paid' }`.

- [ ] **Step 1: Testes.** Funções puras:
  - `jsonSeguro({ n: '</script>' })` não contém `</script>`;
  - `eventoInicioCompra` com cupom ⇒ `ga[1]` igual a `{ currency: 'BRL', value: 44.91, coupon: 'LEI10', items: [{ item_id, item_name }] }`.

  Rotas, no padrão de `test/ead-online.test.js`:
  - a capa do curso pago contém `G-HDYZZ5JZHF`;
  - a capa pelo link de teste (`/ead-teste/<codigo>`) não contém;
  - aluna com matrícula PAGO confirmada agora ⇒ a 1ª capa tem `'purchase'` e o id da matrícula, a 2ª não;
  - confirmada há 2 dias ⇒ sem `purchase`;
  - vaga de lote ⇒ sem `purchase`;
  - Review Focus 1: curso com nome `Curso </script><script>alert(1)</script>` ⇒ o HTML não contém `</script><script>alert(1)`;
  - a capa pública tem `"@type":"Course"` e `"price":49.9`;
  - retorno (`/inscricao/retorno?matriculaId=…&pix=1`) de matrícula ONLINE tem `'begin_checkout'` com `"value":49.9`.
- [ ] **Step 2:** `node --test test/ead-medicao.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar. O `_topo.ejs` escreve:

  ```html
  <script>gtag('event', ...)</script>
  <script>fbq('track', ...)</script>
  ```

  `gtag`/`fbq` já existem depois do `rastreamento`. Na tela de retorno o rastreamento já vem do `site-head`, então só escreve o evento.
- [ ] **Step 4:** `node --test test/ead-medicao.test.js test/ead-online.test.js test/ead-teste-rotas.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(ead): Analytics, eventos de compra e dados estruturados do curso online`.

### Task 2: Pendências que o aluno vê

**Files:**
- Modify:
  - `src/lib/ead-meus-cursos.js` (situação `cancelado`) e `src/views/minha-conta.ejs` (selo e texto);
  - `src/routes/ead-teste.js` (`cupomDaCapa`: só guarda na sessão o cupom válido) e `src/views/ead-teste/capa.ejs` ("tirar" junto do erro, textos da capa, botão do visitante com 100%);
  - `src/lib/ead-duvidas.js` (`nomePublico`; `duvidasDaTela(telaId, alunoCursoId, { todas })` → `{ lista, total }`), `src/views/ead-teste/_duvidas.ejs` e a rota da tela (`?duvidas=todas`);
  - `src/public/ead.css` (`.esc-tabela` vira cartões abaixo de 640 px, com `data-rotulo` em cada `<td>` de `views/escola/lote.ejs`).
- Test: `test/ead-pendencias-aluno.test.js` e os ajustes em `test/ead-duvidas.test.js` (novo retorno de `duvidasDaTela`).

**Interfaces:**
- Produces:
  - `meusCursosOnline` ganha a situação `'cancelado'` (matrícula ESTORNADO/CANCELADO sem outro acesso), com `ORDEM.cancelado = 4` e `link` para a capa;
  - `duvidasDaTela(telaId, alunoCursoId, { todas = false } = {}) → { lista, total }`: sem `todas`, as 20 mais recentes das respondidas, mais todas as do próprio aluno não respondidas; `total` conta todas as visíveis.

- [ ] **Step 1: Testes.**
  - Estornada e cancelada ⇒ itens com `situacao: 'cancelado'`, no fim.
  - Review Focus 4: estornada + vaga de escola no mesmo curso ⇒ 1 item, `origem: 'escola'`.
  - Aba mostra "Pagamento cancelado ou devolvido: o curso fica fechado.".
  - `?cupom=NADA` ⇒ a mensagem com `href="…?cupom="` ("tirar"); a próxima capa sem query não mostra erro (não guardou).
  - Curso com `maxParcelas` 6 ⇒ "À vista no PIX ou em até 6x no cartão." e sem "Pagamento único".
  - Visitante com cupom 100% ⇒ "Criar conta e liberar" e não "R$ 0,00".
  - Nomes:
    - `nomePublico('João Silva Neto') === 'João S.'`;
    - `'maria souza filho' → 'Maria S.'`;
    - `'Pedro Alves Júnior' → 'Pedro A.'`;
    - Review Focus 2: `'João Neto' → 'João N.'`;
    - `'Ana' → 'Ana'`.
  - 25 respondidas ⇒ `lista.length === 20`, `total === 25`; `{ todas: true }` ⇒ 25. A tela mostra "Ver todas as 25 dúvidas".
  - `views/escola/lote.ejs` tem `data-rotulo` nas células e `ead.css` tem `@media (max-width: 640px)` para `.esc-tabela`.
- [ ] **Step 2:** `node --test test/ead-pendencias-aluno.test.js` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `node --test test/ead-pendencias-aluno.test.js test/ead-duvidas.test.js test/ead-duvidas-rotas.test.js test/ead-meus-cursos.test.js test/ead-cupom-compra.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(ead): pendências que o aluno vê (cancelados, cupom, capa, nomes, dúvidas, celular)`.

### Task 3: Travas da compra e do lote

**Files:**
- Modify: `src/routes/ead-online.js` (`matriculaDaCompra` dentro de `transacao()` com a trava `compra:<aluno>:<turma>`), `src/lib/ead-lote.js` (`criarLote`, `alterarLote`, `removerGestor`)
- Test: `test/ead-travas.test.js`

**Interfaces:**
- Produces: as mensagens do Global Constraints em `{ ok: false, erro }` de `criarLote`/`alterarLote`. "Futuro" = depois do fim do dia de hoje no Rio.

- [ ] **Step 1: Testes.**
  - "Liberar curso" e POST PIX em paralelo (10 rodadas, cada uma com aluno novo) ⇒ toda matrícula termina PAGO, com `valorCurso` 0.
  - `criarLote` com `recebidoEm` amanhã ⇒ erro; Review Focus 5: com hoje ao meio-dia no Rio ⇒ ok.
  - Prazo ontem ⇒ erro "O prazo precisa ser uma data futura.".
  - `alterarLote` com recebido amanhã ⇒ erro.
  - `criarLote` com o lote falhando (força: `cursoOnlineId` de curso apagado) ⇒ nenhuma `EscolaEad` nova e nenhuma conta nova do gestor.
  - `alterarLote({ vagas: 1 })` em paralelo com 2 cadastros num lote de 3 ⇒ vagas nunca abaixo das usadas.
- [ ] **Step 2:** `node --test test/ead-travas.test.js` → FAIL.
- [ ] **Step 3:** Implementar. `criarLote`:
  - cria a conta do gestor (`contaParaPessoa`) antes;
  - abre `transacao` para escola + lote + gestor;
  - no erro, apaga a conta se ela foi criada agora (como `cadastrarFuncionario`).
- [ ] **Step 4:** `node --test test/ead-travas.test.js test/ead-lote.test.js test/ead-lote-painel.test.js test/ead-cupom-compra.test.js test/ead-online.test.js` → PASS.
- [ ] **Step 5: Commit** `fix(ead): travas da compra e do lote`.

### Task 4: Financeiro (lote a receber, estornos antigos, OFX)

**Files:**
- Modify:
  - `src/routes/admin.js` (`/financeiro`, ~1987–2205): sem linhas `lote_a_receber` na tabela de pagamentos; os estornos de recompra;
  - `src/views/admin/financeiro.ejs`;
  - `src/lib/relatorio.js` (`coletarLancamentosOfx` soma os lotes recebidos no período).
- Test: `test/financeiro-estornos-lotes.test.js`

**Interfaces:**
- Consumes: `lotesRecebidos({ de, ate })` (`lib/ead-lote.js`, etapa 6).
- Produces:
  - Estornos de recompra: `Pagamento` com `status: 'ESTORNADO', tipo: 'CURSO'` cuja matrícula não está ESTORNADO entram como `{ m, tipo: 'estornado', valor: Number(p.valor), data: p.atualizadoEm }`.
  - `totalEstornado` = soma das matrículas ESTORNADO (como hoje) + soma desses pagamentos.
  - OFX de lote: `{ fitid: 'LOTE' + id sem hífens (32 chars), data: recebidoEm, valor, tipoTrn: 'CREDIT', memo: 'Lote: <escola> · <curso>' }`.

- [ ] **Step 1: Testes** (Postgres local):
  - lote a receber não aparece entre as linhas `pagamentos`/`lotesLinhas` da tabela, mas o total a receber o inclui (como hoje);
  - matrícula estornada e comprada de novo (status PAGO, um `Pagamento` ESTORNADO de 49,90) ⇒ a lista de estornos tem a linha e `totalEstornado` sobe 49,90;
  - Review Focus 3: estornada de novo (status ESTORNADO, dois `Pagamento` ESTORNADO) ⇒ a soma conta a matrícula uma vez (`valorCurso`) mais o pagamento antigo, nunca 3×;
  - um caso presencial igual ao do online;
  - `coletarLancamentosOfx(prisma, { de, ate })` traz o lote recebido no período com o `fitid` e o memo acima, e não traz o de fora.
- [ ] **Step 2:** `node --test test/financeiro-estornos-lotes.test.js` → FAIL.
- [ ] **Step 3:** Implementar. Para chamar no teste sem subir o painel, extrair de `admin.js` a função pura `estornosDeRecompra(prisma, { contaFiltro })`.
- [ ] **Step 4:** `node --test test/financeiro-estornos-lotes.test.js test/ead-lote-financeiro.test.js` → PASS, depois `npm test > /tmp/claude-0/suite8.log 2>&1; tail -5 /tmp/claude-0/suite8.log` → todos passam.
- [ ] **Step 5: Commit** `fix(financeiro): estornos de recompra, lote a receber fora da tabela e lotes no OFX`.

### Task 5: Guia de publicação e roteiro de deploy

**Files:**
- Create: `docs/ead/como-publicar-um-curso.md`, `docs/ead/deploy.md`
- Test: `test/ead-docs.test.js` (os dois arquivos existem; o guia cita "link de teste", "Validar" e "Publicar"; o deploy cita `_prisma_migrations`, `prisma migrate deploy` e as 6 pastas `prisma/migrations/2026110*_ead_*` que existem no repositório (estrutura, aluno, venda, duvidas, lote, cupom))

- [ ] **Step 1:** Teste.
- [ ] **Step 2:** `node --test test/ead-docs.test.js` → FAIL.
- [ ] **Step 3:** Escrever os dois guias com os passos do spec §6 e §7. O deploy lista as migrações pelo nome real (`ls prisma/migrations | grep ead`).
- [ ] **Step 4:** `node --test test/ead-docs.test.js` → PASS.
- [ ] **Step 5: Commit** `docs(ead): guia de publicação e roteiro de deploy`.

### Task 6: Links do curso online pelo nome (pedido do Matheus durante a execução)

**Files:**
- Modify: `src/lib/vitrine.js` (`urlOnline(curso) → '/online/' + slugCurso(curso.nome)`) e todos os pontos que montavam `/online/<id>`:
  - views: catálogo, caixa do presencial e Minha conta;
  - e-mails: curso liberado, vaga da escola e dúvida respondida;
  - destino depois do pagamento, painel ("Abrir a página do curso"), sitemap, `/cursos/<nome>` do curso só online, convite da escola, JSON-LD.
- Modify: `src/routes/ead-teste.js` e `_topo.ejs`: o endereço com o id continua abrindo; a página leva `<link rel="canonical">` para o endereço com o nome.
- Test: `test/ead-links-nome.test.js`, mais os testes antigos que conferiam o link com o id.

- [ ] **Step 1:** Testes:
  - `urlOnline` monta o endereço com o nome;
  - nenhum arquivo monta `/online/<id>`;
  - o endereço com o nome abre;
  - o endereço com o id abre e tem o canonical;
  - Minha conta e o retorno levam ao nome.
- [ ] **Step 2:** `node --test test/ead-links-nome.test.js` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → todos passam.
- [ ] **Step 5: Commit** `feat(ead): links do curso online pelo nome do curso`.
