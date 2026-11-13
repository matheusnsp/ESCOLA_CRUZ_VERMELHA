# Painel: menu com submenus, celular caprichado e boas-vindas por curso

Data: 2026-11-13 · Branch: `menu-submenus` · Base: `main`

## Porquê

O menu do painel tem 14 itens soltos no modo Presencial e 7 no Online. Várias páginas que existem ficam escondidas
atrás de abas ou de links dentro de outras telas. No celular e no tablet, o menu vira uma faixa que corre para o lado
e corta os itens, os filtros quebram em até 3 linhas e o botão de criar empurra o conteúdo. O Matheus quer o menu
organizado em grupos e o painel bom em todas as telas, aplicado **igual em todas as páginas**, sem esquecer nenhuma.

## Decisões do Matheus (13/11)

| Pergunta | Resposta |
|---|---|
| Menu | Grupos com submenus (prints aprovados); nenhuma página some; "Painel online" (inventado no 1º esboço) não entra |
| Nomes | Comprovantes continua **"Comprovantes"**; Pesquisa → "Pesquisa de satisfação"; Dúvidas → "Dúvidas dos alunos"; Escolas → "Escolas (lotes)" |
| Abas dentro das páginas que repetem o menu | **Mantém** (Turmas, Matrícula rápida, Configurações) |
| Botão de criar no computador | **Como hoje** (vermelho, no topo) |
| Filtros no computador | **Como hoje** |
| Botão de criar no celular | **Botão redondo flutuante (+)** no canto de baixo |
| Filtros no celular | **Cartão "Mostrando …"** que abre uma lista de baixo para cima (print "Novo: tocou no filtro") |
| Boas-vindas por curso | **Faz** |

## Abordagens

| | Como | Troca | |
|---|---|---|---|
| **A** | Regras **gerais** no `header.ejs` + `admin.css` + um script do painel: toda `.adm-abas` vira o cartão/lista no celular, todo botão marcado com `data-criar` vira o botão flutuante | Uma vez só; páginas novas ganham de graça; testes conferem as 58 telas | **Escolhida** (minha decisão) |
| B | Editar tela por tela | Fácil de esquecer uma; repete código | — |

## 1. Menu

### Presencial
- **Painel**
- **Cursos e turmas** ▸ Cursos · Turmas · Matrícula rápida · Mapa de horários · Mensagem de boas-vindas
- **Alunos** ▸ Alunos · Matrículas · Pendentes · Comprovantes · Pesquisa de satisfação
- **Financeiro** ▸ Financeiro · Contas a pagar · Cupons (só DEV, como hoje)
- **Certificados**
- *Sistema* · **Configurações** ▸ Usuários do painel · Permissões · Alunos banidos · Suspeitos · Integração

### Online (só DEV, como hoje)
- **Cursos online** ▸ Cursos · Criar curso com IA · Dúvidas dos alunos
- **Conteúdos** ▸ E-books (· Webinários, quando existir)
- **Vendas** ▸ Cupons · Escolas (lotes)
- **Certificados**
- *Sistema* · **Configurações** ▸ (os mesmos itens)

### Regras
- Cada item continua com **a mesma permissão de hoje** (a do link atual ou a da rota). Grupo sem nenhum item permitido
  não aparece. Configurações ▸ Usuários/Permissões/Banidos/Suspeitos: só DEV (como hoje); Integração:
  `integracao:gerenciar` (como hoje). Criar curso com IA: a mesma condição que hoje mostra o botão em Cursos online.
- O grupo da página atual **abre sozinho** e o item fica marcado. Os outros abrem/fecham com um clique; o navegador
  lembra quais ficaram abertos (`localStorage`, com try/catch).
- O selo de dúvidas aguardando continua no item e aparece também no título do grupo quando fechado.
- **Nenhum endereço muda.** Cada página passa a informar o próprio item (`ativo`); veja a lista do §4.
- As abas dentro das páginas **ficam como estão**.

## 2. Celular e tablet (até 1024 px)

