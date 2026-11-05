# EAD — etapa 1: estrutura do conteúdo e cadastro no painel — especificação

Data: 05/11/2026. Decidido com o usuário na conversa, a partir do documento "O primeiro EAD da Cruz
Vermelha Rio" (Núcleo de Comunicação, out/2026, v2). É a primeira de quatro etapas do EAD:

| Etapa | O quê |
|---|---|
| **1 (esta)** | Tabelas do conteúdo + telas de cadastro e validação no painel da secretaria |
| 2 | Site do aluno: menu do curso, telas, quiz por sorteio, pré-teste, cenário, progresso |
| 3 | Conclusão: certificado automático com ressalva, cartões de bolso em PDF |
| 4 | Inscrição e pagamento do curso online (turma permanente) e acompanhamento no painel |

## 1. Objetivo

A secretaria (e quem mais tiver a permissão) cadastra, pelo painel, o conteúdo de um curso 100% online
no formato do documento: módulos → tópicos → telas (Modelo 1), banco de perguntas (Modelo 3) e cenários
(Modelo 4). A área técnica vê cada tela como o aluno verá e marca o **módulo** como validado. Nada do
EAD aparece ainda para o aluno. O presencial não muda.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Ligação com o curso | Tabela nova `CursoOnline`, 1:1 com um `Curso` existente (`cursoId` único). Nome, preço, foto, catálogo e certificado continuam no `Curso`. |
| Migração | **Só `CREATE TYPE` e `CREATE TABLE`** (mais índices e chaves estrangeiras das tabelas novas). Nenhuma coluna nova em tabela existente: em 30/09 uma versão que dependia de coluna nova derrubou a produção (ver `lib/extras.js`). O campo de relação `online CursoOnline?` em `model Curso` é só do Prisma; não gera coluna. |
| Entrada do conteúdo | Telas de cadastro no painel (formulários), item a item. Sem importação por planilha nesta etapa. |
| Validação clínica | **Selo por módulo**: `RASCUNHO` → `VALIDADO`, por quem tem `ead:validar`. Qualquer mudança dentro de um módulo validado o devolve a `RASCUNHO`. |
| Vídeo | **Só link** de YouTube (inclusive não listado) ou Vimeo, incorporado num `<iframe>`. Sem upload de vídeo. |
| Foto | Upload pelo pipeline atual (`lib/upload.js`: WEBP + Supabase Storage). |
| Código | `src/routes/ead.js` montado no `admin.js` como o `contas.js` (`require('./ead')({ requirePermissao, auditar, ADMIN_URL })`); regras em `src/lib/ead.js`; telas em `src/views/admin/ead/`. |
| Fora desta etapa | Progresso e telas do aluno, sorteio, certificado, cartão de bolso, inscrição/pagamento online, importação por planilha. |

## 3. Banco de dados

### 3.1 Enums novos

```prisma
enum StatusModuloEad { RASCUNHO VALIDADO }
enum TipoPerguntaEad { UNICA MULTIPLA VF }
```

### 3.2 Tabelas novas

Todos os ids são `String @id @default(uuid())`; toda tabela tem `criadoEm DateTime @default(now())` e,
as editáveis, `atualizadoEm DateTime @updatedAt`. Toda chave estrangeira para o "pai" tem índice e
`onDelete: Cascade`, exceto `CursoOnline.cursoId` (ver 3.3). `ordem Int @default(0)` ordena irmãos (sem
índice único: reordenar troca os números de dois irmãos numa transação).

