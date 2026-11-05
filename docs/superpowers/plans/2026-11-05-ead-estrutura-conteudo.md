# EAD etapa 1 (estrutura do conteúdo e cadastro no painel): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tabelas do conteúdo EAD e telas no painel (só DEV, no modo Online do painel) para cadastrar módulos, tópicos, telas, perguntas e cenários, ver a tela como o aluno, validar o módulo e abrir o curso num link secreto de teste.

**Architecture:** 9 tabelas novas ligadas a `Curso` por `CursoOnline` (1:1), migração que só cria. Regras puras e testáveis em `src/lib/ead.js` (vídeo, perguntas, pendências, mm:ss, Zod); acesso ao banco do EAD em `src/lib/ead-db.js` (carregar árvore, invalidar selo, reordenar); rotas em `src/routes/ead.js` montadas no `admin.js` como `contas.js`; telas em `src/views/admin/ead/`.

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5 / PostgreSQL 16, Zod 3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-05-ead-estrutura-conteudo.md` (ler inteira antes de qualquer task; as seções citadas abaixo são dela).

## Global Constraints

- Branch `ead-estrutura-conteudo`; PR para `main` **sem merge**. Nada roda contra banco que não seja local.
- Migração só `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / FKs das tabelas novas; **nenhum `ALTER TABLE` em tabela existente** (spec §3.4).
- Toda rota `/ead…` usa `requireDev` (de `admin.js`); `lib/permissoes.js` não muda (spec §5.1).
- Vídeo só por link YouTube/Vimeo, normalizado (spec §4.3); CSP `frameSrc` ganha `https://www.youtube-nocookie.com` e `https://player.vimeo.com`.
- Mínimos para validar: 3 perguntas ativas por tópico, 8 por módulo; aviso (não bloqueia) abaixo de 10 por tópico (spec §4.4).
- Estilo do repo: comentários e textos em português; confirmação só por `data-confirmar` no `<form>` (CSP proíbe JS inline); mensagens por `?ok=` / `?erro=` na URL; views com `include('head', { titulo })`, `include('header', { ativo: 'ead' })`, `include('foot')`.
- Handlers `async` do router novo envolvidos com `lib/asyncHandler` (mesma técnica do topo de `admin.js`).
- Escritas que mexem no módulo usam `prisma.$transaction(async (tx) => …)` e chamam `invalidarSeValidado` dentro dela.
- Toda criação/exclusão de item grava `EAD_CRIOU_<ITEM>` / `EAD_EXCLUIU_<ITEM>` (`MODULO`, `TOPICO`, `TELA`, `PERGUNTA`, `CENARIO`, `DECISAO`) com `{ moduloId, titulo }`; edição não grava (spec §5.3).
- Limites de texto da spec §5.3 (títulos 120; âncora 600; introdução 3000; item de revisão 200; alerta e dica 400; enunciado 600; alternativa/opção 300; feedback 800; cena 1000).

## Review Focus

- Link de vídeo com lixo em volta (espaços, `&t=30s`, `?si=…`, `www.`/`m.` do YouTube, `http://`) deve normalizar; `youtube.com.evil.com/watch?v=…` deve ser recusado. Task 2.
- Pergunta UNICA salva com duas alternativas marcadas como corretas, ou com alternativas em branco no meio, não pode passar; as em branco somem e a ordem se refaz. Task 2.
- Edição feita por POST direto (sem passar pelo modal) num módulo validado ainda tem que invalidar o selo. Tasks 3 e 5.
- Subir o primeiro item / descer o último não pode quebrar nem mudar nada. Task 3.
- Link de teste trocado ou desligado tem que parar de abrir na hora (inclusive as telas internas), e um id de tela de outro curso com um código válido dá 404. Task 8.
- Id inexistente ou de outro tipo em qualquer rota (`/ead/tela/<id de pergunta>`) responde 404 com `admin/erro`, nunca 500. Task 4.

---

### Task 1: Banco: schema, migração e Postgres local

**Files:**
- Modify: `prisma/schema.prisma` (2 enums, 9 models, campo de relação `online CursoOnline?` em `Curso`)
- Create: `prisma/migrations/20261105120000_ead_estrutura/migration.sql`
- Create: `scripts/checar-migracao-ead.js`