- **Topo:** barra fina com o logo, o nome da página e o botão **Menu**. O menu abre como uma gaveta pela esquerda
  (Presencial/Online, grupos, tema, Sair); fecha no X, tocando fora ou com Esc. Computador (> 1024 px): a barra
  lateral de hoje, com os grupos.
- **Filtros (até 620 px):** toda `.adm-abas` vira um cartão "Mostrando **<filtro atual>**" com a contagem; ao tocar,
  sobe a lista com todas as opções, contagens e ✓ na atual. Título da lista: "Mostrar" + o `aria-label` da `nav`
  (ex.: "Mostrar turmas"). Funciona com abas que são **links** (troca de página) e com as que são **botões** (o
  Financeiro filtra na própria página com JS: o clique na lista aciona o botão original). Itens marcados como
  separados (`adm-aba-sep`, ex.: "Matrícula rápida" em Turmas) aparecem na lista depois de uma linha. Links que **baixam arquivo** (`.xlsx`, `.csv`, `.pdf`, ex.: "Excel" nas abas do curso online) também vão para depois da linha, como "Baixar planilha (Excel)" com o ícone de download, e nunca aparecem como "Mostrando".
- **Botão de criar (até 620 px):** o botão marcado com `data-criar` vira o botão redondo (+) fixo no canto de baixo,
  à direita, sem cobrir o rodapé. Página com **mais de uma** ação de criar (Contas a pagar: Nova despesa, Pedido de
  compra, Reembolso): o (+) abre uma lista com as três.