| Modelo | Campos (além de id/ordem/datas) |
|---|---|
| `CursoOnline` | `cursoId String @unique` → `Curso`; `notaMinimaQuiz Int @default(80)` (porcentagem para passar no quiz e no pré-teste) |
| `ModuloEad` | `cursoOnlineId`; `titulo String`; `minutosEstimados Int @default(0)`; `introducao String?` (os ~3 parágrafos da abertura); `fotoIntroUrl String?`; `final Boolean @default(false)` (módulo de cenários, abre depois dos outros); `status StatusModuloEad @default(RASCUNHO)`; `validadoPor String?` (id do usuário); `validadoEm DateTime?` |
| `TopicoEad` | `moduloId`; `titulo String` |
| `TelaEad` | `topicoId`; `titulo String`; `ancora String?` (2–3 frases: situação + por que importa); `fotoUrl String?`; `videoUrl String?` (URL de embed normalizada, ver 4.3); `videoTitulo String?`; `videoDuracaoSeg Int?`; `revisaoTitulo String?`; `revisaoItens String[]` (as frases da revisão rápida, até 4); `alerta String?`; `dicaProfissional String?` |
| `PerguntaEad` | `topicoId`; `tipo TipoPerguntaEad @default(UNICA)`; `enunciado String`; `feedback String?` (o porquê); `ativa Boolean @default(true)` |
| `AlternativaEad` | `perguntaId`; `texto String`; `correta Boolean @default(false)` |
| `CenarioEad` | `moduloId`; `titulo String`; `cena String?` (3 linhas); `fotoUrl String?`; `videoUrl String?`; `tempoSugeridoSeg Int @default(240)` |
| `DecisaoCenario` | `cenarioId`; `pergunta String` |
| `OpcaoDecisao` | `decisaoId`; `texto String`; `correta Boolean @default(false)`; `feedback String?` (a fala do instrutor para esta escolha) |

A "próxima tela" não é guardada: é a seguinte pela `ordem` (tela → tópico → módulo).

### 3.3 Curso com EAD não se apaga por cascata

`CursoOnline.cursoId` usa `onDelete: Restrict`. A rota `POST /cursos/:id/excluir` (`admin.js`) passa a
recusar, com a mesma mensagem de "tem turmas", quando existir `CursoOnline` para o curso: "Não é possível
excluir: o curso tem conteúdo EAD. Desative o EAD em EAD → curso antes." Sem isso o Postgres recusaria com
erro genérico.

### 3.4 Migração

`prisma/migrations/20261105120000_ead_estrutura/migration.sql`, gerada pelo `prisma migrate dev` num banco
local e conferida à mão: só `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`/`CREATE UNIQUE INDEX` e
`ALTER TABLE <tabela nova> ADD CONSTRAINT ... FOREIGN KEY`. Nenhum `ALTER TABLE` em tabela existente
(a FK de `CursoOnline` para `Curso` é declarada em `CursoOnline`).

## 4. Regras (`src/lib/ead.js`)

### 4.1 Módulo final
- No máximo um módulo `final` por curso. Marcar um como final desmarca o anterior (na mesma transação).
- Para o aluno (etapa 2), o módulo final vem sempre por último, seja qual for a `ordem`.
- Módulo final tem cenários e não tem tópicos; módulo comum tem tópicos e não tem cenários. A página do
  módulo só oferece o que cabe nele. Trocar `final` só é permitido com o módulo vazio do outro tipo
  (sem tópicos para virar final; sem cenários para deixar de ser).

### 4.2 Perguntas
- `UNICA`: 2 a 5 alternativas, **exatamente 1** correta.
- `MULTIPLA`: 2 a 5 alternativas, **pelo menos 1** correta.
- `VF`: o formulário cria sozinho as duas alternativas "Verdadeiro" e "Falso"; marca-se qual é a correta.
- Alternativas com texto vazio são ignoradas ao salvar. Enunciado obrigatório.
- Desativar (`ativa=false`) tira a pergunta do sorteio sem apagar.

### 4.3 Link de vídeo (`normalizarVideo(url)`)
Aceita e devolve a URL de embed, ou `null` + mensagem de erro:

| Entrada | Saída |
|---|---|
| `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/embed/ID` | `https://www.youtube-nocookie.com/embed/ID` |
| `vimeo.com/NUM`, `vimeo.com/NUM/HASH` (não listado), `player.vimeo.com/video/NUM?h=HASH` | `https://player.vimeo.com/video/NUM` (+ `?h=HASH` se houver) |
| qualquer outra coisa | erro "Use um link do YouTube ou do Vimeo." |

`ID` do YouTube: `[A-Za-z0-9_-]{11}`; `NUM`: só dígitos; `HASH`: `[a-f0-9]+`. O CSP (`server.js`,
`frameSrc`) ganha `https://www.youtube-nocookie.com` e `https://player.vimeo.com`.

### 4.4 Pendências (`pendencias(moduloId)`)
Lista de frases do que impede validar. Módulo **comum**:
- título e introdução preenchidos; `minutosEstimados > 0`;
- pelo menos 1 tópico; todo tópico com pelo menos 1 tela;
- toda tela com título, âncora e vídeo;
- todo tópico com **pelo menos 3** perguntas ativas (o quiz sorteia 3);
- o módulo com **pelo menos 8** perguntas ativas no total (o pré-teste sorteia de 8 a 12);
- toda pergunta ativa válida pela regra 4.2 e com feedback.