**Interfaces (Produces):** modelos Prisma `cursoOnline`, `moduloEad`, `topicoEad`, `telaEad`, `perguntaEad`, `alternativaEad`, `cenarioEad`, `decisaoCenario`, `opcaoDecisao`; enums `StatusModuloEad { RASCUNHO VALIDADO }`, `TipoPerguntaEad { UNICA MULTIPLA VF }`. Relações (nome do campo filho → pai): `CursoOnline.curso`/`Curso.online`, `CursoOnline.modulos`, `ModuloEad.topicos`, `ModuloEad.cenarios`, `TopicoEad.telas`, `TopicoEad.perguntas`, `PerguntaEad.alternativas`, `CenarioEad.decisoes`, `DecisaoCenario.opcoes`. Campos exatamente como spec §3.2.

- [ ] **Step 1:** Subir Postgres local: `pg_ctlcluster 16 main start` (ou `initdb` num diretório do scratchpad), criar o banco `escola_ead` e um `.env` local com `DATABASE_URL` e `SESSION_SECRET` (não commitar).
- [ ] **Step 2:** `npx prisma migrate deploy` no banco vazio aplica as migrações atuais. Esperado: "All migrations have been successfully applied".
- [ ] **Step 3:** Escrever `scripts/checar-migracao-ead.js <arquivo.sql>`: sai com código 1 e imprime a linha se houver `ALTER TABLE "X"` com X fora da lista das 9 tabelas novas, ou `DROP`, ou `ALTER TYPE`/`ALTER COLUMN`. Rodar contra o SQL da migração de 27/10: deve **falhar** (tem `ALTER TYPE`), prova de que o checador pega.
- [ ] **Step 4:** Editar `schema.prisma` (§3.1–3.3: `onDelete: Cascade` nos filhos, `onDelete: Restrict` em `CursoOnline.curso`, `@@index` em toda FK, `revisaoItens String[]`, defaults da spec). Gerar o SQL com `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <banco vazio> --script > prisma/migrations/20261105120000_ead_estrutura/migration.sql`, com um comentário em português no topo dizendo que só cria tabelas.
- [ ] **Step 5:** `node scripts/checar-migracao-ead.js prisma/migrations/20261105120000_ead_estrutura/migration.sql` → sai 0. `npx prisma migrate deploy` → aplica. `SEED_EXEMPLO=true npm run db:seed` → os cursos de exemplo entram. `npx prisma migrate status` → "Database schema is up to date".
- [ ] **Step 6:** Commit "EAD: tabelas do conteúdo (migração só cria)".

---

### Task 2: Regras puras (`src/lib/ead.js`) com testes

**Files:**
- Create: `src/lib/ead.js`, `test/ead.test.js`
- Modify: `package.json` (script `"test": "node --test test/"`)

**Interfaces (Produces):**
- `normalizarVideo(url: string): { url: string } | { erro: string }`, com saídas exatas da spec §4.3 e o erro `"Use um link do YouTube ou do Vimeo."`.
- `lerMmSs(txt: string): number | null` (`"2:10"` → 130, `"130"` → 130, `""` → null, `"2:75"`/`"abc"` → null) e `mmSs(seg: number): string` (130 → `"2:10"`).
- `normalizarAlternativas(tipo, itens: {texto, correta}[]): { alternativas: {texto, correta, ordem}[] } | { erro: string }`, regras da spec §4.2 (VF devolve sempre `[{texto:'Verdadeiro'},{texto:'Falso'}]` com a correta escolhida; descarta textos vazios; refaz `ordem` 0..n-1).
- `pendencias(modulo): string[]` e `avisos(modulo): string[]`, puras, sobre a árvore carregada `modulo = { titulo, introducao, minutosEstimados, final, topicos:[{titulo, telas:[…], perguntas:[{ativa, tipo, feedback, alternativas:[…]}]}], cenarios:[{titulo, cena, decisoes:[{pergunta, opcoes:[{texto, correta, feedback}]}]}] }`. Frases no formato da spec ("Tópico 'X': só 2 perguntas ativas (mínimo 3)").
- `MINIMO_POR_TOPICO = 3`, `MINIMO_POR_MODULO = 8`, `META_POR_TOPICO = 10`.
- Esquemas Zod `schemaModulo`, `schemaTopico`, `schemaTela`, `schemaPergunta`, `schemaCenario`, `schemaDecisao`, `schemaCursoOnline` (`notaMinimaQuiz` inteiro 50–100) com os limites dos Global Constraints; strings vazias viram `null` nos opcionais.