- **Revisão das telas:** depois dessas regras, passar pelas 58 telas em 390 px, 820 px e 1280 px (claro e escuro),
  tirar print e corrigir o que vazar ou cortar (como o caso do Safari no PR #133). Tabelas `.adm-table-cards` já
  viram cartões; o resto é conferido no print.

## 3. Boas-vindas por curso

- Na página **Mensagem de boas-vindas** (`/modelos`), nova parte **"Texto por curso"**, **abaixo** do texto padrão: escolher o curso (cursos
  presenciais ativos), escrever o texto dele, salvar. Mesmos campos automáticos ({CURSO}, {curso}, {data}, {hora},
  {local}, {doacao}). Apagar o texto e salvar = o curso volta a usar o padrão. A lista mostra quais cursos têm texto
  próprio (com "Editar" e "Voltar ao padrão").
- Guardado em `extras` do curso (`lib/extras.js`, campo `boasVindasTexto`); **sem coluna nova** no banco.
- `montarTexto(turma, modelo)`: usa o texto do curso quando houver, senão o padrão. A doação da turma continua
  valendo sobre a doação padrão. A tela de Boas-vindas da turma mostra "Texto próprio do curso" ou "Texto padrão",
  com link para editar o certo.

## 4. Checklist das 58 telas (levantado no código em 13/11)

Legenda: **(+)** = vira botão flutuante no celular · **Filtro** = vira cartão/lista no celular · **Item** = o que fica
marcado no menu.

| Tela (view) | Item no menu | (+) no celular | Filtro no celular | Busca |
|---|---|---|---|---|
| dashboard | Painel | | | |
| cursos | Cursos e turmas ▸ Cursos | Novo curso | | sim |
| curso-form | ▸ Cursos | | | |
| turmas | ▸ Turmas | Nova turma | Status (5) + Matrícula rápida | |
| turma-form, turma-notas, turma-boas-vindas, turma-certificados, turma-pesquisa-qr | ▸ Turmas | | | turma-certificados |
| matricula-rapida | ▸ Matrícula rápida | | Status + "Inscritos/Mapa" | sim |
| horarios | ▸ Mapa de horários | | Status + "Inscritos/Mapa" | |
| modelos | ▸ Mensagem de boas-vindas | | | |
| alunos, aluno-form, aluno-matriculas | Alunos ▸ Alunos | | | alunos |
| inscricoes, nota, transferir | ▸ Matrículas | | | inscricoes |
| pendentes, contato-whatsapp | ▸ Pendentes | | Situação | |
| comprovantes-saude | ▸ Comprovantes | | Situação | |
| pesquisa | ▸ Pesquisa de satisfação | | Abas | |
| financeiro | Financeiro ▸ Financeiro | | Abas (botões, JS) | |
| contas, conta, conta-form | ▸ Contas a pagar | Despesa · Compra · Reembolso (lista) | Situação | |
| ead/cupons, ead/cupom-form | ▸ Cupons / Vendas ▸ Cupons | Novo cupom | | |
| certificados | Certificados | | | |
| dev-usuarios, dev-usuario-form | Configurações ▸ Usuários do painel | Novo usuário | Abas de Configurações | |
| dev-permissoes | ▸ Permissões | | Abas de Configurações | |
| banimentos | ▸ Alunos banidos | | Abas de Configurações | sim |
| suspeitos | ▸ Suspeitos | | Abas de Configurações | sim |
| integracao | ▸ Integração | | | |
| ead/cursos | Cursos online ▸ Cursos | | | |
| ead/curso, ead/alunos, ead/concluintes, ead/desempenho | ▸ Cursos | Novo módulo (só em ead/curso) | Abas do curso (4) | |
| ead/aluno, ead/curso-online-form, ead/modulo, ead/modulo-form, ead/tela-form, ead/tela-ver, ead/pergunta-form, ead/cenario-form, ead/decisao-form | ▸ Cursos | | | |
| ead/ia-lista, ead/ia-form, ead/ia-geracao | ▸ Criar curso com IA | Criar curso com IA (ia-lista) | | |
| ead/duvidas | ▸ Dúvidas dos alunos | | Situação | sim |
| ead/ebooks, ead/ebook-form | Conteúdos ▸ E-books | Novo e-book | | |
| ead/escolas, ead/escolas-lote, ead/escolas-lote-form | Vendas ▸ Escolas (lotes) | Novo lote | | |

Botões de criar que **não** viram (+) (ficam onde estão, no meio do conteúdo): "Criar curso só online" e "Ativar EAD"
(caixas de Cursos online), "Outro lote" (cartão da escola), "Nova turma" na linha de cada curso, "Criar turma" na
Matrícula rápida, "Novo tópico/Novo cenário" dentro do módulo, botões "Adicionar…" de formulários.

## 5. Testes (node:test)

- **Toda tela tem item:** para cada view com `include('header'`, o `ativo` existe no mapa do menu (nenhuma página
  fica sem item marcado). Lista das 58 telas conferida contra o §4.
- **Menu:** render do header por papel/permissão (DEV, Secretaria, Consulta): grupos e itens certos; grupo vazio some;
  item ativo marcado e grupo aberto; selo de dúvidas no grupo fechado; nenhum `href` muda (mesmo conjunto de hoje +
  os itens que aparecem).
- **Filtros:** toda view com `class="adm-abas"` (ou include de abas) tem `aria-label` (vira o título da lista); o
  script transforma links e botões (teste de DOM com um HTML de exemplo, ou Playwright local no celular).
- **(+):** toda view do §4 com (+) tem `data-criar` no botão; Contas tem os três.
- **Boas-vindas por curso:** salvar/ler/apagar texto do curso; `montarTexto` usa o do curso, cai no padrão sem ele;
  doação da turma continua por cima; tela da turma diz qual texto vale.
- **Visual:** prints em 390/820/1280 px das telas do §4 (claro e escuro) anexados ao PR.

## 6. Fora

Painel online (página nova), mudar endereços, mudar o visual das telas no computador, mudar textos internos das
telas, a página de Webinários (vem com a fase 3; o item entra no menu junto com ela).

## 7. Decisões minhas (o Matheus pode mudar)

- Regras gerais (abordagem A) em vez de editar tela por tela.
- Gaveta do menu até 1024 px; filtro em lista e botão (+) até 620 px (tablet deitado continua com pílulas e botão no
  topo, que cabem).
- Grupos lembrados por navegador.
- Texto por curso só para cursos presenciais (o online não manda boas-vindas).
