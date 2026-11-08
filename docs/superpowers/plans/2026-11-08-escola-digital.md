# Escola Digital, vistoria e criação simplificada — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fazer três coisas:
- corrigir o que a vistoria achou no curso online;
- separar os cursos online numa aba própria, a "Escola Digital", com interruptor no painel;
- simplificar a criação de cursos.

**Architecture:** a Escola Digital é uma chave em `Configuracao` lida a cada pedido, guardada em cache. `res.locals.escolaDigital` alimenta o menu, o catálogo e as rotas do curso online. Os endereços `/escola-digital/<curso>` são apelidos das mesmas rotas de `/online/<curso>`, em `routes/ead-teste.js` e `routes/ead-online.js`, e `vitrine.urlOnline()` passa a gerar o novo endereço. As regras de validação viram uma lista única, `checklist(modulo)`, de onde saem as pendências (o que trava) e os avisos (o que é recomendado). A tela do aluno não muda quanto aos módulos que ele vê (decisão do Matheus); a proteção contra rascunho fica no painel (avisos e regra de validação).

**Tech Stack:** Node 22 CommonJS, Express 4, EJS, Prisma 5/Postgres, node:test (`npm test`), Playwright para o ciclo pela interface.

**Spec:** `docs/superpowers/specs/2026-11-08-escola-digital.md` (os códigos B1…B8, H1…H11, P1…P10 e T1 vêm de lá).

## Global Constraints

- **Sem migração.** A tela do aluno continua mostrando todos os módulos, como hoje (decisão do Matheus, 08/11).
- O CSP proíbe JS inline: scripts em `src/public/js/*.js`, servidos por `asset()`.
- O texto de interface é em português, sem jargão.
- Interruptor: chave `escola-digital:ligada` em `Configuracao`, valor `'1'` ou `'0'`. O padrão é **desligada**. Auditoria: `ESCOLA_DIGITAL_LIGOU` / `ESCOLA_DIGITAL_DESLIGOU`.
- Endereço novo `/escola-digital/<slug>`. O `/online/<slug ou id>` continua abrindo, com `<link rel="canonical">` para o novo, sem redirecionar.
- Desligada: quem tem acesso (comprou, vaga de escola, cortesia) continua estudando. A página de venda para quem não tem acesso mostra "Este curso não está disponível no momento.". O link de teste continua funcionando.
- Tempo automático do módulo: 3 min por tela + 1 min por pergunta ativa + 3 min por cenário.
- Texto padrão da fala do instrutor vazia: "Certo!" na correta; "Não é a melhor escolha. Tente de novo." nas outras.
- Frase neutra do rodapé do site: "Capacitação para quem quer cuidar, prevenir e agir com responsabilidade."

## Review Focus

1. Escola Digital desligada e funcionário de escola entrando pelo convite: o convite e `/escola-digital/<curso>` continuam abrindo o curso para ele (teste na Task 6).
2. Curso publicado em que a secretaria cria um módulo: o aviso aparece no painel, e o aluno continua vendo o curso como antes (teste na Task 1).
3. Cupom de 100% de quem ainda não tem conta, pelo caminho de cadastro de verdade: termina com o curso liberado sem digitar o código de novo (teste na Task 2).
4. Links antigos `/online/<uuid>` de e-mails já enviados continuam abrindo a página do curso (teste na Task 6).
5. Curso presencial que também tem versão online, com a Escola Digital desligada: o catálogo e a página do presencial não mostram nenhum link para o online (teste na Task 6).

---

### Task 1: Proteção contra rascunho do lado da secretaria (B5, B6)

**Files:**
- Modify: `src/views/admin/ead/curso.ejs`, `src/views/admin/ead/modulo.ejs`, `src/views/admin/ead/ia-form.ejs` (aviso), `src/routes/ead.js` (passar `publicado` para as views, se ainda não passa)
- Test: `test/escola-digital-aluno.test.js`

