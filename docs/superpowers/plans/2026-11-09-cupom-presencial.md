# Cupom na inscrição do presencial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Campo "Tem cupom?" na inscrição presencial, com desconto só no valor do curso, guardado na matrícula e usado em todas as etapas.

**Architecture:** `CupomEad` ganha `cursoId` e `todosPresenciais`. `calcularValores(curso, plano, alunoId, { cupom, matriculaId })` aplica o desconto ao valor do curso (a taxa não muda); com `matriculaId` lê o cupom gravado em `CupomMatriculaEad` (só se o cupom vale para aquele curso). Todos os chamadores que têm matrícula passam `matriculaId`. A tela de inscrição ganha o bloco de cupom (GET `?cupom=`), e o POST confere de novo e grava.

**Tech Stack:** Node 22, Express, EJS, Prisma 5 (migração SQL), node:test.

**Spec:** `docs/superpowers/specs/2026-11-09-cupom-presencial.md`

## Global Constraints

- Desconto só no valor do curso (`precoAvista` no à vista, `precoCheio` no parcelado); a taxa de inscrição fica cheia.
- Cupom "todos" antigo (sem nada marcado) não vale no presencial. Presencial = `cursoId` daquele curso ou `todosPresenciais`.
- Cupom de presencial não vale no online/e-book (mensagem `MSG.outroCurso`).
- Sem cupom gravado, todo valor fica idêntico ao de hoje.
- Curso com desconto de 100%: só o à vista é oferecido (total = taxa); sem taxa, a inscrição é confirmada sem pagamento.
- Limite de tentativas erradas do online (`lib/limite-cupom.js`).

## Review Focus

- Matrícula transferida para outro curso (admin "transferir"): o cupom de outro curso não se aplica no destino. → Task 2.
- Cupom que vence ou se esgota depois de gravado: a matrícula mantém o desconto já concedido. → Task 2.
- Parcelado: a etapa "pagar o curso" e o cartão usam o curso com desconto. → Task 3.
- Passaporte (secretaria) com cupom: matrícula com o total com desconto. → Task 3.
- Cupom 100% sem taxa: confirmada sem cobrança, sem Pagamento. → Task 3.

---

### Task 1: Cupom vale para presencial
**Files:** `prisma/schema.prisma` + migração `20261115120000_cupom_presencial`, `src/lib/ead-cupom.js` (`lerDados` aceita `alvo=presencial:<cursoId>` e `presenciais`; `validarCupom(codigo, alvo, { presencial })`; `listarCupons` rótulos), `src/routes/ead.js` + `cupom-form.ejs` (opções novas), `src/views/admin/header.ejs` (aba Cupons no modo Presencial); Test `test/cupom-presencial.test.js`.
- [ ] Testes: validação (curso certo ok em qualquer turma; outro curso recusa; `todosPresenciais` ok; "todos" antigo recusa presencial; presencial recusa no online); `lerDados` grava `cursoId`/`todosPresenciais`; lista "Presencial: <curso>" / "Todos os presenciais".
- [ ] commit `feat(cupom): cupom vale para curso presencial`.

### Task 2: Valores com desconto
**Files:** `src/lib/matricula.js` (`calcularValores(..., { cupom, matriculaId })`, `cupomDaMatricula`), todos os chamadores com matrícula (`routes/cursos.js`, `lib/lembretes.js`, `lib/matricula-rapida.js`, `routes/admin.js` transferir); Test no mesmo arquivo.
- [ ] Testes: sem cupom = valores de hoje; cupom 20% no à vista reduz só `valorCurso`; com `matriculaId` lê o gravado; cupom de outro curso gravado não se aplica; cupom vencido depois de gravado continua aplicado.
- [ ] commit `feat(cupom): valores da inscrição com o desconto do cupom`.

### Task 3: Tela de inscrição e gravação
**Files:** `src/routes/cursos.js` (GET/POST `/inscrever/:turmaId`, etapas), `src/views/inscrever.ejs` (bloco "Tem cupom?", preços riscados), CSS; Test `test/cupom-presencial-inscricao.test.js`.
- [ ] Testes: `?cupom=` válido mostra o valor riscado e o total novo; inválido mostra o motivo; POST à vista PIX grava `CupomMatriculaEad` e cobra o total com desconto; parcelado grava e a etapa pagar-curso usa o desconto; passaporte grava; 100% sem taxa → PAGO sem Pagamento.
- [ ] `npm test`; prints; commit `feat(cupom): campo de cupom na inscrição do presencial`.
