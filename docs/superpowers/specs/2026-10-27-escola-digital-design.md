# Escola Digital CVB-RJ — área do aluno (especificação)

**Data:** 27/10/2026 · **Branch:** `claude/ead-cvbrj-online` · **Situação:** aprovado em conversa, aguardando revisão desta especificação

Base: o documento "O primeiro EAD da Cruz Vermelha Rio" (Núcleo de Comunicação, out/2026) e as decisões
tomadas com a equipe da escola na conversa de desenho. Protótipo visual: `docs/ead/prototipo-escola-digital.html`
(direção C).

---

## 1. Objetivo

Uma plataforma de cursos 100% online dentro do site da escola, chamada **Escola Digital CVB-RJ**, onde o aluno
se matricula, paga, estuda pelo celular no ritmo dele e recebe o certificado, sem nenhuma etapa manual da
secretaria. O primeiro curso é **Primeiros Socorros (Lei Lucas)**, com a estrutura de 8 módulos do documento.

**Sucesso desta etapa:** no computador de quem desenvolve, com banco de teste e pagamento simulado, uma pessoa
consegue fazer o caminho inteiro (matrícula rápida → pagamento → estudo → testes → cenários → certificado), no
visual da direção C, sem que nada do site presencial e da secretaria mude de comportamento.

### Dentro do escopo
- Vitrine dos cursos online, página do curso, matrícula rápida, pagamento (PIX e cartão, à vista ou parcelado).
- Área de estudo: módulos, tópicos, telas, "Já sei isso?", teste rápido, cenários com relógio.
- Progresso, prazo de acesso, conclusão, certificado em PDF com verificação por QR Code, cartão de bolso.
- E-mails de matrícula confirmada e de conclusão.
- Ligação com o site atual (botão, faixa na home, catálogo, Minha conta).
- Conteúdo de exemplo (ilustrativo) carregado a partir de arquivos.
- Pagamento simulado para teste local.

### Fora do escopo (etapas seguintes)
- Telas da secretaria para criar e editar cursos, módulos, telas, perguntas e cenários; configurar preço, prazo e
  validade; ver alunos online; prorrogar prazo; estornar. Até lá, esses dados vêm dos arquivos de conteúdo.
- Pagamentos online no Financeiro, nos relatórios e na planilha da Integração.
- Lembretes por e-mail (prazo vencendo, aluno parado), renovação de certificado vencido.
- Saber se o aluno assistiu ao vídeo até o fim.
- Publicar em produção (ver seção 10).

---

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Nome | **Escola Digital CVB-RJ** (provisório; definido num lugar só, fácil de trocar) |
| Endereço | `/digital` no mesmo site (não subdomínio): mesmo login, sem domínio novo, funciona em `localhost:3000/digital` |
| Visual | Direção **C, "Manual de campo"**: papel claro, linhas pretas, números grandes, carimbos de status, lema sempre à vista, vermelho e preto; fontes Archivo, Instrument Sans e Azeret Mono |
| Da plataforma americana | Só a estrutura pedagógica (módulos, pilha da tela, pré-teste, quiz sorteado, cenários, cartão de bolso). Nada do visual nem do conteúdo |
| Conta | Uma conta só para site, Escola Digital e Minha conta |
| Matrícula | **Matrícula rápida**: nome, CPF, celular e e-mail; senha inicial = 4 últimos dígitos do CPF; depois pede para trocar a senha e completar os dados (avisos que já existem) |
| Preço | **Sem taxa de inscrição**: só a matrícula. Usa os campos que a secretaria já conhece: preço à vista, preço parcelado, número máximo de parcelas (valores de referência: R$ 49,90 a R$ 99,90) |
| Parcelas | Aluno escolhe à vista (PIX ou cartão) ou parcelado no cartão até o máximo do curso, com o cálculo da Únicopag que já existe |
| Prazo de acesso | Por curso (padrão 365 dias), conta a partir da **confirmação do pagamento** |
| Validade do certificado | Por curso (ex.: 24 meses), a partir da data de conclusão |
| Vídeos | YouTube **não listado**, embutido por `youtube-nocookie.com` |
| Conteúdo do piloto | Exemplo marcado como **ilustrativo**, tirado do documento; vídeo substituto até a gravação |
| Teste local | Banco de teste no Mac (Postgres.app) e `.env` sem chaves reais |

