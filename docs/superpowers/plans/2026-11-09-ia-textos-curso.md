# Escrever com IA: descrição, conteúdo e dúvidas do curso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Escrever com IA" nos formulários do curso presencial e do curso só online (o Claude escreve no padrão dos cursos existentes e preenche a tela), dúvidas frequentes na página de venda do curso online, e dúvidas na proposta da criação com IA, que entram no curso sozinhas.

**Architecture:** Lib nova `src/lib/ia-textos.js` (exemplos, pedido ao Claude, validação, gravar dúvidas). Rotas JSON-por-formulário (urlencoded, `_csrf` no corpo) que devolvem os textos; JS externo `src/public/js/ia-textos.js` preenche os campos e monta a lista de dúvidas (caixinhas = inputs `faqsIa[i][...]` do próprio formulário, gravadas ao salvar). Proposta da criação com IA ganha `faqs`; `confirmarRoteiro` grava.

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5, cliente Claude da etapa 9, node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-ia-textos-curso.md`

## Global Constraints

- Tabela das dúvidas: `FaqCurso` (`cursoId`, `pergunta`, `resposta`, `ordem`); novas entram depois das existentes (`ordem` = total atual + i), sem repetir pergunta igual (comparação sem caixa/acentos/espaços nas pontas).
- Limites: presencial `descricao` ≤300, `descricaoLonga` ≤3000, `conteudoProgramatico` ≤4000 (um item por linha); online `descricao` ≤1000; `faqs` 5–6 itens, pergunta ≤200, resposta ≤600; "Ideias para a IA" ≤500 (não é salva).
- Claude: cliente/`MODELO` da etapa 9, `effort: 'low'`; 3 exemplos do mesmo tipo (presencial: `ativo` com `descricaoLonga`; online: `CursoOnline.publicado` e `somenteOnline`), o próprio curso fora dos exemplos.
- Regras do prompt: português do Brasil, tom da Escola, sem preço, sem prometer prática no online (teórico, sem manequim), certificado só ao concluir, não inventar lei/norma ausente dos dados.
- Custo: `IA.somarCustoAvulso`; teto estourado ou sem chave → erro em texto, sem chamar.
- Nada é salvo pelo botão; o JS pergunta antes de substituir campo com texto ("Substituir os textos que você já escreveu?"); JS sem inline (CSP).
- Online: a capa do curso só online mostra "Dúvidas frequentes" (sanfona `<details>`) quando há `FaqCurso`.

## Review Focus

- Resposta do Claude com `faqs` vazio, com 10 itens ou com pergunta repetida: corta em 6, tira repetidas, aceita 0 (não quebra o formulário). → teste na Task 1.
- Salvar o formulário com `faqsIa` adulterado (sem pergunta, com 50 itens, texto gigante): ignora vazio, aceita no máximo 6, corta nos limites. → teste na Task 1 (`lerFaqsDoForm`).
- Falha do Claude (recusa, sem chave, teto): o botão mostra a mensagem e o formulário continua como estava. → teste na Task 2.
- Dúvidas da proposta num curso existente que já tem a mesma pergunta: não duplica. → teste na Task 4.
- Texto do Claude com HTML (`<script>`): aparece como texto (campos de formulário e `<%= %>`), nunca executa. → teste na Task 3 (capa com faq contendo `<script>` escapada).

---

### Task 1: Lib — exemplos, pedido ao Claude, validação, gravar dúvidas

**Files:** Create `src/lib/ia-textos.js`; Modify `src/lib/ead-ia-esquema.js`; Test `test/ia-textos.test.js`.

**Interfaces (Produces):**
- `E.ESQUEMA_TEXTOS_PRESENCIAL` → `{ descricao, descricaoLonga, conteudoProgramatico, faqs:[{pergunta,resposta}] }`; `E.ESQUEMA_TEXTOS_ONLINE` → `{ descricao, faqs }`; `E.validarTextos(json, tipo) -> { descricao, descricaoLonga?, conteudoProgramatico?, faqs }` (corta nos limites; `faqs` sem vazias/repetidas, máx. 6).
- `txt.exemplos(tipo, excetoCursoId) -> Promise<[{ nome, descricao, descricaoLonga?, conteudoProgramatico?, faqs }]>` (até 3).
- `txt.escrever({ tipo:'presencial'|'online', dados:{ nome, cargaHoraria, escolaridade, categoria, descricao, descricaoLonga, conteudoProgramatico }, ideias, cursoId }, { cliente }) -> Promise<{ textos, usage }>`; `txt.definirCliente(c)`.
- `txt.lerFaqsDoForm(body) -> [{pergunta,resposta}]` (lê `faqsIa[i][usar|pergunta|resposta]`, só `usar=1`, máx. 6, cortes).
- `txt.salvarFaqs(cursoId, faqs, { tx } = {}) -> Promise<number>` (acrescenta sem repetir; devolve quantas entraram).
- [ ] Testes que falham: validação (cortes, 10→6, repetidas fora, vazio ok); `escrever` manda 3 exemplos do mesmo tipo (não o próprio curso) e as ideias no texto, `effort: 'low'`, system com "sem preço"/"teórico"; `lerFaqsDoForm` ignora não marcadas, vazias, corta e limita a 6; `salvarFaqs` acrescenta com ordem depois das existentes e não repete pergunta igual (com acento/caixa diferente).
- [ ] Rodar → FAIL; implementar; rodar → PASS; `npm test` verde; commit `feat(ia): textos do curso pelo Claude (lib)`.

### Task 2: Botão "Escrever com IA" nos dois formulários + salvar as dúvidas marcadas

**Files:** Modify `src/routes/admin.js` (`POST /cursos/ia-textos`, criar/editar curso gravam `faqsIa`), `src/routes/ead.js` (`POST /ead/ia-textos`, criar/editar curso só online gravam `faqsIa`), `src/views/admin/curso-form.ejs`, `src/views/admin/ead/curso-online-form.ejs`, `src/views/admin/_ia-textos.ejs` (bloco comum: campo "Ideias para a IA", botão, área das dúvidas), Create `src/public/js/ia-textos.js`, CSS; Test `test/ia-textos-painel.test.js` (rotas do EAD com `montarPainel`).

**Interfaces:** rota devolve JSON `{ ok:true, textos }` ou `{ ok:false, erro }` (status 200, para o JS mostrar). O JS lê `data-ia-textos-url` e `data-tipo` do bloco, manda o formulário (`FormData` → `URLSearchParams`, sem o arquivo) e preenche `[name=descricao]`, `[name=descricaoLonga]`, `[name=conteudoProgramatico]`; as dúvidas viram linhas com caixinha `faqsIa[i][usar]` (marcada), `faqsIa[i][pergunta]`, `faqsIa[i][resposta]` editáveis.
- [ ] Testes que falham (EAD): `POST /ead/ia-textos` devolve os textos do Claude falso e soma custo avulso; teto estourado → `{ok:false}` sem chamar; criar curso só online com 3 `faqsIa` (2 marcadas) grava 2 `FaqCurso`; editar idem acrescentando; formulário tem `data-ia-textos-url` e `<script src=".../ia-textos.js">`, sem script inline.
- [ ] Rodar → FAIL; implementar (admin.js com a mesma lib; sem teste de rota — `setInterval` no módulo — coberto pela lib e por print no servidor local); PASS; `npm test`; commit `feat(painel): escrever com IA nos formulários do curso`.

### Task 3: Dúvidas na página de venda do curso online + lista no formulário

**Files:** Modify `src/routes/ead-teste.js` (capa carrega `FaqCurso` do curso), `src/views/ead-teste/capa.ejs` (seção "Dúvidas frequentes", `<details>`), `src/routes/ead.js` (`POST /ead/curso/:id/faqs`, `POST /ead/curso/:id/faqs/:faqId/remover`; editar curso só online mostra a lista), `src/views/admin/ead/curso-online-form.ejs`; Test `test/ia-textos-capa.test.js`.
- [ ] Testes que falham: capa do curso só online com 2 dúvidas mostra "Dúvidas frequentes" e as duas em `<details>`; sem dúvidas a seção não aparece; dúvida com `<script>` aparece escapada; adicionar e remover pelo painel funcionam (auditados `ADICIONOU_FAQ`/`REMOVEU_FAQ`).
- [ ] Rodar → FAIL; implementar; PASS; `npm test`; commit `feat(escola-digital): dúvidas frequentes no curso online`.

### Task 4: Dúvidas na proposta da criação com IA, gravadas ao criar

**Files:** Modify `src/lib/ead-ia-esquema.js` (`ESQUEMA_PROPOSTA` + `faqs`; `validarProposta` corta), `src/lib/ead-ia.js` (prompt da proposta pede 5–6 dúvidas; `confirmarProposta` guarda as dúvidas conferidas em `pedido.faqs`; `confirmarRoteiro` chama `txt.salvarFaqs` no curso novo ou existente), `src/routes/ead.js` (`lerPedidoIa`/rota da proposta leem `faqsIa`), `src/views/admin/ead/ia-geracao.ejs` (lista editável das dúvidas no passo 2, mesmo bloco do JS), `test/helpers/ia-falso.js` (`propostaBoa` com `faqs`); Test `test/ead-ia-proposta.test.js`, `test/ead-ia-passos-painel.test.js`.
- [ ] Testes que falham: proposta com 6 dúvidas aparece no passo 2 com caixinhas; confirmar com 4 marcadas → `pedido.faqs` tem 4; confirmar o roteiro (curso novo) grava as 4 `FaqCurso`; curso existente que já tem uma das perguntas: grava só as 3 novas.
- [ ] Rodar → FAIL; implementar; PASS; `npm test`; prints (formulário presencial preenchido; curso online com dúvidas; passo 2 com dúvidas); commit `feat(ead-ia): dúvidas frequentes na proposta, gravadas no curso`.
