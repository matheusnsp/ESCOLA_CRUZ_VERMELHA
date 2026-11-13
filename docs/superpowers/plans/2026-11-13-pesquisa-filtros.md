# Pesquisa: filtros e visual novo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Filtros por curso/turma/nota e visual novo da página Pesquisa de satisfação.
**Architecture:** Funções puras em `lib/pesquisa.js` (filtrar, resumir, opções, por curso, query string); rota monta; view nova; JS genérico mínimo em `admin-menu.js` (enviar ao mudar, recolher no celular).
**Tech Stack:** Express/EJS, node:test, Playwright (DOM).
**Spec:** `docs/superpowers/specs/2026-11-13-pesquisa-filtros-design.md`

## Global Constraints
- Endereço: `/pesquisa?aba=&curso=&turma=&nota=`; `nota` ∈ `satisfeitos` (4–5) · `neutros` (3) · `insatisfeitos` (0–2).
- Chave do curso: `cursoId`, ou `nome:<curso>` em respostas antigas sem `cursoId`.
- Sem JS inline novo (CSP).
- Permissões de hoje: ver `pesquisa:gerenciar|painel:leitura`; mexer `pesquisa:gerenciar`.

## Review Focus
1. Resposta antiga sem `cursoId`/`turmaId` → aparece em "Todos" e filtra pelo nome do curso, sem quebrar.
2. `?turma=` de outro curso ou lixo → ignorado (mostra todas as turmas do curso).
3. Filtro sem nenhuma resposta → cartões com "—", aba vazia com "Nada com esses filtros.", sem dividir por zero.
4. Aprovar com filtro ativo → volta para o mesmo filtro e a mesma aba.
5. Pessoa só com `painel:leitura` → vê filtros e números, sem botões e sem liga/desliga clicável.

### Task 1: funções puras em `lib/pesquisa.js`
Produces: `chaveCurso(r) -> string`; `filtrarRespostas(todas, { curso, turma, nota }) -> lista`; `resumirRespostas(lista) -> { total, media, dist: number[6] (índice = nota), satisfeitos, insatisfeitos, comComentario, aprovadas, aguardando }`; `opcoesFiltro(todas, curso) -> { cursos: [{ id, nome }], turmas: [{ id, data }] }` (cursos por nome; turmas mais nova primeiro); `mediasPorCurso(todas) -> [{ id, nome, total, media }]` (maior média primeiro, empate por total); `filtroDaQuery(query, todas) -> { curso, turma, nota }` (normaliza: turma só se for do curso; nota só valores válidos); `qsFiltro(filtro, extra) -> string` ("curso=…&turma=…&nota=…" sem vazios); `contarEnvios(filtro?)` aceita `{ curso, turma }` (conta envios cujas matrículas são da turma/curso).
- [ ] Testes `test/pesquisa-filtros.test.js` (Review Focus 1–3 incluídos) → FAIL → implementar → PASS → commit.

### Task 2: rota + view + CSS + JS genérico
- Rota `GET /pesquisa` usa as funções; `POST /pesquisa/site` e `POST /pesquisa/:id/(aprovar|ocultar)` redirecionam com `qsFiltro` dos campos escondidos.
- View `pesquisa.ejs` nova (spec §1–6); `admin-menu.js`: `form[data-envia-ao-mudar]` envia ao mudar um select e esconde `[data-sem-js]`; `.adm-recolhe-cel` + `.adm-recolhe-btn` alterna `.aberto` (só até 620 px).
- [ ] Testes: render da view (filtros selecionados, turma só com curso, switch, links por curso com `nota`, campos escondidos nos forms de ação, "respostas de Y enviadas", vazio "Nada com esses filtros.", sem botões para leitura); fonte da rota (redirect com qsFiltro); DOM (envia ao mudar; recolhe no celular) → FAIL → implementar → PASS → prints 390/820/1280 → commit → PR (base `menu-submenus`).
