# Cursos e Turmas: telas novas (resumo + seções) — desenho

Data: 2026-11-13 · Pedido do Matheus (coordenação usa o painel no computador e no celular).

## Intenção

Hoje a tela de criar/editar curso junta tudo numa página só (7 blocos, 2 botões de salvar, 4 ações de IA misturadas aos campos) e a secretaria acha confuso. A turma é mais curta, mas a lista de turmas tem 5 botões por linha. O pedido: tratar cada coisa separada, "igual fizemos no site inteiro" (o menu em grupos de 2026-11-13), com a IA ajudando onde fizer sentido e tudo funcionando também sem IA.

Sucesso: a pessoa abre um curso ou turma, vê de cara o que está pronto e o que falta, e edita uma coisa de cada vez numa tela curta, sem rolar uma página enorme.

Os prints aprovados estão em `docs/superpowers/specs/2026-11-13-cursos-turmas-telas/` (sem-ia/ e com-ia/, para curso e turma). Eles são a referência visual; os dados neles são de exemplo.

## Objetivos

1. **Curso:** lista → resumo do curso (cartões) → uma tela curta por seção, cada uma com seu botão de salvar.
2. **Criar curso** em 3 passos (Curso → Valores → Textos), com a caixa opcional "Começar com a IA" que preenche os 3 passos.
3. **Turma:** lista → resumo da turma (cartões) → telas que já existem (dados, alunos, notas, boas-vindas, QR, certificados).
4. **Nova turma** numa tela em blocos, com **Gerar aulas** (dias da semana + horário + até quando) e a caixa opcional "Começar com a IA".
5. **Menu:** separar "Cursos e turmas" em dois grupos, **Cursos** e **Turmas**.
6. **Dúvidas frequentes:** passar a poder **editar** e **mudar a ordem** (hoje só adiciona e remove).
7. **IA nova:** "Desfazer" depois de reescrever textos; "Sugerir com IA" no conteúdo programático do certificado.
8. O **assistente** continua preenchendo as telas novas (curso novo, turma nova e edições), sempre sem salvar sozinho.

## Não-objetivos

- Não muda regra de negócio: preços, status automáticos da turma (Confirmada à 00:00, Concluída no dia seguinte à última aula), quem pode excluir, Matrícula rápida, certificados, pagamentos.
- Não muda o modo Online (EAD), e-books, webinários nem o site público.
- Não muda permissões: quem pode criar/editar/ver continua igual.

## Anti-objetivos (seria fracasso mesmo funcionando)

- Perder algum campo ou ação que existe hoje.
- Salvar sem a pessoa clicar (nem a IA, nem o assistente).
- Quebrar links salvos: `/cursos`, `/turmas`, `/cursos/novo`, `/turmas/nova`, `/cursos/:id/editar`, `/turmas/:id/editar` continuam abrindo algo certo.
- Ficar ruim no celular ou no modo escuro.

## Restrições

- Stack atual: Node 22 CommonJS, Express, EJS, Prisma/Postgres, helmet CSP sem JS inline (scripts em `src/public/js/`), testes `node:test` + Playwright (Chromium).
- Visual: as classes e variáveis de `src/public/admin.css` (claro/escuro). Nada de cor fixa que quebre o modo escuro.
- Permissões existentes: `cursos:criar`, `cursos:gerenciar`, `turmas:gerenciar`, `painel:leitura` (só ver).
- Textos de curso seguem o modelo de 3 parágrafos (`lib/ia-textos.js`, PR 154). Toda IA nova passa por `ead-ia` (teto de custo, `somarCustoAvulso`).
- Em português, linguagem da secretaria.

## Abordagens consideradas

1. **Resumo + seções (escolhida).** Cada curso/turma abre num resumo com cartões; cada parte é uma tela curta com seu salvar. Mais clara e melhor no celular; dá mais trabalho (rotas e telas novas).
2. Abas na mesma página. Menos trabalho, mas um salvar vale para várias abas (fácil esquecer uma) e as abas apertam no celular.
3. Só reorganizar a página atual (blocos recolhíveis + salvar fixo). Pouco trabalho, melhora pouco.

