# Pesquisa de satisfação: filtros e visual novo

Data: 2026-11-13 · Branch: `pesquisa-filtros` · Base: `menu-submenus` (PR #134; usa o cartão de filtros do celular)

## Porquê
O Matheus quer filtrar a página de Pesquisa por curso e um visual melhor (prints aprovados em 13/11: "Proposta").

## Abordagens
| | Como | Troca | |
|---|---|---|---|
| **A** | Filtros por endereço (`?curso=&turma=&nota=`), contas no servidor com funções puras em `lib/pesquisa.js`, view nova | Link filtrado compartilhável; aprovar mantém o filtro; testável | **Escolhida** (minha decisão) |
| B | Filtrar no navegador (JS), como o Financeiro | Sem recarregar, mas números/gráfico também em JS e sem link filtrado | — |

## Design (aprovado nos prints)
1. **Filtros:** Curso (cursos com respostas), Turma (só com curso escolhido; datas das turmas do curso), Nota (Todas · 4 e 5 · 3 · 0 a 2), "Limpar filtros". Mudou um campo → a página recarrega (sem JS: botão "Aplicar"). Valem para os números, o gráfico e as respostas. Turma de outro curso é ignorada.
2. **Cartões:** Nota média (estrelas + quantas deram cada nota, 5 a 0; "X respostas de Y enviadas" — envios contados pelo mesmo filtro); Satisfeitos (% com 4 ou 5; "A deram 4 ou 5 · B deram 0 a 2"; "C com comentário"); Depoimentos no site (aprovados; aguardando aprovação; **liga/desliga** da seção da página inicial — `role="switch"`, mesmo POST de hoje; só quem tem `pesquisa:gerenciar` mexe).
3. **Nota média por curso:** barras, maior nota primeiro, todos os cursos (ignora o filtro de curso/turma); o curso filtrado fica destacado; tocar filtra (mantém o filtro de nota).
4. **Respostas:** abas de hoje (Aguardando aprovação, No site, Ocultas, Todas) dentro da caixa; linhas compactas (nota, comentário, linha de aluno · curso · turma · data · autorização, situação e botões Aprovar / Não publicar à direita). Sem comentário: "Só a nota, sem comentário."
5. **Filtro preservado:** abas, Aprovar/Não publicar e liga/desliga voltam para o mesmo filtro.
6. **Celular (até 620 px):** filtros recolhidos atrás de um botão "Filtros" (mostra o que está filtrado); tocar abre os campos logo abaixo. Abas viram o cartão "Mostrando…" (já existe).

## Fora
Exportar, gráfico por período, filtros por data.
