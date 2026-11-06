# EAD etapa 5 — dúvidas por aula, central e curso só online — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dúvidas por tela do curso online (públicas só depois de respondidas), central no painel (DEV) para responder, e criação de curso que só existe online.

**Architecture:**
- **Dúvidas:** uma tabela nova `DuvidaEad`, com as regras em `src/lib/ead-duvidas.js`.
  - O lado do aluno fica em `routes/ead-teste.js`, que serve os modos teste e pago.
  - A central fica em `routes/ead.js`.
- **Curso só online:** é um `Curso` com `ativo false` mais `CursoOnline.somenteOnline`, criado e editado por `src/lib/ead-curso-online.js`.
  - O presencial o esconde por uma lista de ids lida à parte, tolerante a erro, como o selo da etapa 4.
  - O catálogo o mostra com link para `/online/<id>`.

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5/Postgres, node:test, exceljs (já existe).

**Spec:** `docs/superpowers/specs/2026-11-07-ead-duvidas.md`

## Global Constraints

- **Migração:** só acrescenta. Tem de passar em `node scripts/checar-migracao-ead.js`, com `DuvidaEad` em `TABELAS_EAD`; a coluna nova fica só em `CursoOnline`.
- **Acesso:** o EAD no painel é só DEV (`requireDev`). Nada do curso só online aparece no presencial.
- **Transações:** interativas só por `transacao()` (`lib/transacao.js`). Trava de status com `updateMany` condicional, como em `aplicarStatus`.
- **Texto das dúvidas:**
  - pergunta de 10 a 1000 caracteres; resposta de 1 a 2000;
  - máximo de 5 AGUARDANDO por aluno em cada curso;
  - nome público "Primeiro S.".
- **Textos fixos da spec (copiar exatamente):**
  - o aviso do formulário (§4);
  - "Sua dúvida foi respondida";
  - "aguardando resposta" e "não publicada";
  - "Dúvidas desta aula";
  - "Entre para mandar uma dúvida".
- **Front:** CSP sem JS inline em atributo; confirmações com `data-confirmar`.
- **Testes e commits:** testes no Postgres local, com o e-mail trocado por espião. Commits sem identificador de modelo.

## Review Focus

- **HTML ou script digitado na dúvida ou na resposta:** aparece como texto, com as quebras de linha preservadas, nunca executado. Teste na Task 3.
- **Duas respostas à mesma dúvida ao mesmo tempo:** gravam uma resposta e mandam um e-mail só. Teste na Task 2.
- **Nomes reais no nome público:** espaços sobrando, minúsculas, partícula ou nome de uma palavra só ("maria  da silva" ⇒ "Maria S."; "Ana" ⇒ "Ana"). Teste na Task 2.
- **Curso só online com nome que colide com outro curso** (o mesmo endereço de `/cursos/<endereço>`, por exemplo com caixa ou acento diferentes): recusado com mensagem. Teste na Task 5.
- **DEV vendo o catálogo do site:** o curso só online não pode aparecer como card do presencial (o DEV vê os inativos). Teste na Task 5.

---

### Task 1: Banco

**Files:** Modify `prisma/schema.prisma`, `scripts/checar-migracao-ead.js` (`TABELAS_EAD` += `'DuvidaEad'`). Create `prisma/migrations/20261108120000_ead_duvidas/migration.sql`. Test `test/ead-duvidas-migracao.test.js`.

- [ ] **Test:** `checa()` (mesma técnica de `test/turma-online.test.js`) aceita o SQL real da migração, e recusa `ALTER TABLE "Curso" ADD COLUMN "somenteOnline" BOOLEAN;`. Rodar ⇒ FAIL (arquivo não existe).
- [ ] **Schema** (§3 da spec):
  - `enum StatusDuvidaEad { AGUARDANDO RESPONDIDA DESCARTADA OCULTA }`;
  - `model DuvidaEad` com os campos e os três índices da spec, relações `alunoCurso` e `tela` (Cascade), e as relações inversas em `AlunoCursoEad.duvidas` e `TelaEad.duvidas`;
  - `CursoOnline.somenteOnline Boolean @default(false)`.
