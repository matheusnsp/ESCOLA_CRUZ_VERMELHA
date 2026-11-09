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
- O custo entra na geração (curso novo) ou num registro de custo avulso (botão), contando no teto do mês.

## 3. O banco (Pexels)

- Variável no Render (serviço da secretaria): `PEXELS_API_KEY`. Busca: `GET https://api.pexels.com/v1/search` com
  `query=<busca>`, `orientation=landscape`, `per_page=15`, `locale=pt-BR`.
- Escolhe a primeira foto da lista que **ainda não está em uso no mesmo curso** (o id do Pexels vai no nome do
  arquivo guardado: `pexels-<id>-...`). Baixa o tamanho `large` (≈ 940 px de largura), passa pela mesma
  compressão das fotos enviadas (`salvarFotoCurso`) e guarda.
- **Trocar por outra**: busca de novo com a mesma `busca` e pega a próxima foto depois da atual na lista (dá a
  volta no fim); a foto antiga é apagada do armazenamento.
- Busca sem resultado: tenta uma vez com as 2 primeiras palavras; sem nada, deixa vazio e mantém a sugestão.
- Crédito: o nome do fotógrafo fica guardado e aparece no painel ("Foto: Ana Souza / Pexels"); no site, não.

## 4. Dados (migração pequena, só acrescenta colunas)

- `ModuloEad`: `fotoBusca String?`, `fotoSugestao String?`, `fotoCredito String?`.
- `CursoOnline`: `capaBusca String?`, `capaSugestao String?`, `capaCredito String?` (a foto continua em
  `Curso.imagemUrl`).

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
- passo "fotos" de um curso novo: capa e módulos com foto, sugestão e crédito gravados, ids do Pexels sem repetir;
  depois CONCLUIDA; erro na IA ou no Pexels → CONCLUIDA mesmo assim, com o aviso;
- botão em curso existente: só preenche o vazio (foto já posta fica);
- trocar por outra: pega a próxima da lista e apaga a antiga;
- sem `PEXELS_API_KEY`: grava só as sugestões, sem chamar o banco;
- busca sem resultado: tenta a forma curta; sem nada, fica vazio com a sugestão;
- teto do mês estourado: não chama a IA e avisa.
