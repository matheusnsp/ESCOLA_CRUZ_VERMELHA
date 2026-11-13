# Cursos e Turmas: telas novas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Curso e turma passam a abrir num resumo com cartões e cada parte vira uma tela curta com seu salvar; criar curso em 3 passos; menu separado em Cursos e Turmas; IA opcional em cada lugar; assistente atualizado.

**Architecture:** As rotas de curso e de resumo da turma saem do `admin.js` (3 mil linhas) para dois roteadores-fábrica montados nele, no padrão de `contas.js` (`require('./painel-cursos')({ requirePermissao, auditar })`). Regras puras (o que cada seção grava, o que falta, mover dúvida, gerar aulas) ficam em libs pequenas, testadas sem servidor. As telas reaproveitam as classes de `admin.css` e os prints aprovados.

**Tech Stack:** Node 22 CommonJS, Express, EJS, Prisma/Postgres, `node:test`, Playwright (Chromium), helmet CSP (JS só em `src/public/js/`).

**Spec:** `docs/superpowers/specs/2026-11-13-cursos-turmas-telas-design.md` (prints em `docs/superpowers/specs/2026-11-13-cursos-turmas-telas/`).

## Global Constraints

- Nada salva sem a pessoa clicar: IA e assistente só preenchem campos.
- Permissões de hoje: resumo e seções do curso = `cursos:gerenciar`; Novo curso = `cursos:criar`; resumo da turma = `turmas:gerenciar`; listas = como hoje (`cursos:gerenciar|painel:leitura`, `turmas:gerenciar|painel:leitura`). Botão **Abrir** só para quem pode editar. Quem tem `cursos:criar` sem `cursos:gerenciar` volta para `/cursos?ok=Curso criado.`
- Links antigos continuam: `/cursos`, `/turmas`, `/cursos/novo`, `/turmas/nova`, `/turmas/:id/editar`; `/cursos/:id/editar` redireciona (302) para `/cursos/:id` (e `#duvidas` → `/cursos/:id/duvidas` não é possível no servidor; o resumo tem o cartão).
- Curso novo nasce `ativo: false` salvo se "Mostrar no site" vier marcado em "Mais detalhes".
- Regras que não mudam: excluir curso (sem turmas, matrículas, EAD ou cupom), excluir turma (sem matrícula), status automáticos da turma, assinaturas (até 4 no certificado).
- Texto de curso no modelo de 3 parágrafos (`lib/ia-textos.js`); toda IA nova via `ead-ia` (`dentroDoTeto`, `somarCustoAvulso`, `ehChaveConfigurada`), erro: "A IA não conseguiu agora; preencha à mão ou tente de novo."
- Cores só por variáveis de `admin.css` (claro/escuro); tudo usável a 390 px sem rolagem lateral.
- Português da secretaria. Nomes de botões: "Criar curso", "Salvar página", "Salvar valores", "Salvar certificado", "Salvar" (publicação), "Criar turma", "Salvar alterações".

## Review Focus

1. Salvar uma seção não apaga dados de outra (ex.: Salvar valores mantém foto, textos, conteúdo programático e assinaturas) — teste na Task 3.
2. O assistente preenche campos que estão num passo escondido do Novo curso e em "Mais detalhes" (o bloco abre sozinho) — teste na Task 6.
3. Gerar aulas com dados ruins (nenhum dia marcado, "até" antes do início, mais de 60 aulas, horário torto) mostra aviso e não quebra — teste na Task 9.
4. IA devolvendo lixo (preço "muito", curso que não existe, data 31/02) é filtrada pelas mesmas validações do assistente; campo inválido fica em branco — teste nas Tasks 7 e 10.
5. Pessoa com só `painel:leitura` abrindo `/cursos/:id` ou `/turmas/:id` direto pelo endereço recebe 403 (como a edição hoje) e não vê Abrir — teste nas Tasks 3 e 9.

---

### Task 1: Menu em dois grupos (Cursos / Turmas)

