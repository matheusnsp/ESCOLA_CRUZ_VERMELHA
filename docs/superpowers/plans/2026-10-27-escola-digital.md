# Escola Digital CVB-RJ (área do aluno) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plataforma de cursos online em `/digital` (matrícula rápida, pagamento, estudo, testes, cenários, certificado), escondida atrás de uma chave, testada só localmente.

**Architecture:** Módulo novo e isolado (`src/lib/escola-digital/`, `src/routes/escola-digital/`, `src/views/digital/`), montado no roteador do site do aluno só quando `ESCOLA_DIGITAL=1`. Regras de negócio em funções puras testadas com `node --test`; banco só com acréscimos (tabelas novas + colunas com padrão em `Curso`); pagamentos online numa tabela própria, confirmados pelo mesmo aviso da Únicopag.

**Tech Stack:** Node 22, Express 4, EJS, Prisma 5 / PostgreSQL, pdfkit, qrcode, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-27-escola-digital-design.md`

## Global Constraints

- **Nada vai para o ar.** Trabalho na branch `claude/ead-cvbrj-online`; nunca juntar na `main` nem abrir pull request.
- **Push só na branch `claude/ead-cvbrj-online`**, que a Vercel ignora (`vercel.json`, Task 0) e a Render não publica.
- Banco: só acréscimos. Nenhuma coluna ou tabela existente muda de nome, tipo, obrigatoriedade; nada é apagado.
- Chave: `ESCOLA_DIGITAL=1` liga; ausente/qualquer outro valor = desligada → rotas `/digital*` 404 e o site/secretaria idênticos a hoje.
- Pagamento simulado só quando `NODE_ENV !== 'production'` **e** `ESCOLA_DIGITAL_PAGAMENTO_SIMULADO=1`.
- Nome exibido: constante única `NOME = 'Escola Digital CVB-RJ'`, `NOME_CURTO = 'Escola Digital'`.
- Nota mínima `0.8`; teste rápido 3 perguntas; "Já sei isso?" 10 perguntas.
- Senha inicial da conta nova = 4 últimos dígitos do CPF (mesma regra de `senhaPadraoDoDocumento` em `src/routes/auth.js`); consentimento LGPD com `POLITICA_VERSAO` de `src/routes/auth.js`.
- Visual direção A, "App claro" (spec §6): fundo branco, texto `#141414`, vermelho `#d9081f`, cartões com raio 16px e sombra leve, faixa em degradê, Archivo / Instrument Sans; celular primeiro.
- CSP: sem `<style>` inline; JS em `src/public/js/`; acrescentar `https://www.youtube-nocookie.com` em `frameSrc`.
- Ressalva do certificado (texto fixo): "Curso teórico: ensina a reconhecer e decidir. Não inclui treino prático em manequim."
- Textos de exemplo marcados "conteúdo ilustrativo, não validado".
- Comentários e nomes em português, no estilo do código existente.

## Review Focus

