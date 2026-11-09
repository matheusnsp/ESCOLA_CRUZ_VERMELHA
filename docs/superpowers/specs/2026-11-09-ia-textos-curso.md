# Escrever com IA: descrição, conteúdo e dúvidas frequentes do curso

Data: 2026-11-09 · Branch: `ia-textos-curso` · Base: main (com as imagens com IA)

## Objetivo

Pedido do Matheus: "quero que possa fazer a criação da descrição do curso, olha o padrão dos outros… e que você
coloque também as dúvidas já dentro, em um prompt… aí ele vai preenchendo". Vale para os dois formulários
("sim, nos dois"): **curso presencial** (aba Cursos) e **curso só online** (Escola Digital).

## 1. Como funciona (os dois formulários)

- Campo novo **"Ideias para a IA"** (opcional, até 500 caracteres; não é salvo) e botão **"Escrever com IA"**.
- O botão manda ao servidor (fetch JSON, JS externo — CSP) o que já está na tela: nome, carga horária,
  escolaridade, área, as ideias e os textos atuais. O servidor chama o Claude (cliente da etapa 9, esforço `low`)
  com **3 cursos de exemplo já publicados/ativos** do mesmo tipo (presencial: ativos com descrição longa; online:
  publicados), para seguir o padrão de tom, tamanho e formato.
- O Claude devolve os textos e o JS **preenche os campos na tela**; nada é salvo até a pessoa clicar em Salvar.
  Campo que já tem texto: o navegador pergunta antes de substituir ("Substituir os textos que você já escreveu?").
- Aviso "Escrevendo…" no botão enquanto espera (20 a 40 s); erro → mensagem no lugar.
- Conta no teto mensal do Claude (custo avulso do mês, como as imagens). Teto estourado ou sem chave → mensagem.
- Dúvidas: aparecem numa lista no formulário, cada uma com caixinha marcada; ao salvar, as **marcadas** viram
  dúvidas do curso (`FaqCurso`), depois das que já existem. Funciona também no curso novo.

## 2. O que o Claude escreve

Presencial: `descricao` (1–2 frases, até 300), `descricaoLonga` (até 3000, parágrafos), `conteudoProgramatico`
(itens, um por linha, até 4000), `faqs` (5 a 6, pergunta até 200, resposta até 600).
Online: `descricao` (até 1000, o texto da página de venda) e `faqs` (5 a 6).
Regras no prompt: português do Brasil, tom da Escola, sem prometer o que o curso não dá (online é teórico, sem
prática em manequim; certificado só ao concluir), sem preço (o preço muda e já aparece na página), não inventar
lei/norma que não esteja nos dados; dúvidas sobre o que o aluno costuma perguntar (público, certificado,
carga horária, pré-requisito, como funciona).

## 3. Curso online: dúvidas na página de venda

- A capa do curso online (`/escola-digital/<curso>`) ganha a seção **"Dúvidas frequentes"** em sanfona (as
  `FaqCurso` do curso), igual à do presencial, abaixo do cartão de compra. Sem dúvidas, a seção não aparece.
- O formulário do curso online (`/ead/curso/:id/editar` do curso só online) ganha a lista das dúvidas com
  "Remover" e o formulário de adicionar, como o presencial.

## 3.1 Criação de curso com IA (passo a passo)

Pedido do Matheus: "as dúvidas vão estar no prompt pra criação do curso também, e depois só faz o corte cola".
- A **proposta** (passo 2) passa a trazer também 5 a 6 **dúvidas frequentes** (pergunta e resposta), com os mesmos
  limites e regras; elas aparecem no formulário da proposta para a pessoa conferir (editar o texto, tirar as que
  não quiser).
- Ao criar o curso (confirmar o roteiro, curso novo), as dúvidas confirmadas entram no curso (`FaqCurso`)
  automaticamente: nada para copiar. Curso existente: as dúvidas novas entram depois das que já existem, sem
  repetir pergunta igual.

## 4. Fora

Gerar o nome do curso, preço, carga horária; traduzir; escrever para cursos online que não são "só online" (esses
usam os textos do curso presencial).

## 5. Testes

Claude falso: o pedido leva 3 exemplos do mesmo tipo e as ideias; a resposta vem cortada nos limites; teto
estourado não chama; salvar com 2 dúvidas marcadas de 3 cria só as 2 (presencial novo e editar; online editar); a
capa do curso online mostra as dúvidas em sanfona e some sem dúvidas; JS sem inline (o botão funciona por
`data-*` e arquivo externo).