**Files:**
- Modify: `src/lib/menu-painel.js:28-36`
- Test: `test/menu-painel.test.js`

**Interfaces:**
- Produces: ids de item `cursos`, `curso-novo`, `turmas`, `turma-nova`, `matricula-rapida`, `horarios`, `boas-vindas` (as telas filhas usam `ativo: 'cursos'` / `'turmas'`; Novo curso usa `'curso-novo'`; Nova turma `'turma-nova'`).

- [ ] **Step 1: Teste** `menu: Cursos e Turmas em grupos separados` — `montarMenu({modo:'presencial', papel:'DEV', pode:()=>true})` tem grupo `{id:'cursos-grupo', rotulo:'Cursos'}` com itens `['Todos os cursos','Novo curso']` (hrefs `/cursos`, `/cursos/novo`) e grupo `{id:'turmas-grupo', rotulo:'Turmas'}` com `['Todas as turmas','Nova turma','Matrícula rápida','Mapa de horários','Mensagem de boas-vindas']`; não existe mais `cursos-turmas`; com `pode` só `painel:leitura`, Novo curso e Nova turma somem; `ativo:'curso-novo'` abre o grupo Cursos.
- [ ] **Step 2:** `node --test test/menu-painel.test.js` → FAIL.
- [ ] **Step 3:** Trocar o grupo `cursos-turmas` pelos dois grupos (ícones `fa-book-medical` e `fa-calendar-days`); Novo curso `pode: P('cursos:criar')`, Nova turma `pode: P('turmas:gerenciar')`. Atualizar os testes antigos que esperam `Cursos e turmas`.
- [ ] **Step 4:** `node --test test/menu-painel.test.js test/menu-header.test.js test/assistente-contexto.test.js` → PASS.
- [ ] **Step 5:** Commit `Menu: Cursos e Turmas em grupos separados`.

### Task 2: Regras das seções do curso e do "o que falta"

**Files:**
- Create: `src/lib/curso-secoes.js`, `src/lib/parse-form.js`
- Modify: `src/routes/admin.js` (passa a importar `parseInteiro`, `parseDecimal` de `lib/parse-form.js`)
- Test: `test/curso-secoes.test.js`

**Interfaces:**
- Produces:
  - `SECOES: { pagina, valores, certificado, publicacao }`, cada uma `{ rotulo, botao, caminho: (id) => string, campos: string[] }` — `pagina` = nome, descricao, descricaoLonga, cargaHoraria, escolaridadeMinima, categoria (foto à parte); `valores` = precoAvista, precoCheio, parcelas, taxaMatricula; `certificado` = nomeCertificado, conteudoProgramatico, certificadoValidade (+ assinaturas); `publicacao` = ativo, exigeComprovanteSaude. Rótulos/botões: "Página no site"/"Salvar página", "Valores"/"Salvar valores", "Certificado"/"Salvar certificado", "Inscrição e publicação"/"Salvar". Caminhos `/cursos/:id/pagina|valores|certificado|publicacao`.
  - `lerSecao(secao: string, body: object) -> { dados: object, extras: object, erro: string|null }` — `dados` só com colunas do `Curso` daquela seção, `extras` só com chaves de `lib/extras` daquela seção; validação igual a `lerCursoDoForm` para os campos da seção.
  - `secoesDosCampos(campos: object) -> Array<{ secao, rotulo, botao, campos }>` — agrupa um objeto de campos (o do assistente) pelas seções, na ordem pagina, valores, certificado, publicacao; `faqs` vira `{ secao: 'duvidas', rotulo: 'Dúvidas frequentes' }`.
  - `faltasCurso(c) -> string[]` (c com `imagemUrl`, `descricaoLonga`, `conteudoProgramatico`, `totalFaqs`): "Foto", "Texto completo", "Conteúdo do certificado", "Dúvidas frequentes".
  - `faltasTurma(t) -> string[]` (t com `totalAulas`, `inscritos`, `minimoAlunos`, `pendentes`, `inicioPrevisto`): "Aulas" (sem aulas), "Pagamentos pendentes" (pendentes>0), "Abaixo do mínimo" (inscritos<minimo e início no futuro).
  - `parseInteiro`, `parseDecimal` (movidos sem mudar comportamento).

