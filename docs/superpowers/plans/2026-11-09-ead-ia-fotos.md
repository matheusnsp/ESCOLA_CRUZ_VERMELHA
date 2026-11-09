# Curso com IA: imagens da capa e dos módulos (Claude + OpenAI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Claude escreve o pedido de cada imagem (capa e abertura dos módulos; capa do curso presencial) e a API de imagens da OpenAI gera; tudo em WebP, contado no painel.

**Architecture:** Lib nova `src/lib/ead-imagens.js` (pedidos do Claude, geração na OpenAI, gravar/gerar outra, contadores). `ead-ia.js` ganha o passo `FOTOS_GERANDO` e o custo avulso do mês; a fila processa esse passo com a marca da geração. Painel do EAD e formulário do curso presencial ganham os botões. `upload.js` passa a converter GIF em WebP animado.

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, `@anthropic-ai/sdk` (cliente da etapa 9), fetch nativo (OpenAI REST), sharp, node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-ead-ia-fotos.md`

## Global Constraints

- Alvos: `Curso.imagemUrl` (capa do online e imagem do presencial) e `ModuloEad.fotoIntroUrl`; nada em telas/cenários.
- Claude: mesmo cliente/`MODELO` da etapa 9, `effort: 'low'`; devolve `pedido` (inglês, ≤600), `pedidoCurto` (≤200) e `descricao` (português, ≤200); regras do §2 da spec no system prompt (realista, horizontal, espaço à esquerda, sem texto/logotipo, sem sangue/sofrimento, sem rosto de criança em destaque, **sem o símbolo da Cruz Vermelha** — cruz verde/branca ou nenhuma, brasileiros, estilo comum no curso).
- OpenAI: `POST https://api.openai.com/v1/images/generations`, `Authorization: Bearer <OPENAI_API_KEY>`, body `{ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1536x1024', quality: 'medium', n: 1 }`, resposta `data[0].b64_json`.
- Recusa/falha: uma nova tentativa com `pedidoCurto`; falhou de novo → alvo vazio, descrição mantida.
- Guardado via `salvarFotoCurso({ buffer, mimetype: 'image/png' })` (vira WebP); nome do arquivo segue o de `salvarFotoCurso`.
- Sem limite mensal; contadores `ead-ia:imagens:<AAAA-MM>` (fuso do Rio) e `ead-ia:imagens:total`; texto "Imagens geradas com IA: N neste mês · M no total".
- Botões do EAD só preenchem vazio; o do presencial troca (com confirmação) e apaga a antiga.
- Erro no passo da geração: CONCLUIDA mesmo assim, aviso "As imagens não puderam ser geradas; use o botão Gerar imagens com IA na página do curso."
- Sem `OPENAI_API_KEY`: grava só descrições/pedidos, aviso "Sem chave da OpenAI: as descrições do Claude estão em cada módulo, envie as imagens."
- Custo do Claude nos botões: `ead-ia:custo-avulso:<AAAA-MM>`, somado em `gastoDoMes`; teto do Claude estourado → não chama.
- GIF enviado pelo painel → WebP animado.

## Review Focus

- Resposta da OpenAI sem `b64_json` (formato inesperado, ex.: `url`): baixa a URL ou trata como falha, nunca grava arquivo vazio. → teste na Task 1.
- OpenAI demorando mais de 120 s: aborta (AbortSignal) e trata como falha, sem prender o passo da fila para sempre. → teste na Task 1.
- Curso/módulo apagado durante o passo da geração: termina sem erro e conclui. → teste na Task 3.
- Duplo clique em "Gerar imagens com IA": não gera duas imagens para o mesmo alvo nem deixa arquivo órfão. → advisory lock por curso (Task 2), teste de duplo POST (Task 4).
- Enviar imagem própria depois de uma gerada: desliga o selo e "Gerar outra" some até haver pedido de novo… o pedido continua, então "Gerar outra" continua disponível e substitui a enviada só se a pessoa clicar. → teste na Task 4.

---

### Task 1: Claude escreve os pedidos; OpenAI gera (lib, sem banco)

**Files:**
- Create: `src/lib/ead-imagens.js`
- Modify: `src/lib/ead-ia-esquema.js` (esquema/validador), `src/lib/ead-ia.js` (`chamarClaude` aceita `effort`, default `'high'`)
- Test: `test/ead-imagens.test.js`; `test/helpers/ia-falso.js` (`openaiFalso`, `pedidosImagensBons`)