**Interfaces:**
- Produces: aviso com a classe `adm-aviso-publicado` e o texto exato "Este curso está publicado: o que você criar ou mudar aqui aparece para os alunos na hora." Aparece na página do curso e do módulo quando `co.publicado`, e no formulário da IA quando há cursos publicados entre os destinos (texto ao lado do select). A regra "todo tópico com pelo menos 1 tela" é feita na Task 4.

- [ ] Step 1: testes:
  - `curso publicado mostra o aviso no painel` (GET `/ead/curso/:id` e `/ead/modulo/:id`, padrão de `test/ead-ia-painel.test.js`);
  - `curso não publicado não mostra`;
  - `tela do aluno inalterada`: `carregarCursoParaAluno` continua devolvendo os módulos em rascunho, uma regressão contra filtrar.
- [ ] Step 2: FAIL (os dois primeiros).
- [ ] Step 3: implementar os avisos.
- [ ] Step 4: PASS e `npm test` verde.
- [ ] Step 5: commit `feat(painel): aviso de curso publicado ao criar ou mudar conteúdo`.

### Task 2: Cupom sobrevive ao login e ao cadastro; limite conta só código errado (B3, B7)

**Files:**
- Modify: `src/routes/auth.js` (cadastro, ~150; login, ~515), `src/lib/limite-cupom.js`, `src/routes/ead-teste.js` (`cupomDaCapa`), `src/routes/ead-online.js` (compra com cupom inválido)
- Test: `test/escola-digital-cupom.test.js`

**Interfaces:**
- Produces:
  - `limite-cupom.js` exporta `{ limiteCupom, registrarFalhaCupom, MSG_TENTATIVAS }`.
  - `registrarFalhaCupom(req)` soma 1 falha ao IP, numa janela de 15 min.
  - `limiteCupom` marca `req.cupomBloqueado = true` quando o IP tem 30 falhas ou mais na janela.
  - O contador fica num `Map` em memória, com limpeza das janelas vencidas.

- [ ] Step 1: testes:
  - `cupom da capa continua depois do POST /login`: app de teste com sessão real (padrão de `test/ead-links-nome.test.js`). Fazer `GET /online/<slug>?cupom=X` (aplicado), depois `POST /login` com identificador e senha, depois `GET /online/<slug>`: o HTML contém "aplicado" e o preço com desconto.
  - `mesmo caminho pelo POST /cadastro` (usuário novo).
  - `cupom de 100%: cadastro e volta mostram "Liberar curso"`.
  - `30 usos de um cupom válido não bloqueiam`: 31 GETs com cupom válido continuam aplicando.
  - `30 códigos errados bloqueiam o 31º`: o 31º mostra `MSG_TENTATIVAS`.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar:
  - `auth.js`: ler `req.session.cupomEad` antes do `regenerate` e regravar na sessão nova, nos dois handlers;
  - `limite-cupom.js` conforme as Interfaces;
  - chamar `registrarFalhaCupom(req)` quando `validarCupom` devolve `erro`, em `cupomDaCapa` e na compra.
- [ ] Step 4: PASS, e `npm test` verde.
- [ ] Step 5: commit `fix(ead): cupom continua depois do login e do cadastro; limite só para código errado`.

### Task 3: Estorno duplicado, desativar EAD, aluno de escola no painel, certificado do link de teste (B4, B8, P10, T1)

**Files:**
- Modify: `src/lib/status-pagamento.js` (~275), `src/routes/ead.js` (`/ead/curso/:id/desativar`, ~139), `src/lib/ead-relatorios.js` (`detalheDoAluno`, ~90), `src/lib/ead-certificado.js`, `src/routes/ead-teste.js` (`concluirCurso`, rota `/certificado`), `src/views/admin/certificado-imprimir.ejs`
- Test: `test/escola-digital-correcoes.test.js`

**Interfaces:**
- Produces: `previaCertificadoEad(alunoCursoId, { documentoAluno }) -> { dados }`. Mesmos `dados` de `dadosCertificadoEad`, com `teste: true`, `livro: null`, `registro: null`. Não reserva número, não chama a Redação e não grava log.

