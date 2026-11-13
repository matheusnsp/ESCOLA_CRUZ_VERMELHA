# Webinários (Escola Digital, fase 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (escolhido pela pessoa: inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Webinários ao vivo e/ou gravados na Escola Digital, grátis ou pagos, com inscrição, lembretes, transmissão pelo site, gravação embutida e certificado de participação por palavra-código.

**Architecture:** Igual ao e-book. `Webinario` 1–1 com um **curso escondido** (`ativo: false`). A compra é uma matrícula na turma online desse curso (`turmaOnline`). A inscrição grátis e a inscrição pós-pagamento ficam em `InscricaoWebinario`. A presença fica em `PresencaWebinario`, que é dona do número do certificado. A lib `lib/webinario.js` espelha `lib/ebook.js`. As rotas `routes/ead-webinarios.js` (painel, DEV) e `routes/webinarios.js` (site) espelham as de e-book.

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, node:test, Playwright (só na revisão visual).

**Spec:** `docs/superpowers/specs/2026-11-13-escola-digital-webinarios-design.md`

## Global Constraints
- Fuso **America/Sao_Paulo** em toda data/hora mostrada e calculada (formatar com `timeZone: 'America/Sao_Paulo'`; `.ics` como `lib/agenda.js`, UTC-3).
- **Nunca** mostrar vagas, ocupadas, restantes ou número de inscritos no site (os testes procuram por "vaga", "restam", "ocupad").
- `linkAoVivo` e `gravacaoUrl` só vão para o HTML de quem tem acesso e está na situação que os mostra. A transmissão passa por `…/entrar-na-transmissao` (redirect); o link nunca fica na página nem nos e-mails.
- Janela do ao vivo: abre **30 min antes** de `inicioEm` e fecha **30 min depois** de `inicioEm + duracaoMin`.
- Palavra-código: comparação sem maiúsculas, sem acentos e sem espaços nas pontas; **10 tentativas por pessoa por webinário por hora** (tabela `TentativaPalavraWebinario`).
- Publicar exige palavra-código **e** (`inicioEm` **ou** `gravacaoUrl`). Gravação via `normalizarVideo` (`lib/ead.js`), erro `'Use um link do YouTube ou do Vimeo.'`.
- Conta obrigatória para inscrever, comprar, assistir e pegar certificado; a página é pública.
- Painel: modo Online, só DEV (`requireDev`, como e-books); menu "Conteúdos › Webinários" depois de E-books.
- CSP: sem JS inline novo; textos em português do Brasil, no tom dos atuais.

## Review Focus
1. Webinário **despublicado ou Escola Digital desligada** com inscrito → o inscrito continua vendo a página, a transmissão e o certificado; visitante recebe 404. Teste na Task 3.
2. **Mudança de `inicioEm` depois que já passou** (evento remarcado para o futuro) → a situação volta a "antes da janela", os lembretes zeram e a presença já registrada continua valendo. Teste nas Tasks 2 e 6.
3. **Estorno** de webinário pago → perde o acesso (sem links, sem lembretes); o certificado já emitido continua abrindo. Teste nas Tasks 3 e 6.
4. Palavra-código com **espaços internos e acentos** ("Cruz  Vermelha" × "cruz vermelha"; "Coração" × "coracao") → aceita espaços nas pontas e acentos, mas não colapsa espaços internos. Teste na Task 4.
5. Webinário **só gravado com `inicioEm` vazio** em vitrine, lembretes e certificado → nunca dá erro de data nula; o certificado diz "modalidade gravada". Teste nas Tasks 5, 6 e 7.

---

### Task 1: Modelo, lib e filtros
**Files:** `prisma/schema.prisma`, migração `prisma/migrations/20261117120000_webinarios/migration.sql`, `src/lib/webinario.js` (novo), `src/lib/ead-curso-online.js:70-77`, filtros `ebook: null` em `src/lib/assistente-ferramentas.js:182`, `src/lib/planilha-ao-vivo.js:256`, `src/routes/cursos.js:477`, `src/routes/ead.js:108`, `src/server.js:338`; testes `test/webinario.test.js`, `test/webinario-filtros.test.js`.