- **Inscrição de outra pessoa na URL** (`/digital/estudo/:id` de outro aluno): 404, sem vazar nada — teste na Task 8.
- **Prazo vence no meio do estudo**: qualquer rota de estudo (tela, teste, cenário) de inscrição `ATIVA` com `acessoAte` vencido mostra "acesso encerrado" e grava `EXPIRADA` — teste na Task 8.
- **Aviso da Únicopag repetido, fora de ordem ou "pago" depois de estorno**: ativa uma vez só; nunca reativa inscrição cancelada — teste na Task 7.
- **Duplo clique / duas abas em "Matricular" ou "Pagar"**: uma inscrição por aluno+curso e no máximo um `PagamentoOnline` `PENDENTE` reaproveitado — teste nas Tasks 6 e 7.
- **Tópico com menos perguntas que o sorteio pede** (ex.: 2 no banco, teste pede 3; módulo com 6, pré-teste pede 10): usa todas, nota sobre o total sorteado, nunca divide por zero — teste na Task 3.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/escola-digital/config.js` | chave, nome, modo simulado |
| `src/lib/escola-digital/regras.js` | regras puras (sorteio, nota, estados, prazos, transições, valores) |
| `src/lib/escola-digital/conteudo.js` | validar e carregar arquivos de conteúdo no banco |
| `src/lib/escola-digital/inscricao.js` | matrícula rápida, inscrição, progresso, conclusão (banco) |
| `src/lib/escola-digital/pagamento.js` | cobrança (Únicopag ou simulada), aplicar status, reconciliação |
| `src/lib/escola-digital/certificado.js` | número, PDF, verificação |
| `src/routes/escola-digital/index.js` | monta os sub-roteadores e o 404 quando desligada |
| `src/routes/escola-digital/loja.js` | vitrine, página do curso, matrícula rápida, pagamento, simulado |
| `src/routes/escola-digital/estudo.js` | área do curso, módulo, tela, testes, cenários, certificado |
| `src/views/digital/` | layout (`_topo.ejs`, `_rodape.ejs`, `_abas.ejs`) e páginas |
| `src/public/escola-digital.css`, `src/public/js/escola-digital.js` | visual C; teste/cenário/relógio/PIX no navegador |
| `conteudo/escola-digital/primeiros-socorros/` | `curso.json` + `modulo-01.json` … `modulo-08.json` |
| `scripts/digital-carregar.js` | comando de carga |
| `test/escola-digital/*.test.js` | testes puros; `test/escola-digital/db/*.test.js` com banco de teste |

---

### Task 0: Prévias da Vercel (concluída em 27/10)

O site oficial roda na Render, que só publica a `main`. A Vercel ainda está ligada ao repositório (equipe de outra conta) e montava uma cópia a cada push. Resolvido no próprio repositório: `vercel.json` com `git.deploymentEnabled` desligando a branch `claude/ead-cvbrj-online`. Conferir depois de cada push que `gh api repos/matheusnsp/ESCOLA_CRUZ_VERMELHA/deployments` não ganhou um Preview novo para o commit. O `vercel.json` nunca vai para a `main`.

---

### Task 1: Base de testes, chave de liga/desliga e roteador vazio

**Files:**
- Create: `src/lib/escola-digital/config.js`, `src/routes/escola-digital/index.js`, `test/escola-digital/config.test.js`
- Modify: `package.json` (scripts `test`, `digital:carregar`), `src/server.js:108-116` (frameSrc), `src/server.js:318-325` (montagem)

**Interfaces:**
- Produces: `config.ligada(): boolean`, `config.pagamentoSimulado(): boolean`, `config.NOME`, `config.NOME_CURTO`; `require('./routes/escola-digital')` → `express.Router`.

- [ ] **Step 1: Teste**

```js
// test/escola-digital/config.test.js
const { test } = require('node:test'); const assert = require('node:assert');
const cfg = () => { delete require.cache[require.resolve('../../src/lib/escola-digital/config')]; return require('../../src/lib/escola-digital/config'); };
test('desligada por padrão', () => { delete process.env.ESCOLA_DIGITAL; assert.equal(cfg().ligada(), false); });
test('liga só com 1', () => { process.env.ESCOLA_DIGITAL = '1'; assert.equal(cfg().ligada(), true); process.env.ESCOLA_DIGITAL = 'true'; assert.equal(cfg().ligada(), false); });
test('simulado nunca em produção', () => { process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO = '1'; process.env.NODE_ENV = 'production'; assert.equal(cfg().pagamentoSimulado(), false); process.env.NODE_ENV = 'development'; assert.equal(cfg().pagamentoSimulado(), true); });
```
`config.js` lê `process.env` a cada chamada (não no carregamento), para os testes e o servidor verem mudanças.

- [ ] **Step 2:** `npm test` → FAIL (módulo inexistente). Antes, acrescentar ao `package.json`: `"test": "node --test test/"`, `"digital:carregar": "node scripts/digital-carregar.js"`.
- [ ] **Step 3:** Implementar `config.js` e `routes/escola-digital/index.js` (router que, com `ligada()` falsa, faz `next()` para tudo — o 404 do site trata; ligada, monta `loja` e `estudo` quando existirem; nesta task só `GET /digital` → `res.send('ok')` provisório).
- [ ] **Step 4:** `src/server.js`: `siteAluno.use(require('./routes/escola-digital'))` antes de `siteAluno.use(authRoutes)`; acrescentar `'https://www.youtube-nocookie.com'` ao `frameSrc`; `Disallow: /digital/estudo/` no robots.
- [ ] **Step 5:** `npm test` → PASS. Rodar o servidor sem a chave: `curl -s -o /dev/null -w "%{http_code}" localhost:3000/digital` → `404`; com `ESCOLA_DIGITAL=1` → `200`.
- [ ] **Step 6: Commit + push** (sem banco) `git commit -m "Escola Digital: chave de liga/desliga, roteador e base de testes"`

---

### Task 2: Modelo de dados e migração aditiva

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261027120000_escola_digital/migration.sql`, `test/escola-digital/migracao.test.js`

**Interfaces:**
- Produces (Prisma): `ModalidadeCurso`, `Curso.modalidade|prazoAcessoDias|validadeCertificadoMeses`, `ModuloOnline`, `TopicoOnline`, `TelaOnline`, `PerguntaOnline`, `CenarioOnline`, `DecisaoCenario`, `InscricaoOnline`, `PagamentoOnline`, `TelaVista`, `TentativaTeste`, `ModuloConcluido`, `CenarioFeito`; enums `SituacaoInscricaoOnline`, `ComoConcluiu`, `TipoTeste`.

- [ ] **Step 1: Schema** (decisões fixas; acrescentar relações inversas em `Curso` e `Usuario`)

```prisma
enum ModalidadeCurso { PRESENCIAL ONLINE }
enum SituacaoInscricaoOnline { AGUARDANDO_PAGAMENTO ATIVA CONCLUIDA EXPIRADA CANCELADA }
enum ComoConcluiu { TELAS PRE_TESTE CENARIOS }
enum TipoTeste { TOPICO PRE_TESTE }
// Curso: modalidade ModalidadeCurso @default(PRESENCIAL); prazoAcessoDias Int?; validadeCertificadoMeses Int?
model ModuloOnline   { id String @id @default(uuid()) cursoId String; chave String; ordem Int; titulo String; minutos Int @default(0); abertura String?; imagemUrl String?; temPreTeste Boolean @default(true); final Boolean @default(false); @@unique([cursoId, chave]) @@index([cursoId]) }
model TopicoOnline   { id; moduloId; chave; ordem Int; titulo; @@unique([moduloId, chave]) }
model TelaOnline     { id; topicoId; chave; ordem Int; titulo; ancora String; imagemUrl String?; imagemAlt String?; videoId String?; videoTitulo String?; videoSegundos Int?; revisao Json @default("[]"); alerta String?; dica String?; @@unique([topicoId, chave]) }
model PerguntaOnline { id; topicoId; chave; enunciado; alternativas Json; correta Int; porque String; ativa Boolean @default(true); @@unique([topicoId, chave]) }
model CenarioOnline  { id; moduloId; chave; ordem Int; titulo; cena String; imagemUrl String?; tempoSugerido Int; @@unique([moduloId, chave]) }
model DecisaoCenario { id; cenarioId; ordem Int; pergunta; opcoes Json; correta Int; fala String; @@unique([cenarioId, ordem]) }
model InscricaoOnline { id; alunoId; cursoId; situacao SituacaoInscricaoOnline @default(AGUARDANDO_PAGAMENTO); plano PlanoPagamento?; forma FormaPagamento?; parcelas Int @default(1); valor Decimal? @db.Decimal(10,2); ativadaEm DateTime?; acessoAte DateTime?; concluidaEm DateTime?; certificadoValidoAte DateTime?; codigoCertificado String? @unique; criadoEm; atualizadoEm @updatedAt; @@unique([alunoId, cursoId]) }
model PagamentoOnline { id; inscricaoId; metodo FormaPagamento; parcelas Int @default(1); valor Decimal @db.Decimal(10,2); status StatusPagamento @default(PENDENTE); gateway String?; gatewayRef String?; gatewayHash String?; gatewayStatus String?; gatewayResponse Json?; pixQrCode String? @db.Text; pixUrl String? @db.Text; pixBase64 String? @db.Text; criadoEm; atualizadoEm @updatedAt; @@index([inscricaoId]) @@index([gatewayRef]) @@index([gatewayHash]) @@index([status]) }
model TelaVista       { inscricaoId; telaId; vistaEm DateTime @default(now()); @@id([inscricaoId, telaId]) }
model TentativaTeste  { id; inscricaoId; tipo TipoTeste; topicoId String?; moduloId String?; perguntas Json; respostas Json @default("[]"); acertos Int @default(0); total Int; aprovado Boolean @default(false); finalizada Boolean @default(false); criadoEm; @@index([inscricaoId]) }
model ModuloConcluido { inscricaoId; moduloId; como ComoConcluiu; em DateTime @default(now()); @@id([inscricaoId, moduloId]) }
model CenarioFeito    { inscricaoId; cenarioId; escolhas Json; acertos Int; segundos Int; em DateTime @default(now()); @@id([inscricaoId, cenarioId]) }
```
Todas as FKs de conteúdo com `onDelete: Cascade`; as do aluno (`InscricaoOnline.alunoId`) sem cascade.

- [ ] **Step 2: Gerar a migração só com o que mudou**, sem depender do histórico antigo: `git show HEAD:prisma/schema.prisma > /tmp/antes.prisma && npx prisma migrate diff --from-schema-datamodel /tmp/antes.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261027120000_escola_digital/migration.sql`.
- [ ] **Step 3: Teste de "só acréscimos"**

```js
// test/escola-digital/migracao.test.js — lê o migration.sql
test('migração só acrescenta', () => {
  const sql = fs.readFileSync(arquivo, 'utf8');
  assert.doesNotMatch(sql, /\bDROP\b|\bRENAME\b|ALTER COLUMN|SET NOT NULL/i);
  for (const l of sql.split(';').filter((s) => /ALTER TABLE "Curso"/.test(s))) assert.match(l, /ADD COLUMN/);
});
```
- [ ] **Step 4:** `npm test` → PASS; `npx prisma db push` no banco de teste local → sem erro; `npx prisma validate` → OK.
- [ ] **Step 5: Commit + push** `git commit -m "Escola Digital: modelo de dados (só acréscimos)"`

---

### Task 3: Regras de negócio (funções puras)

**Files:** Create `src/lib/escola-digital/regras.js`, `test/escola-digital/regras.test.js`

**Interfaces (Produces):**
- `NOTA_MINIMA = 0.8`, `PERGUNTAS_TOPICO = 3`, `PERGUNTAS_PRE_TESTE = 10`
- `sortear(ids: string[], n: number, evitar: string[] = [], aleatorio = Math.random): string[]`
- `aprovado(acertos: number, total: number): boolean`
- `estadoModulos(modulos: {id, ordem, final}[], concluidos: Record<moduloId, 'TELAS'|'PRE_TESTE'|'CENARIOS'>): {id, estado: 'FEITO'|'JA_SABIA'|'AGORA'|'TRANCADO'}[]`
- `proximoPasso(topicos: {id, telas: {id}[]}[], vistas: Set<string>, topicosAprovados: Set<string>): {tipo:'tela', id}|{tipo:'teste', topicoId}|null`
- `situacaoAtual(insc: {situacao, acessoAte}, agora = new Date()): SituacaoInscricaoOnline`
- `calcularAcessoAte(ativadaEm: Date, dias: number): Date`, `calcularValidoAte(concluidaEm: Date, meses: number): Date`
- `efeitoNaInscricao(situacao, novoStatusPagamento: 'PAGO'|'ESTORNADO'|'CANCELADO'): SituacaoInscricaoOnline|null`
- `valorCobranca(curso: {precoAvista, precoCheio, parcelas}, { plano: 'A_VISTA'|'PARCELADO', parcelas: number }): { valor: number, parcelas: number }` (lança `Error('parcelas inválidas')`)

- [ ] **Step 1: Testes** (asserções que fixam as regras)

```js
test('sortear evita a tentativa anterior e completa se faltar', () => {
  const r = sortear(['a','b','c','d'], 3, ['a','b','c'], () => 0);
  assert.equal(r.length, 3); assert.ok(r.includes('d')); assert.equal(new Set(r).size, 3);
});
test('sortear com banco menor que n usa todas', () => assert.equal(sortear(['a','b'], 3).length, 2));
test('aprovado', () => { assert.equal(aprovado(3,3), true); assert.equal(aprovado(2,3), false); assert.equal(aprovado(8,10), true); assert.equal(aprovado(7,10), false); assert.equal(aprovado(0,0), false); });
test('estadoModulos: ordem e final', () => {
  const m = [{id:'1',ordem:1},{id:'2',ordem:2},{id:'3',ordem:3},{id:'F',ordem:8,final:true}];
  assert.deepEqual(estadoModulos(m, {'1':'TELAS','2':'PRE_TESTE'}).map(x=>x.estado), ['FEITO','JA_SABIA','AGORA','TRANCADO']);
  assert.equal(estadoModulos(m, {'1':'TELAS','2':'TELAS','3':'TELAS'}).at(-1).estado, 'AGORA');
});
test('proximoPasso: tela, depois teste, depois próximo tópico', () => {
  const t = [{id:'t1',telas:[{id:'a'},{id:'b'}]},{id:'t2',telas:[{id:'c'}]}];
  assert.deepEqual(proximoPasso(t, new Set(['a']), new Set()), {tipo:'tela',id:'b'});
  assert.deepEqual(proximoPasso(t, new Set(['a','b']), new Set()), {tipo:'teste',topicoId:'t1'});
  assert.deepEqual(proximoPasso(t, new Set(['a','b']), new Set(['t1'])), {tipo:'tela',id:'c'});
  assert.equal(proximoPasso(t, new Set(['a','b','c']), new Set(['t1','t2'])), null);
});
test('situacaoAtual expira só ATIVA vencida', () => {
  const ontem = new Date(Date.now()-864e5);
  assert.equal(situacaoAtual({situacao:'ATIVA',acessoAte:ontem}), 'EXPIRADA');
  assert.equal(situacaoAtual({situacao:'CONCLUIDA',acessoAte:ontem}), 'CONCLUIDA');
});
test('prazos', () => {
  assert.equal(calcularAcessoAte(new Date('2026-10-27T12:00:00Z'), 365).toISOString(), '2027-10-27T12:00:00.000Z');
  assert.equal(calcularValidoAte(new Date('2026-11-03T12:00:00Z'), 24).toISOString().slice(0,10), '2028-11-03');
  assert.equal(calcularValidoAte(new Date('2026-01-31T12:00:00Z'), 1).toISOString().slice(0,10), '2026-02-28');
});
test('efeitoNaInscricao', () => {
  assert.equal(efeitoNaInscricao('AGUARDANDO_PAGAMENTO','PAGO'), 'ATIVA');
  assert.equal(efeitoNaInscricao('ATIVA','PAGO'), null);
  assert.equal(efeitoNaInscricao('CANCELADA','PAGO'), null);
  assert.equal(efeitoNaInscricao('ATIVA','ESTORNADO'), 'CANCELADA');
  assert.equal(efeitoNaInscricao('AGUARDANDO_PAGAMENTO','CANCELADO'), null);
});
test('valorCobranca', () => {
  const c = { precoAvista: 79.9, precoCheio: 89.9, parcelas: 3 };
  assert.deepEqual(valorCobranca(c, {plano:'A_VISTA',parcelas:1}), {valor:79.9,parcelas:1});
  assert.deepEqual(valorCobranca(c, {plano:'PARCELADO',parcelas:3}), {valor:89.9,parcelas:3});
  assert.throws(() => valorCobranca(c, {plano:'PARCELADO',parcelas:4}));
  assert.throws(() => valorCobranca(c, {plano:'PARCELADO',parcelas:1}));
});
```
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implementar `regras.js` (meses: soma no calendário UTC e, se o dia não existir, último dia do mês). **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit + push** `"Escola Digital: regras de progresso, testes, prazos e pagamento"`

---

### Task 4: Conteúdo de exemplo e comando de carga

**Files:**
- Create: `src/lib/escola-digital/conteudo.js`, `scripts/digital-carregar.js`, `conteudo/escola-digital/primeiros-socorros/curso.json`, `modulo-01.json` … `modulo-08.json`, `test/escola-digital/conteudo.test.js`, `test/escola-digital/db/carga.test.js`

**Interfaces:**
- Produces: `validarCurso(dados: {curso, modulos[]}): string[]` (lista de erros, vazia = ok); `carregarCurso(pasta: string, prisma): Promise<{cursoId, criados, atualizados, desativadas}>`.
- O `Curso` não ganha coluna `chave`: a carga acha o curso por `modalidade: 'ONLINE'` + `nome` igual ao de `curso.json` (cria se não existir). O argumento do comando é o nome da pasta (`primeiros-socorros` → `conteudo/escola-digital/primeiros-socorros`) ou um caminho.
- Formato: `curso.json` = `{ nome, descricao, cargaHoraria, precoAvista, precoCheio, parcelas, prazoAcessoDias, validadeCertificadoMeses, imagemUrl? }`; `modulo-NN.json` = `{ chave, ordem, titulo, minutos, abertura, temPreTeste, final, topicos: [{ chave, titulo, telas: [{ chave, titulo, ancora, imagemUrl?, imagemAlt?, video?: {id, titulo, segundos}, revisao: [..até 4], alerta?, dica? }], perguntas: [{ chave, enunciado, alternativas: [..3-5], correta, porque }] }], cenarios?: [{ chave, titulo, cena, tempoSugerido, decisoes: [{ pergunta, opcoes: [3], correta, fala }] }] }`.

- [ ] **Step 1: Testes de validação**: `validarCurso` acusa (a) revisão com mais de 4 itens, (b) `correta` fora das alternativas, (c) cenário cuja 1ª decisão não tem as opções `["OLHAR","LIGAR","CUIDAR"]`, (d) `chave` repetida no mesmo nível, (e) módulo `final` sem cenários; e aceita o conteúdo real: `assert.deepEqual(validarCurso(lerPasta('conteudo/escola-digital/primeiros-socorros')), [])`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar `validarCurso` e escrever o conteúdo: 8 módulos e minutos do mapa (spec §7; documento p. 9); Módulo 4 com os exemplos A, B e C do documento (tela "Criança no recreio", pergunta do pão, cenário "Pânico na hora do lanche"); demais módulos com 1 tópico, 1 tela e 3 perguntas de preenchimento; módulo 8 `final` com 5 cenários curtos (3 decisões cada). Todo texto de exemplo com o sufixo "(conteúdo ilustrativo, não validado)" na âncora. Vídeo substituto: um ID público fixo definido em `curso.json` (`videoSubstituto`) usado onde `video.id` faltar. Curso com `precoAvista: 79.9`, `precoCheio: 89.9`, `parcelas: 3`, `prazoAcessoDias: 365`, `validadeCertificadoMeses: 24`.
- [ ] **Step 4: `carregarCurso`**: upsert por `chave` em transação; curso com `modalidade: 'ONLINE'`, `cargaHoraria`, `valorParcela = precoCheio/parcelas`; perguntas ausentes do arquivo → `ativa: false`. `scripts/digital-carregar.js <pasta>` recusa rodar se `DATABASE_URL` não contém `localhost|127.0.0.1` **a menos que** `--confirmo-banco-real` seja passado.
- [ ] **Step 5: Teste com banco** (`test/escola-digital/db/carga.test.js`, pulado se `DATABASE_URL` não for local): carregar duas vezes → mesma contagem de módulos/telas/perguntas; remover uma pergunta do objeto e recarregar → `ativa=false`.
- [ ] **Step 6:** `npm test` → PASS; `npm run digital:carregar -- primeiros-socorros` → resumo sem erro.
- [ ] **Step 7: Commit** `"Escola Digital: conteúdo de exemplo e comando de carga"`

---

### Task 5: Visual C, vitrine e página do curso

**Files:**
- Create: `src/views/digital/_topo.ejs`, `_rodape.ejs`, `_abas.ejs`, `vitrine.ejs`, `curso.ejs`, `erro.ejs`; `src/public/escola-digital.css`; `src/routes/escola-digital/loja.js`
- Modify: `src/routes/escola-digital/index.js`

**Interfaces:**
- Consumes: `config.NOME`, `regras.situacaoAtual`.
- Produces: `GET /digital` (vitrine: cursos `modalidade ONLINE, ativo`), `GET /digital/cursos/:slug` (curso `ONLINE` cujo `slugCurso(nome)` de `src/lib/vitrine.js` é igual ao `:slug`); view local `estadoBotao` ∈ `'matricular'|'pagar'|'continuar'|'certificado'|'encerrado'`.

- [ ] **Step 1:** Layout e CSS seguindo `docs/ead/prototipo-escola-digital.html` (opção C), classes com prefixo `ed-`; `_topo` com cruz, `NOME_CURTO`, "CVB-RJ", link "Site da escola" e conta; `_abas` (Início, Cursos, Certificados, Conta) só no celular.
- [ ] **Step 2:** Página do curso com tudo da spec §5.1, inclusive "ou até {parcelas}× de R$ {valorParcela} no cartão" e o aviso sobre a prática.
- [ ] **Step 3: Verificação** com servidor local e `ESCOLA_DIGITAL=1`: `/digital` lista "Primeiros Socorros"; `/digital/cursos/<slug>` 200 com o preço; curso inexistente → 404 no layout da Escola Digital; captura de tela no celular (390px) e no computador comparada ao protótipo.
- [ ] **Step 4: Commit** `"Escola Digital: visual, vitrine e página do curso"`

---

### Task 6: Matrícula rápida

**Files:**
- Create: `src/lib/escola-digital/inscricao.js` (parte 1), `src/views/digital/matricula.ejs`, `test/escola-digital/db/matricula.test.js`
- Modify: `src/routes/escola-digital/loja.js`

**Interfaces:**
- Produces: `matricular({ cursoId, usuarioLogadoId?, dados?: {nome, cpf, celular, email, aceite} }): Promise<{ ok: true, inscricao, contaNova: boolean } | { ok: false, motivo: 'precisa_login'|'invalido', erros?: string[] }>`; rotas `GET/POST /digital/cursos/:slug/matricula` (rate limit 10/15 min por IP, como `cadastroLimiter`).

- [ ] **Step 1: Testes com banco**: (a) conta nova: cria `Usuario` ALUNO com `cpfCnpj` normalizado, `senhaHash` que confere com os 4 últimos dígitos (`verificarSenha`), `consentimentoVersao` = `POLITICA_VERSAO`, e `InscricaoOnline` `AGUARDANDO_PAGAMENTO`; (b) CPF existente ou e-mail existente sem login → `{ ok:false, motivo:'precisa_login' }` e nenhuma conta criada; (c) logado → usa a conta, ignora `dados`; (d) chamar duas vezes → mesma inscrição (`count === 1`); (e) CPF inválido, celular sem DDD, sem aceite → `invalido` com erros.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (reaproveitar `validarCpfCnpj`, `hashSenha`, `enviarEmailConfirmacao` via a mesma função `enviarConfirmacao` de `routes/auth.js` — extraí-la para `src/lib/confirmacao-email.js` e usar nos dois lugares). Conta nova: `req.session.regenerate` e sessão como no login (`usuarioId`, `papel`, `nome`). `precisa_login`: `req.session.returnTo = '/digital/cursos/:slug/matricula'` e redirect a `/login`.
- [ ] **Step 4:** `npm test` → PASS. **Step 5: Commit** `"Escola Digital: matrícula rápida"`

---

### Task 7: Pagamento, confirmação e reconciliação

**Files:**
- Create: `src/lib/escola-digital/pagamento.js`, `src/views/digital/pagamento.ejs`, `pagamento-pix.ejs`, `pagamento-simulado.ejs`, `test/escola-digital/db/pagamento.test.js`
- Modify: `src/routes/escola-digital/loja.js`, `src/routes/webhook.js:73-77`, `src/lib/reconciliacao.js` (laço novo), `src/lib/email.js` (`enviarMatriculaOnlineConfirmada`), `src/public/js/escola-digital.js` (consulta de status do PIX)

**Interfaces:**
- Consumes: `regras.valorCobranca`, `regras.efeitoNaInscricao`, `regras.calcularAcessoAte`, `classificarStatus` (`lib/status-pagamento.js`), `unicopag.criarTransacao|obterOpcaoParcelamento|consultarTransacao`.
- Produces: `cobrar({ inscricaoId, plano, parcelas, forma, dadosCartao? }): Promise<PagamentoOnline>` (reaproveita o `PENDENTE` da mesma forma/valor); `aplicarStatusOnline(pagamento, { status, payload, origem }): Promise<{ info?, novoStatus? }>`; `acharPorAviso({ hash, email, valor }): Promise<PagamentoOnline|null>`; `reconciliarOnline(): Promise<resumo>`. Rotas: `GET/POST /digital/pagamento/:inscricaoId`, `GET /digital/pagamento/:inscricaoId/status` (JSON), `GET/POST /digital/simulado/:pagamentoId` (só se `pagamentoSimulado()`).

- [ ] **Step 1: Testes com banco**: (a) "paid" → pagamento PAGO, inscrição ATIVA com `acessoAte = ativadaEm + prazoAcessoDias`; (b) mesmo aviso duas vezes → um e-mail e `ativadaEm` inalterada; (c) "refunded" depois → CANCELADA; "paid" depois disso → continua CANCELADA; (d) "refused" → pagamento CANCELADO, inscrição AGUARDANDO; (e) duas chamadas a `cobrar` iguais → um `PagamentoOnline` PENDENTE; (f) `acharPorAviso` por hash e, sem hash, por e-mail + valor + PENDENTE.
- [ ] **Step 2:** FAIL → **Step 3:** implementar `aplicarStatusOnline` com a trava `updateMany({ where: { id, status: { not: novo } } })` como `aplicarStatus`; `cobrar` com `gateway: 'unicopag'` (conta principal) ou `'simulado'`; parcelado via `obterOpcaoParcelamento(centavos, parcelas)` e valor cobrado = `opcao.total_amount/100`.
- [ ] **Step 4: Webhook**: se `pagamento` (tabela atual) não for achado pelos 3 caminhos existentes, tentar `acharPorAviso`; achou → gravar hash e `aplicarStatusOnline`; o ramo atual não muda.
- [ ] **Step 5: Reconciliação**: `reconciliarOnline()` com os mesmos filtros de idade e `pegarVez` próprio (`'reconciliacao-online:rodada'`), chamado logo após `reconciliarPendentes` em `rodar()`.
- [ ] **Step 6: Telas** (spec §5.3): escolha de plano/parcelas e forma; PIX com QR e "copia e cola" e consulta a cada 5 s em `/status`; cartão com o formulário da inscrição presencial (`inscrever.ejs` como referência); recusado com motivo; simulado com **Aprovar**/**Recusar** chamando `aplicarStatusOnline(..., { status: 'paid'|'refused', origem: 'simulado' })`.
- [ ] **Step 7:** `npm test` → PASS; manual: matrícula → PIX simulado aprovado → cai no Módulo 1. **Commit** `"Escola Digital: pagamento, confirmação e reconciliação"`