- [ ] **Step 1: Testes** — `lerSecao('valores', {precoAvista:'1.200,00'...})` devolve `dados` só com as 4+`valorParcela` chaves e `extras` `{}`; `lerSecao('valores', {precoAvista:'muito'})` → erro "Verifique os valores (use numeros, ex.: 150.00)."; `lerSecao('pagina', {nome:''})` → "Informe o nome do curso."; `lerSecao('publicacao', {})` → `dados.ativo === false`, `extras.exigeComprovanteSaude === null`; `lerSecao('certificado', {conteudoProgramatico:'A\r\nB'})` → `extras.conteudoProgramatico === 'A\nB'` e `dados` `{}`; `secoesDosCampos({precoAvista:'1300.00', descricaoLonga:'x'})` → secoes `['pagina','valores']` com botões "Salvar página"/"Salvar valores"; `faltasCurso({imagemUrl:null, descricaoLonga:'t', conteudoProgramatico:null, totalFaqs:0})` → `['Foto','Conteúdo do certificado','Dúvidas frequentes']`; `faltasTurma({totalAulas:0, inscritos:9, minimoAlunos:10, pendentes:2, inicioPrevisto: amanhã})` → `['Aulas','Pagamentos pendentes','Abaixo do mínimo']`.
- [ ] **Step 2:** `node --test test/curso-secoes.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar; `lerCursoDoForm` do admin.js continua para o Novo curso (Task 6) e passa a usar `parse-form`.
- [ ] **Step 4:** `node --test test/curso-secoes.test.js` → PASS; `npm test` sem regressão.
- [ ] **Step 5:** Commit `Regras das seções do curso e do que falta`.

### Task 3: Resumo do curso e seções Página, Valores, Certificado, Publicação

**Files:**
- Create: `src/routes/painel-cursos.js`, `src/views/admin/curso-resumo.ejs`, `src/views/admin/curso-secao.ejs`, `src/views/admin/_curso-secao-pagina.ejs`, `_curso-secao-valores.ejs`, `_curso-secao-certificado.ejs`, `_curso-secao-publicacao.ejs`, `_rodape-salvar.ejs`
- Modify: `src/routes/admin.js` (montar `router.use(require('./painel-cursos')({ requirePermissao, auditar }))` junto do `contas`; remover `GET /cursos/:id/editar` e `POST /cursos/:id` e `POST /cursos/:id/excluir`; rotas de imagem e FAQ redirecionam para as telas novas), `src/public/admin.css` (cartões `adm-hub`, rodapé fixo `adm-rodape-salvar`, caixa `adm-perigo`, etiqueta `adm-tag-ia`)
- Test: `test/painel-cursos.test.js`

**Interfaces:**
- Consumes: `SECOES`, `lerSecao`, `faltasCurso` (Task 2).
- Produces: rotas `GET /cursos/:id([0-9a-f-]{36})`, `GET|POST /cursos/:id/:secao(pagina|valores|certificado|publicacao)`, `POST /cursos/:id/excluir`, `GET /cursos/:id/editar` → 302 `/cursos/:id`. Fábrica `module.exports = ({ requirePermissao, auditar }) => router`.

- [ ] **Step 1: Testes** (express com a fábrica, `requirePermissao` falso que lê `res.locals.pode`, banco local): resumo mostra os 6 cartões com os links das seções e "Falta o conteúdo programático" quando vazio; `POST /cursos/:id/valores` com preços novos grava só preços e redireciona `/cursos/:id?ok=Valores salvos.` **mantendo** `imagemUrl`, `descricaoLonga`, `conteudoProgramatico` e `certAssinaturas` (Review Focus 1); `POST .../pagina` com nome vazio volta 400 com "Informe o nome do curso." e os campos digitados; `POST .../certificado` com 5 assinaturas marcadas → erro "O certificado leva no máximo 4 assinaturas."; `/cursos/:id/editar` → 302 `/cursos/:id`; publicação de curso com turma mostra "Excluir curso" com `disabled` e o motivo, curso sem nada mostra botão ativo com `data-confirmar`; com `pode` só `painel:leitura`, `GET /cursos/:id` → 403 (Review Focus 5); a 390 px (Playwright, `curso-resumo` renderizado) `scrollWidth <= innerWidth`.
- [ ] **Step 2:** `node --test test/painel-cursos.test.js` → FAIL.
- [ ] **Step 3:** Implementar as rotas (Página trata foto como o `POST /cursos/:id` de hoje: enviar, remover, `imagemGeradaPorIa=false`; nome repetido de curso online barrado como hoje; `guardarEnderecoAntigo`), as views seguindo os prints `curso/sem-ia/05..08,11..13`, e mover a exclusão para dentro (mesmas checagens de hoje, volta para `/cursos?ok=Curso excluido.`). Auditoria: `EDITOU_CURSO` com `{ secao }`.
- [ ] **Step 4:** `node --test test/painel-cursos.test.js` e `npm test` → PASS.
- [ ] **Step 5:** Commit `Curso: resumo e seções com salvar próprio`.

### Task 4: Seção Dúvidas frequentes (editar e mudar a ordem)

**Files:**
- Create: `src/lib/curso-faqs.js`, `src/views/admin/curso-duvidas.ejs`, `src/public/js/faq-editar.js`
- Modify: `src/routes/painel-cursos.js` (rotas de FAQ saem do admin.js para cá), `src/views/admin/_ia-duvidas.ejs` (volta para a seção)
- Test: `test/curso-faqs.test.js`

**Interfaces:**
- Produces: `moverFaq(cursoId: string, faqId: string, direcao: 'subir'|'descer') -> Promise<boolean>` (troca `ordem` com a vizinha; normaliza 0..n-1 antes; `false` no topo/fim ou de outro curso); `editarFaq(cursoId, faqId, { pergunta, resposta }) -> Promise<{ ok, erro? }>` (cortes 200/1000, vazios → erro "Preencha a pergunta e a resposta."). Rotas `GET /cursos/:id/duvidas`, `POST /cursos/:id/faqs`, `/faqs-ia`, `/faqs/:faqId/remover|editar|subir|descer`, todas voltando para `/cursos/:id/duvidas`.

- [ ] **Step 1: Testes** — com 3 dúvidas: `moverFaq(c, f2, 'subir')` → ordem `[f2,f1,f3]`; `subir` no topo → `false` sem mudar; dúvida de outro curso → `false`; ordens repetidas (0,0,0) são normalizadas antes; `editarFaq` com pergunta vazia → erro; rota `POST .../faqs/:id/editar` redireciona para `/cursos/:id/duvidas`; a tela mostra Editar, setas e lixeira por dúvida e "Adicionar dúvida" (print `curso/sem-ia/09`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (edição inline: o botão Editar troca o texto por campos via `faq-editar.js`; sem JS, o formulário fica visível). **Step 4:** PASS + `npm test`. **Step 5:** Commit `Dúvidas: editar e mudar a ordem`.

### Task 5: Seção Turmas deste curso e lista de cursos

**Files:**
- Create: `src/views/admin/curso-turmas.ejs`
- Modify: `src/routes/painel-cursos.js`, `src/routes/admin.js` (`GET /cursos` calcula `faltas` por curso), `src/views/admin/cursos.ejs`
- Test: `test/painel-cursos.test.js` (novos casos)

- [ ] **Step 1: Testes** — `GET /cursos/:id/turmas` lista as turmas do curso com situação pelo nome da tela (`rotuloTurma`) e o link "Nova turma deste curso" `/turmas/nova?curso=ID`; a lista `/cursos` (render da view com dados) mostra filtros "Todos · N", "No site · N", "Fora do site · N" (links `status=ATIVO|INATIVO`), coluna Falta com os itens de `faltasCurso`, botão Abrir → `/cursos/:id` só quando `pode('cursos:gerenciar')`, e não mostra mais Ocultar/Excluir na linha.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (print `curso/sem-ia/01, 10`). **Step 4:** PASS. **Step 5:** Commit `Cursos: lista com Abrir e Falta; turmas do curso`.

### Task 6: Novo curso em 3 passos

**Files:**
- Create: `src/views/admin/curso-novo.ejs`, `src/public/js/curso-passos.js`
- Modify: `src/routes/painel-cursos.js` (`GET /cursos/novo`, `POST /cursos` saem do admin.js), `src/public/js/admin-assistente.js` (`acharFormulario` acha o form do Novo curso; ao preencher, chama `window.admPassos && window.admPassos.mostrarTudoQueVeio(campos)`), remover `src/views/admin/curso-form.ejs` quando nada mais usar
- Test: `test/curso-novo.test.js`

**Interfaces:**
- Produces: um `<form id="cursoNovo">` com os mesmos `name` de hoje (nome, cargaHoraria, categoria, escolaridadeMinima, precoAvista, precoCheio, parcelas, taxaMatricula, descricao, descricaoLonga, faqsIa[...], conteudoProgramatico, nomeCertificado, certificadoValidade, exigeComprovanteSaude, ativo) dividido em `<section data-passo="1|2|3">`; `<details id="maisDetalhes">` no passo 3. `window.admPassos = { ir(n), mostrarTudoQueVeio(campos) }` (abre `maisDetalhes` se veio algum campo dele; marca com `.adm-tag-ia` os campos preenchidos).

- [ ] **Step 1: Testes** (Playwright com a view renderizada + script): Continuar sem nome no passo 1 mostra "Informe o nome do curso." e não avança; Voltar/Continuar não enviam; o envio final manda todos os campos dos 3 passos; `mostrarTudoQueVeio({conteudoProgramatico:'A'})` abre `#maisDetalhes` (Review Focus 2); servidor: `POST /cursos` sem `ativo` cria com `ativo:false` e redireciona `/cursos/:id?ok=Curso criado.`; com só `cursos:criar` redireciona `/cursos?ok=Curso criado.`; erro de validação volta 400 no passo do campo (`data-passo-erro="2"` para preço).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (prints `curso/sem-ia/02..04`). **Step 4:** PASS + `npm test`. **Step 5:** Commit `Novo curso em 3 passos`.