**Produces:**
- Modelos do spec §1: `Webinario` (com `curso` 1–1 `onDelete: Restrict`), `InscricaoWebinario`, `PresencaWebinario`, `TentativaPalavraWebinario`, `Curso.webinario Webinario?` e `CupomEad.webinarioId String?` (Restrict). Usuário em cascata nas três tabelas por pessoa.
- `lib/webinario.js`: `endereco(nome)`, `salvar(entrada, foto=null, id=null) -> Promise<{ ok, webinario? , erro? }>`, `doEndereco(end, { incluirRascunho })`, `porId(id)`, `acesso(usuarioId, w) -> { situacao: 'sem'|'gratis'|'pendente'|'pago'|'cancelado', matricula? }` (mesma tabela SITUACAO do e-book; grátis = `InscricaoWebinario`), `temAcesso(a) -> bool` (`gratis|pago`), `janela(w, agora) -> 'sem-data'|'antes'|'dentro'|'depois'`, `situacaoCartao(w, a, agora) -> string` (um código por linha da tabela §3: `visitante|encerrado-sem-gravacao|inscrever|comprar|pendente|inscrito-antes|transmissao|transmissao-sem-link|gravacao|gravacao-em-breve`), `normalizarPalavra(s)`, `excluir(id)`, `cargaHorasDe(duracaoMin) = ceil(min/60)`.
- `idsSoOnline()` inclui os `cursoId` de webinário (assim `semSoOnline`/`ehSoOnline` já excluem). Os 5 filtros explícitos viram `ebook: null, webinario: null`.

- [ ] Testes: `endereco('Primeiros Socorros: Bebês')` = slug do e-book; `salvar` publicando sem palavra → erro "Para publicar, defina a palavra-código."; publicando sem data e sem gravação → "Para publicar, informe a data do ao vivo ou o link da gravação."; gravação `https://x.com/v` → `'Use um link do YouTube ou do Vimeo.'`; `duracaoMin` 0 → erro; trocar `gratuito` com inscrição/matrícula existente → "Não dá para trocar entre grátis e pago depois que alguém se inscreveu."; `janela` com relógio fixo (29 min antes = antes, 30 min antes = dentro, fim+30 = dentro, fim+31 = depois, sem `inicioEm` = sem-data); `normalizarPalavra('  Coração ')` = `'coracao'` e `'Cruz  Vermelha'` ≠ `'cruz vermelha'`; `excluir` com inscrição → recusa; o curso escondido não aparece em `semSoOnline`, nem no seletor de cursos (`/cursos` do painel), nem na vitrine de cursos. → FAIL → implementar (+ `npx prisma migrate dev` local) → PASS → commit.

### Task 2: Painel (modo Online → Webinários)
**Files:** `src/routes/ead-webinarios.js` (novo, fábrica `rotasWebinarios({ requireDev, auditar })` montada ao lado de `rotasEbooks` em `routes/admin.js:500`), views `src/views/admin/ead/webinarios.ejs`, `webinario-form.ejs`, `webinario-inscritos.ejs`, `src/lib/menu-painel.js:67`, `src/lib/assistente-manual.md`, `src/lib/assistente-contexto.js:40`; teste `test/webinario-painel.test.js`.

**Consumes:** Task 1 (`salvar`, `excluir`, `porId`). E-mails da Task 6 (`email.enviarWebinarGravacao`, `email.enviarWebinarNovoHorario`) — nesta task, chamados via `require('../lib/email')` e espionados no teste.