Módulo **final**: título e introdução; pelo menos 1 cenário; todo cenário com cena, pelo menos 1 decisão;
toda decisão com **exatamente 3** opções, **exatamente 1** correta e feedback em todas.

Cada frase aponta o item ("Tópico 'Reconhecer o engasgo': só 2 perguntas ativas (mínimo 3)").

### 4.5 Selo
- **Validar** (`POST /ead/modulo/:id/validar`, `ead:validar`): só com `pendencias()` vazia; grava
  `status=VALIDADO`, `validadoPor`, `validadoEm`; auditoria `EAD_VALIDOU_MODULO`.
- **Voltar para rascunho** à mão (`POST /ead/modulo/:id/reabrir`, `ead:validar`): auditoria
  `EAD_REABRIU_MODULO`.
- **Mudança dentro de módulo validado**: toda rota que cria, altera, apaga ou reordena algo do módulo
  (o próprio módulo, tópico, tela, pergunta, alternativa, cenário, decisão, opção) chama
  `invalidarSeValidado(tx, moduloId, req, oQueMudou)` na mesma transação: volta para `RASCUNHO`, limpa
  `validadoPor/validadoEm` e grava `EAD_INVALIDOU_MODULO` `{ moduloId, oQueMudou }`. Nesses formulários,
  quando o módulo está validado, aparece uma faixa amarela "Este módulo está validado. Salvar uma mudança
  o volta para rascunho até a área técnica validar de novo." e o `<form>` leva `data-confirmar` com a
  mesma frase (modal que o painel já tem).
- Mudar a ordem dos **módulos** entre si invalida os dois módulos trocados.

## 5. Painel da secretaria

### 5.1 Permissões (`lib/permissoes.js`)
- `ead:gerenciar` — criar/editar/apagar/reordenar conteúdo EAD e ativar EAD num curso. Entra no padrão
  da SECRETARIA (e por isso do COORDENADOR).
- `ead:validar` — validar e reabrir módulo. Entra no padrão do COORDENADOR. O DEV atribui a outros papéis
  na tela de Permissões. Ambas ganham descrição na lista de "o que cada permissão libera".
- Ver (sem botões): `ead:gerenciar`, `ead:validar` ou `painel:leitura`.

### 5.2 Menu
Item **EAD** (`fa-solid fa-laptop-medical`) depois de "Turmas", com `secaoAtiva === 'ead'`, visível para
quem pode ver (5.1).

### 5.3 Rotas e telas (`src/routes/ead.js`, `src/views/admin/ead/`)

