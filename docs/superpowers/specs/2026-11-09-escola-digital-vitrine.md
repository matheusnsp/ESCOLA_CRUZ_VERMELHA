# Escola Digital: vitrine estilo Netflix + cursos gratuitos (fase 1 de 3)

Data: 2026-11-09 · Branch: `escola-digital-vitrine` · Base: main (d51127e)

## Objetivo

A página `/escola-digital` deixa de ser uma grade simples e vira uma **vitrine estilo Netflix, clara, com as
cores do site** (vermelho Cruz Vermelha, fundo claro), como no mockup aprovado
(`direcao-escola-digital-netflix-*`). Nesta fase só entram os **cursos online que já existem**. E-books (fase 2)
e webinários (fase 3) virão depois, cada um com sua especificação; a vitrine já nasce preparada para mais
linhas, mas **linha sem produto não aparece**.

Junto vem o **curso gratuito**: a secretaria marca "Gratuito", o curso aparece com "Grátis" e o aluno libera
com um clique, sem pagamento.

Regras fixas (pedido do Matheus):

- **Conta obrigatória**: para fazer um curso (e, nas próximas fases, baixar um e-book ou assistir a um
  webinário) a pessoa **precisa ter conta e estar logada**, inclusive quando é grátis. A vitrine e a página
  do produto são públicas (qualquer um vê); liberar, comprar e acessar o conteúdo, só logado. Quem não está
  logado é levado a "Criar conta" / "Entrar" e volta para o produto depois.
- **Nunca mostrar vagas ocupadas ou restantes** em nenhum lugar da vitrine.

## 1. A página `/escola-digital` (site, visual claro)

De cima para baixo:

1. **Destaque (hero)**: um curso escolhido na secretaria, com a foto do curso (`Curso.imagemUrl`) de fundo
   em largura total, véu claro/escuro para leitura, selo "Escola Digital CVB-RJ", nome (h1), descrição curta
   (até ~160 caracteres, cortada no espaço), carga horária, preço ou **Grátis**, e o botão principal:
   - aluno que já tem o curso → "Continuar" (link `/escola-digital/<slug>/continuar`);
   - senão → "Ver curso" (link `/escola-digital/<slug>`).
   Sem destaque escolhido (ou o escolhido não está publicado), usa o primeiro curso da ordem da vitrine.
   Sem foto, fundo vermelho do site com o desenho/gradiente padrão. Sem nenhum curso publicado: o hero
   institucional atual ("Aprenda onde estiver.") e "Novos cursos online em breve." (como hoje).
2. **"Continue de onde parou"**: só para aluno logado com curso online liberado e não concluído. Usa
   `meusCursosOnline(usuarioId)` (já existe), mostra os cursos em andamento/novos com a **barra de progresso**
   (percentual) e leva ao `link` (que já é o `/continuar`). Visitante, DEV/secretaria e aluno sem curso não
   veem a linha.
3. **"Cursos online"**: todos os cursos publicados (pagos e grátis), na **ordem da vitrine**.
4. **"Gratuitos"**: só quando existir ao menos um curso grátis publicado; os mesmos cards, só os grátis.

Cada linha é um **carrossel horizontal** (rolagem com o dedo / trackpad, `scroll-snap`), com setas ‹ › no
computador (JS externo `escola-digital-vitrine.js` via `asset()`; CSP sem JS inline). Sem JS, a linha rola
normalmente. No celular os cards ocupam ~70% da largura (o próximo aparece "espiando").

**Card** (novo partial `partials/ed-card.ejs`, só da Escola Digital): capa 16:9 (foto do curso ou o fundo
padrão com o nome), nome (2 linhas no máximo), carga horária ("8 h"), e o preço ("R$ 49,90" — com parcelas
quando houver: "ou 3× no cartão") ou o selo **Grátis**. Para o aluno que já tem o curso: selo "Você já tem"
no lugar do preço. Nenhum número de vagas. O card inteiro é um link para a página do curso.

Mantém: trilha "Início › Escola Digital", header e footer do site, `menuAtivo: 'escola-digital'`, título e
descrição da página, canonical, sitemap. A página continua 404 com a Escola Digital desligada. O cache do
catálogo (`catalogo(res, 'escola-digital', …)`) continua só para a lista pública; a linha "Continue de onde
parou" e o "Você já tem" são calculados por pessoa, fora do cache.

## 2. Secretaria (modo Online → Cursos online, `/ead`)

Na caixa do interruptor "Escola Digital no site" (já existe), uma área nova **"Vitrine"**:

- **Destaque**: um `<select>` com os cursos online publicados ("— automático (o primeiro da ordem) —" é o
  padrão). Salvar grava a escolha.
- **Ordem**: a lista dos cursos publicados com botões ↑ ↓ (um POST por clique, como as outras ordens do
  painel). Curso novo publicado entra no fim.
- Link "Ver a vitrine no site ↗".

Na página do curso online (`/ead/curso/:id`), no bloco do preço:

