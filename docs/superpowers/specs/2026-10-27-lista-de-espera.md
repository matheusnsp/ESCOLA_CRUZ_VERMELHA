# Lista de espera por curso (turma `EM_ESPERA`) — especificação

Data: 27/10/2026. Decidido com o usuário na conversa (substitui a trava "quem veio pelo site se trata em
Inscrições" e o "apagar e recriar" do PR #89).

## 1. Objetivo

A secretaria pode **mover** qualquer matrícula do curso para outra turma ou **mandar para a lista de
espera**, sem apagar nada, tenha a pessoa vindo pelo encaixe da matrícula rápida ou pelo site da escola, e
tenha ela pago só a inscrição, parte ou tudo. Quem está na espera aparece em "Aguardando encaixe" na
Matrícula rápida e, no painel do aluno, vê "Em espera · data ainda não definida".

## 2. Decisões

| Tema | Decisão |
|---|---|
| Como guardar "sem turma" | Um status novo de turma, `EM_ESPERA`, e **uma turma de espera por curso**, criada sozinha na primeira vez que alguém for para a espera (`inicioPrevisto` 2099-12-31, `vagas` 9999, `minimoAlunos` 0). A matrícula só troca de turma; pagamentos, nota e histórico ficam. |
| Migração | Só `ALTER TYPE "StatusTurma" ADD VALUE 'EM_ESPERA'`. Nenhuma coluna nova. |
| Quem pode ir para a espera | Matrícula com `statusPagamento` ≠ `CANCELADO`/`ESTORNADO`, sem nota (`nota`, `situacao`, `avaliacoes`), e turma atual ≠ `ENCERRADA`. Qualquer situação de pagamento (só inscrição, parcial, tudo pago). |
| Mover entre turmas reais | Mesmo curso, destino `ABERTA`/`CONFIRMADA`, diferente da atual, com vaga (critério `FILTRO_VAGA`), sem nota, não cancelada/estornada. Preço não muda. Vale para encaixe e para quem veio pelo site. |
| Sair da espera | É o próprio **Encaixar** da Matrícula rápida (move a matrícula da turma de espera para a escolhida) ou o **Transferir** em Inscrições. |
| O que some | O caminho "apagar matrícula e pagamentos" do PR #89 **deixa de existir**: `voltarParaEspera` passa a mover para a turma de espera. |
| Auditoria | `MOVEU_MATRICULA_RAPIDA` `{ inscricaoSite, de, para }`; `VOLTOU_PARA_ESPERA_MATRICULA_RAPIDA` `{ inscricaoSite, matriculaId, de, esperaTurmaId, motivo, origem: 'encaixe' \| 'escola' }`; `ENCAIXOU_DA_ESPERA` `{ inscricaoSite, matriculaId, de, para }`. |

## 3. Secretaria

### 3.1 Matrícula rápida (`lib/matricula-rapida.js`, `views/admin/matricula-rapida.ejs`)
- `carregar()`: depois de resolver `p.encaixe` (chave gravada ou matrícula da escola), se a turma dessa
  matrícula está `EM_ESPERA`, a pessoa vira `p.espera = { matriculaId, alunoId, desde }` e `p.encaixe = null`.
  Ela conta como "aguardando encaixe" (número do topo, filtro, Painel).
- Card de quem está na espera: estado "Na espera desde dd/mm/aaaa" (no lugar de "Esperando há N dias") e o
  form **Encaixar** normal. O `encaixar` com `p.espera` **move** a matrícula (não cria outra, não cria
  pagamento), atualiza/cria a chave `matricularapida:<inscricaoId>` com o `turmaId` novo e manda o e-mail
  "Sua turma foi definida".
- Card de quem tem turma (encaixe **ou** site): bloco `.mr-acoes` com **Mover** (select das outras turmas
  abertas do curso; sem outra turma, texto "Mover: nenhuma outra turma aberta deste curso" + link "Criar
  turma") e **Voltar para a espera** (motivo obrigatório pelo modal). Some só com `erroLigar` ou `dobro`.
- A matrícula alvo é resolvida pela função `matriculaDoCurso(inscricaoId)`: chave gravada com
  `matriculaId` → essa; senão, a matrícula da pessoa (e-mail do site, papel ALUNO) numa turma do curso, não
  cancelada/estornada, preferindo `taxaConfirmada`. Sem matrícula → erro "Clique em Atualizar".
- Ao mover/espera uma matrícula que não tinha chave, grava a chave com `{ matriculaId, turmaId, alunoId,
  naEscola: true, por, em }` para o histórico (`movidoDe/movidoPor/movidoEm` ou `esperaDesde/esperaMotivo`).

### 3.2 Outras telas
- **Turmas:** a turma de espera não aparece nas abas; o `STATUS_TURMA` do formulário não oferece
  `EM_ESPERA` (ninguém cria ou edita à mão). Excluir turma de espera: bloqueado (tem matrículas, como hoje).
- **Inscrições** e **Aluno → matrículas:** no lugar da data, "Em espera · sem data"; etiqueta "Em espera".
  Transferir continua funcionando a partir dela.
- **Pendentes, Painel, Relatório, Lembretes:** tudo que hoje exclui `CONGELADA` exclui também `EM_ESPERA`
  (sem cobrança, sem lembrete, fora de "fora de prazo").
- **Planilha ao vivo:** `statusTurma` devolve `EM_ESPERA` e a aba Turmas mostra "Em espera"; a turma de
  espera não conta como turma aberta.

## 4. Aluno (`views/minha-conta.ejs`, `routes/painel.js`, `lib/status-pagamento.js`)
- Card da inscrição com `m.turma.status === 'EM_ESPERA'` (e não devolvida): selo **EM ESPERA** (amarelo),
  linha "**Aguardando encaixe** · data ainda não definida · inscrito em dd/mm/aaaa", etiqueta "Em espera"
  ao lado da etiqueta de taxa, caixa azul: "Você está na lista de espera. Sua inscrição está paga e
  garantida; ainda não há data definida para a sua turma. Quando a secretaria encaixar você numa turma, a
  data aparece aqui e você recebe um e-mail." Sem botão de pagar (`calcularRetomada` devolve null).
- As etiquetas do que já foi pago (taxa, curso) continuam iguais.
- E-mail de pagamento confirmado com turma em espera: "data a confirmar (lista de espera)", sem aulas.

## 5. E-mails (`lib/email.js`)
- `enviarEntradaNaEspera(email, nome, { curso, link })`: "Você está na lista de espera" — inscrição
  continua paga/garantida; a secretaria avisa a data; botão "Ver minha matrícula".
- `enviarTurmaDefinida(email, nome, { curso, inicio, link })`: "Sua turma foi definida" — início em dd/mm;
  botão "Ver minha matrícula". (`enviarMudancaTurmaMatriculaRapida` continua para turma → turma.)

## 6. Não muda
Financeiro, Integração/planilha (valores), certificados, Escola Digital, inscrição pelo site, webhook.

## 7. Verificação
- `node --check` nos `.js`, EJS compilado, migração aplicada num banco local de teste.
- Ciclo real pelas rotas do painel (login 2FA, CSRF, modal): site da escola → espera → encaixar; encaixe →
  mover → espera → encaixar; travas (turma cheia, mesma turma, com nota, cancelada); Minha conta do aluno
  nos dois estados; e-mails no terminal; auditoria das três ações.
- PR para `main` **sem merge**; o usuário aprova depois de ver o ciclo.