- [ ] **Migração:** gerar com `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`, conferir que só tem CREATE/ADD, aplicar com `npx prisma migrate deploy`, depois `npx prisma generate`. Test ⇒ PASS.
- [ ] **Commit:** "EAD dúvidas: tabela de dúvidas e curso só online no banco".

### Task 2: Regras das dúvidas

**Files:** Create `src/lib/ead-duvidas.js`, test `test/ead-duvidas.test.js`. Modify `src/lib/email.js` (`enviarDuvidaRespondida`).

**Interfaces (Produces):**
- `nomePublico(nome: string) → string`
- `enviarDuvida({ alunoCursoId, telaId, texto }) → { ok: true, duvida } | { ok: false, erro: 'curta'|'longa'|'limite' } | { ok: true, repetida: true }`
- `duvidasDaTela(telaId, alunoCursoId|null) → [{ id, nome, texto, criadoEm, status, resposta, respondidaEm, minha: boolean }]`: as RESPONDIDA de todos, mais AGUARDANDO e DESCARTADA do próprio aluno. Ordem: as do aluno primeiro, depois respondidas da mais nova para a mais antiga.
- `marcarLidas(alunoCursoId, telaId) → void`
- `respondidasNaoLidas(alunoCursoId) → [{ id, telaId }]` (a mais recente primeiro)
- `responder(duvidaId, resposta, atorId, { linkBase }) → { ok: true } | { ok: false, erro: 'vazia'|'longa'|'ja_respondida'|'nao_achou' }`. A trava: `updateMany({ where: { id, status: 'AGUARDANDO' } })`. Só quem a passa manda o e-mail, com o link `linkBase + '/tela/' + telaId + '#duvidas'`.
- `descartar(id, motivo, atorId)`, `editarResposta(id, resposta, atorId)` (só RESPONDIDA, sem e-mail), `tirarDoAr(id, atorId)` (RESPONDIDA → OCULTA), `reabrir(id, atorId)` (DESCARTADA ou OCULTA → AGUARDANDO). Cada uma devolve `{ ok, erro? }`.
- `contarAguardando() → number`
- `listarCentral({ status, cursoOnlineId }) → [{ duvida, aluno: { nome, email }, origem: 'Pago'|'Teste', curso, modulo, tela, linkBase }]`. `linkBase` é `/online/<cursoId>` se o aluno tem matrícula na turma online; senão, `/ead-teste/<código>` se o link de teste estiver ligado; senão `null`.
- `email.enviarDuvidaRespondida(email, nome, { curso, tela, link })`, no padrão `moldura` de `enviarCertificadoEadPronto`.

- [ ] **Tests (escrever todos, rodar ⇒ FAIL):**
  - `nomePublico`: `'Maria da Silva'`⇒`'Maria S.'`, `'  maria   souza '`⇒`'Maria S.'`, `'Ana'`⇒`'Ana'`, `'JOÃO pedro'`⇒`'João P.'`.
  - `enviarDuvida`:
    - 9 caracteres ⇒ `curta`; 1001 ⇒ `longa`;
    - a 6ª AGUARDANDO no mesmo curso ⇒ `limite` (as de outro curso não contam);
    - o mesmo texto seguido na mesma tela ⇒ `repetida`, com 1 linha no banco.
  - `duvidasDaTela`:
    - outro aluno vê só RESPONDIDA;
    - o autor vê também AGUARDANDO e DESCARTADA (`minha: true`);
    - ninguém vê OCULTA.
  - `responder`:
    - `Promise.all` de duas respostas ⇒ uma `ok`, outra `ja_respondida`, 1 e-mail no espião, link terminando em `/tela/<id>#duvidas`;
    - resposta vazia ⇒ `vazia`.
  - `editarResposta` não manda e-mail; `tirarDoAr` e `reabrir` mudam o status; cada ação grava `LogAuditoria` (`EAD_DUVIDA_RESPONDEU|DESCARTOU|EDITOU|OCULTOU|REABRIU`).
  - `marcarLidas` e `respondidasNaoLidas`.
  - `listarCentral` por status e curso, com `origem` e `linkBase` certos; `contarAguardando`.
- [ ] **Implement.** O e-mail é lido na hora (`require('./email').enviarDuvidaRespondida`), para o espião funcionar. Tests ⇒ PASS.
- [ ] **Commit:** "EAD dúvidas: regras, resposta com trava e e-mail".