- [ ] Step 1: testes:
  - `estornar um de dois pagamentos PAGO mantém a matrícula PAGO` (o cenário de `vistoria-codigo/estorno-duplicado.js`: CREDITO PAGO + PIX PAGO, estorna o PIX → `acessoPago(...).liberado === true`);
  - `estornar o único pagamento fecha o acesso` (continua como hoje);
  - `desativar curso com cupom mostra mensagem` (redirect com `erro` contendo "cupom", sem exceção);
  - o mesmo com lote ("escola");
  - `detalheDoAluno de quem veio de lote`: origem começa com "Escola:" e o início é `vaga.criadoEm`;
  - `concluir pelo link de teste não reserva número`: a contagem de `LogAuditoria` de numeração não muda, e `previaCertificadoEad(...).dados.teste === true`.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar:
  - no estorno: antes do update, `prisma.pagamento.count({ where: { matriculaId, tipo: 'CURSO', status: 'PAGO', id: { not: pagamento.id } } })`. Se for maior que 0, não muda a matrícula e loga;
  - desativar: contar `cupomEad` e `loteEad` do curso online antes de apagar;
  - `detalheDoAluno` com a mesma regra da lista;
  - `concluirCurso`: só chama `dispararEmissao` em `req.ead.modo === 'pago'`;
  - a rota `/certificado` em modo teste renderiza `previaCertificadoEad`;
  - a view mostra a faixa "TESTE — sem validade" quando `teste`, e "—" no Livro/Registro.
- [ ] Step 4: PASS, e `npm test` verde.
- [ ] Step 5: commit `fix(ead): estorno duplicado, desativar com cupom/lote, aluno de escola no painel, certificado de teste`.

### Task 4: Criação simplificada (seção 3, P1, P3, P6, P9)

**Files:**
- Modify: `src/lib/ead.js` (`pendencias`, `avisos` e novos `checklist`, `minutosDoModulo`; mensagens de `inteiro()`), `src/lib/ead-db.js` (`marcarFinal`), `src/routes/ead.js` (módulo novo/editar com tópicos; tela "Salvar e escrever outra"; mover módulo sem invalidar), `src/views/admin/ead/modulo.ejs`, `modulo-form.ejs`, `tela-form.ejs`, `src/views/ead-teste/cenario.ejs` (texto padrão da fala), as views que mostram minutos (capa, módulo do aluno, lista do painel)
- Test: `test/escola-digital-criacao.test.js`; ajustar `test/ead.test.js` e `test/ead-db.test.js` onde dependem das regras antigas

**Interfaces:**
- Produces:
  - `checklist(modulo) -> { paraValidar: [{ texto, ok }], recomendado: [{ texto, ok }] }`;
  - `pendencias(modulo)` = os `texto` de `paraValidar` com `!ok`;
  - `avisos(modulo)` = os `texto` de `recomendado` com `!ok`;
  - `minutosDoModulo(modulo) -> number`: `minutosEstimados` se for maior que 0, senão a soma automática.
- **Para validar** (comum):
  - "Título";
  - "Pelo menos 1 tópico com 1 tela";
  - "Todo tópico tem pelo menos 1 tela";
  - "Perguntas com alternativas válidas".
- **Para validar** (final):
  - "Título";
  - "Pelo menos 1 cenário";
  - "Todo cenário tem decisão";
  - "Toda decisão tem de 2 a 4 opções e 1 correta".
- **Recomendado:**
  - "Vídeo em todas as telas";
  - "Âncora em todas as telas";
  - "Introdução do módulo";
  - "3 perguntas ou mais por tópico";
  - "8 perguntas ou mais no módulo (libera o pré-teste)";
  - "O porquê em todas as perguntas";
  - "Cena em todos os cenários";
  - "Fala do instrutor em todas as opções".

