# Escola Digital: vitrine estilo Netflix + curso gratuito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/escola-digital` vira vitrine estilo Netflix (clara) com destaque e carrosséis, e o curso online pode ser gratuito (liberado com um clique, só com conta).

**Architecture:** Dois campos novos em `CursoOnline` (`gratuito`, `ordemVitrine`) e o destaque em `Configuracao`. A montagem da página fica num lib novo (`escola-digital-vitrine.js`), a liberação grátis reaproveita a liberação do cupom de 100% em `ead-online.js`. Views EJS novas só da Escola Digital; JS do carrossel em arquivo externo (CSP).

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5 / Postgres, node:test (`npm test`, serial).

**Spec:** `docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md`

## Global Constraints

- Conta obrigatória: liberar/comprar/acessar só logado, inclusive grátis; vitrine e página do produto são públicas.
- Nunca mostrar vagas ocupadas ou restantes (nenhum "vaga", "restam", "ocupad" na vitrine).
- Visual claro, cores do site; sem JS inline (CSP) — scripts via `asset()`.
- Migração só acrescenta colunas com default (`gratuito Boolean @default(false)`, `ordemVitrine Int @default(0)`).
- Chave do destaque: `escola-digital:destaque` em `Configuracao`; cache de 30 s, limpo ao salvar.
- Escola Digital desligada: `/escola-digital` continua 404; liberar grátis não funciona para quem não tem o curso.
- Textos: "Grátis", "Quero estudar · Grátis", "Criar conta e liberar", "Você já tem", "Continue de onde parou", "Cursos online", "Gratuitos", "Defina o preço do curso online (ou marque Gratuito).", origem "Gratuito".

## Review Focus

- Curso grátis em lugares que hoje tratam preço 0/nulo como "não está à venda" (selo do catálogo presencial, sitemap, capa, cupom): deve aparecer como "Grátis", nunca sumir nem mostrar "R$ 0,00" ou "Em breve". → teste na Task 1 (anexarOnline/cursosDaEscolaDigital) e Task 3 (capa).
- Cupom aplicado (sessão ou `?cupom=`) num curso que virou grátis: não pode mostrar o campo nem aplicar desconto. → teste na Task 3.
- Curso que deixou de ser grátis com aluno já liberado: continua com acesso; "Minha conta" continua "Gratuito". → teste na Task 3.
- Destaque apontando para curso despublicado ou apagado: a vitrine não quebra, cai no automático. → teste na Task 4.
- Aluno logado que é DEV/secretaria vendo a vitrine: sem "Continue de onde parou", sem erro. → teste na Task 4.

---

### Task 1: Dados — migração, preço/grátis e destaque

**Files:**
- Create: `prisma/migrations/20261109120000_escola_digital_vitrine/migration.sql`
- Modify: `prisma/schema.prisma` (model `CursoOnline`)
- Modify: `src/lib/ead-publicacao.js`, `src/lib/escola-digital.js`, `src/views/partials/v-card-cat.ejs` (preço → "Grátis")
- Test: `test/escola-digital-vitrine-dados.test.js`

**Interfaces:**
- Produces:
  - `publicacao.temPreco(co) -> boolean` (exportado): `co.gratuito === true` ou `precoOnline > 0`.
  - `publicacao.podePublicar(co)`: pendência de preço com o texto `'Defina o preço do curso online (ou marque Gratuito).'`.
  - `publicacao.cursosOnlinePublicados() -> Map<cursoId, { preco:number, gratis:boolean }>`; `anexarOnline` põe `curso.online = { preco, gratis }` ou `null`. (Consumidores que liam `mapa.get(id)` como número passam a ler `.preco`.)
  - `escolaDigital.CHAVE_DESTAQUE = 'escola-digital:destaque'`; `lerDestaque() -> Promise<string|null>` (cache 30 s); `definirDestaque(cursoOnlineId|null, req) -> Promise<{erro?:string}>` (erro `'Escolha um curso online publicado.'` se o id não é de curso publicado; null apaga a chave; audita `ESCOLA_DIGITAL_DESTAQUE`).
  - `escolaDigital.cursosDaEscolaDigital()`: publicados com `gratuito` OU `precoOnline > 0`, ordenados por `ordemVitrine` asc e nome asc; cada curso com `online: { preco, gratis, maxParcelas, cursoOnlineId, somenteOnline: true }`.