O Matheus escolheu a 1, depois de ver os prints.

## Como fica — Curso

### Lista `/cursos`
Busca pelo nome, filtros Todos / No site / Fora do site (com contagem), tabela: curso (nome, horas, área), próximas turmas, site (No site / Fora do site), **Falta** (o que está incompleto, ver "O que falta"), botão **Abrir**. Botão **Novo curso** no topo. Os botões Editar/Ocultar/Excluir saem da linha e vão para dentro do curso.

### Novo curso `/cursos/novo` — 3 passos
- **Passo 1 · Curso:** nome, carga horária, área, escolaridade mínima.
- **Passo 2 · Valores:** à vista, parcelado (total), máximo de parcelas, taxa de inscrição (com a conta da parcela, como hoje).
- **Passo 3 · Textos:** resumo e texto completo (lembrete do modelo de 3 parágrafos) e, quando vierem da IA, as dúvidas frequentes. Botão "Escrever com IA (opcional)". Botão final **Criar curso**.
- "Voltar"/"Continuar" entre os passos não salvam nada; só **Criar curso** grava.
- **Mais detalhes (opcional)**, recolhido no fim do passo 3: conteúdo programático, nome no certificado, validade, "exige comprovante da área da saúde" e "Mostrar no site" (desmarcado por padrão). Serve para o que a IA ou o assistente trouxerem e não tem lugar nos 3 passos; se algo vier preenchido, o bloco abre sozinho para a pessoa ver. Nada fica escondido sendo salvo. *(decisão de construção, registrada pelo Claude)*
- O curso nasce **fora do site** (ativo = falso) e abre no resumo. Foto, certificado e o resto são completados depois.
- **Começar com a IA** (topo do passo 1): uma caixa de texto livre ("escreva o que você sabe do curso") e o botão **Preencher com IA**. A IA preenche os 3 passos (campos + textos + dúvidas); cada campo preenchido por ela ganha a etiqueta **IA**. A pessoa confere passo a passo. Aviso de espera ("leva uns 20 segundos").

### Resumo do curso `/cursos/:id`
Título = nome; linha com horas · área · No site/Fora do site · próxima turma. Seis cartões, cada um com o estado e o link:
1. **Página no site** → `/cursos/:id/pagina`
2. **Valores** → `/cursos/:id/valores`
3. **Certificado** → `/cursos/:id/certificado`
4. **Dúvidas frequentes** → `/cursos/:id/duvidas`
5. **Turmas deste curso** → `/cursos/:id/turmas` (+ atalho Nova turma deste curso)
6. **Inscrição e publicação** → `/cursos/:id/publicacao`

### Seções (cada uma: título, "← Voltar ao curso", blocos, rodapé fixo com o botão de salvar e "Nada é salvo até você clicar em Salvar")
- **Página no site:** dados (nome, horas, área, escolaridade), textos (resumo, texto completo, com **Reescrever com IA**: ideias opcionais → reescreve → **Desfazer** volta ao texto anterior sem salvar), foto (enviar, remover, **Gerar foto com IA** com o pedido da imagem, como hoje).
- **Valores:** os 4 campos de preço + a tabela de valores que existe hoje (`valores-curso`).
- **Certificado:** nome no certificado, conteúdo programático (**Sugerir com IA**: a IA sugere a partir do texto do curso; a pessoa confere), validade, quem assina (até 4, mesma regra de hoje).
- **Dúvidas frequentes:** lista na ordem do site; cada dúvida com **Editar** (abre ali mesmo, Salvar/Cancelar), setas **↑ ↓** (muda a ordem), lixeira (com confirmação); **+ Adicionar dúvida**; caixa **Sugerir dúvidas** (IA, marcar as que entram, como hoje). Cada ação grava na hora (não há "salvar a seção").
- **Turmas deste curso:** tabela das turmas do curso (início, aulas, vagas, situação, Editar) + **Nova turma deste curso** (`/turmas/nova?curso=ID`).
- **Inscrição e publicação:** "Mostrar este curso no site", "Exige comprovante da área da saúde", salvar. Abaixo, a caixa **Excluir curso**: habilitada só quando a regra de hoje permite (sem turmas, inscrições, EAD ou cupom); senão desabilitada, explicando o motivo e sugerindo desmarcar "Mostrar no site". Exclusão sempre com a caixa de confirmação do painel.