**Produces:** rotas `GET /ead/webinarios` (lista: capa, título, quando "20/11/2026 às 19h"/"Gravado", preço/"Grátis", publicado/rascunho, inscritos, presenças, vendas pagas, ↑↓), `POST /ead/webinarios/ordem/:id/:dir` (renumera 0..n-1 como `routes/ead.js:131`), `GET|POST /ead/webinarios/novo`, `GET|POST /ead/webinarios/:id`, `GET /ead/webinarios/:id/inscritos`, `GET /ead/webinarios/:id/inscritos.csv`, `POST /ead/webinarios/:id/excluir`, FAQs (`:id/faqs`, `:id/faqs/:faqId/remover`, como e-book). Capa por `salvarFotoCurso`. Ações de auditoria `CRIOU_WEBINARIO`, `EDITOU_WEBINARIO`, `EXCLUIU_WEBINARIO`.
- Ao salvar: `gravacaoUrl` nova, com `janela === 'depois'`, inscritos e `gravacaoAvisadaEm` vazio → `enviarWebinarGravacao` para cada inscrito com acesso e marca `gravacaoAvisadaEm`. `inicioEm` alterado com inscritos → zera `lembrete24hEm`/`lembrete1hEm` e manda `enviarWebinarNovoHorario` com o .ics novo.
- Menu: item `{ id: 'webinarios', rotulo: 'Webinários', href: '/ead/webinarios', pode: SEMPRE }` em "Conteúdos", depois de E-books. Manual: seção `## Webinários (Conteúdos › Webinários)`. Catálogo do assistente: `'/ead/webinarios': { params: [], dev: true }`.

- [ ] Testes (app de teste como `test/ebook-painel.test.js`): criar rascunho → aparece na lista com "Rascunho"; publicar sem palavra → mensagem da Task 1 na tela; ↑↓ troca a ordem; inscritos mostra nome, e-mail, forma (grátis/pago) e presença; CSV com cabeçalho `Nome;E-mail;Inscrito em;Forma;Presença`; excluir com inscrição → "despublique"; gravação nova depois do fim → 1 e-mail por inscrito e, salvando de novo, nenhum; mudar `inicioEm` → lembretes zerados e e-mail de novo horário; o teste do manual do assistente (`test/assistente-contexto.test.js`) continua passando com o item novo. → FAIL → implementar → PASS → commit.

### Task 3: Site — página, inscrição, compra e transmissão
**Files:** `src/routes/webinarios.js` (novo, montado em `server.js` ao lado de `routes/ebooks.js:348`), view `src/views/webinario.ejs` (topo/fim `ead-teste/_topo`/`_fim`), `src/lib/vitrine.js` (`urlWebinario(curso)` → `/escola-digital/webinario/<slug>`), `src/lib/agenda.js` (`icsDoWebinario(w, url)`), `src/lib/status-pagamento.js:61-70` (turma online de webinário: cria `InscricaoWebinario` e chama `email.enviarWebinarConfirmado`), `src/lib/cobranca-avista.js:138-141` (destino pós-pagamento = página do webinário), `src/routes/cursos.js:1297-1301` (`maxParcelasOnline` lê `Webinario.maxParcelas`), `src/lib/ead-cupom.js` (alvo `webinario:<id>`, seletor "Vale para"), `src/routes/ead.js:713,725`; testes `test/webinario-site.test.js`, `test/webinario-compra-cupom.test.js`.

**Consumes:** Task 1 (`doEndereco`, `acesso`, `situacaoCartao`, `janela`); `compra` de `routes/ead-online.js` (`matriculaDaCompra`, `gravarCupom`, `liberarSemPagamento`), `iniciarCobrancaAVista`, `cupons.validarCupom(codigo, w, { webinario: true })`.

**Produces:** `GET <página>`, `GET …/criar-conta`, `GET …/entrar`, `POST …/inscrever` (grátis: cria `InscricaoWebinario` + `enviarWebinarConfirmado`), `POST …/comprar` (igual ao e-book; nome da cobrança `'<título> (webinário)'`), `GET …/entrar-na-transmissao` (acesso + janela `dentro` + `linkAoVivo` → 302 para o link; senão 302 para a página), `GET …/agenda.ics` (só com acesso e `inicioEm`). `inscrever`/`comprar` recusam na situação `encerrado-sem-gravacao`. Carregar como `ebooks.js carregar()`: rascunho/Escola desligada só para DEV ou quem tem acesso.

