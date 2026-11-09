# Curso com IA: fotos da capa e dos módulos (banco de fotos + sugestão da IA)

Data: 2026-11-09 · Branch: `ead-ia-fotos` · Base: main

## Objetivo

O curso feito com IA sai só com texto ("ficou meio fraco visualmente"). As telas do aluno já mostram a foto do
curso (`Curso.imagemUrl`, na capa) e a foto de abertura de cada módulo (`ModuloEad.fotoIntroUrl`), mas elas ficam
vazias. Esta etapa preenche **só essas duas** (decisão do Matheus: "só capa e módulos"):

- a IA diz **o que buscar** (termos em inglês, para o banco) e **a foto ideal** (descrição em português);
- o sistema busca no **Pexels** (banco gratuito, uso comercial liberado), baixa a foto, guarda no nosso
  armazenamento (o mesmo das fotos de hoje) e coloca no curso/módulo como rascunho;
- no painel a secretaria vê a sugestão da IA ao lado da foto, pode **trocar por outra** do banco ou **enviar a
  dela**.

Sem chave do Pexels configurada, nada quebra: o sistema guarda e mostra só as sugestões da IA, para a secretaria
enviar as fotos.

## 1. Quando acontece

1. **Curso novo com IA**: depois que o último módulo fica pronto, a geração faz o passo **"fotos"** antes de virar
   CONCLUIDA (status novo `FOTOS_GERANDO`, entre `MODULOS_GERANDO` e `CONCLUIDA`). Erro nesse passo não trava a
   geração: ela conclui assim mesmo e o painel avisa "As fotos não puderam ser colocadas; use o botão Colocar fotos
   com IA na página do curso."
2. **Curso que já existe** (inclusive os feitos à mão): botão **"Colocar fotos com IA"** na página do curso online
   no painel (`/ead/curso/:id`). Preenche só o que está **vazio** (capa sem foto, módulo sem foto de abertura);
   nunca troca foto que a secretaria já pôs. Roda na hora (uma chamada à IA + buscas), com aviso no fim
   ("3 fotos colocadas" / "Nada para preencher").

O passo "fotos" e o botão usam a mesma função.

## 2. A IA (uma chamada por curso)

Uma chamada ao Claude (mesmo cliente e teto mensal da etapa 9; esforço `low`, é tarefa curta) com o nome, a
descrição e a lista de módulos (título e tópicos). Devolve, no formato estruturado:

```
{ capa: { busca, descricao }, modulos: [{ moduloId, busca, descricao }] }
```

- `busca`: 2 a 6 palavras em inglês, concretas e fotografáveis (ex.: "first aid kit kitchen counter"); nada de
  marcas, rostos de crianças em primeiro plano, sangue ou ferimentos graves (regra no prompt).
- `descricao`: até 200 caracteres em português, a foto ideal (ex.: "Kit de primeiros socorros aberto sobre a
  bancada da cozinha, com gaze e luvas à vista").
- O custo entra na geração (curso novo) ou no custo avulso do mês (botão), contando no teto do mês.

## 3. O banco (Pexels) e a escolha pelo Claude

Decisão do Matheus: **quem sugere e quem escolhe a foto é o Claude (Anthropic)**; o Pexels só fornece as fotos.

- Variável no Render (serviço da secretaria): `PEXELS_API_KEY`. Busca: `GET https://api.pexels.com/v1/search` com
  `query=<busca>`, `orientation=landscape`, `per_page=15`, `locale=pt-BR`.
- Das fotos devolvidas, as **6 primeiras que ainda não estão em uso no mesmo curso** vão para o Claude **olhar**
  (imagem pequena de cada uma, `src.medium`), junto com o título do módulo (ou o nome do curso) e a descrição da
  foto ideal. O Claude devolve a lista das fotos **adequadas, da melhor para a pior**, descartando as que têm
  sangue ou ferimento, criança em destaque, marca aparente, texto em outra língua em destaque ou que não têm a ver
  com o assunto (esforço `low`; uma chamada por foto a escolher).
- A melhor é baixada no tamanho `large` (≈ 940 px de largura), passa pela mesma compressão das fotos enviadas
  (`salvarFotoCurso`) e é guardada. O id do Pexels vai no nome do arquivo (`pexels-<id>-...`). A lista ordenada
  fica guardada (`fotoOpcoes` / `capaOpcoes`).
- **Trocar por outra**: usa a próxima da lista ordenada pelo Claude (dá a volta no fim); a foto antiga é apagada
  do armazenamento. Não chama a IA de novo.
- Nenhuma adequada (ou busca sem resultado): tenta uma vez a busca com as 2 primeiras palavras; sem nada, deixa
  vazio e mantém a sugestão.
- Crédito: o nome do fotógrafo fica guardado e aparece no painel ("Foto: Ana Souza / Pexels"); no site, não.
- Custo: as chamadas de escolha somam no custo da geração (curso novo) ou no custo avulso do mês (botão), e
  contam no teto mensal.

## 4. Dados (migração pequena, só acrescenta colunas)

- `ModuloEad`: `fotoBusca String?`, `fotoSugestao String?`, `fotoCredito String?`, `fotoOpcoes Json?`.
- `CursoOnline`: `capaBusca String?`, `capaSugestao String?`, `capaCredito String?`, `capaOpcoes Json?` (a foto
  continua em `Curso.imagemUrl`).
- `fotoOpcoes`/`capaOpcoes`: a lista ordenada pelo Claude, `[{ id, url, credito }]` (`url` = tamanho `large`).
- Custo do botão (fora de uma geração): `Configuracao` `ead-ia:custo-avulso:<AAAA-MM>` (US$), somado no gasto do
  mês.

## 5. Painel

- **Página do curso online** (`/ead/curso/:id`): botão "Colocar fotos com IA" (com aviso do que faz). Na capa:
  a sugestão da IA e o crédito, com "Trocar por outra" (quando há `capaBusca` e chave do Pexels).
- **Página do módulo** (`/ead/modulo/:id`), na foto de abertura: a sugestão da IA, o crédito e "Trocar por outra";
  "Enviar a minha" é o envio de foto que já existe.
- Sem `PEXELS_API_KEY`: os botões de trocar não aparecem e o "Colocar fotos com IA" só grava as sugestões (aviso:
  "Sem chave do banco de fotos: as sugestões da IA estão em cada módulo, envie as fotos.").

## 6. Fora desta etapa

Fotos nas telas e nos cenários, vídeos, imagens geradas por IA, escolher entre várias fotos numa grade.

## 7. Testes

Pexels e Claude falsos (nenhum teste chama serviço de verdade):
- o Claude recebe as fotos candidatas (até 6, sem as já usadas no curso) e a foto gravada é a primeira da lista
  dele, não a primeira do Pexels; foto que ele descarta nunca é usada;
- passo "fotos" de um curso novo: capa e módulos com foto, sugestão e crédito gravados, ids do Pexels sem repetir;
  depois CONCLUIDA; erro na IA ou no Pexels → CONCLUIDA mesmo assim, com o aviso;
- botão em curso existente: só preenche o vazio (foto já posta fica);
- trocar por outra: pega a próxima da lista do Claude (sem chamar a IA) e apaga a antiga;
- sem `PEXELS_API_KEY`: grava só as sugestões, sem chamar o banco;
- busca sem resultado: tenta a forma curta; sem nada, fica vazio com a sugestão;
- teto do mês estourado: não chama a IA e avisa.
