# Curso com IA: fotos da capa e dos módulos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A capa do curso e a foto de abertura de cada módulo são escolhidas pelo Claude entre fotos do Pexels (com sugestão e crédito no painel), no fim da geração com IA ou por um botão em qualquer curso.

**Architecture:** Lib nova `src/lib/ead-fotos.js` (Pexels, sugestão e escolha pelo Claude, gravar/trocar). `ead-ia.js` ganha o passo `FOTOS_GERANDO` (entre os módulos e CONCLUIDA) e o custo avulso do mês; a fila processa esse passo com a marca da geração. Painel: botão, "Trocar por outra", sugestão e crédito.

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, `@anthropic-ai/sdk` (cliente da etapa 9), fetch nativo, sharp (já usado no upload), node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-ead-ia-fotos.md`

## Global Constraints

- Só capa (`Curso.imagemUrl`) e abertura de módulo (`ModuloEad.fotoIntroUrl`); nada em telas/cenários.
- Sugestão e escolha pelo Claude (mesmo cliente/`MODELO` da etapa 9, `effort: 'low'`); Pexels só fornece fotos.
- Pexels: `GET https://api.pexels.com/v1/search?query=…&orientation=landscape&per_page=15&locale=pt-BR`, header `Authorization: <PEXELS_API_KEY>`; candidatos = 6 primeiros não usados no curso; Claude vê `src.medium`; grava `src.large`.
- Nome do arquivo guardado: `pexels-<id>-<data>.webp` (via `salvarFotoCurso`); ids não se repetem no mesmo curso.
- Nunca troca foto posta pela secretaria (botão só preenche vazio).
- Erro no passo "fotos" não trava: geração vira CONCLUIDA com o aviso "As fotos não puderam ser colocadas; use o botão Colocar fotos com IA na página do curso."
- Sem `PEXELS_API_KEY`: grava só sugestões, aviso "Sem chave do banco de fotos: as sugestões da IA estão em cada módulo, envie as fotos."
- Custo do botão: `Configuracao` `ead-ia:custo-avulso:<AAAA-MM>` (fuso do Rio), somado em `gastoDoMes`; teto estourado → não chama a IA.
- Migração só acrescenta colunas (ver Task 2).
- Crédito no painel: `Foto: <fotógrafo> / Pexels`; no site, não.

## Review Focus

- Foto do Pexels que não baixa (404/timeout) depois de escolhida: tenta a próxima da lista do Claude; não grava URL quebrada. → teste na Task 2.
- Curso apagado ou módulo apagado durante o passo "fotos": o passo termina sem erro e a geração conclui. → teste na Task 3.
- Duas pessoas clicando "Colocar fotos com IA" ao mesmo tempo: não grava duas fotos no mesmo módulo nem deixa arquivo órfão sem dono. → trava (advisory lock por curso) na Task 2, teste de duplo POST na Task 4.
- Resposta do Claude com índice fora da lista ou repetido: ignorado, sem quebrar. → teste na Task 1.
- Módulo com `fotoOpcoes` de uma única foto: "Trocar por outra" avisa "Não há outra foto sugerida para este módulo." e não apaga a atual. → teste na Task 4.

---

### Task 1: Pexels, sugestão e escolha pelo Claude (lib, sem banco)

**Files:**
- Create: `src/lib/ead-fotos.js`
- Modify: `src/lib/ead-ia-esquema.js` (esquemas novos), `src/lib/ead-ia.js` (`chamarClaude` aceita `effort` e `conteudoExtra`)
- Test: `test/ead-fotos.test.js`, `test/helpers/ia-falso.js` (helpers `pexelsFalso`, `sugestaoFotosBoa`)

**Interfaces:**
- Produces:
  - `E.ESQUEMA_SUGESTAO_FOTOS` → `{ capa: { busca, descricao }, modulos: [{ moduloId, busca, descricao }] }`; `E.validarSugestaoFotos(json, moduloIds) -> { ok, sugestao } | { ok:false, erro }` (busca cortada em 80, descricao em 200; módulo de id desconhecido descartado).
  - `E.ESQUEMA_ESCOLHA_FOTO` → `{ ordem: integer[] }` (índices 0-based das adequadas, melhor primeiro); `E.validarEscolha(json, n) -> number[]` (só inteiros 0..n-1, sem repetir).
  - `chamarClaude(cliente, { system, messages, schema, effort = 'high' })` (default inalterado).
  - `fotos.temPexels() -> boolean` (lê `process.env.PEXELS_API_KEY`).
  - `fotos.buscarPexels(busca, { fetch }) -> Promise<[{ id, medium, large, credito }]>` (lança `ErroFotos` em HTTP ≠ 200).
  - `fotos.sugerir(curso, modulos, { cliente }) -> Promise<{ sugestao, usage }>` — `curso: { nome, descricao }`, `modulos: [{ id, titulo, topicos: [titulo] }]`.
  - `fotos.escolher({ assunto, descricao, candidatos }, { cliente }) -> Promise<{ ordem: candidatos[], usage }>` — manda até 6 blocos `{ type:'image', source:{ type:'url', url: c.medium } }`; devolve os candidatos na ordem do Claude.
  - `fotos.opcoesPara({ busca, assunto, descricao, usados:Set<id> }, { cliente, fetch }) -> Promise<{ opcoes:[{id,url,credito}], usage:[] }>` — busca, filtra usados, pega 6, escolhe; sem nenhuma adequada tenta a busca com as 2 primeiras palavras; ainda nada → `opcoes: []`.