- [ ] Step 1: testes:
  - `módulo com 1 tópico, 1 tela sem vídeo e sem perguntas valida` (`pendencias` = `[]`, `avisos` inclui o vídeo);
  - `módulo sem tópicos não valida`;
  - `tópico sem telas não valida, mesmo com perguntas`;
  - `decisão com 2 opções e 1 correta valida`; `decisão com 5 opções não valida`;
  - `minutosDoModulo` de 2 telas e 4 perguntas sem minutos → 10; com `minutosEstimados: 25` → 25;
  - `criar segundo módulo final é recusado` (POST `/ead/curso/:id/modulos/novo` com `final=1` → erro "Este curso já tem um módulo final");
  - `módulo novo com "Tópicos (um por linha)" cria os tópicos na ordem`;
  - `mover módulo validado não volta para rascunho` e redireciona com `ok=Ordem salva.`;
  - `inteiro acima do máximo dá mensagem em português` ("No máximo 600.").
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar:
  - as funções conforme as Interfaces;
  - `marcarFinal` recusa quando já existe outro final, com a mensagem `Este curso já tem um módulo final ('<título>').`;
  - o form do módulo ganha a textarea `topicos`, só na criação;
  - o form da tela ganha "Salvar e escrever outra", como nas perguntas;
  - o mover de módulos tira o `invalidarSeValidado`;
  - `modulo.ejs` (painel) mostra as duas listas com ✓/○ desde o começo, no lugar da lista de pendências;
  - "0 min" some onde aparece, e os minutos exibidos usam `minutosDoModulo`;
  - `cenario.ejs` usa o texto padrão quando `feedback` está vazio;
  - a mensagem do módulo final diz que ele é opcional.
- [ ] Step 4: PASS, e `npm test` verde (os testes antigos ajustados às regras novas).
- [ ] Step 5: commit `feat(ead): criação simplificada: só o necessário trava, o resto vira aviso`.

### Task 5: Painel mais fácil de usar (P2, P4, P5, P7, P8)

**Files:**
- Modify: `src/views/admin/ead/curso.ejs` (Módulos antes de Venda), `src/routes/ead.js` (preço, nota mínima, tópico, resposta de dúvida: re-render com os valores, em vez de `voltar()` com `?erro=`), `src/views/admin/header.ejs` e o script do modal de confirmação (`requestSubmit(submitter)`; classe do botão por `data-confirmar-tipo="ok|perigo"`), `src/public/ead-admin.css` (`.adm-campos > *, select { min-width:0; max-width:100% }`)
- Test: `test/escola-digital-painel.test.js`

- [ ] Step 1: testes:
  - `curso.ejs: "Novo módulo" vem antes de "Venda no site"` (posição no HTML);
  - `preço inválido mostra a página com o valor digitado` (status 400 e `value="abc"`);
  - o mesmo para resposta de dúvida vazia (o texto continua no textarea) e tópico vazio;
  - `botão Validar e Publicar usam data-confirmar-tipo="ok"`.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar conforme os Files.
- [ ] Step 4: PASS, `npm test` verde, e conferir no navegador o "Salvar e escrever outra" num módulo validado.
- [ ] Step 5: commit `fix(painel): ordem da página do curso, erros sem perder o digitado, confirmação certa, celular`.

### Task 6: Escola Digital — interruptor, endereços, catálogo e páginas (seção 2)