---

## 3. Como se liga ao site atual

```
Site da escola (/)                Escola Digital (/digital)                 Minha conta (/minha-conta)
 - botão "Escola Digital"   ───▶  - vitrine e página do curso        ◀──▶  - presencial e online juntos
 - faixa na página inicial        - matrícula rápida e pagamento           - "Ir para a Escola Digital"
 - catálogo: selo "Online"        - estudo, testes, cenários
 - login e cadastro de sempre     - certificado e cartão de bolso
                                  - link "Site da escola"
```

- **Chave de liga/desliga**: variável de ambiente `ESCOLA_DIGITAL=1`. Desligada (padrão), nada da Escola Digital
  aparece: as rotas `/digital*` respondem 404, o botão, a faixa e os cursos online somem do site, e a secretaria
  ignora cursos online. Em produção fica desligada até a decisão de abrir.
- Rotas montadas no roteador do **site do aluno** (`src/server.js`, `siteAluno`). O painel da secretaria não muda
  nesta etapa, além de ignorar cursos online.

---

## 4. Dados

Regra: **só acréscimos**. Nenhuma tabela ou coluna existente muda de nome, tipo ou obrigatoriedade, e nada é
apagado. Todas as tabelas novas podem ser removidas sem afetar o resto.

### 4.1 `Curso` (colunas novas, com padrão)
| Coluna | Tipo | Padrão | Uso |
|---|---|---|---|
| `modalidade` | enum `ModalidadeCurso` (`PRESENCIAL`, `ONLINE`) | `PRESENCIAL` | todo curso existente continua presencial |
| `prazoAcessoDias` | Int? | — | online: dias de acesso após o pagamento (365 no exemplo) |
| `validadeCertificadoMeses` | Int? | — | online: validade do certificado (24 no exemplo) |

Preço e parcelas usam as colunas que já existem: `precoAvista`, `precoCheio` (total parcelado), `parcelas`
(máximo), `valorParcela`. `taxaMatricula` é ignorada nos cursos online.

### 4.2 Conteúdo (tabelas novas)
Cada linha de conteúdo tem uma **`chave`** estável (texto, única dentro do curso), para o comando de carga
atualizar o conteúdo sem duplicar e sem perder o progresso dos alunos.

- **`ModuloOnline`**: curso, chave, ordem, título, minutos estimados, texto de abertura, imagem, `temPreTeste`,
  `final` (módulo de cenários).
- **`TopicoOnline`**: módulo, chave, ordem, título.
- **`TelaOnline`**: tópico, chave, ordem, título, âncora (texto), imagem + texto alternativo, vídeo (ID do
  YouTube, título, duração em segundos), revisão rápida (lista de até 4 frases), alerta, dica de profissional
  (opcional).
- **`PerguntaOnline`** (banco): tópico, chave, enunciado, alternativas (3 a 5), índice da correta, o porquê,
  ativa.
- **`CenarioOnline`**: módulo final, chave, ordem, título, cena (texto), imagem, tempo sugerido (segundos).
- **`DecisaoCenario`**: cenário, ordem, pergunta, opções (3), índice da correta, fala do instrutor. A primeira
  decisão de todo cenário tem as opções do lema (OLHAR, LIGAR, CUIDAR).

### 4.3 Do aluno (tabelas novas)
- **`InscricaoOnline`**: aluno, curso, situação (`AGUARDANDO_PAGAMENTO`, `ATIVA`, `CONCLUIDA`, `EXPIRADA`,
  `CANCELADA`), plano (`A_VISTA`/`PARCELADO`), forma, parcelas, valor, `ativadaEm`, `acessoAte`, `concluidaEm`,
  `certificadoValidoAte`, código de verificação do certificado. Única por aluno e curso.
  - `EXPIRADA` não é gravada por tarefa agendada: é calculada (`acessoAte` passou sem conclusão) e gravada na
    primeira vez que o aluno acessa depois disso.