---

### Task 8: Área do curso, módulos, telas e progresso

**Files:**
- Create: `src/routes/escola-digital/estudo.js`, `src/views/digital/area.ejs`, `modulo.ejs`, `tela.ejs`, `encerrado.ejs`, `test/escola-digital/db/estudo.test.js`
- Modify: `src/lib/escola-digital/inscricao.js` (parte 2), `src/routes/escola-digital/index.js`

**Interfaces:**
- Consumes: `regras.estadoModulos|proximoPasso|situacaoAtual`.
- Produces: middleware `carregarInscricao(req,res,next)` (dono + situação; `req.inscricao`); `progresso(inscricaoId): Promise<{ vistas:Set, aprovados:Set, concluidos:Record, cenarios:Set }>`; `marcarVista(inscricaoId, telaId)`; `concluirModuloSePronto(inscricaoId, moduloId)`; rotas `GET /digital/estudo/:id`, `/digital/estudo/:id/continuar`, `/digital/estudo/:id/modulo/:moduloId`, `/digital/estudo/:id/tela/:telaId`, `POST /digital/estudo/:id/tela/:telaId/proximo`.

- [ ] **Step 1: Testes com banco** (Review Focus): (a) inscrição de outro aluno → 404; (b) `ATIVA` com `acessoAte` vencido em `/tela/:id` → página "encerrado" e situação gravada `EXPIRADA`; (c) `CONCLUIDA` vencida → continua acessando; (d) tela de módulo `TRANCADO` → redirect para a área; (e) `proximo` grava `TelaVista` uma vez e redireciona para `proximoPasso`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar telas (spec §5.4–5.5) com vídeo `https://www.youtube-nocookie.com/embed/{id}?rel=0&modestbranding=1`, lista de tópicos à esquerda (computador) / menu (celular), botão fixo "Próximo".
- [ ] **Step 4:** `npm test` → PASS. **Commit** `"Escola Digital: área do curso, telas e progresso"`

