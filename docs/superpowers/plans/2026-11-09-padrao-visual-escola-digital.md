# Escola Digital no padrão do presencial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cartão de bolso com 1 página por módulo no visual do site, e as páginas do curso online sem desenhos fora do padrão (avisos, header, cenário, dúvidas, selo).

**Architecture:** `src/lib/ead-cartao.js` reescrito por dentro (mesma interface `gerarCartao(cursoOnlineId)`; `paginasDoCartao` passa a devolver capa + 1 página por módulo). Fonte Inter em `src/assets/fonts/` registrada no pdfkit. O resto é EJS + `src/public/ead.css`.

**Tech Stack:** Node 22, Express, EJS, pdfkit + sharp, node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-padrao-visual-escola-digital.md`

## Global Constraints

- Cores do site: vermelho `#d9081f`, vermelho escuro `#b80016`, tinta `#141414`, cinza `#6b6b6b`, rosa `#fff5f5`/`#fff1f2`, borda rosa `#f3c6cb`. Nada de amarelo/laranja (`#f59e0b`, `#fcd94d`, `#fef3c7`, `#92400e`, `#fff8e6`, `#d99a06`).
- CSP: sem JS nem `<style>` inline.
- Cartão: A6, passos = 1º item da revisão de cada tela do módulo (máx. 6), alerta = 1º alerta do módulo; módulo final fora; módulo vazio ainda tem página; nunca quebra para página extra.

## Review Focus

- Curso com módulo sem nenhuma tela: página do módulo sai só com o título. → teste Task 1.
- Revisão com item gigante (2.000 caracteres) ou título de módulo gigante: corta com "…", nº de páginas não muda. → teste Task 1.
- Arquivo da fonte faltando: cai na Helvetica com `paraPdf`, não quebra. → teste Task 1.
- Decisão do cenário enviada sem marcar opção (`opcaoId` vazio): a rota já ignora (`r.ignorada`) e volta para a decisão. → teste Task 4.
- Aviso de senha e de cadastro juntos no celular: os dois cabem, botão embaixo. → print Task 2.

---

### Task 1: Cartão de bolso por módulo

**Files:** Modify `src/lib/ead-cartao.js`; Create `src/assets/fonts/Inter-{Regular,Bold,Black}.ttf`; Test `test/ead-cartao.test.js`.

**Interfaces:** `paginasDoCartao(modulos) -> [{tipo:'capa'}, {tipo:'modulo', numero, titulo, fotoUrl, passos:string[≤6], alerta:string|null}]`; `gerarCartao(id) -> {buffer, nomeArquivo}` (igual).

- [ ] Testes que falham: `paginasDoCartao` → capa + 1 por módulo não-final, passos = 1º item de cada tela (máx. 6), alerta = 1º alerta, módulo vazio presente; `gerarCartao` com 2 módulos + final → 3 páginas; item gigante não muda nº de páginas; PDF embute a fonte Inter (`/FontName /…Inter`); vermelho `#d9081f` (não `#c8102e`).
- [ ] Implementar; `npm test`; commit `feat(cartao): cartão de bolso com 1 página por módulo, no visual do site`.

### Task 2: Avisos da conta iguais aos do presencial

**Files:** `src/views/ead-teste/_avisos.ejs`, `src/views/ead-teste/capa.ejs` (aviso de dúvida respondida), `src/public/ead.css`; Test `test/ead-visual-site.test.js`.
- [ ] Testes: `_avisos` renderizado tem `.ea-aviso` com ícone `fa-key`/`fa-triangle-exclamation`, texto em `<p>` e botão `a.ea-aviso-btn` "Trocar senha"/"Completar agora"; CSS `.ea-aviso` com fundo `#fff5f5` e flex.
- [ ] Implementar; commit `fix(escola-digital): avisos da conta iguais aos do presencial`.

### Task 3: Header — menu não quebra

**Files:** `src/views/ead-teste/_topo.ejs` (classe `ea-header-curso` quando `voltarMenu`), `src/public/ead.css`.
- [ ] Testes: `.ea-menu a` com `white-space: nowrap`; com `voltarMenu` o header tem `ea-header-curso`; CSS esconde `.ea-header-curso .ea-menu` e mostra o ☰ até 1280 px.
- [ ] Implementar; commit `fix(escola-digital): menu do header não quebra com "Menu do curso"`.

### Task 4: Cenário no desenho das perguntas

**Files:** `src/views/ead-teste/cenario.ejs`, `src/public/ead.css`; Test `test/ead-visual-site.test.js` (render EJS) e rota com `opcaoId` vazio.
- [ ] Testes: decisão em andamento tem `label.ea-alt` + `input[type=radio][name=opcaoId][required]` + botão "Responder", sem `ea-opcao`; escolha mostra `.ea-alt.certa`/`.errada` com ✓/✕; CSS sem `.ea-opcao`, `.ea-instrutor` sem amarelo; rótulo do cabeçalho do cenário com `white-space: nowrap`.
- [ ] Implementar; commit `feat(escola-digital): decisões do cenário no desenho das perguntas`.

### Task 5: Dúvidas da aula e selo

**Files:** `src/public/ead.css` (e a view da tela se o quadro estiver fora da coluna).
- [ ] Testes: `.ea-selo` sem amarelo; quadro de dúvidas com a largura da aula.
- [ ] Implementar; `npm test`; prints; commit `fix(escola-digital): dúvidas alinhadas com a aula e selo sem amarelo`.
