# Menu com submenus, celular e boas-vindas por curso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu do painel em grupos com submenus; no celular, gaveta de menu, filtros em lista de baixo e botão (+) flutuante, aplicados a todas as telas por regras gerais; texto de boas-vindas por curso.

**Architecture:** Uma lib pura (`lib/menu-painel.js`) decide grupos/itens/permissões/ativo; `header.ejs` só desenha. Um script do painel (`public/js/admin-menu.js`) faz gaveta, grupos lembrados, filtros em lista e (+) a partir de marcações gerais (`.adm-abas`, `data-criar`). Boas-vindas por curso usa `extras` do curso (sem coluna nova).

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, node:test; Playwright (já instalado no ambiente) para testes de DOM.

**Spec:** `docs/superpowers/specs/2026-11-13-menu-submenus-design.md`

## Global Constraints

- Nenhum endereço muda; nenhuma página some; "Painel online" não entra.
- Computador (> 1024 px): botão de criar e filtros **como hoje**; só o menu muda (barra lateral com grupos).
- Gaveta do menu até **1024 px**; filtro em lista e botão (+) até **620 px**.
- Nomes: "Comprovantes" (não muda); "Pesquisa de satisfação"; "Dúvidas dos alunos"; "Escolas (lotes)"; "Mensagem de boas-vindas"; "Criar curso com IA".
- Permissão de cada item = a de hoje (§1 Regras da spec). Grupo sem item permitido não aparece.
- As abas dentro das páginas **ficam**.
- CSP: sem JS inline novo; script em arquivo (`/js/admin-menu.js`) carregado no `foot.ejs`. `localStorage` sempre em try/catch.
- Texto por curso em `extras` do curso, campo `boasVindasTexto`; só cursos presenciais (`semSoOnline`).
- `npm test` roda em série; Postgres local: `service postgresql start`.

## Review Focus

1. Pessoa com poucas permissões (papel Consulta, sem `turmas:gerenciar`, sem financeiro) → só vê o que já via; nenhum grupo vazio; nada quebra sem `ativo` (página de erro). Teste na Task 1.
2. `localStorage` bloqueado (aba anônima/Safari) → menu e grupos funcionam, só não lembram. Teste na Task 2 (script com `localStorage` que lança).
3. Financeiro: abas são **botões** com filtro em JS → tocar na lista aciona o botão original e o cartão mostra o novo filtro. Teste na Task 3.
4. Página com mais de uma `.adm-abas` ou aba "separada"/link de download → cada uma vira seu cartão; separada e download vão depois da linha; download nunca vira "Mostrando". Teste na Task 3.
5. Texto do curso com `{hora}` e turma sem horário → some " às {hora}" igual ao padrão; doação da turma continua por cima. Teste na Task 5.

---

### Task 1: `lib/menu-painel.js` (grupos, permissões, ativo)

**Files:**
- Create: `src/lib/menu-painel.js`
- Test: `test/menu-painel.test.js`

**Interfaces:**
- Produces: `montarMenu({ modo: 'presencial'|'online', papel: string, pode: (perm)=>bool, ativo: string, duvidasAguardando?: number }) -> Array<Grupo|Separador>`
  - `Grupo = { id, rotulo, icone, href?, itens?: [{ id, rotulo, href, selo?: number }], aberto: bool, ativo: bool, selo?: number }` (sem `itens` = link direto)
  - `Separador = { separador: 'Sistema' }` (só se vier grupo depois)
- Produces: `ATIVOS: Set<string>` com todos os ids de item: `home, cursos, turmas, matricula-rapida, horarios, boas-vindas, alunos, inscricoes, pendentes, comprovantes, pesquisa, financeiro, contas, cupons, certificados, dev-usuarios, permissoes, banimentos, suspeitos, integracao, ead, ia, duvidas, ebooks, escolas`.