### Task 7: "Começar com a IA" no Novo curso

**Files:**
- Create: `src/lib/ia-comecar.js`, `src/public/js/ia-comecar.js`
- Modify: `src/routes/painel-cursos.js` (`POST /cursos/ia-comecar`), `src/lib/assistente-ferramentas.js` (exportar `validarCurso`, `validarTurma`), `src/views/admin/curso-novo.ejs`
- Test: `test/ia-comecar.test.js`

**Interfaces:**
- Produces: `comecarCurso(texto: string, opts?: { cliente }) -> Promise<{ campos: object, textos: { descricao, descricaoLonga, conteudoProgramatico, faqs }, usage }>` — 1ª chamada (`IA.chamarClaude`, `effort: 'low'`, schema com os campos do Novo curso) extrai só o que está no texto; `campos` passa por `validarCurso` e campo com erro é descartado; depois `ia-textos.escrever({ tipo:'presencial', dados, ideias: texto })`. Rota → `{ ok:true, campos, textos }` ou `{ ok:false, erro }` (sem chave, teto, falha). Front: `iaComecar.preencher(form, resposta)` preenche e etiqueta "IA".

- [ ] **Step 1: Testes** (cliente falso `test/helpers/ia-falso.js`): resposta com `precoAvista:'muito'` e `categoria:'Culinária'` → esses campos ficam fora de `campos` (Review Focus 4); `cargaHoraria:120` → `'120'`; textos vêm de `escrever` com `ideias` = o texto da pessoa; texto vazio → erro "Escreva o que você sabe do curso."; teto estourado → `{ ok:false, erro: <msg do teto> }`; custo somado com `somarCustoAvulso` nas duas chamadas.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (prints `curso/com-ia/01..05`; aviso "A IA está preenchendo… leva uns 20 segundos."). **Step 4:** PASS. **Step 5:** Commit `Novo curso: começar com a IA`.