- **`PagamentoOnline`**: inscrição, tipo de pagamento, valor, parcelas, campos do gateway (os mesmos de
  `Pagamento`: referência, hash, status, resposta, dados do PIX), situação, datas.
  - **Tabela separada de `Pagamento` de propósito**: Financeiro, relatórios, Pendentes, planilha e conferência
    com a Únicopag continuam lendo só `Pagamento` e não mudam. O custo: o dinheiro do online só aparece no
    Financeiro quando a parte da secretaria for feita.
- **`TelaVista`**: inscrição + tela + quando. Única por par.
- **`TentativaTeste`**: inscrição, tipo (`TOPICO`/`PRE_TESTE`), tópico ou módulo, perguntas sorteadas, respostas,
  acertos, total, aprovado, quando.
- **`ModuloConcluido`**: inscrição + módulo + como (`TELAS`, `PRE_TESTE`, `CENARIOS`) + quando. Única por par.
- **`CenarioFeito`**: inscrição + cenário + decisões escolhidas + acertos + tempo em segundos + quando.

### 4.4 Número do certificado
Mesmo **livro e sequência de registro dos certificados presenciais** (`lib/certificado.js`, registro guardado
em `LogAuditoria`), com `alvoTipo: 'InscricaoOnline'`. A numeração existente é estendida para aceitar
inscrições online, sem mudar a dos presenciais.

---

## 5. Caminho do aluno

### 5.1 Vitrine e página do curso (`/digital`, `/digital/cursos/:curso`)
- Vitrine: cursos `ONLINE` e ativos.
- Página: título, chamada, carga, módulos (títulos e minutos), "como funciona", aviso honesto sobre a prática,
  card de compra com preço à vista, "ou até N× de R$ X no cartão", prazo de acesso, validade do certificado.
- Botão conforme a situação do aluno logado: **Matricular e começar** · **Continuar pagamento** · **Continuar
  estudando** · **Ver certificado** · **Acesso encerrado** (com o contato da secretaria).

### 5.2 Matrícula rápida
- Formulário: nome, CPF, celular, e-mail, aceite dos **termos do curso online** e da política de privacidade
  (mesmo registro de consentimento LGPD do cadastro).