### Task 3: Dúvidas na tela do aluno e aviso na capa

**Files:** Modify `src/routes/ead-teste.js`, `src/views/ead-teste/tela.ejs`, `src/views/ead-teste/capa.ejs`, `src/public/ead.css`. Create `src/views/ead-teste/_duvidas.ejs`. Test `test/ead-duvidas-rotas.test.js` (app de teste como em `test/ead-online.test.js`, nos dois modos).

**Interfaces:**
- **Consumes:** Task 2.
- **Produces:** `POST <base>/tela/:telaId/duvida` (campo `texto`), que redireciona para `<base>/tela/<telaId>?duvida=<enviada|curta|longa|limite>#duvidas`. A capa recebe `duvidasRespondidas: [{ id, telaId }]` em `ctx`.

- [ ] **Tests (rodar ⇒ FAIL):**
  - visitante no modo teste vê "Dúvidas desta aula", as respondidas e "Entre para mandar uma dúvida"; o POST sem login grava nada e vai ao login;
  - aluno logado manda ⇒ 302 com `duvida=enviada`, e a tela mostra "aguardando resposta";
  - outro aluno não vê a pendente;
  - modo pago sem acesso: o POST volta à capa sem gravar;
  - **[Review Focus]** dúvida `<script>alert(1)</script>\nlinha 2` respondida com `<b>oi</b>` ⇒ o HTML tem `&lt;script&gt;` e `&lt;b&gt;`, e as duas linhas aparecem separadas;
  - capa com resposta não lida ⇒ "Sua dúvida foi respondida" com link para a tela; abrir a tela ⇒ o aviso some.
- [ ] **Implement:**
  - O bloco `_duvidas.ejs` fica embaixo do conteúdo, com `id="duvidas"`. Quebras de linha com `white-space: pre-line`, sem `<%-`.
  - A rota GET da tela chama `duvidasDaTela` e `marcarLidas`.
  - A capa, com `ctx`, chama `respondidasNaoLidas`.
  - Estilo no padrão `ea-*` de `ead.css`.
  - Tests ⇒ PASS. `npm test` passa.
- [ ] **Commit:** "EAD dúvidas: caixa de dúvidas em cada aula".

### Task 4: Central de dúvidas no painel

**Files:** Modify `src/routes/ead.js`, `src/views/admin/header.ejs` (badge), `src/views/admin/ead/desempenho.ejs`, `src/lib/ead-relatorios.js`, `src/public/ead-admin.css`. Create `src/views/admin/ead/duvidas.ejs`. Test `test/ead-duvidas-central.test.js` (app de teste do painel como em `test/ead-relatorios.test.js`).

**Interfaces:**
- **Consumes:** Task 2.
- **Produces:**
  - `GET /ead/duvidas?status=AGUARDANDO|RESPONDIDA|DESCARTADA|OCULTA&curso=<cursoOnlineId>`
  - `POST /ead/duvidas/:id/(responder|descartar|editar|ocultar|reabrir)`, com os campos `resposta` e `motivo`. Volta para a mesma aba com `ok` ou `erro`.
  - `res.locals.duvidasAguardando`: um middleware em `/ead` antes das rotas, com o valor de `contarAguardando()`.
  - `desempenhoDoCurso` ganha `duvidasPorTela: [{ telaId, titulo, modulo, total }]` (as 10 maiores).

- [ ] **Tests (rodar ⇒ FAIL):**
  - a lista padrão é Aguardando, com a mais antiga primeiro; o filtro por curso funciona;
  - responder ⇒ a dúvida sai de Aguardando e aparece em Respondidas; e-mail 1;
  - descartar com motivo; editar; ocultar; reabrir;
  - o header de uma página `/ead/...` mostra o badge com o número de aguardando;
  - o desempenho lista as telas com mais dúvidas.
- [ ] **Implement:**
  - Item "Dúvidas" no menu do modo Online (`header.ejs`), com o badge quando `typeof duvidasAguardando === 'number' && duvidasAguardando > 0`.
  - Tela no padrão das abas da etapa 4.
  - Botões perigosos (descartar, tirar do ar) com `data-confirmar`.
  - Tests ⇒ PASS. `npm test` passa.