- [ ] **Step 1: Testes que falham** em `test/ead.test.js` (`node:test` + `node:assert/strict`):
  - `normalizarVideo`: cada linha da tabela §4.3; `" https://youtu.be/dQw4w9WgXcQ?si=abc "` → `https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ`; `https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s` → idem; `https://vimeo.com/123456/abcdef12` → `https://player.vimeo.com/video/123456?h=abcdef12`; `https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ`, `https://example.com/v.mp4`, `javascript:alert(1)` e `""` → `{ erro }`.
  - `lerMmSs`/`mmSs` com os valores acima.
  - `normalizarAlternativas`: UNICA com 2 corretas → erro; UNICA com 1 alternativa preenchida → erro (mínimo 2); MULTIPLA com 0 corretas → erro; 6 preenchidas → erro (máximo 5); `['a','', 'b']` com `b` correta → 2 itens, ordens 0 e 1, `b` correta; VF com "Falso" correta → `[{Verdadeiro,false},{Falso,true}]`.
  - `pendencias`: módulo comum completo → `[]`; tópico com 2 perguntas ativas → contém "mínimo 3"; módulo com 2 tópicos × 3 perguntas = 6 → contém "mínimo 8"; pergunta inativa não conta; tela sem vídeo → pendência citando a tela; pergunta ativa sem feedback → pendência; `minutosEstimados` 0 → pendência; módulo final sem cenário → pendência; decisão com 2 opções ou 2 corretas ou opção sem feedback → pendência.
  - `avisos`: tópico com 3 perguntas → aviso com "meta do documento: 10"; com 10 → `[]`.
- [ ] **Step 2:** `npm test` → falha (módulo não existe).
- [ ] **Step 3:** Implementar `src/lib/ead.js` (sem `require('../db')`: puro).
- [ ] **Step 4:** `npm test` → tudo passa.
- [ ] **Step 5:** Commit "EAD: regras do conteúdo (vídeo, perguntas, pendências) com testes".

---

### Task 3: Acesso ao banco do EAD (`src/lib/ead-db.js`)

**Files:**
- Create: `src/lib/ead-db.js`, `test/ead-db.test.js` (roda só com `DATABASE_URL` local; sem ela, `t.skip`)

**Interfaces:**
- Consumes: modelos da Task 1.
- Produces:
  - `carregarModulo(id): Promise<ModuloCompleto | null>`: módulo com `cursoOnline.curso`, tópicos (telas e perguntas com alternativas) e cenários (decisões com opções), tudo por `ordem asc, criadoEm asc`. É a entrada de `pendencias`/`avisos`.
  - `invalidarSeValidado(tx, moduloId, atorId, oQueMudou: string): Promise<boolean>`: se `VALIDADO`, põe `RASCUNHO`, limpa `validadoPor/validadoEm`, cria `LogAuditoria` `EAD_INVALIDOU_MODULO` `{ moduloId, oQueMudou }`; devolve se invalidou.
  - `mover(tx, modelo: 'moduloEad'|'topicoEad'|'telaEad'|'cenarioEad'|'decisaoCenario', id, direcao: 'subir'|'descer', campoPai: string): Promise<{ trocadoCom: string } | null>`: troca a `ordem` com o vizinho (mesmo pai, ordenação `ordem, criadoEm`); antes, se houver ordens repetidas entre irmãos, renumera 0..n-1. Primeiro/último → `null` sem escrever.
  - `proximaOrdem(tx, modelo, campoPai, paiId): Promise<number>` (max+1, ou 0).
  - `marcarFinal(tx, moduloId, final: boolean): Promise<{ erro?: string }>`: regra da spec §4.1 (desmarca o outro final do curso; recusa se o módulo tiver tópicos para virar final, ou cenários para deixar de ser).
  - `moduloDe(tipo: 'topico'|'tela'|'pergunta'|'cenario'|'decisao', id): Promise<{ moduloId, cursoOnlineId } | null>`: sobe a árvore para as rotas saberem qual módulo invalidar.

- [ ] **Step 1: Testes que falham** (banco local, criando e apagando um curso de teste próprio): `invalidarSeValidado` num módulo VALIDADO → RASCUNHO + 1 log; num RASCUNHO → `false`, 0 log. `mover` de 3 telas com ordens `[0,0,0]` → renumera e troca; subir a primeira → `null`, ordens iguais. `marcarFinal` em dois módulos seguidos → só o último é final; marcar final num módulo com tópico → erro.
- [ ] **Step 2:** `npm test` → falha.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → passa (com `DATABASE_URL` local).
- [ ] **Step 5:** Commit "EAD: acesso ao banco (selo, ordem, módulo final)".

