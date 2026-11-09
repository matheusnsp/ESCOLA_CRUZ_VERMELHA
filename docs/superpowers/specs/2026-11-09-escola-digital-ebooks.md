# Escola Digital, fase 2a: e-books (PDF enviado pela Escola)

Data: 2026-11-09 · Branch: `escola-digital-ebooks` · Base: `escola-digital-padrao` (PR #122)

## Objetivo

A Escola Digital (vitrine: `docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md`) passa a vender e entregar
e-books, além dos cursos online. Decisões do Matheus (09/11):

| Pergunta | Resposta |
|---|---|
| Pago ou grátis | **Os dois**: cada e-book tem preço; R$ 0 = grátis (só pede conta) |
| Proteção do PDF | **Nome no rodapé** de cada download ("Licenciado para …") |
| Conteúdo | **Os dois**: agora a Escola envia o PDF pronto (esta fase, 2a); a IA escrevendo o e-book vem na fase 2b |
| Desenho geral | Aprovado (pagamento pelo caminho dos cursos online, bucket privado, página própria, fileira na vitrine) |

Regra que já vale (vitrine): **conta obrigatória** para baixar, inclusive grátis.

## 1. Modelo

- Tabela nova **`Ebook`**: `id`, `cursoId` (único, o "curso escondido" abaixo), `arquivoPdf` (caminho no bucket privado),
  `arquivoNome` (nome original), `paginas` (Int), `tamanhoBytes` (Int), `descricaoLonga` (texto da página de venda),
  `precoOnline` (Decimal), `gratuito` (Bool), `maxParcelas` (Int, padrão 1), `publicado` (Bool, padrão false),
  `ordemVitrine` (Int, padrão 0), `capaGeradaPorIa` (Bool), `criadoEm`, `atualizadoEm`.
- Cada e-book tem um **`Curso` escondido** (`ativo: false`): guarda nome, descrição curta e capa (`imagemUrl`), e as dúvidas
  frequentes (`FaqCurso`, como os cursos). A compra é uma `Matricula` na **turma online** desse curso
  (`lib/turma-online.js`, mesma técnica dos cursos online): PIX, cartão, parcelas, webhook da Únicopag, reconciliação,
  Financeiro e estorno sem código novo de pagamento.
- O curso escondido de e-book **não aparece** em nenhuma lista de cursos (painel "Cursos", site presencial, vitrine de
  cursos, relatórios de turmas presenciais, seletor de cursos dos cupons de curso, IA de textos dos cursos). Filtro
  único: `ebook: null` (relação 1–1 opcional `Curso.ebook`), aplicado onde hoje se lista curso.
- **Cupons** (`CupomEad`): campo novo `ebookId` (opcional). Cupom com `ebookId` vale só para aquele e-book; com
  `cursoOnlineId` só para aquele curso; **sem os dois, vale para todos os cursos online e e-books**. No formulário do
  cupom, o seletor "Vale para" lista cursos online e e-books.

## 2. Painel: Escola Digital → E-books

Só quem tem a permissão da Escola Digital (a mesma dos cursos online).

- **Lista**: capa, título, preço (ou "Grátis"), publicado/rascunho, downloads (total), vendas pagas, ordem.
- **Formulário** (novo e editar): título (até 120), descrição curta (até 300), descrição da página de venda (até 3000),
  capa (imagem, vira WebP como as outras), **PDF** (obrigatório para publicar; até **50 MB**; só `application/pdf`
  que o `pdf-lib` consiga abrir — senão "Este arquivo não é um PDF válido"), preço / "Grátis", parcelas (1–12), ordem
  na vitrine, "Publicado".
  - Ao enviar o PDF: conta as páginas e guarda tamanho e nome; o arquivo vai para o **bucket privado `ebooks`** do
    Supabase (criado na primeira vez pelo próprio servidor, com a chave que já existe; `public: false`). Sem Supabase
    configurado (ambiente local), vai para uma pasta privada fora de `public/` (`UPLOADS_DIR/../ebooks-privados` ou
    `data/ebooks`), nunca servida por URL.
  - Trocar o PDF substitui o arquivo (o antigo é apagado depois de salvar).
- **IA** (como nos cursos): "Escrever com IA" preenche descrição curta, descrição da página e 5–6 dúvidas frequentes
  (o Claude recebe o título, as ideias e o **texto das primeiras páginas do PDF**, até ~6.000 caracteres, para não
  inventar); "Gerar capa com IA" usa a geração de imagem atual (WebP, identidade da Cruz Vermelha, cruz vermelha).
- **Dúvidas frequentes**: lista com adicionar/remover, como no curso só online.
- **Excluir**: só sem vendas pagas; senão "Despublicar".
- Auditoria: `CRIOU_EBOOK`, `EDITOU_EBOOK`, `TROCOU_PDF_EBOOK`, `EXCLUIU_EBOOK`.

## 3. Aluno

### 3.1 Página do e-book — `/escola-digital/ebook/<endereço>`

Endereço = nome do e-book em minúsculas sem acento (como os cursos); só e-book publicado (DEV vê rascunho com aviso).
Visual da página do curso online (topo com a capa, cartão de compra à direita, rodapé do site):
- topo: rótulo "E-BOOK", título, descrição curta, pílulas "N páginas" · "PDF" · "Leia no celular ou imprima";
- cartão: preço (ou "Grátis"; parcelas quando houver), cupom ("Tem cupom?") e o botão:
  - sem login: "Criar conta e baixar" (grátis) / "Criar conta e comprar" (pago) → cadastro/login e volta para a página;
  - logado sem acesso: "Baixar e-book" (grátis) / "Comprar" (pago → mesmo fluxo de pagamento do curso online);
  - logado com acesso (grátis, ou matrícula paga): "Baixar e-book" e "Já é seu desde 09/11/2026";
  - pagamento pendente: "Ver o pagamento" (como no curso online).
- seções: "Sobre o e-book" (descrição da página de venda) e "Dúvidas frequentes" (sanfona), quando houver.

### 3.2 Download — `/escola-digital/ebook/<endereço>/baixar`

- Exige login e acesso (grátis: qualquer conta; pago: matrícula **PAGA** na turma online do e-book).
- O servidor lê o PDF do bucket privado, escreve no **rodapé de todas as páginas**, em cinza claro, 7 pt, centralizado:
  `Licenciado para <Nome> · CPF ***.456.789-** · <data>` (documento mascarado como já é feito no site; passaporte/CNPJ
  mascarados do mesmo jeito) e devolve como anexo `<endereço>.pdf`. O original não muda.
- Sem limite de downloads. Cada download grava `DownloadEbook` (`ebookId`, `usuarioId`, `criadoEm`) para a contagem
  no painel. Limite de frequência: 20 downloads por pessoa por hora (o 21º mostra "Muitos downloads seguidos; tente
  daqui a pouco").
- Grátis: o primeiro download também cria a "posse" (`AcessoEbook`: `ebookId`, `usuarioId`, `criadoEm`, único por par)
  para aparecer em "Minha conta". Pago: a posse é a matrícula paga.
- PDF que não abre / arquivo sumido do bucket: página de erro "Não conseguimos preparar o seu e-book agora. Tente de
  novo em alguns minutos." e log `[ebook]`.

### 3.3 Vitrine e "Minha conta"

- Vitrine `/escola-digital`: fileira **"E-books"** depois das de cursos (cards com a capa em pé, título, "N páginas",
  preço ou "Grátis"), só e-books publicados, na `ordemVitrine`. Sem e-book publicado, a fileira não aparece.
- "Minha conta": seção **"E-books"** (menu da conta do site e do header da Escola Digital, só para quem tem algum) com
  capa, título e "Baixar".
- E-mail de compra paga confirmada: o mesmo aviso de pagamento confirmado do curso online, com o link "Baixar e-book".

## 4. Fora

IA escrevendo o e-book (fase 2b); e-book em lotes de escolas; leitor no site (o PDF é baixado); estatísticas além de
downloads e vendas; webinários (fase 3).

## 5. Testes

- Modelo/filtros: curso escondido de e-book fora das listas (painel Cursos para DEV, site, vitrine de cursos, cupom).
- Painel: criar com PDF de 3 páginas guarda `paginas = 3`; arquivo que não é PDF é recusado; publicar sem PDF é
  recusado; excluir com venda paga é recusado.
- Página: grátis sem login → "Criar conta e baixar"; pago logado → "Comprar"; com matrícula paga → "Baixar".
- Download: sem login → login; pago sem pagamento → volta para a página; com acesso → PDF com o mesmo nº de páginas
  e o texto "Licenciado para" no conteúdo; grava `DownloadEbook`; 21º na hora → recusado.
- Cupom: de e-book vale só para ele; geral vale para curso e e-book; de curso não vale para e-book.
- Vitrine: fileira aparece só com e-book publicado. "Minha conta" lista o e-book grátis baixado e o pago.
- Prints: painel (lista e formulário), página do e-book (grátis, pago, já comprado) no computador e no celular, vitrine,
  PDF baixado (rodapé).