- [ ] **Step 1: Testes que falham** (`test/escola-digital-vitrine-dados.test.js`, Postgres local, padrão de `test/escola-digital.test.js`):
  - `temPreco`: `{gratuito:true, precoOnline:0}` → true; `{precoOnline:null}` → false; `{precoOnline:49.9}` → true.
  - `podePublicar({gratuito:true, precoOnline:0, modulos:[{titulo:'M',status:'VALIDADO'}]})` → `[]`; sem preço e não grátis → contém `'Defina o preço do curso online (ou marque Gratuito).'`.
  - `cursosDaEscolaDigital()` inclui o curso grátis publicado com `online.gratis === true` e `online.preco === 0`, e respeita `ordemVitrine` (curso com ordem 0 antes do de ordem 1, mesmo com nome alfabeticamente depois).
  - `anexarOnline([curso grátis publicado])` → `online.gratis === true`.
  - `definirDestaque(idPublicado)` grava; `lerDestaque()` devolve o id; `definirDestaque(idNaoPublicado)` → `{erro:'Escolha um curso online publicado.'}`; `definirDestaque(null)` → `lerDestaque() === null`.
- [ ] **Step 2:** `node --test test/escola-digital-vitrine-dados.test.js` → FAIL (coluna `gratuito` não existe / funções não definidas).
- [ ] **Step 3:** Schema + migração (`ALTER TABLE "CursoOnline" ADD COLUMN "gratuito" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "ordemVitrine" INTEGER NOT NULL DEFAULT 0;`), `npx prisma migrate deploy && npx prisma generate`. Implementar as interfaces acima. Em `v-card-cat.ejs`, `curso.online.gratis` mostra `Grátis` no lugar de `vitrine.reais(...)`. Ajustar os outros consumidores de `cursosOnlinePublicados` (grep) para `.preco`.
- [ ] **Step 4:** O teste da Task passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(escola-digital): curso gratuito e ordem/destaque da vitrine nos dados`.

### Task 2: Secretaria — "Curso gratuito" e caixa "Vitrine"

**Files:**
- Modify: `src/routes/ead.js` (rotas novas; publicar põe no fim da ordem; página `/ead` e `/ead/curso/:id` recebem os dados), `src/views/admin/ead/cursos.ejs`, a view da página do curso online (bloco de preço/parcelas/cupons)
- Test: `test/escola-digital-vitrine-painel.test.js` (helpers `test/helpers/painel-ead.js`)

**Interfaces:**
- Consumes: Task 1 (`definirDestaque`, `lerDestaque`, `temPreco`, campos).
- Produces (rotas do painel, todas POST com CSRF como as demais, redirect + flash):
  - `POST /ead/curso/:id/gratuito` body `gratuito=1|0`. `1` → `{gratuito:true, precoOnline:0, maxParcelas:1}`, flash `'Curso marcado como gratuito.'`; `0` → `{gratuito:false, precoOnline:null}`, flash `'Curso deixou de ser gratuito: defina o preço.'`. Audita `EAD_GRATUITO`. Recusa `1` se o curso tem cupom ativo: `'Este curso tem cupom ativo. Desative os cupons antes de marcar como gratuito.'`.
  - `POST /ead/curso/:id/preco`: com `gratuito` true, recusa com `'Desmarque "Curso gratuito" para definir um preço.'`.
  - `POST /ead/escola-digital/destaque` body `cursoOnlineId` (vazio = automático), flash `'Destaque salvo.'`.
  - `POST /ead/escola-digital/ordem/:id/:dir` (`dir` = `subir|descer`): troca `ordemVitrine` com o vizinho na lista de publicados (renumera 0..n-1 antes de trocar).
  - `POST /ead/curso/:id/publicar` (já existe): ao publicar, `ordemVitrine = max(ordemVitrine dos publicados) + 1`.

- [ ] **Step 1: Testes que falham:** marcar gratuito zera preço e parcelas, e publicar sem preço passa; desmarcar deixa `precoOnline` null e publicar volta a pedir preço; POST `/preco` em curso grátis recusa; marcar grátis com cupom ativo recusa; página `/ead/curso/:id` de curso grátis não tem `name="precoOnline"` habilitado nem o link/área de cupons e tem `name="gratuito"` marcado; `/ead` lista os publicados na caixa "Vitrine" com o `<select name="cursoOnlineId">`; destaque salvo aparece `selected`; `subir` no 2º põe ele em 1º; publicar curso novo o põe no fim.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar rotas e views (caixa "Vitrine" dentro da caixa do interruptor em `cursos.ejs`, com "Ver a vitrine no site ↗"; checkbox "Curso gratuito" num form próprio no bloco do preço; com grátis, campo de preço e parcelas `disabled` e a área de cupons do curso oculta).
- [ ] **Step 4:** teste passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(painel): curso gratuito e vitrine (destaque e ordem) na Escola Digital`.