- [ ] **Step 1: Testes** — `test/menu-painel.test.js`:
  - DEV presencial, `ativo:'horarios'` → rótulos dos grupos `['Painel','Cursos e turmas','Alunos','Financeiro','Certificados','Configurações']`, separador antes de Configurações; grupo "Cursos e turmas" `aberto && ativo`; itens `['Cursos','Turmas','Matrícula rápida','Mapa de horários','Mensagem de boas-vindas']`; hrefs `['/cursos','/turmas','/matricula-rapida','/horarios','/modelos']`.
  - DEV online, `ativo:'cupons'`, `duvidasAguardando:3` → grupos `['Cursos online','Conteúdos','Vendas','Certificados','Configurações']`; "Vendas" aberto; item "Dúvidas dos alunos" com `selo:3` e grupo "Cursos online" com `selo:3`.
  - Secretaria com `pode` = `{turmas:gerenciar, pendentes:gerenciar, aluno:gerenciar}` → sem "Financeiro", sem "Configurações", sem item "Cupons"/"Matrículas"; "Alunos" tem `['Alunos','Pendentes','Comprovantes']`.
  - Só `integracao:gerenciar` (papel não DEV) → grupo "Configurações" com um item "Integração".
  - `ativo` desconhecido/undefined → nenhum grupo aberto, sem erro.
  - Todo `ativo` usado nas views (`include('header', { ativo: '…' })` em `src/views/admin/**/*.ejs`) está em `ATIVOS` (lê os arquivos com regex).
