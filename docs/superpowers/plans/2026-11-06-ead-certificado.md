# EAD etapa 3 (certificado do curso online e cartão de bolso): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao concluir o curso online, o aluno recebe o certificado no modelo oficial (selo CURSO ONLINE, ressalva, Livro/Registro da escola e Redação), o cartão de bolso em PDF e um e-mail.

**Architecture:** A numeração de `lib/certificado.js` ganha uma função de reserva usada pelo presencial e pelo online (mesma sequência e trava). `src/lib/ead-certificado.js` emite o certificado (número, Redação, dados, e-mail) de forma idempotente. A view `admin/certificado-imprimir.ejs` ganha os trechos `c.online`, sem mudar o HTML do presencial. `src/lib/ead-cartao.js` gera o PDF A6 com `pdfkit` + `sharp`. As rotas novas ficam em `routes/ead-teste.js` (aluno) e `routes/ead.js` (prévia do DEV).

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5 / PostgreSQL, pdfkit 0.19, sharp, qrcode, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-06-ead-certificado.md`

## Global Constraints

- Branch `ead-certificado` (sai de `ead-aluno`); PR para `ead-aluno`, sem merge. Só banco local.
- **Nenhuma tabela, coluna nem migração nova.** Números e códigos ficam no `LogAuditoria`, com os mesmos formatos de id do presencial (`certificado-<id>`, `cert-num-<livro>-<registro>`, `cert-redacao-<id>`).
- O certificado presencial não muda: mesmos ids de log, mesmas ações (`CERTIFICADO_NUMERO`, `CERTIFICADO_EMITIDO`) e o mesmo HTML para uma matrícula presencial.
- Textos fixos da spec §2 e §3.4 usados como estão: "CURSO ONLINE", "na modalidade a distância (100% online)", "concluído em dd/mm/aaaa", "Capacitação teórica. Não inclui treinamento prático em manequim, oferecido nos cursos presenciais da Escola."
- Na Redação, o curso vai como "`<nome>` (online)", com `matriculaId = alunoCursoId` e `turmaId = cursoOnlineId`.
- Cartão: A6 retrato, margens de 10 mm, Helvetica, fotos convertidas para JPEG; foto que falha é pulada.
- Emitir no momento da conclusão **sem esperar** (não atrasar a resposta); erro só no log.
- Sem JavaScript inline novo (CSP); o botão de imprimir reaproveita o script que já existe na view.

## Review Focus

- Dois alunos concluindo ao mesmo tempo (ou um presencial impresso no mesmo instante) não podem receber o mesmo Registro. Task 1.
- Abrir a página do certificado várias vezes, ou a conclusão disparar duas vezes, não pode gerar outro número nem um segundo e-mail. Task 3.
- Aluno sem CPF no cadastro (passaporte, ou dado faltando): o certificado sai com o documento que houver, ou com a linha em branco, como no presencial, sem erro. Task 2.
- Uma tela com foto em URL do Supabase fora do ar, ou foto apagada, não pode impedir o cartão de sair. Task 4.
- Um aluno logado tentando abrir o certificado de outro curso (código de outro link) ou antes de concluir é mandado para a capa, sem emitir nada. Task 5.

---

### Task 1: Numeração compartilhada

**Files:** Modify `src/lib/certificado.js`. Create `test/certificado-numero.test.js` (banco local).

**Interfaces (Produces):**
- `reservarNumero(alvoId: string, alvoTipo: 'Matricula'|'AlunoCursoEad', livro: number, atorId: string)` → `{ livro, registro } | null` (null se o alvo já tinha número; até 20 tentativas contra `P2002`, como hoje).
- `numerar(matriculaIds, atorId)`: mesma assinatura e retorno de hoje, agora usando `reservarNumero`.
- `numerarEad(alunoCursoId, atorId = 'SISTEMA')` → `{ livro, registro, emitidoEm: Date, novo: boolean }`.
- `lerNumero(alvoId)` → `{ livro, registro, emitidoEm } | null`.

- [ ] **Testes primeiro:** matrícula presencial de teste numerada com `numerar` ⇒ registro R; `numerarEad(a)` ⇒ R+1 com `novo: true`; `numerarEad(a)` de novo ⇒ mesmo número com `novo: false`; outra matrícula com `numerar` ⇒ R+2. `Promise.all` de `numerarEad` para 5 alunos diferentes ⇒ 5 registros distintos. Os logs do presencial mantêm `acao` e `alvoTipo: 'Matricula'`; os do online têm `alvoTipo: 'AlunoCursoEad'`. Os testes usam um livro próprio (`cert_livro_atual` salvo como 9999 no teste e restaurado depois) para não misturar com outros dados locais.
- [ ] `npm test` ⇒ falha. Implementar. `npm test` ⇒ passa (inclusive os testes antigos). Commit "Certificado: numeração compartilhada entre presencial e online".

### Task 2: Dados e texto do certificado online

**Files:** Modify `src/lib/certificado.js` (exporta `emitidoEm`, `portador`, `dataBr`), `src/views/admin/certificado-imprimir.ejs`, `src/public/certificado.css`. Create `src/lib/ead-certificado.js` (só a parte pura nesta task), `test/ead-certificado.test.js`.

**Interfaces (Produces):** `dadosCertificadoEad({ usuario, curso, cursoOnline, modulos, numero, concluidoEm, ajustes, documentoAluno })` → o mesmo formato de `dadosDoCertificado`, mais `online: true` e `concluidoEm: 'dd/mm/aaaa'`, com:
- `curso` = `nomeCertificado || nome` (extras do curso);
- `conteudo` = títulos dos módulos (comuns na ordem, o final por último);
- `assinaturas` = `escolhaDoCurso` sem `instrutor`; vazia ⇒ a 1ª da lista;
- `periodo` = `{ frase: 'concluído em dd/mm/aaaa', curta: 'dd/mm/aaaa' }`;
- `livro`/`registro` vindos de `numero`; `emitidoEm` com a data da emissão.

- [ ] **Antes de mexer na view:** gravar em `test/fixtures/certificado-presencial.html` o HTML que a view gera **hoje** para uma lista fixa (dados presenciais montados à mão: nome, documento, curso, período, 2 assinaturas, conteúdo, livro e registro, verificação com um QR fixo).
- [ ] **Testes primeiro:**
  - `dadosCertificadoEad` com um usuário de CPF ⇒ `documento.tipo` 'CPF'.
  - Sem documento ⇒ `documento: null`.
  - Gênero Feminino ⇒ 'Portadora'.
  - Assinaturas sem instrutor.
  - `conteudo` na ordem com o final por último.
  - Render da view com o mesmo fixture presencial ⇒ **igual** ao HTML gravado.
  - Render com um item `online` ⇒ contém "CURSO ONLINE", "na modalidade a distância (100% online)", "concluído em 05/11/2026" e a ressalva exata. Não contém "no período de".
- [ ] `npm test` ⇒ falha. Implementar. Na view, blocos `<% if (c.online) { %>`: selo antes do `h1`, a frase alternativa e a ressalva antes das assinaturas. CSS: `.cert-selo-online` (fita vermelha) e `.cert-ressalva` (itálico, 8,5 pt). `npm test` ⇒ passa. Commit "Certificado: texto do curso online (selo e ressalva)".

### Task 3: Emitir (número, Redação, e-mail)

**Files:** Modify `src/lib/ead-certificado.js`, `src/lib/email.js`. Test: `test/ead-certificado.test.js` (parte com banco).

**Interfaces:**
- Consumes: Task 1 (`numerarEad`, `lerAjustes`) e Task 2 (`dadosCertificadoEad`); `redacao.registrarCertificados`; `app.locals.documentoAluno` (`src/server.js`), passado como parâmetro.
- Produces:
  - `emitirCertificadoEad(alunoCursoId, { enviarEmail = false, linkCertificado = null, documentoAluno })` → `{ dados, verificacao: { codigo, url, qr } | null, avisoRedacao: string|null } | null`.
    - null se o `AlunoCursoEad` não tem `concluidoEm`.
    - E-mail só quando `numerarEad` devolveu `novo: true`, `enviarEmail` está ligado e existe `linkCertificado`.
  - `enviarCertificadoEadPronto(email, nome, { curso, link })` em `lib/email.js` (texto da spec §6, mesmo layout dos outros e-mails).
- [ ] **Testes primeiro:**
  - sem `concluidoEm` ⇒ null e nenhum log;
  - primeira chamada ⇒ número e 1 e-mail (substituir `enviarCertificadoEadPronto` por um espião no teste);
  - segunda ⇒ mesmo número e nenhum e-mail;
  - com `REDACAO_URL` vazio ⇒ `avisoRedacao 'nao_configurado'` e `verificacao` null;
  - com uma **Redação falsa** (servidor `http` local no teste em `127.0.0.1`, que confere `Authorization: Bearer <token de 32+>`, devolve `{ codigo: 'ABCD-EFGH' }` e guarda o corpo recebido) ⇒ `verificacao.codigo` 'ABCD-EFGH', `qr` começa com `<svg`, log `cert-redacao-<alunoCursoId>` e o corpo recebido com `curso: '<nome> (online)'` e `turma_id: cursoOnlineId`;
  - terceira chamada com a Redação falsa desligada ⇒ continua com o código guardado.
- [ ] `npm test` ⇒ falha. Implementar. `npm test` ⇒ passa. Commit "EAD: emissão do certificado online (número, Redação, e-mail)".

### Task 4: Cartão de bolso

**Files:** Create `src/lib/ead-cartao.js`, `test/ead-cartao.test.js`.

**Interfaces (Produces):**
- `gerarCartao(cursoOnlineId)` → `Promise<{ buffer: Buffer, nomeArquivo: string }>`.
- `paginasDoCartao(modulos)` (pura) → `[{ tipo: 'capa' } | { tipo: 'tela', modulo: { numero, titulo }, primeiraDoModulo: boolean, tela }]`, só com as telas que têm revisão ou alerta, e sem o módulo final.
- `carregarFoto(url)` → `Promise<Buffer|null>` (JPEG): `/uploads/...` pelo `uploadsDir` de `lib/upload.js`, `/img/...` por `src/public`, `https://` por fetch (limite de 3 MB e 8 s). Qualquer erro ⇒ null.

- [ ] **Testes primeiro:**
  - `paginasDoCartao` com 2 módulos (3 telas, 1 sem revisão nem alerta) mais o final ⇒ capa + 2 páginas, com `primeiraDoModulo` certo.
  - `gerarCartao` de um curso de teste ⇒ começa com `%PDF-`; o número de `/Type /Page\b` (sem `/Pages`) é igual a 1 + telas; o nome é `cartao-de-bolso-<slug>.pdf`.
  - Tela com `fotoUrl` `/img/capa.webp` (WEBP real do repositório) ⇒ gera sem erro e o PDF contém `/Subtype /Image`.
  - Tela com `fotoUrl` `https://127.0.0.1:1/x.jpg` (recusada) e outra com `/uploads/nao-existe.webp` ⇒ gera sem erro.
- [ ] `npm test` ⇒ falha. Implementar (layout da spec §4). `npm test` ⇒ passa. Salvar um cartão do curso de teste no scratchpad e olhar 2 ou 3 páginas convertidas em PNG (`pdftoppm`, se houver; senão o Chromium do Playwright abrindo o PDF). Commit "EAD: cartão de bolso em PDF".

### Task 5: Rotas, gatilhos e telas

**Files:**
- Modify: `src/routes/ead-teste.js`, `src/routes/ead.js`, `src/views/admin/certificado-imprimir.ejs` (barra do aluno: local `barraAluno = { voltarUrl, cartaoUrl }`), `src/views/ead-teste/capa.ejs`, `resultado.ejs`, `cenario.ejs`, `src/views/admin/ead/curso.ejs`.
- Test: `test/ead-teste-aluno.test.js`.

**Interfaces:** Consumes `emitirCertificadoEad` e `gerarCartao`. Produces `dispararEmissao(alunoCursoId, base, req)` em `ead-teste.js`, que chama `emitirCertificadoEad` sem `await`, com `enviarEmail: true` e o link `APP_URL + base + '/certificado'`; `.catch` só registra no log.

- [ ] **Testes primeiro** (app de teste da etapa 2):
  - `GET /certificado` e `GET /cartao-de-bolso.pdf` sem login ⇒ 302 login;
  - logado sem concluir ⇒ 302 para a capa e nenhum log `certificado-<alunoCursoId>`;
  - concluído ⇒ certificado 200 com "CURSO ONLINE", o nome e "Livro";
  - cartão 200 com `application/pdf` e `attachment`.
- [ ] Gatilhos:
  - onde a etapa 2 chama `marcarCursoConcluido` (resultado da tentativa, escolha do cenário e cenário sem decisão), chamar também `dispararEmissao`;
  - em `contexto()`, se `estado.concluido` e o `AlunoCursoEad` ainda não tem `concluidoEm`: `marcarCursoConcluido` + `dispararEmissao`.
- [ ] Rotas da spec §5 e o botão "Baixar cartão de bolso (prévia)" no painel (`GET /ead/curso/:id/cartao-de-bolso.pdf`, só DEV pelo `router.use` da etapa 1).
  - Certificado: `res.set('Cache-Control', 'no-store')` e `X-Robots-Tag` (já vêm do router).
  - `avisoRedacao` só no log; o aluno não vê o aviso técnico.
- [ ] Capa concluída, resultado aprovado e fim do cenário: botões "Ver meu certificado" e "Baixar cartão de bolso" quando `ctx.estado.concluido`.
- [ ] `npm test` ⇒ passa. Commit "EAD: certificado e cartão para o aluno".

### Task 6: Verificação final e PR

- [ ] `npm test`, `node --check` em todo o `src`, EJS compilando.
- [ ] Ciclo real com o curso de teste (390 px e 1280 px), com uma Redação falsa local ligada (`REDACAO_URL=http://127.0.0.1:<porta>` e token de 32+ no `.env` local):
  - concluir ⇒ e-mail no log do app;
  - capa com os botões ⇒ certificado (captura);
  - `page.pdf()` do Playwright em A4 deitado ⇒ 2 páginas (frente e verso) e captura;
  - cartão baixado e 3 páginas renderizadas (capturas).
- [ ] Presencial: no painel, imprimir os certificados de uma turma de exemplo ⇒ a página abre, o Registro segue a sequência (depois dos números do online) e não aparece nenhum texto do online.
- [ ] Revisão final do branch por um revisor novo (o modelo mais capaz). Corrigir Critical/Important com teste.
- [ ] Push e PR para `ead-aluno`, sem merge.