### Task 3: Liberar grátis no site (só com conta) e "Minha conta"

**Files:**
- Modify: `src/routes/ead-online.js` (forma `GRATIS`; generalizar `liberarPorCupom` em `liberarSemPagamento(alunoId, turmaId, { confirmadaPor, cupom? })`), `src/routes/ead-teste.js` (`compraDaCapa`: `gratuito`), `src/views/ead-teste/capa.ejs`, `src/lib/ead-meus-cursos.js` (origem `gratuito`), view de "Minha conta" (rótulo "Gratuito")
- Test: `test/escola-digital-gratis.test.js` (padrão de `test/escola-digital-cupom-compra.test.js`)

**Interfaces:**
- Consumes: Task 1 (`gratuito`).
- Produces: `compra.gratuito: boolean` na capa (e `compra.preco === 0` com ele); origem `'gratuito'` em `meusCursosOnline` quando `matricula.confirmadaPor === 'gratuito'`; auditoria `EAD_GRATIS_LIBEROU` (alvo CursoOnline, `{ matriculaId }`).

- [ ] **Step 1: Testes que falham:**
  - visitante: POST `/escola-digital/<slug>/comprar` `forma=GRATIS` → redirect para o login, `matricula.count` inalterado; capa de visitante tem `Criar conta e liberar` e não tem `Quero estudar`.
  - aluno logado **sem CPF** no cadastro: POST `forma=GRATIS` → 302 para `/continuar`; matrícula `PAGO`, `valorCurso` 0, `confirmadaPor 'gratuito'`, nenhum `Pagamento`; dois POSTs → 1 matrícula e 1 auditoria `EAD_GRATIS_LIBEROU`.
  - `forma=GRATIS` em curso pago → volta à capa, nada gravado; curso grátis não publicado → nada; Escola Digital desligada → nada; sessão DEV → nada.
  - capa do curso grátis (aluno logado): tem `Grátis.` e `Quero estudar · Grátis`, não tem `name="cupom"` nem `value="PIX"`; com `?cupom=QUALQUER` continua sem cupom aplicado.
  - pendência: aluno com PIX `PENDENTE` do curso que virou grátis libera e o pagamento fica `CANCELADO`.
  - `meusCursosOnline` do aluno liberado → `origem === 'gratuito'`; depois de o curso voltar a ser pago (`gratuito:false, precoOnline:30`), continua com acesso (`/continuar` não manda para a capa de compra) e origem `gratuito`; "Minha conta" mostra `Gratuito`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. `GRATIS` passa pelas mesmas travas da compra (requireLogin, papel ALUNO, publicado, Escola Digital ligada), exige `co.gratuito`, não confere CPF, não usa cupom. `cupomDaCapa` devolve `{cupom:null}` para curso grátis. Capa: preço `Grátis.`, sem cupom, form com `forma=GRATIS` e botão `Quero estudar · Grátis`; visitante `Criar conta e liberar` (link `/criar-conta` existente).