---

### Task 9: Teste rápido e "Já sei isso?"

**Files:** Create `src/views/digital/teste.ejs`, `teste-resultado.ejs`, `test/escola-digital/db/testes.test.js`; Modify `estudo.js`, `inscricao.js`, `src/public/js/escola-digital.js`

**Interfaces:**
- Produces: `iniciarTeste(inscricaoId, { tipo, topicoId?, moduloId? }): Promise<TentativaTeste>` (sorteio com `regras.sortear`, evitando a última tentativa finalizada do mesmo alvo; reaproveita tentativa aberta); `responder(tentativaId, perguntaId, alternativa): Promise<{ certa: boolean, porque?: string }>` (`porque` só em `TOPICO`); `finalizar(tentativaId): Promise<TentativaTeste>` (aprovação por `regras.aprovado`; `PRE_TESTE` aprovado → `ModuloConcluido` `PRE_TESTE`; `TOPICO` aprovado → `concluirModuloSePronto`). Rotas `GET /digital/estudo/:id/teste/:topicoId`, `GET /digital/estudo/:id/pre-teste/:moduloId`, `POST .../responder`, `POST .../finalizar`.

- [ ] **Step 1: Testes com banco**: 3/3 aprova e conclui o módulo quando era o último tópico; 2/3 reprova e o novo sorteio evita as 3 anteriores quando o banco tem ≥ 6; pré-teste 8/10 conclui como `JA_SABIA`; 7/10 não conclui; responder pergunta que não está na tentativa → erro; resposta repetida não conta duas vezes.
- [ ] **Step 2:** FAIL → **Step 3:** implementar telas (uma pergunta por vez; o porquê após cada resposta no teste rápido; pré-teste só mostra o resultado no fim). **Step 4:** PASS. **Commit** `"Escola Digital: teste rápido e Já sei isso"`