**Interfaces:**
- Produces:
  - `E.ESQUEMA_PEDIDOS_IMAGENS` → `{ capa: {pedido,pedidoCurto,descricao}, modulos: [{ moduloId, pedido, pedidoCurto, descricao }] }`; `E.validarPedidosImagens(json, moduloIds) -> { ok, pedidos } | { ok:false, erro }` (corta nos limites; descarta módulo desconhecido; capa obrigatória).
  - `img.temOpenAI() -> boolean`.
  - `img.pedirAoClaude({ curso: { nome, descricao, categoria }, modulos: [{ id, titulo, topicos:[titulo] }] }, { cliente }) -> Promise<{ pedidos, usage }>` (com `modulos: []` serve ao presencial).
  - `img.gerarNaOpenAI(prompt, { fetch, timeoutMs = 120000 }) -> Promise<Buffer>` — lança `ErroImagem` (mensagem em português) em HTTP ≠ 200, recusa, timeout ou resposta sem imagem (`b64_json`; se vier `url`, baixa).
  - `img.gerarComReserva({ pedido, pedidoCurto }, { fetch }) -> Promise<Buffer|null>` — tenta `pedido`, depois `pedidoCurto`; ambas falham → `null`.
- [ ] **Step 1: Testes que falham** (`test/ead-imagens.test.js`, sem banco): body enviado à OpenAI (`model` padrão `gpt-image-1` e o da variável, `size 1536x1024`, `quality medium`, `n 1`, `prompt` = pedido) e header `Authorization: Bearer …`; `b64_json` vira Buffer; resposta com `url` baixa a URL; HTTP 400 de política → `gerarComReserva` tenta `pedidoCurto`; as duas falham → `null`; timeout (fetch falso que nunca responde, `timeoutMs: 50`) → falha; `validarPedidosImagens` corta e descarta; `pedirAoClaude` manda `effort: 'low'` e o system contém "Red Cross" e "no text".
- [ ] **Step 2:** `node --test test/ead-imagens.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): pedidos de imagem pelo Claude e geração na OpenAI`.

### Task 2: Gravar, gerar outra, contadores, WebP do GIF (banco)

