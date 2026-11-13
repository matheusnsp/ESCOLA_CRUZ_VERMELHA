# Assistente da secretaria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Chat "Assistente" no painel que consulta o sistema (alunos, pendentes, turmas, cursos), explica como fazer as coisas com caminho e link filtrado, sabe a página atual e preenche os formulários de curso/turma (sem salvar).

**Architecture:** Funções de consulta e validação puras/testáveis em libs (`assistente-ferramentas`, `assistente-contexto`, `assistente-uso`); `assistente.js` faz o laço manual de ferramentas com o SDK em streaming e emite eventos; rota NDJSON; tela em `admin-assistente.js` + CSS, sem script inline.

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, `@anthropic-ai/sdk` 1.6.0, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-assistente-secretaria-design.md`

## Global Constraints
- Modelo `claude-opus-5-5`, `output_config: { effort: 'low' }`, streaming (`client.beta.messages.stream`), `max_tokens: 4000`, `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`; nada de `temperature`/`budget_tokens`/`tool_choice` forçado/prefill. Cliente via `require('./ead-ia').clientePadrao()` (testes injetam cliente falso).
- Até **6** rodadas de ferramentas por mensagem; últimas **20** mensagens de texto; mensagem ≤ **2.000** caracteres.
- Limites: **20 / 10 min** e **200 / dia** por pessoa (tabela `UsoAssistente`); teto mensal: `ia.dentroDoTeto()` antes, `ia.somarCustoAvulso(usage)` depois.
- Nunca grava dados do sistema. CPF e celular completos (como na tela do aluno).
- Permissão de cada ferramenta = permissão da **rota** da tela; devolve só os campos que a tela mostra.
- Links: só caminhos/parâmetros do catálogo do manual, ou páginas de registro vistas na conversa; o resto vira texto.
- CSP: sem JS inline; `localStorage`/`sessionStorage` sempre em try/catch.
- Textos para a pessoa em português do Brasil.

## Review Focus
1. Pessoa com papel Consulta (`painel:leitura`) pergunta por pendentes → recebe "sem acesso", nada de nomes/valores. Teste na Task 2.
2. Resposta do modelo com HTML/`<script>`/link `javascript:` → aparece como texto, sem executar. Testes nas Tasks 4 e 7.
3. API fora do ar / chave ausente / teto atingido / recusa → mensagem amigável, sem detalhe técnico na tela; uso não contabilizado como sucesso. Teste na Task 5.
4. "Preencher na tela" em página sem o formulário → vira botão "Abrir … e preencher" e preenche ao chegar (uma vez só, 30 min). Teste na Task 7.
5. Busca com termo de 1–2 letras ou só espaços → pede mais detalhes, sem varrer o banco. Teste na Task 2.

---

### Task 1: Uso e limites
**Files:** `prisma/schema.prisma` (model `UsoAssistente { id String @id @default(uuid()); usuarioId String; criadoEm DateTime @default(now()); tokensEntrada Int @default(0); tokensSaida Int @default(0); tokensCache Int @default(0); ferramentas String[] ; usuario Usuario @relation(..., onDelete: Cascade); @@index([usuarioId, criadoEm]) }`), migração `prisma/migrations/20261116120000_uso_assistente/`, `src/lib/assistente-uso.js`, `test/assistente-uso.test.js`.
**Produces:** `podeEnviar(usuarioId, agora?) -> Promise<{ ok: true } | { ok: false, erro: string }>`; `registrarUso(usuarioId, usage, ferramentas: string[]) -> Promise<void>`; constantes `LIMITE_10MIN = 20`, `LIMITE_DIA = 200`.
- [ ] Testes (banco local): 20 registros nos últimos 10 min → bloqueia com "Você usou muito o assistente agora; tente de novo em alguns minutos."; 200 hoje → bloqueia; registro guarda tokens e nomes; exclusão do usuário apaga em cascata. → FAIL → implementar (+ `npx prisma migrate dev`/`deploy` local) → PASS → commit.

### Task 2: Ferramentas de consulta
**Files:** `src/lib/pendentes.js` (novo: `listarPendentes(agora) -> { comTaxa, semTaxa, foraDePrazo }`, extraído da rota `/pendentes` sem mudar o resultado; a rota passa a usar), `src/lib/assistente-ferramentas.js`, `test/assistente-ferramentas.test.js`.
**Produces:** `DEFINICOES_CONSULTA` (JSON schema, `strict: true`, `additionalProperties: false`) para `buscar_alunos {termo}`, `ver_aluno {alunoId}`, `listar_pendentes {curso?, turmaId?, aba?: 'com-taxa'|'sem-taxa'|'fora-de-prazo'}`, `listar_turmas {situacao?: 'por-comecar'|'andamento'|'congeladas'|'concluidas'|'canceladas', curso?}`, `listar_cursos {termo?}`; `executarConsulta(nome, entrada, { pode, vistos }) -> Promise<object>` (registra em `vistos.alunos`/`vistos.turmas` os ids devolvidos); `pontuarNome(termo, nome) -> number` (0..1).
- [ ] Testes: sem permissão → `{ erro: 'sem_permissao' }` (buscar/ver: `aluno:gerenciar|painel:leitura`; pendentes: `pendentes:gerenciar`; turmas: `turmas:gerenciar|painel:leitura`; cursos: `cursos:criar|cursos:gerenciar|turmas:gerenciar`); `pontuarNome`: "joao"×"João" ≥ 0,95, "silva maria"×"Maria Silva Souza" ≥ 0,85, "Mariana Sousa"×"Mariane Souza" ≥ 0,6, "Pedro"×"Maria Souza" < 0,5; termo com < 3 caracteres úteis → `{ erro: 'termo_curto' }`; banco: e-mail/celular/CPF exatos acham; `ver_aluno` traz os campos da tela Inscrições do aluno; `listar_pendentes` = `listarPendentes()` filtrado; teste da rota `/pendentes` continua passando. → FAIL → implementar → PASS → commit.

### Task 3: Ferramentas de formulário
**Files:** `src/lib/assistente-ferramentas.js` (mesmo arquivo), `test/assistente-formularios.test.js`.
**Produces:** `DEFINICOES_FORMULARIO` para `escrever_textos_curso {nome, cargaHoraria?, escolaridade?, categoria?, ideias?, cursoId?}`, `preencher_curso {campos}`, `preencher_turma {campos}`; `executarFormulario(nome, entrada, { pode, cliente }) -> Promise<{ resultado, evento? }>` onde `evento = { tipo: 'preencher', formulario: 'curso'|'turma', campos }`.
- [ ] Testes: campo desconhecido removido e listado em `ignorados`; número negativo/data inválida → erro do campo; `categoria`/`escolaridadeMinima`/`status` fora da lista do formulário → erro; `cursoId` inexistente ou só online → erro; `aulas` com `data` `YYYY-MM-DD` e `horario` `HH:MM - HH:MM`; `escrever_textos_curso` chama `iaTextos.escrever` (cliente falso), soma custo, recusa com teto atingido; sem permissão → `sem_permissao`. → FAIL → implementar → PASS → commit.

### Task 4: Página atual, links e manual
**Files:** `src/lib/assistente-contexto.js`, `src/lib/assistente-manual.md`, `test/assistente-contexto.test.js`.
**Produces:** `paginaAtual({ caminho, busca }, { pode }) -> Promise<{ texto: string, entidade?: { tipo, id, nome } }>` (reconhece `/alunos/:id/matriculas`, `/alunos/:id/editar`, `/turmas/:id/(editar|notas|boas-vindas|certificados|pesquisa-qr)`, `/cursos/:id/editar`, `/ead/curso/:id`; nome vem do banco; sem permissão ou id inexistente → só o caminho); `CATALOGO` (caminho → parâmetros permitidos e permissão), `filtrarLinks(markdown, { pode, vistos }) -> string`; `montarSistema() -> string` (instruções §4 + menu gerado de `lib/menu-painel` + manual).
- [ ] Testes: casos de página da spec §9; links: interno do catálogo com parâmetro permitido passa; `?x=1` não permitido, externo, `javascript:`, `//evil`, caminho desconhecido e página sem permissão viram texto; `/alunos/<id>/matriculas` passa só se o id está em `vistos.alunos`; todo item de `montarMenu` (DEV, presencial e online) tem seção `## <rótulo>` no manual. → FAIL → implementar → PASS → commit.