---

### Task 10: Cenários do módulo final

**Files:** Create `src/views/digital/cenario.ejs`; Modify `estudo.js`, `inscricao.js`, `src/public/js/escola-digital.js`; Test `test/escola-digital/db/cenarios.test.js`

**Interfaces:**
- Produces: `registrarCenario(inscricaoId, cenarioId, { escolhas: number[], segundos: number }): Promise<CenarioFeito>` (acertos calculados no servidor a partir de `DecisaoCenario.correta`; `segundos` limitado a 0–7200); rotas `GET /digital/estudo/:id/cenario/:cenarioId`, `POST .../concluir`.

- [ ] **Step 1: Testes com banco**: concluir os 5 cenários → `ModuloConcluido` `CENARIOS`; escolhas com tamanho diferente do número de decisões → erro; tempo acima do sugerido é gravado e não impede a conclusão; acessar cenário com o final `TRANCADO` → redirect.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (decisões e falas vão para a página como dados; o navegador mostra uma por vez e o relógio; envia o resultado no fim). **Step 4:** PASS. **Commit** `"Escola Digital: cenários do módulo final"`

---

### Task 11: Conclusão, certificado, verificação e cartão de bolso

**Files:**
- Create: `src/lib/escola-digital/certificado.js`, `src/views/digital/verificar.ejs`, `src/public/arquivo/cartao-bolso-primeiros-socorros.pdf` (provisório), `test/escola-digital/db/certificado.test.js`
- Modify: `src/lib/certificado.js` (exportar `numerarAlvo`), `src/lib/escola-digital/inscricao.js` (`concluirCursoSePronto`), `estudo.js`, `src/lib/email.js` (`enviarConclusaoOnline`)