- Caixa **"Curso gratuito"**. Marcada: o preço fica R$ 0, o campo de preço e as parcelas ficam desabilitados
  e some a parte de cupons (cupom em curso grátis não faz sentido). Desmarcada: volta a pedir o preço
  (o preço anterior não é guardado; a pessoa digita de novo).
- `podePublicar` aceita **preço definido = maior que zero OU gratuito**. A pendência continua "Defina o preço
  do curso online (ou marque Gratuito)."

## 3. Dados (uma migração pequena)

Em `CursoOnline`:

- `gratuito Boolean @default(false)`: o curso é grátis. Com `gratuito = true`, `precoOnline` fica `0`.
  (Um campo explícito em vez de "preço 0" para não confundir com "sem preço" nos lugares que hoje tratam
  `precoOnline` nulo/zero como "não está à venda".)
- `ordemVitrine Int @default(0)`: ordem na vitrine (menor primeiro; empate por nome).

O destaque fica em `Configuracao` com a chave `escola-digital:destaque` (valor = id do CursoOnline, ou
ausente = automático), lido junto com o interruptor (mesmo cache de 30 s, limpo ao salvar).

A migração só acrescenta colunas com valor padrão: não apaga nem altera dados (o Render roda
`prisma migrate deploy` no build).

## 4. Liberar curso grátis (site)

Na página do curso online (`capa.ejs`), para curso com `gratuito = true`:

- Preço mostra **"Grátis."** (no lugar do valor); sem campo de cupom, sem PIX/cartão.
- Aluno logado sem o curso → botão **"Quero estudar · Grátis"** (POST para o mesmo
  `/escola-digital/:curso/comprar` com `forma=GRATIS`).
- Visitante → "Criar conta e liberar" (o caminho que já existe para cupom de 100%; depois do cadastro/login
  volta para a capa e clica em "Quero estudar").
- Quem já tem → "Continuar" (como hoje).

No servidor (`ead-online.js`), `forma=GRATIS`:

- só vale se o curso está `gratuito` e publicado e a Escola Digital ligada (mesmas regras de hoje); senão
  volta para a capa sem gravar nada;
- exige login (`requireLogin`, como a compra): sem conta não libera nada, nem curso grátis;
- não pede o CPF de novo na hora (não há cobrança; o cadastro da conta já pede CPF ou passaporte);
- libera como o cupom de 100% já faz (`liberarPorCupom` generalizada): matrícula na turma ONLINE do curso,
  `statusPagamento: 'PAGO'`, valores 0, `confirmadaPor: 'gratuito'`, sem Pagamento, com a trava por aluno e
  turma (duplo clique = uma liberação), auditoria `EAD_GRATIS_LIBEROU`;
- redireciona para `/continuar`.

Curso que era grátis e passou a ser pago: quem já liberou continua com o curso (a matrícula está PAGA).
Curso pago que passou a ser grátis: quem tinha PIX pendente pode clicar em "Quero estudar" (os pendentes
são cancelados como no cupom de 100%).

Em "Minha conta" (`ead-meus-cursos.js`) a origem do curso liberado de graça aparece como **"Gratuito"**
(nova origem `gratuito`, detectada por `confirmadaPor === 'gratuito'`), ao lado de "Comprado",
"Cortesia" e "Escola".

Onde o site lista cursos online com preço (`cursosOnlinePublicados`, `cursosDaEscolaDigital`, selo no
catálogo presencial, sitemap), o curso grátis publicado **entra** e mostra "Grátis" em vez do valor.

## 5. Fora desta fase

E-books, webinários, "Meus produtos", busca e filtros, categorias por área, avaliações/estrelas,
"mais vendidos". Turmas presenciais não entram na Escola Digital (continuam em `/cursos`).

## 6. Testes (node:test, como os demais)

- Vitrine: hero usa o destaque escolhido; sem destaque usa o primeiro da ordem; destaque despublicado cai no
  automático; ordem da vitrine respeitada; linha "Gratuitos" só com curso grátis; "Continue de onde parou"
  só para aluno com curso em andamento (com percentual) e não para visitante; "Você já tem" no card de quem
  tem; **nenhum texto de vaga** ("vaga", "restam", "ocupad") na página; desligada continua 404; sem cursos
  mostra "em breve".
- Secretaria: salvar destaque (e "automático"); ↑ ↓ mudam `ordemVitrine`; marcar Gratuito zera o preço e
  permite publicar sem preço; desmarcar exige preço de novo; cupom não aparece em curso grátis.
- Conta obrigatória: visitante (sem login) que faz POST `forma=GRATIS` vai para o login e nada é gravado;
  a capa do curso grátis para visitante mostra "Criar conta e liberar" e nenhum botão de liberar direto.
- Liberar grátis: aluno logado libera sem digitar CPF e cai no `/continuar`; duplo POST = uma matrícula e uma
  auditoria; `forma=GRATIS` em curso pago não libera; curso grátis não publicado ou Escola Digital desligada
  não libera; DEV/secretaria não liberam; "Minha conta" mostra "Gratuito".
- Prints (computador e celular) da vitrine com destaque, linhas e card grátis; da capa grátis; da caixa
  "Vitrine" e do "Curso gratuito" na secretaria.