- Validações: CPF válido (`lib/documento.js`), celular com DDD, e-mail válido.
- **Aluno logado**: pula o formulário (usa a conta dele) e só confirma.
- **CPF ou e-mail já cadastrados (não logado)**: não cria conta. Pede a senha dessa conta (ou "esqueci minha
  senha") e volta para a matrícula. Ninguém entra numa conta só sabendo o CPF.
- **Conta nova**: papel `ALUNO`, tipo de documento CPF, senha = 4 últimos dígitos do CPF (mesma função do
  cadastro), e-mail não verificado e e-mail de confirmação como no cadastro de hoje. A pessoa já fica logada.
- Cria a `InscricaoOnline` em `AGUARDANDO_PAGAMENTO` (ou reaproveita a pendente que já existir).
- Limite de tentativas por IP, como nas outras telas públicas.

### 5.3 Pagamento
- Escolha: **à vista** (PIX ou cartão, valor `precoAvista`) ou **parcelado no cartão** (2 até `parcelas` vezes,
  total `precoCheio`, com a opção de parcelamento consultada na Únicopag como na inscrição presencial).
- Cobrança: `lib/unicopag.js` (`criarTransacao`, `obterOpcaoParcelamento`), conta principal, com a referência
  da `PagamentoOnline` no lugar da matrícula.
- PIX: tela com QR Code e "copia e cola", atualizando sozinha (mesmo comportamento de `js/pix.js`); PIX vencido
  gera outro.
- Cartão: resposta na hora; recusado mostra o motivo e permite tentar de novo ou ir para o PIX.
- **Confirmação**: o aviso da Únicopag (`routes/webhook.js`) procura primeiro em `Pagamento` (como hoje) e, se
  não achar, em `PagamentoOnline`. Para o online, uma função própria aplica o resultado com a mesma trava de
  idempotência de `lib/status-pagamento.js`:
  - aprovado → inscrição `ATIVA`, `ativadaEm` = agora, `acessoAte` = agora + `prazoAcessoDias`, e-mail de
    matrícula confirmada (link + lembrete da senha inicial);
  - cancelado/recusado → pagamento cancelado; inscrição segue aguardando;
  - estorno → inscrição `CANCELADA`, acesso fechado.
- A conferência periódica com a Únicopag (`lib/reconciliacao.js`) passa a conferir também os `PagamentoOnline`
  pendentes, num laço separado do atual.
- **Pagamento simulado** (fora de produção, quando `ESCOLA_DIGITAL_PAGAMENTO_SIMULADO=1`): no lugar da Únicopag,
  uma tela com **Aprovar** e **Recusar** que chama a mesma função de confirmação. Em produção a rota não existe.

### 5.4 Área do curso (`/digital/estudo/:inscricao`)
- Cabeçalho do curso, lema OLHAR · LIGAR · CUIDAR, barra de progresso, prazo restante, botão **Continuar** (leva
  à próxima tela não vista).
- Lista de módulos com carimbo: **FEITO**, **JÁ SABIA**, **AGORA**, **TRANCADO**.
- Certificado e cartão de bolso: trancados até a conclusão.
- Acesso só para o dono da inscrição, com a inscrição `ATIVA` ou `CONCLUIDA` (concluída pode rever tudo, mesmo
  depois do prazo).

### 5.5 Módulo, telas e testes
- **Abertura do módulo**: texto, imagem e a escolha **Quero aprender** / **Já sei isso** (se `temPreTeste`).
- **Tela**: âncora + foto → vídeo → revisão rápida → alerta → dica → **Próximo** (fixo embaixo no celular). Ao
  avançar, grava `TelaVista`. No computador, tópicos à esquerda; no celular, num menu.
- **Teste rápido** (fim de cada tópico): 3 perguntas sorteadas do tópico, uma por vez, com o porquê logo após
  cada resposta. Aprovado com **≥ 80%** (com 3 perguntas: acertar as 3). Reprovado: refaz com outro sorteio, sem
  limite.
- **"Já sei isso?"**: 10 perguntas sorteadas do módulo inteiro (ou todas, se houver menos), resultado só no fim.
  ≥ 80% → `ModuloConcluido` via `PRE_TESTE`. Abaixo disso → segue para as telas, sem penalidade.
- **Sorteio**: evita as perguntas da tentativa anterior do mesmo teste enquanto houver alternativas no banco.
- **Módulo concluído** (via `TELAS`) quando todas as telas foram vistas e todos os testes rápidos aprovados.
- **Ordem**: um módulo abre quando o anterior está concluído; o final, quando todos os outros estão.

### 5.6 Cenários (módulo final)
- Cena (texto + imagem), relógio com o tempo sugerido correndo na tela.
- Decisões em sequência; após cada escolha, mostra se era a esperada e a fala do instrutor; segue para a próxima.
- O tempo é guardado e não reprova. O cenário conta como feito ao chegar ao fim (`CenarioFeito`).
- Módulo final concluído (via `CENARIOS`) com todos os cenários feitos.

### 5.7 Conclusão, certificado e cartão de bolso
- Todos os módulos concluídos dentro do prazo → inscrição `CONCLUIDA`, `concluidaEm`, `certificadoValidoAte` =
  conclusão + `validadeCertificadoMeses`, número de registro (4.4) e código de verificação.
- **Certificado em PDF** (`pdfkit`): nome, CPF parcial, curso, modalidade, carga horária, data, registro, validade,
  a ressalva "curso teórico: ensina a reconhecer e decidir; não inclui treino prático em manequim" e um **QR
  Code** para `/digital/verificar/:codigo`.
- **Página de verificação** (pública): mostra nome, curso, data e se o certificado está **válido** ou **vencido**.
  Não mostra CPF nem e-mail.
- **Cartão de bolso**: PDF por curso, arquivo fornecido pela Comunicação; até existir, um PDF provisório.
- E-mail de conclusão com o link do certificado.

---

## 6. Visual (direção C)

- Layout próprio da Escola Digital, separado do layout do site: barra superior com a cruz, "Escola Digital ·
  CVB-RJ", conta; menu de abas embaixo no celular (Início, Cursos, Certificados, Conta); no computador, conteúdo
  centralizado com a lista de tópicos à esquerda.
- Fundo papel (`#f4f1ea`), texto `#111`, vermelho da marca, bordas pretas de 2px, números grandes em Archivo,
  rótulos técnicos em Azeret Mono, carimbos de status levemente inclinados, alerta em bloco vermelho.
- Feito primeiro para o celular (público estuda no celular), com contraste alto para leitura no sol.
- CSS próprio (`public/escola-digital.css`), sem mexer em `vitrine.css`, `style.css` e `site-extra.css`.
- Respeita as regras de segurança atuais do site (CSP do `helmet` em `src/server.js`): nada de `<style>` inline,
  scripts em arquivos de `public/js`, e o vídeo exige acrescentar `https://www.youtube-nocookie.com` ao
  `frame-src`.

---

## 7. Conteúdo de exemplo e carga

- Arquivos em `conteudo/escola-digital/primeiros-socorros/`: `curso.json` (dados do curso, preço, parcelas,
  prazo, validade) e um arquivo por módulo com tópicos, telas, perguntas e cenários, no formato dos quatro
  modelos do documento (ficha de tela, banco de perguntas, cenário).
- Comando `npm run digital:carregar -- primeiros-socorros`: cria ou atualiza pela `chave`. Desativa (não apaga)
  perguntas que saíram do arquivo.
- O exemplo traz os 8 módulos do mapa do documento, com o Módulo 4 (Engasgo) completo a partir dos exemplos do
  documento e textos de preenchimento nos outros, tudo marcado **conteúdo ilustrativo, não validado**.

---

## 8. Ajustes no site atual (só com a chave ligada)

- Cabeçalho: botão **Escola Digital**. Página inicial: faixa da Escola Digital.
- Catálogo e páginas de curso presenciais: listam só cursos `PRESENCIAL`; os online aparecem com selo **Online**
  apontando para `/digital/cursos/:curso`.
- **Minha conta**: lista as inscrições online (progresso, prazo e **Ir para a Escola Digital**).
- Secretaria: as listas e escolhas de curso (Cursos, nova turma, Horários, Matrícula rápida, Integração) ignoram
  cursos `ONLINE`.
- Com a chave desligada, todos esses pontos se comportam exatamente como hoje.

---

## 9. Testes

- **Automáticos** (`node --test`, já vem no Node; script `npm test`), sobre as regras em funções puras:
  sorteio sem repetição, nota mínima, liberação de módulos, módulo concluído, prazo e expiração, validade do
  certificado, transição da inscrição a partir do status da Únicopag (inclusive repetido e fora de ordem),
  cálculo de parcelas.
- **No banco de teste**: o comando de carga duas vezes seguidas não duplica nada; a confirmação do pagamento
  repetida não ativa duas vezes.
- **Manual, no Mac**, com pagamento simulado: roteiro completo (matrícula rápida com conta nova e com conta
  existente, PIX aprovado, cartão parcelado, recusado, estudo, "Já sei isso", teste reprovado e refeito,
  cenários, certificado, verificação, Minha conta) no celular (ferramenta de desenvolvedor do navegador) e no
  computador.
- **Não regressão**: com a chave desligada, o site, a inscrição presencial, a secretaria (Financeiro, Pendentes,
  Integração) e o aviso de pagamento funcionam como antes.

---

## 10. Antes de qualquer publicação em produção (fora desta etapa)

1. Conferir o estado do banco da produção contra o histórico de migrações do Prisma (`prisma migrate status`) e
   alinhar a diferença já observada (coluna antiga da turma), sem perda de dados.
2. Cópia de segurança do banco.
3. Publicar com `ESCOLA_DIGITAL` desligada; conferir que nada mudou; só então decidir abrir.

---

## 11. Pendências da escola (não bloqueiam o desenvolvimento)

- Lema definitivo (OLHAR–LIGAR–CUIDAR ou outro), após consulta à CVB nacional.
- Nome definitivo da plataforma.
- Texto final do certificado e da ressalva.
- Preço, parcelas, prazo e validade do curso de Primeiros Socorros.
- Validação clínica do conteúdo pela área técnica; vídeos gravados; cartão de bolso diagramado.