### Task 8: IA nas seções (Desfazer e conteúdo programático)

**Files:**
- Modify: `src/lib/ia-textos.js` (`sugerirConteudo`), `src/routes/painel-cursos.js` (`POST /cursos/:id/ia-conteudo`), `src/public/js/ia-textos.js` (Desfazer), `_curso-secao-pagina.ejs`, `_curso-secao-certificado.ejs`
- Test: `test/ia-textos.test.js` (novos casos), `test/painel-cursos.test.js`

**Interfaces:**
- Produces: `sugerirConteudo({ nome, descricaoLonga }, opts?) -> Promise<{ conteudo: string, usage }>` — um item por linha, até 4000 caracteres, sem preço. Desfazer: depois de "Reescrever", o botão "Desfazer" devolve os valores anteriores dos campos (guardados na memória da página), sem salvar.

- [ ] **Step 1: Testes** — `sugerirConteudo` com cliente falso devolve linhas limpas (sem "- " no começo, sem linhas vazias); rota responde `{ ok:true, conteudo }` e respeita teto; Playwright: reescrever (resposta falsa) → Desfazer volta o texto antigo.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (prints `curso/com-ia/06, 08`). **Step 4:** PASS. **Step 5:** Commit `IA: desfazer e sugerir conteúdo programático`.