| Rota | Tela / ação |
|---|---|
| `GET /ead` | `cursos.ejs`: cursos com EAD (nome, nº de módulos, validados/total, nº de perguntas ativas). Form "Ativar EAD num curso" com os `Curso` que ainda não têm `CursoOnline`. |
| `POST /ead/ativar` | cria `CursoOnline`; auditoria `EAD_ATIVOU_CURSO`. |
| `GET /ead/curso/:cursoOnlineId` | `curso.ejs`: módulos em ordem (selo, minutos, contagens, "final"), subir/descer, novo módulo, `notaMinimaQuiz`. Botão "Desativar EAD" (apaga o `CursoOnline` e tudo dentro) só se todos os módulos estiverem em rascunho; `data-confirmar`; auditoria `EAD_DESATIVOU_CURSO`. |
| `POST /ead/curso/:cursoOnlineId` | salva `notaMinimaQuiz` (50–100). |
| `GET/POST /ead/curso/:cursoOnlineId/modulos/novo`, `GET/POST /ead/modulo/:id/editar` | `modulo-form.ejs`: título, minutos, introdução, foto da introdução, final. |
| `GET /ead/modulo/:id` | `modulo.ejs`: cabeçalho (selo, quem validou e quando), caixa de **pendências**, botões Validar/Reabrir. Módulo comum: tópicos em ordem; em cada um, as telas (com "ver como o aluno") e o banco de perguntas (enunciado, tipo, nº de alternativas, ativa). Módulo final: cenários com nº de decisões. |
| `POST /ead/modulo/:id/validar`, `/reabrir`, `/subir`, `/descer`, `/excluir` | ações do 4.5; excluir só em rascunho. |
| `POST /ead/modulo/:id/topicos`, `POST /ead/topico/:id`, `/subir`, `/descer`, `/excluir` | tópico (título num form em linha). |
| `GET/POST /ead/topico/:id/telas/nova`, `GET/POST /ead/tela/:id/editar`, `POST /ead/tela/:id/subir`, `/descer`, `/excluir` | `tela-form.ejs`: campos do Modelo 1 — título, âncora, foto (upload), link do vídeo + título + duração (mm:ss), revisão rápida (título + 4 campos), alerta, dica de profissional. |
| `GET /ead/tela/:id/ver` | `tela-ver.ejs`: pré-visualização só leitura no layout do Exemplo A (cabeçalho do módulo, menu lateral dos tópicos/telas, âncora com foto, bloco "Assista" com o vídeo, cartões numerados da revisão, caixa ALERTA, barra "A seguir: …"). Feita como partial (`partials/ead-tela.ejs`) para a etapa 2 reaproveitar. |
| `GET/POST /ead/topico/:id/perguntas/nova`, `GET/POST /ead/pergunta/:id/editar`, `POST /ead/pergunta/:id/excluir`, `/ativar` | `pergunta-form.ejs`: tipo, enunciado, até 5 alternativas com caixa "correta" (VF: duas fixas), feedback. |
| `GET/POST /ead/modulo/:id/cenarios/novo`, `GET/POST /ead/cenario/:id/editar`, `POST /ead/cenario/:id/subir`, `/descer`, `/excluir` | `cenario-form.ejs`: título, cena, foto, link do vídeo, tempo sugerido (mm:ss). Abaixo, as decisões do cenário. |
| `POST /ead/cenario/:id/decisoes`, `GET/POST /ead/decisao/:id/editar`, `POST /ead/decisao/:id/subir`, `/descer`, `/excluir` | `decisao-form.ejs`: pergunta + 3 opções (texto, correta, fala do instrutor). |

Todas as escritas exigem `ead:gerenciar` (exceto 4.5), passam pelo CSRF que já existe, validam com Zod e,
no erro, devolvem o formulário com as mensagens e o que foi digitado. Toda criação/exclusão grava
auditoria `EAD_CRIOU_<ITEM>` / `EAD_EXCLUIU_<ITEM>` com `{ moduloId, titulo }`; edição não grava (a
invalidação já registra quando importa). Exclusões usam `data-confirmar` dizendo o que vai junto
("Apagar o tópico e as 3 telas e 12 perguntas dele?").

Limites de texto (Zod): títulos 120; âncora 600; introdução 3000; item de revisão 200; alerta e dica 400;
enunciado 600; alternativa/opção 300; feedback 800; cena 1000.

## 6. Não muda
Site do aluno, catálogo, inscrição, pagamento, webhook, certificados, e-mails, rotinas automáticas,
turmas, financeiro, planilha ao vivo. A única mudança fora do EAD é a trava de 3.3 na exclusão de curso,
o item de menu e as duas permissões.

## 7. Verificação
- `node --check` em todos os `.js`; todos os EJS novos compilados.
- `prisma migrate dev` num Postgres local limpo; conferir que o SQL só cria (3.4); `prisma migrate deploy`
  num banco com as migrações atuais aplicadas e dados de exemplo (`SEED_EXEMPLO=true`).
- Testes de unidade em `src/lib/ead.js` (`node --test`): `normalizarVideo` (todas as linhas de 4.3 e
  links ruins), regras de pergunta (4.2), `pendencias` (módulo comum e final, cada regra de 4.4).
- Ciclo real pelo painel (login com 2FA, CSRF, modal): ativar EAD num curso de exemplo → criar o Módulo 4
  "Engasgo" com o tópico "Reconhecer o engasgo", a tela "Criança no recreio" e a pergunta do Exemplo B →
  ver pendências → completar até zerar → validar → ver a tela como o aluno → editar uma tela e conferir a
  volta para rascunho e o `EAD_INVALIDOU_MODULO` na auditoria → módulo final com o cenário "Pânico na
  hora do lanche" (Exemplo C) → tentar excluir o curso (recusado) → desativar o EAD.
- Papel CONSULTA vê as telas sem botões; SECRETARIA não vê Validar.
- PR para `main` **sem merge**; o usuário aprova depois de ver o ciclo.
