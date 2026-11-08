# Escola Digital CVB-RJ — vistoria, aba própria e criação simplificada

Data: 08/11/2026 · Base: `main` (EAD etapas 1 a 9 no ar, PR #102; selo de saúde, PR #105)

## Objetivo

O Matheus pediu três coisas:

1. **Vistoria** de tudo o que foi feito no curso online. Corrigir o que impede de usar (ex.: "no cupom eu não consigo escrever nada"), com atenção a header e footer para "bater com tudo".
2. **Uma aba nova para os cursos online**, a **Escola Digital CVB-RJ** (nome curto "Escola Digital"), separada dos presenciais. Liga e desliga pela secretaria.
3. **Facilitar a criação dos cursos online.** Hoje "pede muita coisa e é muito difícil". A orientação foi "apenas facilite a minha vida".

Decisões do Matheus (08/11):

| Pergunta | Resposta |
|---|---|
| Aviso na página do presencial | Sim, um aviso pequeno com link para a Escola Digital, quando ela estiver ligada |
| Escola Digital desligada | Quem já comprou ou recebeu vaga de escola continua estudando; some só para quem visita |
| Endereço | `/escola-digital/<curso>`; os links `/online/...` continuam funcionando |
| Facilitar a criação | Deixou a decisão comigo |

A vistoria foi feita em 3 frentes no app local. Foram percorridos a parte do aluno (1280 e 390 px), o painel (curso criado do zero) e o código. Os achados estão na seção 1. Cada um traz a correção que entra nesta etapa.

## 1. Correções da vistoria

### 1.1 Bloqueiam o uso (entram todas)

| # | Problema | Correção |
|---|---|---|
| B1 | **Campo do cupom com 26 px**: não dá para ver o que se digita. O botão "Aplicar" herda `width:100%` (`ead.css:149`) e estica (computador e celular). | Botão do cupom com largura própria; campo ocupa o resto. |
| B2 | **Celular: o topo da página de venda é cortado à direita**: título, texto e botões do cartão de preço. Mesma causa da B1, mais a grade sem coluna `minmax(0,1fr)`. | Corrigir a grade do topo; conferir em 390 px. |
| B3 | **O cupom some no login e no cadastro.** Quem chega pelo link com cupom e entra ou cria conta volta com o preço cheio. O cupom de 100% ("Criar conta e liberar") deixa de liberar. Causa: `session.regenerate()` (`auth.js:150-156`, `:515-530`) descarta `cupomEad`. | Levar o cupom para a sessão nova no login e no cadastro. Teste com login de verdade, não pelo cabeçalho de teste. |
| B4 | **Estorno de um pagamento duplicado fecha o acesso.** O aluno pagou PIX e cartão, a secretaria estorna um dos dois, e ele fica bloqueado. (`status-pagamento.js:275-293`) | Só marcar ESTORNADO se não sobrar outro pagamento do curso PAGO na matrícula. |
| B5 | **Rascunho aparece para quem pagou.** Um módulo novo, ou um escrito pela IA num curso já publicado, vai direto para o aluno. | **Decisão do Matheus (08/11): a tela do aluno fica exatamente como está.** A proteção fica na secretaria. Na página do curso e do módulo de um curso publicado, o painel mostra o aviso: "Este curso está publicado: o que você criar ou mudar aqui aparece para os alunos na hora." O formulário da IA mostra o mesmo aviso quando o destino é um curso publicado. |
| B6 | **Tópico com perguntas e sem telas trava o curso.** O teste não tem por onde entrar, e o aluno anda em círculo. Cenário sem decisões também trava. | Também do lado da secretaria: para validar, todo tópico precisa de pelo menos 1 tela, e todo cenário de pelo menos 1 decisão (seção 3.1). A tela do aluno não muda. |
| B7 | **Limite de tentativas do cupom conta usos certos.** Numa escola com o mesmo Wi-Fi, depois de 10 a 15 pessoas o link de cupom para de funcionar. (`limite-cupom.js`) | Contar só código inválido. |
| B8 | **"Desativar EAD" dá erro 500** quando o curso tem cupom ou lote. (`ead.js:139-160`) | Conferir antes e mostrar a mensagem certa. |

### 1.2 Header, footer e aparência (entram todas)

| # | Problema | Correção |
|---|---|---|
| H1 | As páginas do curso online não têm caminho para o site, menu de conta nem "Sair". O logo leva para a própria página. (`ead-teste/_topo.ejs`) | Topo da Escola Digital: logo e marca "ESCOLA DIGITAL · CVB-RJ" levando para `/escola-digital` (ou `/` com ela desligada). Links "Site da escola" e "Minha conta". Menu "Olá, Nome ▾" com Minha conta, Cursos online, Minha escola (se for gestor) e Sair. Burger no celular. A faixa do topo vira link para o site da CVB-RJ, como no site. |
| H2 | O rodapé do curso online só tem nome e endereço. Faltam Política de Privacidade, "Preferências de cookies", WhatsApp, e-mail e copyright. Sem "Preferências de cookies", quem já escolheu no banner não consegue mudar (LGPD). (`_fim.ejs`) | O rodapé da Escola Digital usa a mesma faixa de baixo do site (`site-footer`): privacidade, preferências de cookies, contato, WhatsApp e copyright. |
| H3 | O pagamento (`/inscricao/retorno`) usa o layout do site, e o rodapé diz "Capacitação **presencial**". | Frase do rodapé neutra ("Capacitação para quem quer cuidar, prevenir e agir com responsabilidade."). |
| H4 | O menu de conta do site não tem "Cursos online" nem "Minha escola". | Acrescentar os dois, só para quem tem. |
| H5 | O rodapé fica no meio da tela em páginas curtas. | `min-height:100vh` no corpo das páginas da Escola Digital. |
| H6 | O certificado no celular fica com 1123 px: a pessoa só vê uma fatia e precisa rolar de lado. | Na tela, reduzir para caber na largura; os 297 mm valem só na impressão. |
| H7 | Pagamento em andamento com cupom: o cartão não mostra o preço com desconto, e "Ver o pagamento" encosta em "Tem cupom?". | Mostrar o preço riscado e o novo também nesse estado; dar espaço. |
| H8 | Depois de passar no pré-teste, a lista do módulo continua dizendo "teste pendente". | Mostrar "✓ concluído pelo pré-teste". |
| H9 | "Copiar código PIX" dá erro no console (`pix.js:9` procura `#chavePix`). | Tirar o script duplicado ou protegê-lo. |
| H10 | Áreas de toque pequenas: índice do módulo no celular (16 px), "tirar" do cupom, trilha. | Aumentar o espaço clicável. |
| H11 | Página do lote: o convite não tem botão "Copiar", e "Desligar" e "Trocar o link" não pedem confirmação. | Botão Copiar; confirmação nos dois. |

### 1.3 Painel (entram todas)

| # | Problema | Correção |
|---|---|---|
| P1 | Criar um segundo módulo final tira o "final" do primeiro sem avisar. | Recusar: "Este curso já tem um módulo final ('X')". |
| P2 | O botão "Novo módulo" fica escondido embaixo da caixa "Venda no site". | Na página do curso: Módulos primeiro, depois Venda. |
| P3 | Mensagens em inglês ("Number must be less than or equal to 600"). | Mensagens dos números em português. |
| P4 | Erros que apagam o que foi digitado: preço, nota mínima, tópico vazio, resposta de dúvida. | Mostrar a página de novo com os valores. |
| P5 | "Salvar e escrever outra" num módulo validado volta para o módulo em vez de abrir outra pergunta. | O aviso de confirmação envia o botão clicado (`requestSubmit`). |
| P6 | Subir ou descer um módulo não dá recado, e os dois voltam a rascunho calados. | Recado: "Ordem salva." Com a seção 3, mudar a ordem deixa de mexer na validação. |
| P7 | O botão de confirmação é sempre vermelho, até para "Validar" e "Publicar". | Cor de acordo com a ação. |
| P8 | No celular, campos passam da borda (cupom, lote, IA, "Ativar EAD"). | `min-width:0; max-width:100%` nos campos e selects. |
| P9 | O módulo final mostra "0 min". | Sem tempo, não mostrar. |
| P10 | A página do aluno no painel mostra "Teste" e a data errada para quem veio de escola (`ead-relatorios.js:91-98`). | Usar a mesma regra da lista: origem "Escola: …", 7 dias contando da vaga. |

### 1.4 Link de teste

| # | Problema | Correção |
|---|---|---|
| T1 | Concluir pelo link de teste emite certificado com número oficial (Livro/Registro) e manda o e-mail. | No modo teste: certificado com marca "TESTE", sem número oficial, sem Redação e sem e-mail. |

### 1.5 Ficam para depois (anotados)

- Limite de usos do cupom pode passar quando duas pessoas pagam ao mesmo tempo.
- PIX antigo pago depois de "Liberar curso" ou do cartão: marcar para a secretaria estornar.
- Editar uma pergunta enquanto alguém responde conta como erro.
- O cartão de bolso tem 17 páginas A6, a maioria em branco.

## 2. Escola Digital

### 2.1 Interruptor

- **Onde:** painel, modo Online → Cursos online, no topo: **"Escola Digital no site: Ligada / Desligada"**, com explicação de uma linha. Começa **desligada**.
- **Quem:** quem já entra no modo Online (hoje só DEV).
- **Gravação:** `Configuracao` com a chave `escola-digital:ligada`. Mudar fica na auditoria (`ESCOLA_DIGITAL_LIGOU` / `DESLIGOU`).
- **Ligar exige** pelo menos um curso online publicado. Sem isso: "Publique um curso antes de ligar a Escola Digital."

### 2.2 Ligada

| Onde | O que aparece |
|---|---|
| Menu do site (computador e gaveta do celular) | "Escola Digital" depois de "Início" |
| `/escola-digital` | Página própria: topo com foto de fundo (`/img/capa.webp` por enquanto), "Escola Digital CVB-RJ", frase e 4 selos (celular ou computador, no seu ritmo, certificado, turmas para escolas). Abaixo, os cards dos cursos online publicados, no mesmo modelo dos cards do catálogo. |
| `/escola-digital/<curso>` | A página de venda e todas as páginas do curso (telas, teste, certificado), com o topo e o rodapé da Escola Digital (H1, H2) |
| `/online/<curso>…` | Continua abrindo, com `canonical` para `/escola-digital/<curso>`. Sem redirecionar, pelo mesmo motivo da etapa 8: o redirecionamento quebra páginas que pedem login. |
| Catálogo `/cursos` e início | **Só presencial**: sem o selo "100% online" e sem os cards de curso só online. |
| Página de curso presencial com versão online | Aviso pequeno: "Este curso também existe 100% online na Escola Digital → Ver" |
| Sitemap | `/escola-digital` e `/escola-digital/<curso>` dos publicados |
| Links montados pelo sistema | `vitrine.urlOnline()` passa a dar `/escola-digital/<curso>`. Isso cobre e-mails, Minha conta, painel e retorno do pagamento. |

### 2.3 Desligada

- Somem para quem visita: o item do menu, a página `/escola-digital` (404), o aviso na página do presencial e o sitemap.
- A página de venda (`/escola-digital/<curso>` e `/online/<curso>`) para quem não tem acesso mostra "Este curso não está disponível no momento", com link para o site. Não vende.
- **Quem tem acesso continua**: quem comprou, recebeu vaga de escola ou tem cortesia. Entra pela Minha conta → Cursos online e pelos mesmos endereços, faz o curso e recebe o certificado. "Minha escola" e o convite do lote continuam funcionando.
- O link de teste continua funcionando.

## 3. Criação mais fácil

O aluno não precisa de vídeo, âncora, introdução, tempo, quantidade mínima de perguntas, "porquê" ou fala do instrutor. Tudo isso já é opcional nas telas do aluno, e a vistoria conferiu no código. Por isso:

### 3.1 O que trava a validação (só o necessário para o curso funcionar)

- **Módulo comum:**
  - título;
  - pelo menos 1 tópico com pelo menos 1 tela;
  - todo tópico com pelo menos 1 tela (sem isso, o teste do tópico fica sem porta de entrada para o aluno);
  - toda pergunta com alternativas válidas (2 a 5, ao menos 1 correta). O formulário já garante isso.
- **Módulo final:**
  - título;
  - pelo menos 1 cenário;
  - todo cenário com pelo menos 1 decisão;
  - toda decisão com 2 a 4 opções e exatamente 1 correta.
- O **módulo final é opcional**, e a tela passa a dizer isso.

### 3.2 O que vira aviso (amarelo, não trava)

- tela sem vídeo;
- tela sem âncora;
- módulo sem introdução;
- tópico com menos de 3 perguntas ("o teste sorteia as que houver");
- módulo com menos de 8 perguntas ("sem o pré-teste 'Já sei isso?'");
- pergunta sem o porquê;
- cenário sem a cena;
- opção sem a fala do instrutor (o aluno vê "Certo!" ou "Não é a melhor escolha. Tente de novo.").

### 3.3 Menos passos

- **Lista fixa na página do módulo**, desde o começo, em vez de as exigências aparecerem uma a uma: "Para validar" (o que trava) e "Recomendado" (avisos), com ✓ conforme é cumprido.
- **Tempo estimado automático:** campo opcional. Vazio, o sistema calcula 3 min por tela, 1 min por pergunta e 3 min por cenário.
- **Novo módulo com os tópicos de uma vez:** campo "Tópicos (um por linha)" no formulário do módulo.
- **Nova tela no fim do tópico** com "Salvar e escrever outra", como já existe nas perguntas.
- **Mudar a ordem dos módulos não volta nada para rascunho.**
- Publicar continua exigindo preço e todos os módulos validados. Com as regras novas, um curso mínimo fica em cerca de 13 páginas e 6 campos (hoje são cerca de 22 páginas e 51 campos).

A IA continua com as mesmas exigências na resposta (mais perguntas e cenários completos). Isso é qualidade do rascunho, não trava para quem escreve à mão.

## 4. Banco

Nenhuma migração. O interruptor fica em `Configuracao` (`escola-digital:ligada`).

## 5. Testes e verificação

- Teste automático para cada item das seções 1 a 3 que tem regra: B3, B4, B6 a B8, T1, P1, P10, as regras da seção 3, o interruptor ligado e desligado com e sem acesso, endereços novos e antigos, e o catálogo só presencial.
- B3 com login e cadastro de verdade (POST `/login` e `/cadastro`), não com o cabeçalho de teste.
- Ciclo pela interface com prints, em 1280 e 390 px:
  - ligar a Escola Digital;
  - menu, página e card;
  - página do curso com cupom digitado e aplicado depois do login;
  - aula;
  - rodapé com "Preferências de cookies";
  - certificado no celular;
  - desligar e conferir que quem comprou continua;
  - criar um curso mínimo do zero pelo painel, contando os passos.
- Revisão final independente, correções com teste, e PR sem merge.

## Fora do escopo

- Foto própria da Escola Digital: fica a `capa.webp` até a escola mandar uma de alguém estudando pelo celular. Ela é trocada no código, sem upload no painel.
- Liberar o modo Online para a Secretaria (hoje só DEV).
- Os itens da seção 1.5.