### Task 9: Turma — lista, resumo, telas filhas e Gerar aulas

**Files:**
- Create: `src/routes/painel-turmas.js`, `src/views/admin/turma-resumo.ejs`, `src/public/js/gerar-aulas.js`
- Modify: `src/routes/admin.js` (montar a fábrica; `GET /turmas` aceita `q` e calcula `faltasTurma`), `src/views/admin/turmas.ejs` (só Abrir, busca), `src/views/admin/turma-form.ejs` (blocos Quando/Vagas/Situação/Instrutor + Gerar aulas), `turma-notas.ejs`, `turma-boas-vindas.ejs`, `turma-pesquisa-qr.ejs`, `turma-certificados.ejs` ("← Voltar à turma" → `/turmas/:id`)
- Test: `test/painel-turmas.test.js`, `test/gerar-aulas.test.js`

**Interfaces:**
- Consumes: `faltasTurma` (Task 2).
- Produces: `GET /turmas/:id([0-9a-f-]{36})` (resumo; EM_ESPERA/ONLINE redirecionam como a edição hoje); `gerarAulas({ inicio: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', dias: number[] /*0=dom*/, horario: string }) -> { aulas: Array<{ data, horario }>, erro: string|null }` (UMD: `module.exports` no Node, `window.gerarAulas` no navegador); erros: "Marque pelo menos um dia da semana.", "A data final é antes do início.", "Horário no formato 18:00 – 22:00.", "Mais de 60 aulas: diminua o período."

- [ ] **Step 1: Testes** — `gerarAulas({inicio:'2026-12-02', ate:'2026-12-18', dias:[2,4], horario:'18:00-22:00'})` → 6 aulas (02,04,09,11,16,18) com horário `18:00 – 22:00`; cada erro acima (Review Focus 3); resumo mostra os 6 cartões, a linha "vira Confirmada sozinha à 00:00 de dd/mm" para Aberta futura, "6 com pagamento pendente" quando há, caixa de excluir desabilitada com alunos e ativa sem alunos (`data-confirmar`); `painel:leitura` → 403 e lista sem Abrir (Review Focus 5); lista com `?q=soco` filtra pelo curso (sem acento); telas filhas têm link `/turmas/:id`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (prints `turma/sem-ia/01..11`). **Step 4:** PASS + `npm test`. **Step 5:** Commit `Turma: resumo, lista com Abrir e Gerar aulas`.