**Files:**
- Create: `src/lib/escola-digital.js`, `src/views/escola-digital.ejs`, `src/views/ead-teste/indisponivel.ejs`
- Modify:
  - `src/server.js` (middleware `res.locals.escolaDigital`);
  - `src/lib/vitrine.js` (`urlOnline` → `/escola-digital/<slug>`; nova `URL_ESCOLA_DIGITAL = '/escola-digital'`);
  - `src/routes/ead-teste.js` (`P()` ganha `/escola-digital/:cursoId`; `base` do modo pago passa a `/escola-digital/<cursoId>`; canonical para o endereço novo quando entrou por `/online`; desligada e sem acesso → `indisponivel`);
  - `src/routes/ead-online.js` (compra também em `/escola-digital/:cursoId/comprar`);
  - `src/routes/cursos.js` (`GET /escola-digital`; o catálogo e a home sem cursos só online e sem `curso.online`; sitemap; aviso no presencial);
  - `src/views/curso-detalhe.ejs` e `partials/caixa-online.ejs` (aviso pequeno, só ligada);
  - `partials/v-card*.ejs` (sem selo online no catálogo);
  - `partials/site-header.ejs` (item "Escola Digital" depois de "Início", no menu e na gaveta, só ligada);
  - `src/routes/ead.js` e `views/admin/ead/cursos.ejs` (cartão do interruptor no topo; POST `/ead/escola-digital`).
- Test: `test/escola-digital.test.js`

**Interfaces:**
- Produces:
  - `escola-digital.js` exporta `{ CHAVE, estaLigada, definirLigada, cursosDaEscolaDigital }`;
  - `estaLigada() -> Promise<boolean>`, com cache de 30 s por instância e limpo por `definirLigada`;
  - `definirLigada(ligada, req) -> Promise<{ erro?: string }>`, que recusa ligar sem curso publicado com `'Publique um curso antes de ligar a Escola Digital.'`;
  - `cursosDaEscolaDigital() -> Promise<Curso[]>`: cursos com curso online publicado, cada um com `.online = { preco, somenteOnline }`, mais os extras anexados (o formato que `partials/v-card-cat.ejs` espera);
  - `res.locals.escolaDigital: boolean` em todo pedido do site.

- [ ] Step 1: testes:
  - `padrão é desligada`; `ligar sem curso publicado é recusado`; `ligar e desligar gravam auditoria`;
  - `desligada: GET /escola-digital → 404`; o menu do site não tem "Escola Digital";
  - `desligada: visitante na venda vê "não está disponível"` e não vê "Comprar";
  - `desligada: quem comprou abre /escola-digital/<slug> e as telas` (matrícula PAGA na turma ONLINE);
  - `desligada: funcionário de lote abre pelo convite e por /escola-digital/<slug>` (Review Focus 1);
  - `ligada: /escola-digital lista os publicados`; o menu tem "Escola Digital";
  - `/online/<slug> e /online/<uuid> abrem com canonical para /escola-digital/<slug>` (Review Focus 4);
  - `catálogo /cursos não tem curso só online nem "100% online"`;
  - `presencial com online: aviso só com a Escola Digital ligada` (Review Focus 5);
  - `sitemap tem /escola-digital/<slug> só ligada`;
  - `urlOnline({nome:'Primeiros Socorros na Escola'}) === '/escola-digital/primeiros-socorros-na-escola'` (ajustar `test/ead-links-nome.test.js`);
  - `compra por /escola-digital/<slug>/comprar cria a matrícula`.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar conforme as Interfaces.
  - A página `/escola-digital` tem o topo com foto (`/img/capa.webp`, gradiente escuro à esquerda), a trilha "Início › Escola Digital", o kicker "Escola Digital CVB-RJ", o título "Aprenda onde estiver." e a frase "Cursos 100% online da Escola de Educação e Saúde da Cruz Vermelha. Pelo celular, no seu ritmo, com certificado oficial ao concluir.".
  - Abaixo do título, 4 selos: "No celular ou computador", "No seu ritmo", "Certificado da Cruz Vermelha", "Turmas para escolas e empresas".
  - Abaixo dos selos, a grade "Cursos online · Comece hoje." com `v-card-cat`.
  - O CSS fica em `src/public/vitrine.css` (sem `style` inline).
  - Texto do aviso no presencial: "Este curso também existe 100% online, na Escola Digital." com o link "Ver na Escola Digital →".
  - Limpar o cache do catálogo (`cacheRapido.limparTudo()`) ao mudar o interruptor.
- [ ] Step 4: PASS, e `npm test` verde (atualizar os testes que esperavam `/online/` nos links gerados).
- [ ] Step 5: commit `feat(site): Escola Digital com aba própria e interruptor no painel`.