- [ ] Testes com relógio fixo (injetar `agora` como no e-book, ou `?agora=` só em teste): uma página por situação do §3 com o texto esperado (visitante "Criar conta e inscrever-se"; grátis logado "Inscrever-se"; inscrito antes "Você está inscrito" e o HTML **sem** o `linkAoVivo`; dentro da janela "Entrar na transmissão" e ainda sem o link no HTML; `entrar-na-transmissao` fora da janela ou sem acesso → 302 para a página, dentro → 302 para o link; depois com gravação → iframe com a `gravacaoUrl`; pendente → sem links; encerrado sem gravação → "Este webinário já aconteceu" e `POST inscrever` recusado); nenhum HTML contém /vaga|restam|ocupad/i; despublicado: inscrito vê, visitante 404; pago confirmado por `aplicarStatus(... 'paid')` → `InscricaoWebinario` criada e e-mail de confirmação; estorno → situação `cancelado`, sem links; cupom de webinário vale só para ele, cupom geral vale, cupom de e-book não vale; `.ics` com `DTSTART` em horário de Brasília. → FAIL → implementar → PASS → commit.

### Task 4: Palavra-código e presença
**Files:** `src/lib/webinario.js` (`confirmarPresenca`), `src/routes/webinarios.js` (`POST …/palavra-codigo`), `src/views/webinario.ejs` (bloco abaixo do cartão); teste `test/webinario-presenca.test.js`.

**Produces:** `confirmarPresenca(usuarioId, w, palavra, agora) -> Promise<{ ok: true, nova: bool } | { ok: false, erro: 'nao-confere'|'tentativas'|'sem-acesso'|'cedo' }>`. Grava a tentativa antes de comparar; conta as da última hora (`TentativaPalavraWebinario`); com acerto, cria `PresencaWebinario` (único por par) e devolve `nova` só na primeira. Mensagens: "Palavra-código não confere.", "Muitas tentativas. Tente de novo daqui a pouco." O bloco aparece a partir de `inicioEm` (ou sempre, se só gravado), só para quem tem acesso; quem tem presença vê só "Ver certificado".

- [ ] Testes: errada → "não confere"; certa com maiúsculas/acentos/espaços nas pontas → presença; 11ª tentativa na hora → bloqueio, mesmo com a palavra certa; a 1ª tentativa de uma hora depois passa; antes de `inicioEm` → bloco ausente no HTML e POST `cedo`; sem acesso → `sem-acesso`; segunda confirmação → `nova: false`, uma linha só; `'Cruz  Vermelha'` com a palavra `'Cruz Vermelha'` → não confere (Review Focus 4). → FAIL → implementar → PASS → commit.

### Task 5: Certificado de participação
**Files:** `src/lib/webinario-certificado.js` (novo), `src/views/admin/certificado-imprimir.ejs` (ramo `c.webinario`), rota `GET …/certificado` em `src/routes/webinarios.js`; teste `test/webinario-certificado.test.js`.

**Consumes:** `reservarNumero(presenca.id, 'PresencaWebinario', livro)` (`lib/certificado.js:117`), `assinaturasDoCurso(curso, ajustes)` e `dataRio` (`lib/ead-certificado.js`), `redacao.registrarCertificados`, `email.enviarCertificadoEadPronto` (link da página do certificado).

**Produces:** `emitirCertificadoWebinario(presencaId, { enviarEmail, linkCertificado, documentoAluno }) -> Promise<item da lista do certificado-imprimir>`, com `c.webinario = { titulo, apresentador, data: 'dd/mm/aaaa'|null, gravado: bool }` e `cargaHoraria = cargaHorasDe(duracaoMin)`. Ramo da view: selo **WEBINÁRIO**; frase "Portador(a) do documento …, participou do webinário **<TÍTULO>**, promovido pela Cruz Vermelha Brasileira – Filial Rio de Janeiro, realizado em **dd/mm/aaaa**, com duração de **NN horas**." (só gravado: "…na modalidade gravada, com duração de …"); sem a ressalva "Capacitação teórica…"; verso com título, apresentador (se houver), data ou "Gravado", duração, e sem conteúdo programático.