---

### Task 4: Painel: modo Presencial | Online, cursos, módulos e selo

**Files:**
- Create: `src/routes/ead.js`, `src/views/admin/ead/cursos.ejs`, `curso.ejs`, `modulo-form.ejs`, `modulo.ejs`
- Modify: `src/routes/admin.js` (`POST /modo` com `requireDev`, spec §5.2; montar `router.use(require('./ead')({ requireDev, auditar, ADMIN_URL }))` ao lado do `contas`; trava em `POST /cursos/:id/excluir` da spec §3.3 com a frase exata), `src/views/admin/header.ejs` (seletor Presencial | Online só para DEV; com `modoPainel === 'online'` — da sessão, ou passado pela view do EAD — o menu vira só "Cursos online" (`fa-solid fa-laptop-medical`) + Configurações e a marca leva a `/ead`; spec §5.2), `src/public/admin.css` (estilo do seletor), `src/server.js` (`frameSrc`)

**Interfaces:**
- Consumes: Task 2 (`pendencias`, `avisos`, esquemas), Task 3 (`carregarModulo`, `invalidarSeValidado`, `mover`, `proximaOrdem`, `marcarFinal`), `uploadFoto`/`salvarFotoCurso`/`removerFotoCurso` de `lib/upload.js`.
- Produces: `module.exports = function rotasEad({ requireDev, auditar, ADMIN_URL }) → Router`; helpers internos `voltar(res, url, tipo, msg)` e `naoAchou(res)` (404 `admin/erro` "Conteúdo EAD não encontrado."); a página `modulo.ejs` com os blocos onde as Tasks 5–7 penduram tópicos/telas/perguntas/cenários.

- [ ] **Step 0:** `POST /modo` e o seletor no header; `res.locals.modoPainel = req.session.modoPainel || 'presencial'` num middleware do `admin.js`, e o router do EAD sobrescreve com `'online'`. Não-DEV: sempre presencial.
- [ ] **Step 1:** Rotas da spec §5.3 até módulo: `GET /ead`, `POST /ead/ativar`, `GET|POST /ead/curso/:id`, `POST /ead/curso/:id/desativar`, `GET|POST /ead/curso/:id/modulos/novo`, `GET /ead/modulo/:id`, `GET|POST /ead/modulo/:id/editar`, `POST /ead/modulo/:id/{validar,reabrir,subir,descer,excluir}`. Regras: desativar só com todos os módulos em RASCUNHO; excluir módulo só em RASCUNHO; validar só com `pendencias()` vazia (senão volta com `?erro=` "O módulo tem pendências."); subir/descer módulo invalida os dois trocados; editar módulo validado invalida. Auditoria: `EAD_ATIVOU_CURSO`, `EAD_DESATIVOU_CURSO`, `EAD_CRIOU_MODULO`, `EAD_EXCLUIU_MODULO`, `EAD_VALIDOU_MODULO`, `EAD_REABRIU_MODULO`. Foto da introdução: troca remove a antiga com `removerFotoCurso`.
- [ ] **Step 2:** Views: `modulo.ejs` mostra selo, "validado por <nome> em dd/mm/aaaa hh:mm", caixa de pendências (vermelha) e de avisos (amarela), botão Validar desabilitado com pendências; faixa amarela e `data-confirmar` da spec §4.5 em todo form de escrita quando o módulo está VALIDADO; exclusões com `data-confirmar` dizendo o que vai junto.
- [ ] **Step 3:** `node --check src/routes/ead.js src/routes/admin.js src/server.js`; compilar os EJS novos (`node -e "require('ejs').compile(require('fs').readFileSync(f,'utf8'),{filename:f})"` para cada um).
- [ ] **Step 4:** Subir o app local (`ADMIN_PORT=3001 npm run dev`), entrar como DEV no painel e conferir: seletor troca Presencial ↔ Online e o menu muda; `/ead` por link direto mostra o menu Online; ativar EAD num curso de exemplo; criar 2 módulos; subir/descer; editar; validar recusado com pendências; tentar excluir o curso em Cursos → mensagem da §3.3; desativar EAD. Entrar como SECRETARIA: sem seletor nem item EAD; `POST /modo` → 403; `GET /ead` → 403 "Esta área é restrita ao Dev."; `GET /ead/modulo/xyz` como DEV → 404.
- [ ] **Step 5:** Commit "EAD: painel de cursos e módulos (só DEV)".