- [ ] **Step 2:** `node --test test/menu-painel.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar `montarMenu`/`ATIVOS` como tabela de dados (rótulo, href, ícone FA atual do header, condição `(pode, papel) => bool` copiada do `header.ejs` atual; Matrícula rápida/Mapa: `turmas:gerenciar || painel:leitura`; Boas-vindas e Certificados: `turmas:gerenciar`; Cupons e itens de Configurações exceto Integração: `papel === 'DEV'`; modo online inteiro só DEV). Grupo de um item só com `href` próprio (Painel, Certificados) é link direto.
- [ ] **Step 4:** teste passa.
- [ ] **Step 5:** commit `Menu do painel: grupos e permissões em lib/menu-painel.js`.

### Task 2: Header com grupos, gaveta no celular e `ativo` das telas

**Files:**
- Modify: `src/views/admin/header.ejs` (bloco `<nav class="adm-nav">` e topo), `src/views/admin/foot.ejs` (script), `src/public/admin.css` (fim do arquivo)
- Create: `src/public/js/admin-menu.js` (parte menu)
- Modify `ativo`: `matricula-rapida.ejs`→`matricula-rapida`, `horarios.ejs`→`horarios`, `modelos.ejs`→`boas-vindas`, `dev-permissoes.ejs`→`permissoes`, `ead/ia-lista.ejs`/`ead/ia-form.ejs`/`ead/ia-geracao.ejs`→`ia`
- Modify: rota que monta `res.locals` do painel (`src/routes/admin.js:489`) e `src/routes/ead.js:47` só se precisar passar `papel` (já existe `admPapel`)
- Test: `test/menu-header.test.js`

**Interfaces:**
- Consumes: `montarMenu`, `ATIVOS` (Task 1).
- Produces (HTML/CSS que Tasks 3–4 usam): `body.menu-aberto` abre a gaveta; botão `.adm-menu-btn` no `.adm-topo-cel`; grupos `.adm-grp[data-grupo=<id>]` com `.adm-grp-tit` (button, `aria-expanded`) e `.adm-grp-itens`; `foot.ejs` carrega `/js/admin-menu.js`.

- [ ] **Step 1: Testes** — render de `header.ejs` com ejs (locals: `ativo, modoPainel, admPapel, pode, csrfToken, usuario, duvidasAguardando`):
  - DEV, `ativo:'permissoes'` → contém `data-grupo="configuracoes"` com `aria-expanded="true"` e `<a href="/dev/permissoes" class="on"`.
  - conjunto de `href` do `<nav class="adm-nav">` para DEV presencial ⊇ hrefs do menu de hoje (`/`, `/cursos`, `/turmas`, `/ead/cupons`, `/inscricoes`, `/pendentes`, `/alunos`, `/certificados`, `/comprovantes-saude`, `/pesquisa`, `/financeiro`, `/contas`, `/integracao`, `/dev/usuarios`).
  - existe `.adm-topo-cel` com `.adm-menu-btn` e o nome da página.
  - as views do inventário com os novos `ativo` (regex nos arquivos).
  - `admin-menu.js`: com `localStorage` que lança, `require` do arquivo num `vm` com DOM mínimo **ou** no teste Playwright da Task 3 (ver lá) — aqui basta `assert` que todo acesso a `localStorage` está dentro de `try`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `header.ejs` desenha `montarMenu(...)`; grupo ativo com `aberto`; clique no título alterna (JS); grupos abertos lembrados em `localStorage['adm-menu-abertos']` (lista de ids). Topo do celular `.adm-topo-cel` (logo, nome da página = rótulo do item ativo, botão Menu) visível só ≤ 1024 px; gaveta = o próprio `.adm-top` em `position:fixed` com fundo escurecido; fecha no X, Esc e clique fora. Visual dos grupos/gaveta igual aos prints aprovados (`menu.css` do protótipo em scratchpad pode servir de base).
- [ ] **Step 4:** testes passam + suíte de views que renderizam header (`npm test` filtrado por `header|admin`).
- [ ] **Step 5:** commit `Header do painel com grupos e gaveta no celular`.

### Task 3: Filtros em lista no celular (toda `.adm-abas`)

**Files:**
- Modify: `src/public/js/admin-menu.js` (parte filtros), `src/public/admin.css`
- Modify: dar `aria-label` às `.adm-abas` que não têm: `comprovantes-saude.ejs` ("comprovantes"), `pendentes.ejs` ("pendentes"), `pesquisa.ejs` ("respostas"), `financeiro.ejs` ("pagamentos"), `abas-turmas.ejs` (já "Turmas"), `abas-config.ejs`, `ead/_abas-curso.ejs`, `ead/duvidas.ejs`, `contas.ejs`
- Test: `test/menu-celular-dom.test.js` (Playwright; `test.skip` se `require('playwright')` falhar)

**Interfaces:**
- Produces: para cada `.adm-abas`, um `button.adm-filtro-cel` antes dela ("Mostrando <b>atual</b>", contagem) e uma `.adm-folha` com `h3` "Mostrar <aria-label minúsculo>"; até 620 px a `.adm-abas` some e o cartão aparece; acima, nada muda.

- [ ] **Step 1: Testes** (Chromium 390×780, `page.setContent` com `admin.css` + `admin-menu.js`):
  - HTML com `<nav class="adm-abas" aria-label="Turmas">` (3 links, 2º `.on` com `.adm-aba-num`=7, um `.adm-aba-sep`) → cartão mostra o rótulo do 2º e "7"; clicar abre `.adm-folha` com título "Mostrar turmas", ✓ no 2º, linha antes do separado; clicar num item navega para o `href`.
  - Abas com link `.xlsx` → aparece depois da linha como "Baixar planilha (Excel)"; nunca é o "Mostrando".
  - Abas de **botões** (Financeiro): clicar na lista dispara `click` no botão original (contador no teste) e o cartão passa a mostrar o novo rótulo.
  - Duas `.adm-abas` na página → dois cartões independentes.
  - 1280×800 → `.adm-abas` visível, cartão `display:none`.
  - Toda `.adm-abas`/include de abas nas views tem `aria-label` (regex).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementar no `admin-menu.js` (sem dependências); fecha com toque fora, Esc e escolha.
- [ ] **Step 4:** passa.
- [ ] **Step 5:** commit `Painel no celular: filtros viram cartão com lista`.

### Task 4: Botão (+) flutuante no celular

**Files:**
- Modify: `admin-menu.js`, `admin.css`
- Modify (`data-criar` no botão do topo): `turmas.ejs` (Nova turma), `cursos.ejs` (Novo curso), `contas.ejs` (os 3: Nova despesa, Pedido de compra, Reembolso), `dev-usuarios.ejs`, `ead/cupons.ejs`, `ead/ebooks.ejs`, `ead/escolas.ejs` (Novo lote do topo, não "Outro lote"), `ead/ia-lista.ejs`, `ead/curso.ejs` (Novo módulo)
- Test: em `test/menu-celular-dom.test.js` + `test/menu-header.test.js`

**Interfaces:**
- Produces: até 620 px, os `[data-criar]` somem e aparece `a.adm-fab` (um botão) ou `button.adm-fab` + `.adm-fab-menu` (vários).

- [ ] **Step 1: Testes**
  - DOM: um `[data-criar]` → `.adm-fab` com o mesmo `href`, original oculto em 390 px, visível em 1280 px e sem `.adm-fab` visível.
  - DOM: três `[data-criar]` → tocar no (+) abre `.adm-fab-menu` com os três rótulos e ícones; toque fora fecha.
  - Fonte: cada view da lista acima tem `data-criar`; `contas.ejs` tem 3; `ead/escolas.ejs` "Outro lote" **sem** `data-criar`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (FAB a 18 px das bordas; `padding-bottom` extra no `main` em ≤ 620 px para não cobrir o fim). **Step 4:** passa. **Step 5:** commit `Painel no celular: botão + flutuante`.

### Task 5: Boas-vindas por curso

**Files:**
- Modify: `src/lib/boas-vindas.js`, `src/routes/admin.js` (`GET/POST /modelos`, `carregarTurmaBoasVindas`), `src/routes/painel.js:94`, `src/views/admin/modelos.ejs`, `src/views/admin/turma-boas-vindas.ejs`
- Test: `test/boas-vindas-curso.test.js`

**Interfaces:**
- Produces em `boas-vindas.js`: `lerTextosCursos() -> Promise<{[cursoId]: string}>`; `salvarTextoCurso(cursoId, texto) -> Promise<void>` (vazio ou igual ao padrão = apaga, via `extras.salvarExtra('curso', id, { boasVindasTexto: null })`); `anexarTextosCursos(turmas) -> Promise<turmas>` (`extras.anexar('curso', turmas.map(t => t.curso))`); `montarTexto(turma, modelo)` usa `turma.curso.boasVindasTexto` quando preenchido.
- Rotas: `POST /modelos/curso` (`turmas:gerenciar`, campos `cursoId`, `texto`) → redirect `/modelos?ok=…&curso=<id>#texto-curso`; `GET /modelos?curso=<id>` abre o editor daquele curso.

