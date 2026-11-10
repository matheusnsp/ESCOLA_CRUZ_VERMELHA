# Cupom de desconto na inscrição do curso presencial

Data: 2026-11-09 · Branch: `cupom-presencial` · Base: `escola-digital-ebooks` (mexe nos mesmos cupons)

## Objetivo

Pedido do Matheus: na inscrição do curso presencial, "ter um lugar pra colocar o código do cupom… igual no exemplo"
(o "Tem cupom?" da página do curso online). Decisões (09/11):

| Pergunta | Resposta |
|---|---|
| O desconto vale para quê | **Só o valor do curso**; a taxa de inscrição continua cheia |
| Alcance | **Curso** (todas as turmas) ou todos os presenciais; não por turma |
| Onde criar | Na aba **Cupons** que já existe (o "Vale para" ganha os presenciais) |
| Desenho | Aprovado em conversa (abaixo) |

## 1. Cupom

- `CupomEad` ganha `cursoId` (opcional, curso presencial) e `todosPresenciais` (Bool, padrão false).
- "Vale para" no formulário do cupom (aba Cupons), um só:
  - Todos os cursos online e e-books (como hoje: sem nada marcado);
  - **Todos os cursos presenciais** (`todosPresenciais`);
  - **Um curso presencial** (`cursoId`), qualquer turma;
  - Um curso online (`cursoOnlineId`) ou um e-book (`ebookId`), como hoje.
- Os cupons "para todos" que já existem **não** passam a valer no presencial (só com `todosPresenciais` ou `cursoId`).
- Cupom de presencial não vale no online/e-book, e vice-versa (mensagem "Este cupom é de outro curso.").
- Tipos (% ou R$), validade, limite de usos, ativar/desativar e apagar: como hoje. Usos = inscrições **pagas**
  (statusPagamento PAGO ou PARCELADO), como hoje.
- A aba **Cupons** aparece também no modo Presencial do painel (mesma página `/ead/cupons`, só DEV, como hoje).
  A lista mostra "Vale para": "Presencial: <curso>", "Todos os presenciais", etc.

## 2. Tela de inscrição (`/inscrever/<turma>`, etapa "escolha")

- Bloco **"Tem cupom?"** (campo + "Aplicar"), igual ao do curso online: GET na própria tela (`?cupom=CÓDIGO`); o link
  com `?cupom=` serve para campanha. "tirar" (`?cupom=`) remove.
- Cupom válido: em cada opção (à vista, parcelado, na secretaria), o **valor do curso** aparece riscado e o novo ao
  lado; o total (curso + taxa) e as parcelas são recalculados com o curso já com desconto. Aviso
  "Cupom CÓDIGO aplicado: R$ X de desconto no curso. tirar".
- Cupom inválido: a mensagem (não existe, vencido, esgotado, de outro curso) e os preços normais.
- Cupom de 100%: o curso sai por R$ 0; a pessoa paga só a taxa de inscrição (se houver). Sem taxa e com curso a R$ 0,
  a inscrição é confirmada sem pagamento (como o cupom de 100% do online).
- Mesmo limite de tentativas erradas do online (`lib/limite-cupom.js`).
- O formulário de inscrição leva o código; o servidor confere de novo na hora de criar a matrícula.

## 3. A inscrição guarda o desconto

- Ao criar/retomar a matrícula com cupom válido: grava `CupomMatriculaEad` (precoCheio = valor do curso no plano,
  desconto, precoFinal) — a mesma tabela do online.
- **Todo lugar que recalcula o preço de uma matrícula presencial** usa o curso com o desconto gravado: pagar a taxa,
  pagar o curso (parcelado com juros e "na secretaria"), retorno do pagamento, retomada pela "Minha conta" e o
  Financeiro. Uma função só: `calcularValores(curso, plano, alunoId, { cupom })` aplica o desconto ao valor do curso.
- Sem cupom gravado, tudo fica exatamente como hoje.
- Trocar de plano (refazer a escolha numa matrícula ainda "fantasma") recalcula o desconto para o novo plano.
- Passaporte (pagamento na secretaria) também aceita o cupom.

## 4. Fora

Cupom na taxa de inscrição; cupom por turma; liberar a aba Cupons para a secretaria (hoje só DEV).

## 5. Testes

- Validação: cupom de curso presencial vale em qualquer turma dele e recusa outro curso; `todosPresenciais` vale em
  qualquer presencial e recusa online/e-book; cupom "todos" antigo recusa o presencial.
- Tela: `?cupom=` válido mostra o curso riscado e o total novo nas três opções; inválido mostra o motivo.
- Inscrição à vista PIX com 20%: matrícula com `valorCurso` = (curso − 20%) + taxa, `CupomMatriculaEad` gravado,
  cobrança com esse total.
- Parcelado: a etapa "pagar o curso" usa o curso com desconto.
- 100% sem taxa: confirmada sem pagamento.
- Painel: criar cupom "Um curso presencial" grava `cursoId`; lista mostra "Presencial: <curso>"; aba no modo Presencial.