---

### Task 5: Tópicos, telas e "ver como o aluno"

**Files:**
- Create: `src/views/admin/ead/tela-form.ejs`, `tela-ver.ejs`, `src/views/partials/ead-tela.ejs`
- Modify: `src/routes/ead.js`, `src/views/admin/ead/modulo.ejs`

**Interfaces:**
- Consumes: Tasks 2–4 (`normalizarVideo`, `lerMmSs`/`mmSs`, `schemaTopico`/`schemaTela`, `moduloDe`, `invalidarSeValidado`, `mover`).
- Produces: partial `partials/ead-tela.ejs` com os locais `{ modulo, topicos, tela, proxima }` (proxima = `{ titulo } | null`), sem dependência de nada do painel (a etapa 2 renderiza no site do aluno).

- [ ] **Step 1:** Rotas da spec §5.3 para tópico e tela. Toda escrita: `moduloDe` → `$transaction` → escrita + `invalidarSeValidado(tx, moduloId, req.session.usuarioId, 'tela "<título>"')`. Recusar criar tópico em módulo final. Link de vídeo inválido devolve o form com a mensagem de `normalizarVideo` e o que foi digitado. `revisaoItens` vem de 4 campos, os vazios são descartados.
- [ ] **Step 2:** `tela-ver.ejs` + partial no layout do Exemplo A do PDF: cabeçalho "N · MÓDULO N / título", menu lateral (tópicos e telas, a atual destacada), "TÓPICO n" e título, caixa azul da âncora com a foto ao lado, bloco "Assista" com `<iframe src="<videoUrl>" allow="fullscreen; picture-in-picture" loading="lazy">` e título e duração `mmSs`, revisão rápida em cartões numerados, caixa ALERTA, dica de profissional, barra "A seguir: <próxima>". CSS em `src/public/ead.css` (mobile primeiro, cores do `admin.css`), sem JS.
- [ ] **Step 3:** `node --check` e compilar os EJS; no app local, cadastrar o tópico "Reconhecer o engasgo" e a tela "Criança no recreio" do Exemplo A (âncora, link do YouTube, 4 sinais, alerta) e abrir "ver como o aluno": vídeo toca (CSP não bloqueia), layout certo em 375 px de largura. Validar o módulo (com perguntas da Task 6 ainda faltando → pendência; validar só depois da Task 6) — aqui só conferir que **editar a tela de um módulo validado** à mão (forçar `status=VALIDADO` no banco) volta para RASCUNHO e gera `EAD_INVALIDOU_MODULO`, inclusive com POST feito por `curl` com o cookie e o token CSRF, sem o modal.
- [ ] **Step 4:** Commit "EAD: tópicos, telas e pré-visualização".

---

### Task 6: Banco de perguntas

**Files:**
- Create: `src/views/admin/ead/pergunta-form.ejs`
- Modify: `src/routes/ead.js`, `src/views/admin/ead/modulo.ejs`

**Interfaces:** Consumes `normalizarAlternativas`, `schemaPergunta`, `moduloDe`, `invalidarSeValidado`.

- [ ] **Step 1:** Rotas de pergunta da spec §5.3. Salvar = numa transação, atualizar a pergunta, apagar as alternativas antigas e criar as de `normalizarAlternativas`, invalidar o módulo. `/ativar` alterna `ativa` e invalida. Form: tipo (troca entre 5 campos e o par V/F só com CSS `:has()`/radio, sem JS inline), enunciado, alternativas com caixa "correta", feedback.
- [ ] **Step 2:** `modulo.ejs`: em cada tópico, contagem "N perguntas ativas (mínimo 3 · meta 10)" e a lista (enunciado curto, tipo, nº de alternativas, ativa/inativa).
- [ ] **Step 3:** `node --check`, EJS; no app local, cadastrar a pergunta do Exemplo B ("No recreio, um aluno de 7 anos…", 4 alternativas, "Fico ao lado, incentivo a tossir e observo" correta, feedback "Correto. Tosse forte e voz = …") e mais perguntas até o módulo zerar as pendências; validar; conferir avisos "meta 10"; salvar UNICA com 2 corretas → erro no form com o texto digitado preservado.
- [ ] **Step 4:** Commit "EAD: banco de perguntas".

---

### Task 7: Cenários e decisões

**Files:**
- Create: `src/views/admin/ead/cenario-form.ejs`, `decisao-form.ejs`
- Modify: `src/routes/ead.js`, `src/views/admin/ead/modulo.ejs`