### Task 7: Topo, rodapé e telas da Escola Digital (B1, B2, H1–H11)

**Files:**
- Modify:
  - `src/views/ead-teste/_topo.ejs` e `_fim.ejs`, mais as views que os incluem (`escola/convite.ejs`, `minha-escola.ejs`, `lote.ejs`, que hoje passam `base` para o logo);
  - `src/public/ead.css`;
  - `partials/site-footer.ejs` (frase neutra);
  - `partials/site-header.ejs` (menu de conta: "Cursos online" se tiver curso online, "Minha escola" se for gestor; dados por `res.locals`, montados no middleware da Task 6 ou num novo);
  - `src/public/certificado.css` (na tela, abaixo de 1100 px, escala para caber; 297 mm só em `@media print`);
  - `src/views/ead-teste/capa.ejs` (H7);
  - `src/views/ead-teste/modulo.ejs` (H8: "✓ concluído pelo pré-teste");
  - `src/views/inscricao-retorno.ejs` ou `src/public/js/pix.js` (H9: tirar a inclusão duplicada);
  - `src/views/escola/lote.ejs` e `src/public/js/` (H11: botão Copiar e confirmação em Desligar e Trocar o link).
- Test: `test/escola-digital-layout.test.js`, mais o ciclo pela interface (Task 8)

- [ ] Step 1: testes de HTML:
  - `_topo`: o logo aponta para `/escola-digital` com ela ligada e para `/` com ela desligada; a marca diz "ESCOLA DIGITAL"; tem "Minha conta" e "Sair" logado e "Entrar" deslogado; a faixa do topo é link para cruzvermelhariodejaneiro.org;
  - `_fim`: tem `/privacidade`, `data-cvrj-cookies`, `wa.me/` e o copyright;
  - `site-footer`: não contém "presencial" na frase;
  - `capa.ejs` com matrícula PENDENTE e cupom: mostra o preço riscado.
- [ ] Step 2: FAIL.
- [ ] Step 3: implementar:
  - CSS: `.ea-cupom-linha .ea-pilula { width:auto; flex:none; padding:10px 16px }`; `.ea-heroi-grid { grid-template-columns: minmax(0,1fr) }` no celular; `body.ea-pagina { min-height:100vh; display:flex; flex-direction:column }`, com o conteúdo em `flex:1`; `summary` do índice com padding de 12 px; "tirar" e a trilha com área de toque de pelo menos 32 px;
  - o menu de conta do `_topo` em `<details>` (sem JS), como o do site; burger no celular com o mesmo padrão da gaveta do site (script externo existente ou um novo em `src/public/js/`).
- [ ] Step 4: PASS e `npm test` verde.
- [ ] Step 5: commit `fix(ead): topo e rodapé da Escola Digital iguais ao site, cupom e celular`.

### Task 8: Documentação, ciclo pela interface e revisão

**Files:**
- Modify: `docs/ead/como-publicar-um-curso.md` (regras novas, interruptor, endereço), `docs/ead/deploy.md` (sem migração nova nesta etapa)

- [ ] Step 1: atualizar os guias.
- [ ] Step 2: ciclo Playwright em 1280 e 390 px, com prints. Roteiro:
  - ligar a Escola Digital no painel;
  - menu, `/escola-digital` e card;
  - página do curso: digitar o cupom (o campo mostra o código), aplicar, entrar e conferir que o desconto continua;
  - aula e rodapé com "Preferências de cookies";
  - certificado no celular;
  - desligar: visitante vê "não disponível", quem comprou continua;
  - criar um curso mínimo do zero pelo painel, contando páginas e campos.
  - Apagar os dados de teste no fim.
- [ ] Step 3: `npm test` → tudo verde.
- [ ] Step 4: commit `docs(ead): Escola Digital e criação simplificada`.
- [ ] Step 5: revisão final independente, correções com teste, e PR para `main` sem merge.