- [ ] **Step 4:** teste passa; `npm test` verde (os testes de cupom de 100% continuam passando).
- [ ] **Step 5:** Commit `feat(escola-digital): liberar curso gratuito com conta`.

### Task 4: A vitrine estilo Netflix

**Files:**
- Create: `src/lib/escola-digital-vitrine.js`, `src/views/partials/ed-card.ejs`, `src/public/escola-digital-vitrine.js`
- Modify: `src/routes/cursos.js` (rota `/escola-digital`), `src/views/escola-digital.ejs`, CSS do site (arquivo onde estão as classes `v-ed-*`)
- Modify: `docs/ead/como-publicar-um-curso.md` (seção "Vitrine e curso gratuito")
- Test: `test/escola-digital-vitrine.test.js`

**Interfaces:**
- Consumes: Task 1 (`cursosDaEscolaDigital`, `lerDestaque`), `meusCursosOnline(usuarioId)` (lista com `cursoId`, `situacao`, `percentual`, `link`).
- Produces: `montarVitrine(cursos, usuario) -> Promise<{ destaque, continuar, cursos, gratuitos }>`:
  - `cursos` = lista pública (cacheada) com `jaTem: true` nos que o aluno tem;
  - `destaque` = o curso de `lerDestaque()` se estiver na lista, senão `cursos[0]`, senão `null`;
  - `continuar` = só para `usuario.papel === 'ALUNO'`: itens de `meusCursosOnline` com `situacao` em `['novo','andamento']`; senão `[]`;
  - `gratuitos` = `cursos.filter(c => c.online.gratis)`.

- [ ] **Step 1: Testes que falham:**
  - hero (`class="ed-hero"`) com o nome do curso destaque; sem destaque, o primeiro da ordem; destaque despublicado → o primeiro da ordem, sem erro.
  - linha `Cursos online` com os cards na ordem `ordemVitrine`; linha `Gratuitos` só se houver grátis (some quando não há).
  - `Continue de onde parou` com o percentual (`width: N%`) para aluno com curso em andamento; ausente para visitante e para DEV.
  - card do curso que o aluno tem mostra `Você já tem` e o hero desse curso mostra `Continuar`; visitante vê `Ver curso`.
  - card grátis mostra `Grátis`; card com `maxParcelas` 3 mostra `ou 3× no cartão`.
  - página não contém `/vaga|restam|ocupad/i`; desligada → 404; sem cursos → `Novos cursos online em breve.`.
  - a página carrega `escola-digital-vitrine` via `<script src=` e não tem `<script>` inline.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. A lista pública continua em `catalogo(res, 'escola-digital', …)`; `montarVitrine` roda fora do cache. Carrossel: `ul.ed-linha` com `overflow-x:auto; scroll-snap-type:x mandatory`, cards ~70% da largura no celular, setas `button.ed-seta` (ocultas no celular) que o JS liga com `scrollBy`. Hero com `Curso.imagemUrl` de fundo (style com url escapada) e véu; sem foto, o fundo vermelho padrão. Descrição cortada em ~160 caracteres no espaço.
- [ ] **Step 4:** teste passa; `npm test` verde. Prints computador e celular (vitrine com destaque, linhas, card grátis; capa grátis; caixa "Vitrine" e "Curso gratuito" no painel) em `scratchpad/vitrine-fase1/`.
- [ ] **Step 5:** Commit `feat(escola-digital): vitrine estilo Netflix com destaque e carrosséis`.