- [ ] **Commit:** "EAD dúvidas: central no painel".

### Task 5: Curso só online

**Files:**
- Create `src/lib/ead-curso-online.js` and `src/views/admin/ead/curso-online-form.ejs`.
- Modify:
  - `src/routes/ead.js` (novo, dados, desativar);
  - `src/views/admin/ead/cursos.ejs` (botão);
  - `src/views/admin/ead/curso.ejs` (caixa "Dados do curso");
  - `src/routes/admin.js` (lista de cursos `:894`, `GET /turmas/nova :1175`, `POST /turmas :1227`);
  - `src/routes/cursos.js` (catálogo `/cursos`, `resolverEndereco`/`GET /cursos/:cursoId`, `sitemap.xml`);
  - `src/lib/ead-publicacao.js`;
  - `src/views/partials/v-card-cat.ejs`.
- Test `test/ead-curso-online.test.js`.

**Interfaces (Produces):**
- `criarCursoOnline({ nome, descricao, cargaHoraria, imagemUrl }) → { ok: true, co } | { ok: false, erro }`. Erro se o nome estiver vazio, se a carga horária não for de 1 a 999, ou se `slugCurso(nome)` já existir em outro `Curso`. Gravação numa `$transaction` em array.
- `editarCursoOnline(cursoOnlineId, campos) → { ok, erro? }`, com as mesmas validações e ignorando o próprio curso no teste de nome.
- `idsSoOnline() → Set<cursoId>`, tolerante a erro (Set vazio).
- `cursosSoOnlinePublicados() → [{ id, nome, descricao, imagemUrl, cargaHoraria, online: { preco, somenteOnline: true } }]`.
- O desativar de um curso só online apaga também o `Curso`, depois das travas da etapa 4.

- [ ] **Tests (rodar ⇒ FAIL):**
  - criar ⇒ `Curso.ativo false`, `somenteOnline true`;
  - **[Review Focus]** nome repetido e `'Primeiros socorros'` contra um `'Primeiros Socorros'` existente ⇒ erro;
  - editar;
  - Presencial → Cursos (admin, via `GET /cursos` do painel com app de teste) não lista o curso;
  - `GET /turmas/nova` não o oferece;
  - `POST /turmas` com esse `cursoId` ⇒ erro, nada criado;
  - `cursosSoOnlinePublicados` só traz o publicado;
  - `v-card-cat` renderizado com `online.somenteOnline` ⇒ link `/online/<id>`, sem "Matrícula à vista";
  - **[Review Focus]** `carregarVitrine` com o filtro do DEV (`{}`) não traz o curso só online;
  - `/cursos/<endereço>` ⇒ 302 para `/online/<id>` quando publicado, 404 quando não;
  - o sitemap traz `/online/<id>` só quando publicado;
  - desativar apaga o `Curso`.
  
  As rotas do site são testadas com o router de `cursos.js` num app de teste. Se as views do site pedirem locals demais, testar as funções e o redirect (`resolverEndereco`) e deixar um ruling.
- [ ] **Implement.** Formulário com foto (`uploadFoto`/`salvarFotoCurso` como no módulo); auditoria `EAD_CRIOU_CURSO_ONLINE`/`EAD_EDITOU_CURSO_ONLINE`. Tests ⇒ PASS. `npm test` passa.
- [ ] **Commit:** "EAD: curso só online".

### Task 6: Verificação final e PR

- [ ] `npm test`, `node --check` dos arquivos alterados e as views EJS compilando. A migração num banco limpo, com o diff do EAD vazio, e o checador passando.
- [ ] **Ciclo no app local (390 px e 1280 px):**
  - criar curso só online e preencher pelo script de demonstração, ou à mão;
  - publicar ⇒ catálogo com o card online;
  - aluno manda dúvida ⇒ a central mostra ⇒ responder ⇒ e-mail no log ⇒ o aviso na capa ⇒ a resposta aparece para outro aluno;
  - descartar e tirar do ar.
- [ ] Revisão final do branch com o modelo mais capaz, uma rodada de correções com teste, push e PR para `ead-venda`, sem merge.
