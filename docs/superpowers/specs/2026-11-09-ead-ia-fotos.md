# Curso com IA: imagens da capa e dos módulos (o Claude descreve, a OpenAI gera)

Data: 2026-11-09 (revisada: banco de fotos trocado pela geração de imagens da OpenAI; sem limite mensal, só a
contagem; WebP em tudo; imagem do curso presencial também) · Branch: `ead-ia-fotos` ·
Base: main

## Objetivo

O curso feito com IA sai só com texto ("ficou meio fraco visualmente"). As páginas do aluno já mostram a imagem
do curso (`Curso.imagemUrl`, na capa) e a imagem de abertura de cada módulo (`ModuloEad.fotoIntroUrl`), mas elas
ficam vazias. Esta etapa preenche **só essas duas** (decisão do Matheus: "só capa e módulos"):

- o **Claude (Anthropic)** escreve, para cada imagem, o **pedido de imagem** (em inglês, para o gerador) e uma
  **descrição curta em português** (o que aparece no painel);
- a **API de imagens da OpenAI** gera a imagem a partir do pedido (decisão do Matheus: "vou usar a api do chatgpt
  pra criacao de imagens");
- o sistema guarda a imagem no nosso armazenamento (o mesmo das fotos de hoje) e coloca no curso/módulo como
  rascunho;
- no painel a secretaria vê a descrição, pode **gerar outra** ou **enviar a dela**.

Sem chave da OpenAI configurada, nada quebra: o sistema guarda e mostra só as descrições do Claude, para a
secretaria enviar as imagens.

## 1. Quando acontece

1. **Curso novo com IA**: depois que o último módulo fica pronto, a geração faz o passo **"imagens"** antes de virar
   CONCLUIDA (status novo `FOTOS_GERANDO`, entre `MODULOS_GERANDO` e `CONCLUIDA`; rótulo "Gerando as imagens…").
   Erro nesse passo não trava a geração: ela conclui assim mesmo e o painel avisa "As imagens não puderam ser
   geradas; use o botão Gerar imagens com IA na página do curso."
2. **Curso que já existe** (inclusive os feitos à mão): botão **"Gerar imagens com IA"** na página do curso online
   no painel (`/ead/curso/:id`). Preenche só o que está **vazio** (capa sem imagem, módulo sem imagem de
   abertura); nunca troca imagem que a secretaria já pôs. Roda na hora, com aviso no fim ("3 imagens geradas" /
   "Nada para preencher: a capa e os módulos já têm imagem.").

3. **Curso presencial** (aba Cursos, formulário de editar curso): botão **"Gerar imagem com IA"**, só para a
   **imagem do curso** (`Curso.imagemUrl`). Se o curso já tem imagem, pede confirmação ("Trocar a imagem atual por
   uma gerada pela IA?") e apaga a antiga do armazenamento depois de gravar a nova. Mesma regra de pedido do Claude
   (com nome, descrição e categoria do curso) e mesma geração.

O passo e os botões usam as mesmas funções. As imagens de um curso são geradas uma de cada vez (a OpenAI leva de 10 a
60 s por imagem).

## 2. O Claude (uma chamada por curso)

Uma chamada ao Claude (mesmo cliente, modelo e teto mensal da etapa 9; esforço `low`) com o nome, a descrição e a
lista de módulos (título e tópicos). Devolve, no formato estruturado:

```
{ capa: { pedido, descricao }, modulos: [{ moduloId, pedido, descricao }] }
```

- `pedido` (até 600 caracteres, em inglês): a cena, para o gerador. Regras no prompt do Claude, que ele repete em
  todo pedido:
  - estilo **fotografia realista**, luz natural, enquadramento horizontal, espaço livre à esquerda (o texto da capa
    fica por cima);
  - **sem texto, letras, números, logotipos ou marcas** na imagem;
  - **sem sangue, ferimentos, pessoas em sofrimento**; nada de rosto de criança em destaque (criança só de costas,
    de longe ou mãos);
  - nada do símbolo da Cruz Vermelha (é protegido por lei): kit de primeiros socorros com cruz **verde ou branca**,
    ou sem cruz;
  - pessoas brasileiras, diversidade natural, ambiente brasileiro (escola, casa, empresa) quando fizer sentido;
  - mesma linguagem visual em todas as imagens do curso (o Claude define um estilo comum e o aplica a cada pedido).
- `descricao` (até 200 caracteres, em português): o que a imagem mostra (ex.: "Kit de primeiros socorros aberto
  sobre a bancada da cozinha, com gaze e luvas à vista").
- O custo do Claude entra na geração (curso novo) ou no custo avulso do mês (botão), contando no teto do mês.

## 3. A OpenAI (geração das imagens)

- Variáveis no Render (serviço da secretaria): `OPENAI_API_KEY` (obrigatória para gerar) e `OPENAI_IMAGE_MODEL`
  (opcional, padrão `gpt-image-1`).
- Chamada: `POST https://api.openai.com/v1/images/generations` com `model`, `prompt` = o pedido do Claude,
  `size: "1536x1024"` (horizontal), `quality: "medium"`, `n: 1`. A resposta traz a imagem em base64; ela passa pela
  mesma compressão das fotos enviadas (`salvarFotoCurso`: WebP, 1000 px) e é guardada com nome
  `ia-<data>-<aleatório>.webp`.
- Recusa por conteúdo (erro de política da OpenAI) ou falha: tenta **uma vez** com o pedido simplificado (o Claude
  já manda uma versão curta `pedidoCurto` junto); falhando de novo, deixa vazio e mantém a descrição.
- **Gerar outra**: gera de novo com o mesmo pedido (a imagem sai diferente) e apaga a antiga do armazenamento.
- **Sem limite mensal** (decisão do Matheus): o sistema só **conta** as imagens geradas e mostra no painel
  ("Imagens geradas com IA: 12 neste mês · 40 no total"). Contadores em `Configuracao`
  `ead-ia:imagens:<AAAA-MM>` (fuso do Rio) e `ead-ia:imagens:total`. O custo da OpenAI é cobrado na conta da OpenAI
  (cerca de US$ 0,04 a 0,07 por imagem em `medium`).

## 4. Dados (migração pequena, só acrescenta colunas)

- `ModuloEad`: `fotoPedido String?`, `fotoSugestao String?`, `fotoGeradaPorIa Boolean @default(false)`.
- `Curso` (serve para a capa do curso online e para o presencial): `imagemPedido String?`,
  `imagemSugestao String?`, `imagemGeradaPorIa Boolean @default(false)`.
- Contadores de imagens: `Configuracao` `ead-ia:imagens:<AAAA-MM>` e `ead-ia:imagens:total`.
- Custo do Claude nos botões (fora de uma geração): `Configuracao` `ead-ia:custo-avulso:<AAAA-MM>` (US$), somado no
  gasto do mês.
- Enviar uma imagem própria pelo painel desliga o `…GeradaPorIa` daquele alvo.

## 4.1 Imagens em WebP (todas)

Pedido do Matheus: "todas as imagens em formato webp, pra otimizar o meu espaço".
- As geradas pela IA já entram em WebP (passam por `salvarFotoCurso`: WebP, qualidade 75, até 1000 px).
- Os envios pelo painel já viram WebP, **menos o GIF**, que hoje é guardado como veio. Passa a virar **WebP
  animado** (sharp com `animated: true`, mesma largura máxima). As imagens antigas não são convertidas.

## 5. Painel

- **Página do curso online** (`/ead/curso/:id`): botão "Gerar imagens com IA" (com aviso do que faz).
  Na capa: selo "Imagem gerada por IA" quando for o caso, a descrição do Claude e "Gerar outra" (quando há pedido e
  chave da OpenAI).
- **Página do módulo** (`/ead/modulo/:id`), na imagem de abertura: o mesmo (selo, descrição, "Gerar outra");
  "Enviar a minha" é o envio de foto que já existe.
- **Configuração da IA** (página onde fica o teto do Claude): "Imagens geradas com IA: N neste mês · M no total".
- **Curso presencial** (formulário de editar curso): botão "Gerar imagem com IA" junto da imagem, selo "Imagem
  gerada por IA" e a descrição do Claude quando for o caso.
- Sem `OPENAI_API_KEY`: os botões "Gerar outra" não aparecem e o "Gerar imagens com IA" só grava as descrições
  (aviso: "Sem chave da OpenAI: as descrições do Claude estão em cada módulo, envie as imagens.").

## 6. Fora desta etapa

Imagens nas telas e nos cenários, vídeos, escolher entre várias imagens numa grade, editar a imagem gerada.

## 7. Testes

Claude e OpenAI falsos (nenhum teste chama serviço de verdade):
- o pedido mandado à OpenAI é o `pedido` do Claude, com `size 1536x1024` e o modelo da variável (padrão
  `gpt-image-1`); a imagem base64 é comprimida e guardada;
- passo "imagens" de um curso novo: capa e módulos com imagem, descrição e pedido gravados, `…GeradaPorIa`
  ligado; depois CONCLUIDA; erro no Claude ou na OpenAI → CONCLUIDA mesmo assim, com o aviso;
- recusa da OpenAI: tenta com o `pedidoCurto`; recusa de novo → vazio com a descrição;
- botão em curso existente: só preenche o vazio (imagem já posta fica);
- gerar outra: nova imagem e a antiga apagada;
- sem `OPENAI_API_KEY`: grava só as descrições, sem chamar a OpenAI;
- contadores: cada imagem gerada soma 1 no mês e no total; a página de configuração da IA mostra os dois;
- curso presencial: "Gerar imagem com IA" grava a imagem do curso (WebP), apaga a antiga e liga o selo;
- GIF enviado pelo painel é guardado como WebP;
- teto do Claude estourado: não chama o Claude e avisa;
- enviar imagem própria desliga o selo "gerada por IA".