### Task 5: Laço com o Claude e rota
**Files:** `src/lib/assistente.js`, `src/routes/admin.js` (rota `POST /assistente/mensagem`), `test/assistente.test.js`.
**Produces:** `responder({ mensagens, pagina, usuarioId, pode, papel, cliente?, emitir })` — `emitir(evento)` com `{ tipo: 'texto', texto }`, `{ tipo: 'ferramenta', nome }`, `{ tipo: 'preencher', formulario, campos }`, `{ tipo: 'fim' }`, `{ tipo: 'erro', mensagem }`. A rota responde `application/x-ndjson` com `Cache-Control: no-cache, no-transform` (o `compression()` não bufferiza), uma linha JSON por evento.
- [ ] Testes (cliente falso): pergunta simples → eventos `texto…fim`; `tool_use` → executa, devolve `tool_result` (todos numa só mensagem), continua; 7ª rodada não acontece; `stop_reason: 'refusal'` → mensagem amigável; erro da API → "O assistente está fora do ar agora…"; chave ausente → "O assistente ainda não está ligado…"; teto → mensagem do teto; limite → mensagem do limite; mensagem > 2.000 → recusa; texto final passa por `filtrarLinks`; uso registrado com tokens; página atual vai como mensagem de sistema no turno; prompt de sistema com `cache_control`. Rota: exige login de staff e CSRF (fonte). → FAIL → implementar → PASS → commit.