- [ ] **Step 1: Testes que falham** (`test/ead-fotos.test.js`, sem banco):
  - `validarEscolha({ordem:[2,0,2,9,-1,'x']}, 3)` → `[2, 0]`.
  - `validarSugestaoFotos` corta busca >80 e descricao >200 e descarta módulo com id fora de `moduloIds`.
  - `buscarPexels('first aid kit', { fetch: pexelsFalso(...) })` chama a URL com `orientation=landscape`, `per_page=15`, `locale=pt-BR` e o header `Authorization` = chave; devolve `{ id, medium, large, credito }`.
  - `opcoesPara` com 10 fotos, `usados` contendo a 1ª, e Claude falso respondendo `{ordem:[3,1]}`: o Claude recebe 6 blocos de imagem (da 2ª à 7ª); `opcoes` = [candidato 3, candidato 1] (não a primeira do Pexels).
  - `opcoesPara` com Claude respondendo `{ordem:[]}` na 1ª busca: faz a 2ª busca só com as 2 primeiras palavras.
  - `chamarClaude(..., { effort: 'low' })` manda `output_config.effort === 'low'`.
- [ ] **Step 2:** `node --test test/ead-fotos.test.js` → FAIL (`Cannot find module '../src/lib/ead-fotos'`).
- [ ] **Step 3:** Implementar as interfaces. Prompt de `escolher` (system) proíbe: sangue/ferimento, criança em destaque, marca aparente, texto em outra língua em destaque, foto fora do assunto. Prompt de `sugerir` pede busca em inglês, 2–6 palavras concretas e fotografáveis, mesmas proibições.
- [ ] **Step 4:** teste passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): Pexels, sugestão e escolha de fotos pelo Claude`.

### Task 2: Gravar e trocar fotos (banco)

**Files:**
- Create: `prisma/migrations/20261113120000_ead_ia_fotos/migration.sql`
- Modify: `prisma/schema.prisma`, `src/lib/ead-fotos.js`, `src/lib/ead-ia.js` (`gastoDoMes` soma o custo avulso; `somarCustoAvulso(usage)`)
- Test: `test/ead-fotos-db.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Colunas: `ModuloEad.fotoBusca/fotoSugestao/fotoCredito String?`, `ModuloEad.fotoOpcoes Json?`; `CursoOnline.capaBusca/capaSugestao/capaCredito String?`, `CursoOnline.capaOpcoes Json?`.
  - `fotos.colocarFotos(cursoOnlineId, { cliente, fetch, custo }) -> Promise<{ colocadas:number, sugestoes:number, aviso:string|null }>` — `custo(usage)` é chamado a cada chamada ao Claude (geração: soma na geração; botão: `IA.somarCustoAvulso`). Advisory lock `fotos:<cursoOnlineId>`. Só alvos vazios (capa sem `imagemUrl`; módulo sem `fotoIntroUrl`). Grava busca/sugestão sempre; com Pexels grava opções, foto e crédito.
  - `fotos.trocarFoto({ tipo:'capa'|'modulo', id }, { fetch }) -> Promise<{ ok:true } | { ok:false, erro }>` — próxima de `*Opcoes` depois da atual (pelo id no nome do arquivo), dá a volta; apaga a antiga com `removerFotoCurso`. Uma opção só → `{ ok:false, erro:'Não há outra foto sugerida para este módulo.' }` (capa: "…para a capa.").
  - `IA.somarCustoAvulso(usage) -> Promise<void>`; `IA.gastoDoMes()` = gerações + avulso do mês.
  - `ErroFotos` com `.message` em português.

- [ ] **Step 1: Testes que falham** (`test/ead-fotos-db.test.js`, Postgres local, Claude e Pexels falsos, `salvarFotoCurso` real com `uploads/` local):
  - curso com capa vazia e 2 módulos (um com `fotoIntroUrl` já posta): `colocarFotos` → capa e o módulo vazio com foto `/uploads/pexels-<id>-…`, `fotoSugestao`, `fotoCredito`, `fotoOpcoes` gravados; o módulo que tinha foto fica igual; ids diferentes entre capa e módulo; `colocadas === 2`.
  - sem `PEXELS_API_KEY`: só sugestões gravadas, nenhuma chamada ao fetch, `aviso` = texto da Global Constraints.
  - download da 1ª opção dá 404: grava a 2ª opção.
  - `trocarFoto` do módulo: passa para a próxima opção e o arquivo antigo some de `uploads/`; com uma opção só: erro "Não há outra foto sugerida para este módulo." e a foto atual fica.
  - `somarCustoAvulso` aumenta `gastoDoMes()`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Schema + migração (`ALTER TABLE ... ADD COLUMN ...`, todas nulas), `npx prisma migrate deploy && npx prisma generate`; implementar.