**Interfaces:** Consumes `schemaCenario`, `schemaDecisao`, `normalizarVideo`, `lerMmSs`, `moduloDe`, `invalidarSeValidado`, `mover`.

- [ ] **Step 1:** Rotas de cenário e decisão da spec §5.3. Recusar cenário em módulo que não é final. Decisão: sempre 3 opções no form (texto, radio "correta", fala do instrutor); salvar troca as 3 opções numa transação e invalida o módulo.
- [ ] **Step 2:** `node --check`, EJS; no app local, módulo final "Juntando tudo" com o cenário "Pânico na hora do lanche" do Exemplo C (cena, 4:00, decisão 1 "O que você faz primeiro?" com OLHAR/LIGAR/CUIDAR, CUIDAR correta, fala do instrutor virtual nas três), conferir pendências até zerar e validar.
- [ ] **Step 3:** Commit "EAD: cenários e decisões".

---

### Task 8: Link secreto de teste (site do aluno)

**Files:**
- Create: `src/lib/ead-teste.js`, `src/routes/ead-teste.js`, `src/views/ead-teste/capa.ejs`, `modulo.ejs`, `tela.ejs`
- Modify: `src/server.js` (montar antes de `visitas.registrar`; `robots.txt` com `Disallow: /ead-teste/`), `src/routes/ead.js` + `src/views/admin/ead/curso.ejs` (caixa "Link de teste"), `test/ead.test.js`

**Interfaces:**
- Consumes: `partials/ead-tela.ejs` (Task 5), `carregarModulo` (Task 3).
- Produces (`lib/ead-teste.js`): `codigoDoCurso(cursoOnlineId): Promise<string|null>`, `gerarCodigo(cursoOnlineId): Promise<string>` (cria ou substitui), `desligar(cursoOnlineId): Promise<void>`, `cursoDoCodigo(codigo): Promise<string|null>` (recusa sem consultar o banco se o código não casar `^[A-Za-z0-9_-]{43}$`); puro e testável: `proximaTela(arvoreDoCurso, telaId): { tipo: 'tela'|'modulo'|'capa', id? }` sobre os módulos ordenados (final por último).

- [ ] **Step 1: Testes que falham** para `proximaTela`: próxima no mesmo tópico; última do tópico → primeira do próximo tópico; última do módulo → `{ tipo: 'modulo', id: <próximo módulo> }`; última do último módulo → `{ tipo: 'capa' }`; tópico sem telas é pulado. E para o formato do código: `cursoDoCodigo('abc')` → `null`.
- [ ] **Step 2:** `npm test` → falha. **Step 3:** implementar `lib/ead-teste.js`. **Step 4:** `npm test` → passa.
- [ ] **Step 5:** Rotas e views da spec §5.4 (layout do site: `partials/site-head`/`site-header`/`site-footer`, faixa "VERSÃO DE TESTE — não divulgar"); middleware do router põe os três cabeçalhos; toda busca confere que módulo/tela pertencem ao `cursoOnlineId` do código; caixa no painel com Gerar/Trocar/Desligar e auditoria sem o código; desativar o EAD apaga a chave.
- [ ] **Step 6:** No app local: o roteiro de verificação da spec §7 (link de teste), com `curl -I` para conferir os cabeçalhos e o Painel para conferir que a visita não contou.
- [ ] **Step 7:** Commit "EAD: link secreto de teste do curso online".

---

### Task 9: Verificação final e PR

**Files:** nenhum novo (correções que aparecerem).

- [ ] **Step 1:** `npm test` passa; `node --check` em todo `src/**/*.js`; todos os EJS de `src/views/admin/ead/` e `partials/ead-tela.ejs` compilam.
- [ ] **Step 2:** Banco limpo: `prisma migrate deploy` do zero + seed; `node scripts/checar-migracao-ead.js` na migração nova → 0.
- [ ] **Step 3:** Ciclo da spec §7 inteiro no app local, na ordem escrita lá, e conferir no banco os registros de `LogAuditoria` com `acao LIKE 'EAD_%'`.
- [ ] **Step 4:** Presencial intacto: home, `/cursos`, página de um curso, Cursos/Turmas/Inscrições no painel abrem sem erro.
- [ ] **Step 5:** Push e PR para `main` (sem merge) com o resumo da spec, o que foi verificado e o aviso de que a migração só cria tabelas.
