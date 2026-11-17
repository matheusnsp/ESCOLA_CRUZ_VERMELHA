# Cupom de valor final, com quantidade que renova e faixa no site (2026-11-17)

## Por quê
A secretaria quer fazer como o site da instituição: digitar **quanto a pessoa paga** (matrícula e taxa de
inscrição), em vez de um desconto; definir **quantos cupons** existem, com a opção de **renovar sozinho** quando
acabam; e mostrar o cupom **de cara no site**, com "restam N cupons", aplicado sozinho na inscrição.
Copiar só a lógica do desconto: o design do site continua o mesmo; entra só a faixa do cupom.

## Decisões (aprovadas com prints)
- Tipo novo `FINAL` no cupom (os tipos % e R$ continuam). `valor` = matrícula final; `taxaFinal` (opcional) =
  taxa de inscrição final (vazio = taxa normal; 0 = grátis). Só para curso presencial (um curso ou todos).
- O desconto do curso = preço do plano − valor final (nunca negativo). A taxa com cupom = menor entre a taxa do
  cupom e a taxa normal do aluno (quem já é isento continua isento). A taxa com cupom fica gravada na inscrição
  (`CupomMatriculaEad.taxaFinal`), como o desconto: mudar o cupom depois não muda inscrições feitas.
- Quantidade = `limiteUsos` (conta como hoje: pagas + quem pagou a taxa). `renovar`: nunca esgota;
  restam = limite − (usos mod limite); rodada = ⌊usos/limite⌋ + 1. Sem renovar: acabou, some do site e para de valer.
- `noSite`: mostra a faixa e aplica sozinho na inscrição. Vários cupons no mesmo curso: o que deixa mais barato.
- Faixa: "Com o cupom X: R$ total com tudo incluso · restam N cupons" (≤ 5: "só restam N cupons";
  sem limite e com validade: "até dd/mm"). Na vitrine (cards da home e de /cursos), em "Próximas turmas" (/cursos)
  e nas turmas da página do curso. Fora do cache do catálogo (o "restam" muda a cada inscrição).
- Inscrição: aplica sozinho; "tirar" vale até a pessoa digitar outro código (fica na sessão).

## Fora
Cupom de valor final no curso online/e-book/webinário; prévia ao vivo da faixa no painel.
