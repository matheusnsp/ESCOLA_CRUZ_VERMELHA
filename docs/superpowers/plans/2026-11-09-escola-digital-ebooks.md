# Escola Digital: e-books (fase 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender/entregar e-books em PDF na Escola Digital, com o nome do comprador no rodapé de cada download.

**Architecture:** Tabela `Ebook` ligada 1–1 a um `Curso` escondido (`ativo:false`); compra = `Matricula` na turma online
desse curso (`lib/turma-online.js`), reaproveitando as funções de compra de `routes/ead-online.js`. Arquivo em bucket
privado (Supabase) ou pasta privada local; marca no rodapé com `pdf-lib`. Painel em arquivo novo `routes/ead-ebooks.js`
(montado como `routes/ead.js`); aluno em `routes/ebooks.js` (site).

**Tech Stack:** Node 22, Express, EJS, Prisma 5 (migração SQL à mão), pdf-lib, sharp, cliente Claude atual, node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-escola-digital-ebooks.md`

## Global Constraints

- Conta obrigatória para baixar (grátis também). Acesso pago = matrícula `PAGO`/`PARCELADO` na turma ONLINE do curso do e-book.
- PDF: só `application/pdf` que o `pdf-lib` abre; até 50 MB; nunca servido por URL pública.
- Rodapé: `Licenciado para <Nome> · <documento mascarado> · <dd/mm/aaaa>`, 7 pt, cinza claro, centralizado, toda página.
- Downloads: 20 por pessoa por hora; cada um grava `DownloadEbook`.
- Cupom: `ebookId` → só aquele e-book; `cursoOnlineId` → só aquele curso; nenhum → todos os cursos online e e-books.
- Curso escondido de e-book fora de toda lista de cursos (filtro `ebook: null`).
- CSP: sem JS/estilo inline. Visual da página = o da página do curso online (ead.css, `_topo`/`_fim`).

## Review Focus

- PDF corrompido ou criptografado enviado no painel: recusado com "Este arquivo não é um PDF válido", nada gravado. → Task 1.
- Arquivo apagado do bucket depois de publicado: download mostra a página de erro amigável, não 500 cru. → Task 5.
- Nome com acento/caractere fora do WinAnsi (ex.: "Łukasz") no rodapé: sai transliterado, PDF não quebra. → Task 1.
- Duplo clique em "Baixar" no grátis: um `AcessoEbook` só (único por par). → Task 2.
- Cupom de curso usado num e-book (ou vice-versa): recusado com a mensagem de "outro curso". → Task 6.

---

### Task 1: Banco, dependência e arquivo do e-book

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261114120000_ebooks/migration.sql`, `package.json` (`pdf-lib`), Create `src/lib/ebook-arquivo.js`; Test `test/ebook-arquivo.test.js`.

**Produces:** tabelas `Ebook`, `DownloadEbook`, `AcessoEbook`, `CupomEad.ebookId`, `Curso.ebook` (relação).
`arq.lerPdf(buffer) -> { paginas } | throws Error('PDF_INVALIDO')`; `arq.guardar(buffer, nome) -> caminho`;
`arq.ler(caminho) -> Buffer | null`; `arq.apagar(caminho)`; `arq.marcar(buffer, texto) -> Buffer`;
`arq.primeirasPaginas(buffer, n) -> Buffer` (para a IA); `arq.textoDoRodape(usuario, data) -> string`.
- [ ] Testes: PDF de 3 páginas → `paginas 3`; bytes aleatórios e PDF criptografado → `PDF_INVALIDO`; `marcar` mantém 3 páginas e o texto aparece no conteúdo; nome "Łukasz Ação" não quebra; guardar/ler/apagar local (sem Supabase) e caminho fora da pasta (`../x`) devolve null; `textoDoRodape` mascara CPF.
- [ ] Migração aplicada no Postgres local; `npm test`; commit `feat(ebook): tabelas e arquivo do e-book (marca no rodapé)`.

### Task 2: Regras do e-book

**Files:** Create `src/lib/ebook.js`; Test `test/ebook.test.js`.