**Files:**
- Create: `prisma/migrations/20261113120000_ead_ia_imagens/migration.sql`
- Modify: `prisma/schema.prisma`, `src/lib/ead-imagens.js`, `src/lib/ead-ia.js` (`somarCustoAvulso`, `gastoDoMes`), `src/lib/upload.js` (GIF → WebP animado)
- Test: `test/ead-imagens-db.test.js`, `test/upload-webp.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Colunas: `ModuloEad.fotoPedido String?`, `fotoSugestao String?`, `fotoGeradaPorIa Boolean @default(false)`; `Curso.imagemPedido String?`, `imagemSugestao String?`, `imagemGeradaPorIa Boolean @default(false)`.
  - `img.imagensDoCursoOnline(cursoOnlineId, { cliente, fetch, custo }) -> Promise<{ geradas, descricoes, aviso }>` — lock `imagens:<cursoOnlineId>`; só alvos vazios; grava pedido/descrição sempre; com OpenAI gera, guarda, liga `…GeradaPorIa`, soma contadores. `custo(usage)` chamado no uso do Claude.
  - `img.imagemDoCurso(cursoId, { cliente, fetch, custo }) -> Promise<{ ok:true } | { ok:false, erro }>` — presencial: sempre gera (troca), apaga a antiga depois de gravar a nova.
  - `img.gerarOutra({ tipo: 'curso'|'modulo', id }, { fetch }) -> Promise<{ ok } | { ok:false, erro }>` — usa o pedido guardado; sem pedido: "Ainda não há pedido de imagem: use Gerar imagens com IA."
  - `img.contagem() -> Promise<{ mes:number, total:number }>`.
  - `IA.somarCustoAvulso(usage)`; `IA.gastoDoMes()` inclui o avulso.
- [ ] **Step 1: Testes que falham:** curso online com capa vazia e 2 módulos (um com foto): só capa e o módulo vazio ganham imagem (`/uploads/*.webp`), pedido, descrição e selo; o outro fica igual; `geradas === 2`; contadores +2; sem chave: só descrições, fetch não chamado, aviso; OpenAI recusa as duas tentativas num módulo: ele fica vazio com descrição; `imagemDoCurso` troca a imagem do presencial e o arquivo antigo some de `uploads/`; `gerarOutra` gera nova e apaga a antiga; `somarCustoAvulso` sobe `gastoDoMes`; `salvarFotoCurso` com um GIF devolve `.webp`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Schema + migração (só `ADD COLUMN`), `npx prisma migrate deploy && npx prisma generate`; implementar; `comprimirImagem` com GIF: `sharp(buffer, { animated: true }).resize(...).webp(...)`.
- [ ] **Step 4:** passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): gravar imagens geradas, gerar outra e contar; GIF vira WebP`.

### Task 3: Passo "imagens" na geração com IA

**Files:**
- Modify: `src/lib/ead-ia.js` (`EM_ANDAMENTO` + `'FOTOS_GERANDO'`; `gerarImagens(geracaoId, { cliente, fetch })`), `src/lib/ead-ia-fila.js`, `src/views/admin/ead/ia-geracao.ejs`, `src/views/admin/ead/ia-lista.ejs`
- Test: `test/ead-ia-fila.test.js`, `test/ead-ia-passos-painel.test.js`

**Interfaces:**
- Consumes: `img.imagensDoCursoOnline` (Task 2).
- Produces: fila — módulos terminados → `FOTOS_GERANDO` (em vez de CONCLUIDA); passo de `FOTOS_GERANDO` com `comMarca(chave(id))` chama `IA.gerarImagens`, que sempre termina com `updateMany({ status:'FOTOS_GERANDO' } → { status:'CONCLUIDA', materialPdfs: DbNull })` e, em erro, guarda `pedido.avisoImagens`. Rótulos: "Gerando as imagens…" / lista "Gerando as imagens"; conta como andando e passo 4. `img.definirFetch(f)` para os testes.
- [ ] **Step 1: Testes que falham:** geração com módulos prontos passa por `FOTOS_GERANDO` e conclui com capa e módulos com imagem (OpenAI falsa); Claude falha no passo → CONCLUIDA com `pedido.avisoImagens` e a página mostra o aviso; curso apagado antes do passo → CONCLUIDA sem erro; página em `FOTOS_GERANDO` mostra "Gerando as imagens…".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar; ajustar testes antigos da fila só onde a conclusão agora passa pelo passo (sem `OPENAI_API_KEY` no ambiente de teste ele só grava descrições e conclui).
- [ ] **Step 4:** passa; `npm test` verde.
- [ ] **Step 5:** Commit `feat(ead-ia): passo de imagens no fim da geração`.

### Task 4: Painel — botões, selo, descrição, contagem; presencial

**Files:**
- Modify: `src/routes/ead.js`, `src/routes/admin.js` (curso presencial), `src/views/admin/ead/curso.ejs`, `src/views/admin/ead/modulo-form.ejs`, `src/views/admin/ead/ia-lista.ejs`, `src/views/admin/curso-form.ejs`, `src/public/ead-admin.css`, `docs/ead/como-publicar-um-curso.md`
- Test: `test/ead-imagens-painel.test.js`

**Interfaces:**
- Consumes: Task 2 (`imagensDoCursoOnline`, `imagemDoCurso`, `gerarOutra`, `contagem`, `temOpenAI`), `IA.dentroDoTeto`, `IA.somarCustoAvulso`.
- Produces (POST com CSRF, redirect + flash):
  - `POST /ead/curso/:id/imagens-ia` → flash `"<n> imagens geradas."` / `"Nada para preencher: a capa e os módulos já têm imagem."` / aviso; audita `EAD_IMAGENS_IA`.
  - `POST /ead/curso/:id/capa/gerar-outra`, `POST /ead/modulo/:id/foto/gerar-outra` → "Imagem nova gerada." ou o erro.
  - `POST /cursos/:id/imagem-ia` (admin.js, `cursos:gerenciar`) → "Imagem do curso gerada." ou erro; audita `CURSO_IMAGEM_IA`.
  - Envio manual de imagem (curso, módulo, presencial) desliga `…GeradaPorIa`.
  - `/ead/ia` (lista, junto do teto): "Imagens geradas com IA: N neste mês · M no total".
  - Selo "Imagem gerada por IA" + "Descrição: …" nas três telas; botões só com `OPENAI_API_KEY` (o do EAD sem chave grava descrições).
- [ ] **Step 1: Testes que falham:** botão do EAD gera e o flash diz "2 imagens geradas."; segundo clique "Nada para preencher…"; duplo POST simultâneo: cada alvo com uma imagem e nenhum arquivo a mais em `uploads/`; teto do Claude estourado não chama o Claude falso; "Gerar outra" do módulo troca a imagem; presencial: `POST /cursos/:id/imagem-ia` troca a imagem e mostra o selo no formulário; enviar imagem manual desliga o selo; `/ead/ia` mostra a contagem.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar; manual com a seção "Imagens com IA" (chave `OPENAI_API_KEY` no Render, serviço da secretaria; custo aproximado; regra da Cruz Vermelha).
- [ ] **Step 4:** passa; `npm test` verde. Prints do painel (curso online, módulo, curso presencial, contagem) e da página do aluno com capa e imagem de módulo (OpenAI falsa com uma imagem de exemplo).
- [ ] **Step 5:** Commit `feat(painel): gerar imagens com IA no EAD e no curso presencial`.
