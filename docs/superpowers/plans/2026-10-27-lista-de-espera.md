# Lista de espera por curso — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover qualquer matrícula do curso para outra turma ou para uma turma de espera (`EM_ESPERA`), sem apagar nada; aluno vê "Em espera".

**Architecture:** Um valor novo no enum `StatusTurma` e uma turma de espera por curso (`lib/turma-espera.js`). A Matrícula rápida passa a mover matrículas em vez de apagar/criar. Telas e jobs tratam `EM_ESPERA` como já tratam `CONGELADA` (sem cobrança, sem lembrete, sem contar vaga).

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5 / PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-10-27-lista-de-espera.md`

## Global Constraints

- Branch `lista-de-espera` a partir da `main`; PR sem merge. Nada roda contra banco que não seja local.
- Migração só acrescenta (`ALTER TYPE "StatusTurma" ADD VALUE 'EM_ESPERA'`); nenhuma coluna nova.
- Estilo do código existente: comentários em português, `prisma.$transaction` com array (não interativa), respostas `{ ok, msg }`, modal global por `data-confirmar`/`data-motivo` (sem JS inline, CSP).
- Nunca apagar `Matricula` nem `Pagamento` neste recurso.
- Turma de espera: `inicioPrevisto` 2099-12-31T00:00:00Z, `vagas` 9999, `minimoAlunos` 0, `status` EM_ESPERA, sem aulas.
- Textos ao aluno exatamente como na spec §4 e §5.

## Review Focus

- Pessoa com matrícula pela escola (sem chave gravada) mandada para a espera não pode voltar a aparecer como "Encaixado(a)" no próximo `carregar()` — Task 2.
- Encaixar alguém que está na espera não pode criar segunda matrícula nem segundo pagamento — Task 2.
- Matrícula em espera não pode receber lembrete, aparecer em Pendentes "fora de prazo" nem mostrar botão de pagar — Tasks 1 e 3.
- A turma de espera nunca aparece como turma aberta (site, secretaria, planilha, select de encaixe) — Task 1.
- `FILTRO_VAGA` continua contando só turmas reais (a espera tem 9999 vagas, mas nunca é destino de Mover) — Task 2.

---

### Task 1: Status `EM_ESPERA`, turma de espera e exclusões

**Files:**
- Modify: `prisma/schema.prisma` (enum), Create: `prisma/migrations/20261027200000_turma_em_espera/migration.sql`
- Create: `src/lib/turma-espera.js`
- Modify: `src/routes/admin.js` (`STATUS_TURMA` sem EM_ESPERA; abas de Turmas ignoram; Pendentes `not in [CONGELADA, EM_ESPERA]`), `src/lib/relatorio.js`, `src/lib/lembretes.js` (bloqueio como CONGELADA), `src/lib/pesquisa.js` (notIn), `src/routes/painel.js` (`calcularRetomada` null), `src/lib/status-pagamento.js` (e-mail "data a confirmar (lista de espera)"), `src/lib/planilha-ao-vivo.js` (rótulo "Em espera" onde os status viram texto), `src/views/admin/inscricoes.ejs` e `src/views/admin/aluno-matriculas.ejs` ("Em espera · sem data" + etiqueta).

**Interfaces (Produces):** `turmaEspera.EM_ESPERA = 'EM_ESPERA'`; `turmaEspera.turmaDeEspera(cursoId): Promise<Turma>` (acha ou cria, idempotente por `cursoId + status`); `turmaEspera.ehEspera(turma): boolean`.

- [ ] Enum + migração gerada com `prisma migrate diff --from-schema-datamodel <antes> --to-schema-datamodel prisma/schema.prisma --script`; aplicar num banco local (`db push` + o SQL num banco limpo).
- [ ] `turma-espera.js` com `turmaDeEspera` (findFirst por `{ cursoId, status: 'EM_ESPERA' }`, senão `create`; corrida: capturar P2002 não se aplica (sem unique) → usar `pg_advisory_xact_lock` ou aceitar e reusar a primeira por `criadoEm asc`).
- [ ] Exclusões listadas acima, uma por uma; `node --check` em cada arquivo; EJS compilado.
- [ ] Commit "Lista de espera: status EM_ESPERA, turma de espera e exclusões".

---

### Task 2: Matrícula rápida move em vez de apagar

**Files:**
- Modify: `src/lib/matricula-rapida.js` (`matriculaDoCurso`, `moverEncaixe`, `voltarParaEspera`, `encaixar`, `carregar`), `src/routes/admin.js` (rotas mover/espera/encaixar + auditoria), `src/views/admin/matricula-rapida.ejs`, `src/public/admin.css`, `src/lib/email.js` (`enviarEntradaNaEspera`, `enviarTurmaDefinida`).

**Interfaces:**
- Consumes: `turmaDeEspera`, `ehEspera`.
- Produces: `matriculaDoCurso(inscricaoId): Promise<{ erro } | { anotado, cfg, m, origem: 'encaixe'|'escola' }>`; `moverEncaixe({ inscricaoId, turmaId, porUsuarioId, appUrl })`; `voltarParaEspera({ inscricaoId, motivo, porUsuarioId, appUrl }) → { ok, matriculaId, de, esperaTurmaId, origem, msg }`; `encaixar` devolve também `{ daEspera: true, de }` quando moveu.

- [ ] `carregar()`: `p.espera` quando a turma do encaixe/matrícula está EM_ESPERA; `p.encaixe = null`; resumo e filtros contam como aguardando. Turmas de espera nunca entram em `turmasPorCurso`.
- [ ] `voltarParaEspera`: travas da spec §2; `$transaction([ matricula.update({ turmaId: espera, lembreteVesperaEm: null }), configuracao.upsert(chave) ])`; e-mail; `idsCache = null`.
- [ ] `moverEncaixe` para encaixe e escola (resolução por `matriculaDoCurso`); trava de vaga com critério `FILTRO_VAGA`.
- [ ] `encaixar` com `p.espera`: move (sem criar conta/matrícula/pagamento), atualiza chave, e-mail "Sua turma foi definida".
- [ ] View: bloco `.mr-acoes` em todo card com turma (não em `erroLigar`/`dobro`); texto quando não há outra turma; estado "Na espera desde"; rotas com auditoria da spec §2.
- [ ] Commit "Lista de espera: mover e voltar para a espera para toda matrícula".

---

### Task 3: Painel do aluno

**Files:** Modify `src/views/minha-conta.ejs`, `src/public/style.css` (ou onde estão `.ct-pill-pausada`), `src/routes/painel.js` (se faltar algo além do `calcularRetomada`).

- [ ] Card conforme spec §4 (selo, linha, etiqueta, caixa); nada de pagar enquanto em espera; etiquetas de pagamento intactas.
- [ ] Commit "Lista de espera: painel do aluno".

---

### Task 4: Ciclo de teste local e PR

- [ ] Script de ciclo (fora do repositório) pelas rotas reais, como o do PR #89, cobrindo spec §7; relatório com saídas, auditoria e e-mails.
- [ ] Capturas da Minha conta (aluno em espera) e da Matrícula rápida (card na espera, card com Mover/Voltar).
- [ ] Push e PR para `main` (sem merge) com descrição das ações, travas e auditoria.