**Interfaces:**
- Produces: `numerarAlvo({ alvoTipo, alvoId, atorId }): Promise<{ livro, registro }>` em `lib/certificado.js` (mesma sequência de `numerar`, mesmo `idCert(alvoId)`; `numerar` passa a usá-la sem mudar o resultado); `concluirCursoSePronto(inscricaoId): Promise<boolean>` (todos os módulos concluídos → `CONCLUIDA`, `concluidaEm`, `certificadoValidoAte`, `codigoCertificado` = 10 caracteres de `crypto.randomBytes` em base32 sem ambíguos, número, e-mail); `gerarPdf(inscricao, stream)`; rotas `GET /digital/estudo/:id/certificado.pdf`, `GET /digital/estudo/:id/cartao.pdf`, `GET /digital/verificar/:codigo` (pública, sem CPF/e-mail).

- [ ] **Step 1: Testes com banco**: conclusão gera registro sequencial no mesmo livro de um certificado presencial já numerado (registro = anterior + 1); concluir de novo não muda número nem datas; `certificadoValidoAte` = conclusão + 24 meses; `/verificar/<codigo>` mostra "válido" e, com a data passada, "vencido"; código inexistente → 404; o PDF começa com `%PDF`.
- [ ] **Step 2:** FAIL → **Step 3:** implementar (PDF A4 deitado com pdfkit, logo `src/public/img/logo-cvb-rj.webp` convertido por `sharp` para PNG, ressalva fixa, QR com `qrcode` para `${APP_URL}/digital/verificar/${codigo}`). **Step 4:** PASS. **Commit** `"Escola Digital: certificado, verificação e cartão de bolso"`