**Produces:** `eb.endereco(nome)`, `eb.doEndereco(endereco, { incluirRascunho })`, `eb.salvar(dados, arquivo?, ebookId?) -> { ebook } | { erro }` (cria/atualiza o Curso escondido), `eb.acesso(usuarioId, ebook) -> { situacao:'sem'|'pendente'|'pago'|'gratis', desde, matricula }`, `eb.registrarDownload(usuarioId, ebook) -> { ok } | { erro:'LIMITE' }` (grátis cria `AcessoEbook` com upsert), `eb.daVitrine()`, `eb.meus(usuarioId)`, `eb.excluir(id) -> { ok } | { erro }`, `eb.produto(ebook)` (forma usada pelo cupom).
- [ ] Testes: salvar cria Curso `ativo:false`; endereço repetido recusado; publicar sem PDF recusado; acesso sem/pendente/pago/grátis; 21º download na hora → LIMITE; duplo registro grátis → 1 AcessoEbook; excluir com venda paga recusado; `daVitrine` só publicados na ordem.
- [ ] commit `feat(ebook): regras (acesso, downloads, vitrine)`.

### Task 3: Curso escondido fora das listas

**Files:** onde se lista `Curso` (painel Cursos para DEV `routes/admin.js`, `ia-textos.js` exemplos, catálogo/sitemap `routes/cursos.js`, seletor de cursos do painel EAD); Test `test/ebook-filtros.test.js`.
- [ ] Teste: com um e-book criado, a lista de cursos do painel (DEV), o sitemap e `/cursos` não mostram o nome do curso escondido.
- [ ] commit `fix(ebook): curso do e-book fora das listas de cursos`.

### Task 4: Painel — Escola Digital → E-books

**Files:** Create `src/routes/ead-ebooks.js` (montado em `admin.js` ao lado de `./ead`), views `src/views/admin/ead/ebooks.ejs`, `ebook-form.ejs`; link no menu da EAD; `ia-textos.js` (tipo `ebook`: manda as 4 primeiras páginas do PDF como documento ao Claude); reaproveita geração de capa; Test `test/ebook-painel.test.js`.
- [ ] Testes: criar com PDF → lista mostra título e "3 páginas"; arquivo não-PDF → erro na tela; publicar sem PDF → erro; dúvidas adicionar/remover; excluir com venda → erro; "Escrever com IA" (Claude falso) recebe um bloco `document` e devolve os textos; auditoria `CRIOU_EBOOK`.
- [ ] commit `feat(ebook): painel de e-books`.

### Task 5: Página do e-book, compra e download

**Files:** `src/routes/ead-online.js` (exportar `matriculaDaCompra`, `gravarCupom`, `liberarSemPagamento`), Create `src/routes/ebooks.js` (GET página, POST comprar, GET baixar; montado no site antes de `ead-teste`), view `src/views/ebook.ejs`, `lib/cobranca-avista.js` (`destinoAposPagamento` → página do e-book), `lib/status-pagamento.js` + `lib/email.js` (`enviarEbookLiberado`); Test `test/ebook-aluno.test.js`.
- [ ] Testes: botões por situação (grátis sem login, pago logado, pago com matrícula paga, pendente); comprar grátis → baixa direto; comprar pago PIX → cobrança (Únicopag falso); baixar sem acesso → página; com acesso → PDF com rodapé e 1 `DownloadEbook`; arquivo sumido → página de erro 503; e-mail de confirmação com o link "Baixar e-book".
- [ ] commit `feat(ebook): página, compra e download do e-book`.

### Task 6: Vitrine, Minha conta e cupom

**Files:** `routes/cursos.js` (vitrine), `views/escola-digital.ejs` + partial `ed-card-ebook.ejs`, `routes/painel.js` + `views/minha-conta.ejs` (sec `ebooks`), menus de conta (site e `_topo`), `server.js` (`contaLinks.ebooks`), `lib/ead-cupom.js` + form do cupom; Test `test/ebook-vitrine-cupom.test.js`.
- [ ] Testes: fileira "E-books" só com publicado; "Minha conta → E-books" lista o grátis baixado e o pago; link no menu só para quem tem; cupom de e-book vale só nele; geral vale para curso e e-book; de curso recusado no e-book.
- [ ] `npm test`; prints; commit `feat(ebook): vitrine, minha conta e cupons`.