### Links antigos
`/cursos/:id/editar` redireciona para `/cursos/:id` (resumo).

## Como fica — Turma

### Lista `/turmas`
As abas de hoje (Por começar, Em andamento, Congeladas, Concluídas, Canceladas) com contagem, busca pelo curso, tabela: curso, início (+ "em N dias"), aulas, alunos (inscritos/vagas com barrinha; mínimo em alerta quando abaixo), situação, **Abrir**. Botão **Nova turma**.

### Nova turma `/turmas/nova` — uma tela em blocos
- **Quando:** curso, início; **Gerar aulas** (escolhe dias da semana, horário "HH:MM – HH:MM", "até" data → cria as datas de uma vez; dá para apagar e adicionar aula avulsa); lista de aulas.
- **Vagas:** vagas, mínimo de alunos.
- **Instrutor:** nome e registro.
- A turma nasce **Aberta** (como hoje). Botão **Criar turma**.
- **Começar com a IA** (topo): texto livre ("Socorrista, toda terça e quinta de dezembro, 18h às 22h, 30 vagas, instrutora…") → **Preencher com IA** preenche curso, início, aulas, vagas, mínimo e instrutor, com etiquetas IA.

### Resumo da turma `/turmas/:id`
Título "Curso · dd/mm"; linha com a situação e a próxima mudança automática ("vira Confirmada sozinha à 00:00 de 02/12" / "vira Concluída em …"), aulas e horário. Cartões:
1. **Dados da turma** → `/turmas/:id/editar` (a tela de editar existente, reorganizada em blocos Quando / Vagas / Situação / Instrutor, com Gerar aulas)
2. **Alunos** → a lista de alunos da turma que existe hoje (`/alunos?turma=ID`), com o resumo pagos/só inscrição e o alerta de pendentes
3. **Mensagem de boas-vindas** → `/turmas/:id/boas-vindas`
4. **Notas** → `/turmas/:id/notas`
5. **QR da pesquisa** → `/turmas/:id/pesquisa-qr`
6. **Certificados** → `/turmas/:id/certificados`

Abaixo, **Cancelar ou excluir**: excluir só sem nenhuma matrícula (regra de hoje), senão desabilitado explicando que para tirar do site é mudar a situação para Cancelada. Exclusão com a caixa de confirmação.

Os cartões respeitam as permissões de hoje (quem não pode, não vê o cartão).

### Quem só pode ver (painel:leitura) e quem só pode criar
Hoje quem tem só `painel:leitura` (Financeiro, Consulta) vê as listas de cursos e turmas, mas não abre a edição. Isso continua: nas listas, o botão **Abrir** aparece só para quem pode editar (`cursos:gerenciar` / `turmas:gerenciar`); o resumo e as seções exigem a mesma permissão da edição de hoje. Quem tem `cursos:criar` sem `cursos:gerenciar` volta para a lista com "Curso criado." depois do Criar curso (como hoje). *(decisão de construção, registrada pelo Claude: mantém o acesso exatamente como hoje)*

### Telas que já existem
Alunos, Notas, Boas-vindas, QR, Certificados continuam com o conteúdo de hoje; só ganham o cabeçalho "← Voltar à turma".