- [ ] **Step 4:** teste passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): gravar e trocar fotos da capa e dos módulos`.

### Task 3: Passo "fotos" na geração com IA

**Files:**
- Modify: `src/lib/ead-ia.js` (`EM_ANDAMENTO` + `'FOTOS_GERANDO'`; `gerarFotos(geracaoId, { cliente, fetch })`), `src/lib/ead-ia-fila.js` (módulos terminados → `FOTOS_GERANDO`; passo de `FOTOS_GERANDO` com `comMarca(chave(id))`), `src/views/admin/ead/ia-geracao.ejs`, `src/views/admin/ead/ia-lista.ejs`
- Test: `test/ead-ia-fila.test.js` (testes novos), `test/ead-ia-passos-painel.test.js` (texto na página)

**Interfaces:**
- Consumes: `fotos.colocarFotos` (Task 2).
- Produces: `IA.gerarFotos(geracaoId, { cliente, fetch }) -> Promise<void>` — chama `colocarFotos(g.cursoOnlineId, { custo: (u) => somarCusto(geracaoId, u) })`; em qualquer erro (ou curso apagado) conclui assim mesmo, guardando o aviso em `pedido.avisoFotos`; sempre termina com `updateMany({ where: { id, status:'FOTOS_GERANDO' }, data: { status:'CONCLUIDA', materialPdfs: DbNull } })`. Rótulo `FOTOS_GERANDO`: "Colocando as fotos…" (lista: "Colocando as fotos"); conta como "andando" e como passo 4 na barra.

- [ ] **Step 1: Testes que falham:**
  - fila: geração com módulos prontos → passa por `FOTOS_GERANDO` e termina CONCLUIDA com capa e módulos com foto (Pexels falso via `process.env.PEXELS_API_KEY` e `fotos.definirFetch(fake)`).
  - fila: Claude falha no passo fotos → CONCLUIDA e `pedido.avisoFotos` = texto da Global Constraints; a página da geração mostra o aviso.
  - curso online apagado antes do passo → CONCLUIDA sem erro.
  - página da geração em `FOTOS_GERANDO` mostra "Colocando as fotos…".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar. `fotos.definirFetch(f)` (como `fila.definirCliente`) para testes. Ajustar os testes antigos da fila que esperam CONCLUIDA direto depois dos módulos só se precisarem (o passo fotos sem chave do Pexels só grava sugestões e conclui).
- [ ] **Step 4:** teste passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): passo de fotos no fim da geração`.

### Task 4: Painel — botão, trocar, sugestão e crédito

**Files:**
- Modify: `src/routes/ead.js`, `src/views/admin/ead/curso.ejs`, `src/views/admin/ead/modulo-form.ejs`, `src/public/ead-admin.css`, `docs/ead/como-publicar-um-curso.md`
- Test: `test/ead-fotos-painel.test.js` (helpers `test/helpers/painel-ead.js`)

**Interfaces:**
- Consumes: `fotos.colocarFotos`, `fotos.trocarFoto`, `fotos.temPexels`, `IA.dentroDoTeto`, `IA.somarCustoAvulso`.
- Produces (POST com CSRF, redirect + flash):
  - `POST /ead/curso/:id/fotos-ia` → teto estourado: erro do teto; senão `colocarFotos` com `custo: IA.somarCustoAvulso`; flash `"<n> fotos colocadas."` / `"Nada para preencher: a capa e os módulos já têm foto."` / o `aviso`. Audita `EAD_FOTOS_IA`.
  - `POST /ead/curso/:id/capa/trocar`, `POST /ead/modulo/:id/foto/trocar` → `trocarFoto`; flash "Foto trocada." ou o erro.
  - Página do curso: botão "Colocar fotos com IA" (`data-confirmar` explicando que só preenche o vazio); com `capaSugestao`, mostra "Sugestão da IA: …", o crédito e (com Pexels e `capaOpcoes` > 1) "Trocar por outra".
  - Formulário do módulo: o mesmo para a foto de abertura.

- [ ] **Step 1: Testes que falham:** botão em curso existente coloca as fotos e o flash diz "2 fotos colocadas."; segundo clique: "Nada para preencher…"; duplo POST simultâneo não grava duas fotos no mesmo módulo (cada módulo com uma foto, sem arquivo a mais em `uploads/` além das gravadas); teto estourado não chama o Claude falso; "Trocar por outra" do módulo troca a foto; módulo com uma opção mostra o erro; páginas mostram `Sugestão da IA:` e `Foto: <fotógrafo> / Pexels`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar rotas e views; seção "Fotos com IA" no manual (inclui criar a chave em pexels.com/api e pôr `PEXELS_API_KEY` no Render, serviço da secretaria).
- [ ] **Step 4:** teste passa; `npm test` verde. Prints do painel (curso com botão e sugestão; módulo com foto, crédito e trocar) e da página do aluno com capa e foto do módulo.
- [ ] **Step 5:** Commit `feat(painel): colocar e trocar fotos com IA`.