### Task 10: "Começar com a IA" na Nova turma

**Files:**
- Modify: `src/lib/ia-comecar.js` (`comecarTurma`), `src/routes/painel-turmas.js` (`POST /turmas/ia-comecar`), `src/views/admin/turma-form.ejs`, `src/public/js/ia-comecar.js`
- Test: `test/ia-comecar.test.js`

**Interfaces:**
- Produces: `comecarTurma(texto, opts?) -> Promise<{ campos, usage }>` — o schema pede `cursoNome`, `inicioPrevisto`, `aulas[]`, `vagas`, `minimoAlunos`, `instrutorNome`, `instrutorRegistro`; `cursoNome` vira `cursoId` só se bater com um curso presencial (mesma busca sem acento de `listar_cursos`); tudo passa por `validarTurma` e campo com erro é descartado.

- [ ] **Step 1: Testes** — curso inexistente → sem `cursoId`; data `2026-02-31` descartada; aulas com horário "18h às 22h" normalizadas para `18:00 – 22:00`; texto vazio → erro.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (prints `turma/com-ia/01..02`). **Step 4:** PASS. **Step 5:** Commit `Nova turma: começar com a IA`.

### Task 11: Assistente nas telas novas

**Files:**
- Modify: `src/lib/assistente-contexto.js` (CATALOGO: `/turmas` ganha `q`; REGISTROS: `/cursos/:id`, `/cursos/:id/(pagina|valores|certificado|duvidas|turmas|publicacao)` com `vistos.cursos`, `/turmas/:id`; SO_CONTEXTO: as páginas do curso; EXTRAS), `src/lib/assistente-manual.md` (seções "Cursos — presencial (Cursos › Todos os cursos)", "Novo curso", "Turmas (Turmas › Todas as turmas)" com resumo, seções, Gerar aulas, Começar com a IA), `src/lib/assistente-ferramentas.js` (`listar_cursos` anota `vistos.cursos`; `alvoEdicao('curso')` devolve `{ id, nome, secoes: secoesDosCampos(campos) }`; dúvidas de curso existente → evento com `secao:'duvidas'`), `src/public/js/admin-assistente.js` (cartão de edição de curso: um botão por seção "Abrir <rótulo> e preencher"; `botaoSalvar` usa o `botao` da seção; na seção Dúvidas, as dúvidas entram como sugestões marcadas no bloco "Sugerir dúvidas"; `DESTINO.curso` = `/cursos/novo` com os passos)
- Test: `test/assistente-telas-novas.test.js`

**Interfaces:**
- Consumes: `secoesDosCampos` (Task 2), rotas das Tasks 3–10.

- [ ] **Step 1: Testes** — **todo caminho do CATALOGO e todo padrão de REGISTROS/SO_CONTEXTO corresponde a um `router.get` existente em `src/routes/*.js`** (varredura do código; falha nomeando o caminho órfão); todo item do menu tem seção no manual e o manual não cita "Cursos e turmas ›"; `preencher_curso` com `editarCursoId` e `{precoAvista, descricaoLonga}` gera `evento.editar.secoes` com `valores` e `pagina`; Playwright do cartão: dois botões ("Abrir Página no site e preencher", "Abrir Valores e preencher") e a nota cita "Salvar valores"/"Salvar página"; na seção Valores, o preenchimento só mexe nos campos de preço; dúvidas propostas para curso existente aparecem como sugestões marcadas na seção Dúvidas; link `[Ver curso](/cursos/<id>)` só passa se o id veio de `listar_cursos`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS + `npm test`. **Step 5:** Commit `Assistente: caminhos e cartões das telas novas`.

---

Ordem de entrega sugerida (cada PR testável sozinho): Tasks 1–2 → 3–5 → 6–8 → 9–10 → 11. Ao fim, um revisor lê o branch inteiro e eu mando prints reais das telas (claro, escuro, celular).