## Menu
Grupo **Cursos**: Todos os cursos, Novo curso. Grupo **Turmas**: Todas as turmas, Nova turma, Matrícula rápida, Mapa de horários, Mensagem de boas-vindas. Mesmas permissões de hoje (`lib/menu-painel.js`). O item fica marcado também nas telas filhas (resumo e seções de curso → "Todos os cursos"; resumo da turma → "Todas as turmas").

## O que falta (cartões e coluna "Falta")
Curso: sem foto; sem texto completo; certificado sem conteúdo programático; nenhuma dúvida frequente. Turma: sem aulas cadastradas; alunos com pagamento pendente; abaixo do mínimo de alunos.

## IA — regras
- Toda ação de IA só **preenche** campos; nunca salva. Os campos preenchidos ganham a etiqueta **IA** até a pessoa salvar.
- "Começar com a IA" (curso): uma chamada que lê o texto livre e devolve os campos dos 3 passos; textos e dúvidas pela mesma função do "Escrever com IA" (`lib/ia-textos.js`, modelo de 3 parágrafos). Dados que a pessoa não deu ficam em branco (a IA não inventa preço, horas etc.).
- "Começar com a IA" (turma): devolve curso (entre os presenciais existentes), início, aulas, vagas, mínimo, instrutor. Datas e horários validados como em `validarTurma`.
- "Sugerir com IA" (conteúdo programático): a partir do nome e texto completo do curso; um item por linha.
- Respeitam o teto de custo da IA e mostram erro claro quando a IA não responde ("A IA não conseguiu agora; preencha à mão ou tente de novo").

## Assistente
- Criar curso: o cartão "Abrir Novo curso e preencher" abre `/cursos/novo` e preenche os 3 passos (como a caixa "Começar com a IA").
- Editar curso: abre a **seção** que contém os campos pedidos (preço → Valores; texto → Página no site; certificado → Certificado). Se os campos estão em mais de uma seção, o cartão mostra um botão por seção.
- Criar/editar turma: `/turmas/nova` e `/turmas/:id/editar` como hoje.
- O nome do botão de salvar citado pelo assistente segue a tela (Criar curso, Salvar valores, Salvar página, Criar turma, Salvar alterações…).
- **Caminhos do assistente atualizados (pedido do Matheus):** o catálogo de páginas (`lib/assistente-contexto.js`: `CATALOGO`, rotas da página atual, `EXTRAS`), o manual de uso que ele lê, os destinos dos cartões (`admin-assistente.js`: `DESTINO`, `destino()`, `acharFormulario()`) e os caminhos de edição (`alvoEdicao` em `lib/assistente-ferramentas.js`) passam a apontar para as telas novas: resumo do curso/turma, cada seção do curso, Novo curso em passos, menu novo ("Cursos › Todos os cursos", "Turmas › Todas as turmas"). Ele não pode mais citar o caminho antigo "Cursos e turmas › …". Um teste compara o catálogo do assistente com as rotas e o menu, para que uma mudança futura de caminho quebre o teste se o assistente não for atualizado junto.
- **Dúvidas num curso que já existe:** quando o assistente propõe dúvidas para um curso existente, elas aparecem na seção Dúvidas como sugestões com caixinha (igual ao "Sugerir dúvidas"), e a pessoa clica em "Adicionar as marcadas". *(decisão de construção, registrada pelo Claude)*

## Celular e tema
Tudo funciona a partir de 390 px (cartões um embaixo do outro, rodapé de salvar fixo) e nos dois temas.

## Deixado para quem constrói
- Como os passos do Novo curso guardam o que foi digitado entre um passo e outro (minha sugestão: um formulário só, com os passos mostrados/escondidos no navegador, e o servidor validando tudo no Criar curso).
- Nomes internos de rotas POST por seção e de arquivos/partials.
- O texto exato das dicas e mensagens, seguindo o tom dos prints.
- Em que ordem entregar (sugestão: menu + listas + resumos primeiro; depois seções; depois IA nova).