- [ ] **Step 1: Testes**
  - `montarTexto` com `curso.boasVindasTexto = 'Oi {curso} dia {data} às {hora}'` e turma sem horário → `'Oi Bombeiro Civil dia 07/12/2026'`; sem texto do curso → usa `modelo.texto`; `turma.boasVindasDoacao` substitui `{doacao}` também no texto do curso.
  - DB: `salvarTextoCurso(id,'X')` → `lerTextosCursos()[id]==='X'`; `salvarTextoCurso(id,'')` → some; `anexarTextosCursos([turma])` preenche `turma.curso.boasVindasTexto`.
  - Fonte: os 4 lugares que chamam `montarTexto(` carregam o texto do curso antes (`carregarTurma`, `enviarPendentes`, `painel.js`, `carregarTurmaBoasVindas`) — regex `anexarTextosCursos` em cada um.
  - Render `modelos.ejs` com `cursos=[{id,nome}], textosCursos={[id]:'X'}` → seção `id="texto-curso"` **depois** do formulário padrão; linha do curso com "Texto próprio", "Editar", "Voltar ao padrão"; outro curso com "Padrão".
  - Render `turma-boas-vindas.ejs` → "Texto próprio do curso" quando há, "Texto padrão" quando não; link para `/modelos?curso=<id>#texto-curso`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (lista de cursos: `semSoOnline(curso.findMany({ where:{ ativo:true }, orderBy:{nome:'asc'} }))`; "Voltar ao padrão" = form POST com texto vazio e `data-confirmar`). **Step 4:** passa. **Step 5:** commit `Boas-vindas: texto por curso`.

### Task 6: Revisão visual das 58 telas e PR

**Files:** ajustes pontuais em `admin.css`/views conforme os prints.

- [ ] **Step 1:** Script Playwright (scratchpad) abre cada rota do inventário (spec §4; rotas com id pegam o primeiro registro local) em 390×844, 820×1180 e 1280×800, claro e escuro; registra rolagem horizontal (`scrollWidth > innerWidth`) e salva prints.
- [ ] **Step 2:** Corrigir cada tela com rolagem horizontal ou corte; repetir até zero. Cada correção de CSS com um teste de fonte quando for regra nova (como `test/certificados-safari.test.js`).
- [ ] **Step 3:** `npm test` completo (Postgres de pé) → tudo passa.
- [ ] **Step 4:** commit, push, PR (corpo com prints de computador e celular, lista das telas, decisões), revisão final do branch por revisor novo.
