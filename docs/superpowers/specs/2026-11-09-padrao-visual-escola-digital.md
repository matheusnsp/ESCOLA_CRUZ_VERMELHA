# Escola Digital com o padrão do site presencial (e cartão de bolso novo)

Data: 2026-11-09 · Branch: `escola-digital-padrao` · Base: `ead-cartoes-alinhados` (PR #120, mexe no mesmo `ead.css`)

## Objetivo

Pedido do Matheus: "ajeitar esse cartão de bolso… verifique o site inteiro, e otimize pra tudo ficar padronizado… da
plataforma digital… copiando do presencial". A vistoria (17 páginas, computador e celular, lado a lado com o
presencial) achou os pontos abaixo. O resto (header, rodapé, capa, módulos, aula, teste, 404) já está no padrão.

## 1. Cartão de bolso: 1 página por módulo

Decisão do Matheus: **1 página por módulo** (hoje são 41 páginas, uma por tela, quase vazias).

- Formato continua A6 retrato, gerado na hora a partir do conteúdo atual (`src/lib/ead-cartao.js`).
- **Capa**: faixa vermelha "CRUZ VERMELHA BRASILEIRA · RIO DE JANEIRO"; logo atual do site
  (`/img/logo-cvb-rj.webp`, convertido com o sharp) ao lado de **ESCOLA DE EDUCAÇÃO / E SAÚDE CVB-RJ** (como no header);
  "CARTÃO DE BOLSO"; nome do curso; os três blocos OLHAR · LIGAR · CUIDAR; "Em emergência: 192 (SAMU) · 193 (Bombeiros)".
- **Uma página por módulo** (sem o módulo final de cenários), na ordem do aluno:
  - número grande em vermelho ("01") + "MÓDULO 1" + título do módulo;
  - foto de abertura do módulo (`fotoIntroUrl`) numa faixa de ~25 mm, se houver;
  - **passos principais**: o 1º item da revisão rápida de cada tela do módulo que tenha revisão, na ordem, no máximo 6,
    numerados com bolinha vermelha;
  - **alerta**: o 1º alerta do módulo (na ordem das telas), numa caixa rosa com faixa vermelha à esquerda (como os
    alertas da aula);
  - rodapé de sempre (Escola · CVB-RJ / emergência).
- Módulo sem revisão e sem alerta: a página sai só com o título e a foto (não some, para a numeração bater com o curso).
- Cores e fonte do site: vermelho `#d9081f`, tinta `#141414`, cinza `#6b6b6b`; fonte **Inter** (arquivos TTF da Inter,
  licença OFL, guardados no projeto em `src/assets/fonts/`), com Helvetica de reserva se o arquivo faltar.
- Textos longos são cortados com "…" para caber na página (nunca passa para a página seguinte).

## 2. Avisos da conta iguais aos do presencial

"Senha provisória" e "Complete seu cadastro" no curso: hoje caixas brancas só com texto e link. Passam a ser como em
"Minha conta" do presencial: caixa rosa (`#fff5f5`, borda `#f3c6cb`), ícone vermelho à esquerda (chave / triângulo), o
texto e um **botão vermelho** à direita ("Trocar senha", "Completar agora"); no celular o botão fica embaixo, largura
toda. O aviso verde de "dúvida respondida" segue o mesmo desenho, em verde.

## 3. Header com "Menu do curso" no computador

Com "Menu do curso" + "Olá, nome" + "Ver cursos", os links do menu quebravam em duas linhas. Links do menu nunca quebram
(`white-space: nowrap`); quando não cabem (até 1280 px com "Menu do curso"), o menu vai para o ☰ como no celular.

## 4. Opções do cenário iguais às perguntas do teste

Hoje: botões com contorno vermelho, texto vermelho centralizado em caixa alta espaçada. Passam a ser como as opções do
teste: caixa branca, borda cinza (`--ln`), texto escuro à esquerda, peso 600; passar o mouse = borda vermelha. Depois de
escolher: certa = verde, errada = rosa com borda vermelha, as outras apagadas (como hoje).

## 5. Ajustes menores

- Topo do cenário no celular: "CENÁRIO · MÓDULO 8" não quebra (o rótulo fica em uma linha; o título quebra se precisar).
- "Dúvidas desta aula": o quadro ocupa a mesma largura da aula, alinhado com ela.
- Selo "Rascunho" (só no link de teste): sai do amarelo, fica cinza claro (`#f1efeb`, texto `#6b6b6b`); "Validado"
  continua verde.

## 6. Fora

Vitrine `/escola-digital` (desligada no ambiente local; já tem o visual do site desde a vitrine); conteúdo dos cursos;
certificado (já segue o modelo do presencial).

## 7. Testes

- Cartão: curso com 7 módulos + final → PDF com 8 páginas (capa + 7); página do módulo tem no máximo 6 passos e o
  1º alerta; módulo sem revisão/alerta ainda tem página; texto gigante não cria página extra; logo e Inter carregam.
- CSS/HTML: avisos com botão e classe nova, sem texto solto; `.ea-opcao` sem `text-align: center` nem borda vermelha;
  `.ea-menu a` com `nowrap`; selo sem amarelo; quadro de dúvidas com a largura da aula.
- Prints: cartão (capa + 2 módulos), avisos (computador e celular), cenário, header 1280 com "Menu do curso".
