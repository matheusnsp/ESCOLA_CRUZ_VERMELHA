# EAD, etapa 5: dúvidas por aula, central de mensagens e curso só online

Branch `ead-duvidas`, a partir de `ead-venda` (etapa 4, PR #95). Decisões do Matheus em 07/11/2026.

## 1. Objetivo

- O aluno manda uma dúvida em cada aula (tela) do curso online e vê as dúvidas dos outros alunos já
  respondidas pela Escola.
- No painel (modo Online, só DEV) existe uma central para responder, descartar e corrigir.
- Dá para criar um curso que só existe online, sem depender de um curso do presencial.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Visibilidade | A dúvida só aparece para os outros alunos depois de respondida. Antes, só o autor a vê ("aguardando resposta"). |
| Quem responde | Só contas DEV, como todo o EAD até o lançamento. |
| Aviso ao aluno | E-mail "Sua dúvida foi respondida" e aviso na capa do curso até ele abrir a aula. |
| Nome público | Primeiro nome + inicial do sobrenome ("Maria S."). |
| Conversa | Pergunta e resposta, sem réplica. Não entendeu: nova dúvida na mesma aula. |
| Curso só online | Criado pelo painel do EAD; não aparece no presencial (painel e site). |
| Fora desta etapa | Permissão para a secretaria responder; anexos; curtidas/"também tenho essa dúvida"; venda em lote, Minha conta, cupom, parcelamento, lançamento (etapas 6–8). |

## 3. Banco (só acrescenta)

Migração `ead_duvidas`, conferida por `scripts/checar-migracao-ead.js` (a tabela nova entra em `TABELAS_EAD`):

- `enum StatusDuvidaEad { AGUARDANDO RESPONDIDA DESCARTADA OCULTA }`.
- `model DuvidaEad`: `id`, `alunoCursoId` (→ `AlunoCursoEad`, Cascade), `telaId` (→ `TelaEad`, Cascade),
  `texto` (até 1000), `status` (padrão AGUARDANDO), `resposta?`, `respondidaPor?`, `respondidaEm?`,
  `motivoDescarte?` (só interno), `lidaEm?` (quando o autor viu a resposta), `criadoEm`, `atualizadoEm`.
  Índices: `(telaId, status)`, `(alunoCursoId)`, `(status, criadoEm)`.
- `CursoOnline.somenteOnline Boolean @default(false)` (coluna nova numa tabela do EAD).

## 4. Aluno: dúvidas em cada tela

`src/lib/ead-duvidas.js` concentra as regras; as rotas ficam em `routes/ead-teste.js` (os dois modos,
teste e pago).

- **Bloco "Dúvidas desta aula"**, embaixo do conteúdo da tela:
  - as respondidas desta tela (status RESPONDIDA), da mais nova para a mais antiga, com "Maria S.", a data,
    a pergunta e a resposta "Escola de Educação e Saúde CVB-RJ";
  - as do próprio aluno que não estão respondidas, marcadas "aguardando resposta" (AGUARDANDO) ou
    "não publicada" (DESCARTADA). OCULTA não aparece para ninguém, nem para o autor;
  - formulário "Mandar uma dúvida" (10 a 1000 caracteres, CSRF), com o aviso: "A Escola responde por aqui
    e por e-mail. Depois de respondida, sua dúvida pode aparecer para outros alunos, só com seu primeiro
    nome e a inicial do sobrenome."
- **Quem pode mandar:** aluno logado com acesso ao curso (pago liberado, ou modo teste logado). Sem login:
  "Entre para mandar uma dúvida" (link para o login, voltando à tela). No modo pago sem acesso, a tela já
  não abre (etapa 4).
- **Limite:** no máximo 5 dúvidas AGUARDANDO por aluno em cada curso. Passou: mensagem na tela, nada gravado.
- **`POST <base>/tela/:telaId/duvida`:** grava e volta à tela, na âncora do bloco, com "Dúvida enviada".
  Uma dúvida idêntica à última do mesmo aluno na mesma tela (duplo clique) não é gravada de novo.
- **Lida:** ao abrir a tela, as dúvidas respondidas do aluno nessa tela ganham `lidaEm`.
- **Aviso na capa:** "Sua dúvida foi respondida" (ou "N dúvidas respondidas"), com link para a tela da mais
  recente não lida.

## 5. Painel: central de dúvidas (só DEV)

Rotas em `routes/ead.js`, tela `views/admin/ead/duvidas.ejs`.

- **Menu do modo Online:** item "Dúvidas" com o número de AGUARDANDO (de todos os cursos).
- **`GET /ead/duvidas`:** abas Aguardando (mais antigas primeiro), Respondidas, Descartadas e Ocultas,
  filtro por curso. Cada linha mostra:
  - aluno (nome completo e e-mail) e origem (Pago/Teste);
  - curso, módulo e tela, com link para a tela no painel e para a prévia;
  - o texto, a data e, se houver, a resposta, com quem respondeu e quando.
- **Ações (POST, CSRF, auditadas):**
  - **Responder:** grava a resposta (1 a 2000 caracteres), status RESPONDIDA, `respondidaPor`/`respondidaEm`,
    e manda o e-mail. A trava atômica (só passa de AGUARDANDO) garante um e-mail só.
  - **Descartar:** status DESCARTADA, com motivo opcional (interno).
  - **Editar resposta:** muda o texto, sem novo e-mail.
  - **Tirar do ar:** RESPONDIDA → OCULTA.
  - **Voltar para aguardando:** DESCARTADA ou OCULTA → AGUARDANDO.
- **Desempenho do curso:** coluna/linha com o número de dúvidas por tela (as 10 telas com mais dúvidas).
- **E-mail** (`enviarDuvidaRespondida(email, nome, { curso, tela, link })`): link para a tela, no modo em que
  a pessoa perguntou (o link de teste, se perguntou pelo teste; senão `/online/<curso>`), na âncora do bloco.

## 6. Curso só online

- **`GET/POST /ead/curso-online/novo`:** nome, descrição, carga horária e foto. Cria, numa ida:
  - o `Curso`, com `ativo false` e preços 0 (o presencial não o usa);
  - o `CursoOnline`, com `somenteOnline true`.
  
  O nome não pode repetir o de outro curso. Auditoria `EAD_CRIOU_CURSO_ONLINE`.
- **"Dados do curso"** na página do curso online, só quando `somenteOnline`: os mesmos quatro campos.
  Auditoria `EAD_EDITOU_CURSO_ONLINE`.
- **Fora do presencial:**
  - Presencial → Cursos (lista) não mostra o curso.
  - Ele não aparece no seletor de curso das telas de turma nova.
  - O `POST` de criar turma recusa o curso.
  - No site, o presencial não o mostra: ele já é `ativo false`, e o filtro do DEV também o tira.
- **No site, com o online publicado:**
  - Entra no catálogo `/cursos` com o selo "100% online", o preço do online, e o card leva a `/online/<id>`.
  - A home segue mostrando só o presencial.
  - `/cursos/<endereço>` desse curso redireciona (302) para `/online/<id>`.
  - O curso entra no sitemap como `/online/<id>`.
  
  Não publicado: nada aparece e `/cursos/<endereço>` dá 404, como hoje.
- **Desativar EAD** de um curso só online apaga o `CursoOnline` e o `Curso`, com as mesmas travas da etapa 4
  (fora do site, sem matrícula).

## 7. Testes

- Visibilidade: outro aluno vê só RESPONDIDA; o autor vê também AGUARDANDO e DESCARTADA; ninguém vê OCULTA.
- Nome público "Maria S." (nome de uma palavra só: só o primeiro nome).
- Limite de 5 aguardando; dúvida repetida não grava; sem login não grava; modo pago sem acesso não grava.
- Responder: status, e-mail uma vez só (duas respostas ao mesmo tempo ⇒ um e-mail), link do modo certo;
  editar sem e-mail; tirar do ar; voltar para aguardando; auditoria.
- Lida e aviso na capa.
- Central: abas, filtro por curso, contagem do menu.
- Curso só online:
  - criar e editar;
  - fora do Presencial → Cursos e do seletor de turma; criar turma recusada;
  - no catálogo só publicado, com link `/online`;
  - redireciona de `/cursos/<endereço>`;
  - entra no sitemap;
  - desativar apaga o `Curso`.
- Migração passa no checador.

## 8. Não muda

O presencial (fora de esconder o curso só online), o fluxo de compra e acesso da etapa 4, o conteúdo, os
certificados.

## 9. Pendente fora do código

A "escola digital" (outra implementação de curso online, que existe só num branch local do Matheus)
precisa de uma decisão antes de juntar qualquer EAD no `main`.