- [ ] Testes: sem presença → 302 para a página; com presença → HTML com "WEBINÁRIO", "participou do webinário", a data do ao vivo em America/Sao_Paulo e "02 horas" para 90 min; só gravado → "modalidade gravada" e nenhum "null"/"Invalid"; duas aberturas → mesmo livro/registro; e-mail só na primeira; estorno depois da presença → certificado ainda abre (Review Focus 3). → FAIL → implementar → PASS → commit.

### Task 6: E-mails e lembretes
**Files:** `src/lib/email.js` (`enviarWebinarConfirmado(email, nome, { webinario, link, ics })`, `enviarWebinarLembrete(email, nome, { webinario, link, quando: '24h'|'1h' })`, `enviarWebinarNovoHorario(email, nome, { webinario, link, ics })`, `enviarWebinarGravacao(email, nome, { webinario, link })`, todos com `moldura`), `src/lib/webinario-lembretes.js` (novo), `src/server.js:395-408`; teste `test/webinario-lembretes.test.js`.

**Produces:** `processarLembretesWebinario(agora) -> Promise<{ enviados24h, enviados1h }>`. Para cada webinário publicado com `inicioEm` futuro: inscrições sem `lembrete24hEm`, quando faltam ≤ 24 h e a inscrição foi feita > 24 h antes do início → envia e marca; idem 1 h (inscrição > 1 h antes). Confere o acesso na hora de enviar (estornado não recebe). Job: `setInterval(() => processarLembretesWebinario(new Date()).catch(...), 10 * 60 * 1000).unref()`. Nenhum e-mail leva `linkAoVivo`; a confirmação anexa o .ics só quando há `inicioEm`.

- [ ] Testes (relógio fixo, e-mails espionados): 23 h antes → 1 lembrete de 24 h e, rodando de novo, nenhum; 50 min antes → 1 lembrete de 1 h; inscrito 30 min antes do início → nenhum; estornado → nenhum; `inicioEm` remarcado para depois (Task 2 zera) → os lembretes saem de novo no horário novo; só gravado → ignorado sem erro; nenhum corpo de e-mail contém o `linkAoVivo`. → FAIL → implementar → PASS → commit.

### Task 7: Vitrine, Minha conta e exclusão de conta
**Files:** `src/lib/webinario.js` (`daVitrine(agora)`, `meus(usuarioId)`), `src/routes/cursos.js:298-307`, `src/views/escola-digital.ejs`, `src/views/partials/ed-linha-webinarios.ejs` (novo, como `ed-linha-ebooks.ejs`), `src/routes/painel.js` (`secValidas` + 'webinarios'), `src/views/minha-conta.ejs`, `src/views/partials/conta-webinarios.ejs` (novo), `src/lib/excluir-conta.js:25-32`; teste `test/webinario-vitrine.test.js`.

**Produces:** `daVitrine(agora)`: publicados; primeiro os com `inicioEm` futuro (mais perto primeiro), depois os já realizados com gravação e os só gravados (por `ordemVitrine`); realizado sem gravação fica de fora. Cartão: capa, título, "Ao vivo · 20/11 às 19h" ou "Gravado", preço ou "Grátis", "Você está inscrito" para quem tem acesso. Fileira "Webinários" depois de "E-books", só com algum publicado. `meus(usuarioId)`: título, quando, link, e o certificado se tiver presença. `excluir-conta`: matrícula paga de webinário entra na mesma exceção da de e-book.

- [ ] Testes: sem publicados → a fileira não aparece; futuro antes do gravado; realizado sem gravação fora; só gravado sem `inicioEm` aparece sem erro (Review Focus 5); Minha conta lista o webinário com "Certificado" quando há presença; excluir conta com webinário pago não é bloqueado, e inscrição, presença e tentativas somem. → FAIL → implementar → PASS → commit.

### Task 8: Revisão e PR
- [ ] Prints 390/820/1280 (claro/escuro) da página do webinário em cada situação, da vitrine, do painel (lista, formulário, inscritos) e do certificado, no servidor local; `npm test`; revisão final do branch por um revisor novo; PR.