### Task 6: Filtros `?q=` no Financeiro e na Matrícula rápida
**Files:** `src/views/admin/financeiro.ejs` (busca `#finBusca` recebe `q`), `src/views/admin/matricula-rapida.ejs` (+ rota se a busca for no servidor), testes.
- [ ] Testes: `GET /financeiro?q=Maria` abre com a busca preenchida e aplicada; idem Matrícula rápida; sem `q` nada muda. → FAIL → implementar → PASS → commit.

### Task 7: Tela do assistente
**Files:** `src/views/admin/header.ejs` (botões), `src/views/admin/foot.ejs` (script), `src/public/js/admin-assistente.js`, `src/public/admin.css`, `test/assistente-tela.test.js` (Playwright, servidor falso via `page.route`).
- Visual dos prints em `docs/superpowers/specs/2026-11-13-assistente/`. Renderização de Markdown restrita (negrito, listas, tabelas, links já filtrados → botão), montada com `textContent`/elementos, nunca `innerHTML` com texto do modelo. Conversa em `sessionStorage` (`adm-assistente-conversa`); proposta de preenchimento em `sessionStorage` (`adm-assistente-preencher`, `{ formulario, campos, caminho, criadoEm }`, 30 min, uso único).
- [ ] Testes: abre/fecha (botão, X, Esc), foco; "Você está em" com o título; streaming aparece aos poucos; sugestões; tabela e link-botão; `<img onerror>`/`<script>` no texto aparecem como texto; "Preencher na tela" em `/cursos/novo` preenche e dispara `input`/`change` sem enviar; em `/turmas/nova` cria as linhas de aula pelo botão "Adicionar aula"; em outra página vira "Abrir Novo curso e preencher" e preenche ao chegar; até 1024 px botão na barra do topo; até 620 px tela cheia; tema escuro. → FAIL → implementar → PASS → commit.

### Task 8: Revisão e PR
- [ ] Prints 390/820/1280 (claro/escuro) no servidor local com cliente falso; `npm test`; revisão final do branch por revisor novo; PR.