---

### Task 12: Ligação com o site atual e não regressão

**Files:**
- Modify: `src/views/partials/site-header.ejs` (botão), `src/views/home.ejs` (faixa), `src/routes/cursos.js` (catálogo filtra `modalidade: 'PRESENCIAL'` quando ligada; online com selo e link), `src/routes/painel.js` + `src/views/minha-conta.ejs` (inscrições online), `src/routes/admin.js` (Cursos, nova turma, Horários e Matrícula rápida só com `modalidade: 'PRESENCIAL'`), `src/lib/planilha-ao-vivo.js` (cursos e turmas só presenciais)
- Test: `test/escola-digital/db/nao-regressao.test.js`

**Interfaces:**
- Consumes: `config.ligada()`. Helper `filtroPresencial()` em `config.js`: `{ modalidade: 'PRESENCIAL' }` — usado em todo `prisma.curso.findMany` do site e da secretaria (o filtro vale sempre: cursos online só existem se alguém os carregar; com a chave desligada não há curso online no banco da produção).

- [ ] **Step 1: Testes**: com a chave desligada, `GET /`, `/cursos`, `/minha-conta` (aluno com matrícula presencial) e `/digital` respondem como antes (200/200/200/404) e o HTML não contém "Escola Digital"; com a chave ligada e o curso carregado, `/cursos` não lista o curso online como presencial e mostra o selo "Online"; secretaria `/cursos` e `/turmas/nova` não oferecem o curso online.
- [ ] **Step 2:** FAIL → **Step 3:** implementar. **Step 4:** `npm test` → PASS; rodar o roteiro da Task 13 nas telas da secretaria (Financeiro, Pendentes, Integração) com um pagamento online aprovado no banco: nenhuma tela quebra.
- [ ] **Step 5: Commit** `"Escola Digital: ligação com o site e a secretaria"`

---

### Task 13: Roteiro de teste local e entrega para a equipe

**Files:** Create `docs/ead/como-testar-localmente.md`

- [ ] **Step 1:** Escrever o passo a passo para o Mac: `.env` de teste (acrescentar `ESCOLA_DIGITAL=1` e `ESCOLA_DIGITAL_PAGAMENTO_SIMULADO=1`), `npx prisma db push`, `npm run digital:carregar -- primeiros-socorros`, `npm run dev`, e o roteiro manual da spec §9 em forma de checklist.
- [ ] **Step 2:** Rodar o roteiro inteiro aqui (celular 390px e computador), com capturas de tela; `npm test` → todos PASS.
- [ ] **Step 3: Commit + push** `"Escola Digital: roteiro de teste local"`; avisar a equipe para `git pull` e seguir o roteiro.
