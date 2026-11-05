# EAD: etapa 3, certificado do curso online e cartão de bolso. Especificação

Data: 06/11/2026. Decidida com o usuário na conversa. Sai do branch da etapa 2 (`ead-aluno`, PR #93), que
sai da etapa 1 (`ead-estrutura-conteudo`, PR #92). Branch: `ead-certificado`.

## 1. Objetivo

Quem conclui o curso online recebe, sem ninguém da secretaria fazer nada:
1. o **certificado** no mesmo modelo oficial do presencial (moldura, frente e verso), com o selo **CURSO
   ONLINE**, a ressalva de que não inclui prática em manequim, **Livro/Registro na mesma sequência da escola** e
   **registro na Redação** (código e QR de conferência);
2. o **cartão de bolso** em PDF, gerado a partir das telas do curso;
3. um **e-mail** avisando que o certificado está pronto, com o link.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Registro | **Igual ao presencial, com a marca de online.** Mesmo Livro e mesma sequência de Registro (a mesma trava de número único de `lib/certificado.js`) e registro na Redação (`lib/redacao.js`). Na Redação, o curso vai como "`<nome do curso>` (online)". |
| Formato do certificado | **A mesma página do presencial** (`views/admin/certificado-imprimir.ejs` + `public/certificado.css`), aberta pelo aluno. "Baixar PDF" = "Salvar como PDF" do navegador. Nada de PDF gerado no servidor para o certificado (evita manter dois layouts). |
| Texto | **Com ressalva.** Frente: selo "CURSO ONLINE"; "…concluiu o **Curso Livre de `<NOME>`**, na **modalidade a distância (100% online)**, ministrado pela Cruz Vermelha Brasileira – Filial Rio de Janeiro, com carga horária de `<NN> horas`, **concluído em `dd/mm/aaaa`**." e, no rodapé: "Capacitação teórica. Não inclui treinamento prático em manequim, oferecido nos cursos presenciais da Escola." Verso: o conteúdo programático são os **títulos dos módulos** do curso online, na ordem do aluno (o final por último). |
| Assinaturas | As escolhidas para o curso (`escolhaDoCurso`, `lib/certificado.js`), **sem o instrutor** (o online não tem turma). Sem nenhuma escolha válida, a primeira da lista. |
| Cartão de bolso | **Gerado pelo sistema** com `pdfkit` (já é dependência), **A6 retrato**. Capa + **uma página por tela** (título, foto, passos numerados da revisão rápida, alerta), agrupadas por módulo. As fotos (WEBP) são convertidas para JPEG com `sharp` na hora. Gerado a cada pedido, sempre com o conteúdo atual. |
| Quando | O certificado é emitido quando o curso fica concluído: na hora em que a conclusão acontece (fim de tentativa, de cenário ou de tela) e, se algo falhar, na próxima vez que a página do certificado for aberta. Reabrir nunca gera outro número. |
| Link de teste | Continua sendo o único acesso nesta etapa. O certificado sai **com número real e Redação** também pelo link de teste (decisão do usuário: "igual ao presencial"). |
| Banco | **Nenhuma tabela nem coluna nova.** Livro/Registro e código da Redação ficam no `LogAuditoria`, como no presencial, com o id do `AlunoCursoEad` no lugar do id da matrícula (ids uuid não colidem). |
| Fora desta etapa | Matrícula e pagamento do online, "Meus certificados" na Minha conta e lista de concluintes no painel (etapa 4); certificado presencial (não muda). |

## 3. Certificado (`src/lib/ead-certificado.js`)

### 3.1 Numeração (em `lib/certificado.js`)

- Separar de `numerar(matriculaIds)` a parte que reserva o número: `reservarNumero(alvoId, alvoTipo, livro,
  atorId)`, que cria os dois registros no `LogAuditoria` (`cert-num-<livro>-<registro>` e
  `certificado-<alvoId>`) com as mesmas tentativas contra `P2002`. `numerar` passa a usá-la com
  `alvoTipo 'Matricula'`, e o comportamento do presencial **não muda** (mesmos ids, mesmas ações
  `CERTIFICADO_NUMERO`/`CERTIFICADO_EMITIDO`).
- `numerarEad(alunoCursoId, atorId)`: se já existe `certificado-<alunoCursoId>`, não faz nada; senão
  `reservarNumero(alunoCursoId, 'AlunoCursoEad', livro atual, atorId)`. Devolve `{ livro, registro, emitidoEm }`.
- Uma função `lerNumero(alvoId)` → `{ livro, registro, emitidoEm } | null`, para não depender do formato do log fora de `lib/certificado.js`.

### 3.2 Emitir (idempotente)

`emitirCertificadoEad(alunoCursoId, { enviarEmail })` → `{ dados, verificacao | null, avisoRedacao | null }`:
1. Confere que o `AlunoCursoEad` tem `concluidoEm`. Sem isso, devolve `null` (não emite).
2. `numerarEad`.
3. Redação: `registrarCertificados([{ matriculaId: alunoCursoId, turmaId: cursoOnlineId, nome, curso: '<nome> (online)', cargaHoraria, emitidoEm }])`.
   Falha ou não configurada: segue sem QR, com `avisoRedacao` (o mesmo texto do presencial).
4. Monta `dados` no formato de `dadosDoCertificado`, mais `online: true`, `concluidoEm` (data br), e no lugar
   de `periodo` a frase "concluído em dd/mm/aaaa". `conteudo` são os títulos dos módulos.
5. `enviarEmail: true` e é a **primeira** emissão (o número acabou de ser criado): envia
   `enviarCertificadoEadPronto(email, nome, { curso, link })` (`lib/email.js`). O link é a página do
   certificado no link de teste. Envio que falha não impede nada (só log).

### 3.3 Quem chama

- Ao concluir o curso: o lugar onde hoje a etapa 2 chama `marcarCursoConcluido` passa a chamar também
  `emitirCertificadoEad(id, { enviarEmail: true })`, **sem esperar** (não atrasa a resposta; erro só no log).
- Em `contexto()` (`routes/ead-teste.js`), quando `estado.concluido` e `AlunoCursoEad.concluidoEm` está
  vazio: grava `concluidoEm` e dispara a emissão do mesmo jeito. Cobre o curso que termina numa tela vista
  (pendência da etapa 2).
- A página do certificado chama `emitirCertificadoEad(id, { enviarEmail: false })` (refaz o que faltou:
  número ou Redação).

### 3.4 Texto no modelo

`certificado-imprimir.ejs` ganha, só quando `c.online`:
- o selo "CURSO ONLINE" acima de "Certificado" (fita vermelha, maiúsculas);
- a frase com "na modalidade a distância (100% online)" e "concluído em dd/mm/aaaa" no lugar do período;
- a ressalva em itálico, em fonte menor, acima das assinaturas.

Sem `c.online`, o HTML gerado para o presencial é **o mesmo de hoje** (teste: renderizar uma matrícula
presencial antes e depois e comparar).

## 4. Cartão de bolso (`src/lib/ead-cartao.js`)

`gerarCartao(cursoOnlineId)` → `Buffer` (PDF), com `pdfkit`, páginas **A6 retrato** (105 × 148 mm), margens de 10 mm:

- **Capa:** faixa vermelha com "CRUZ VERMELHA BRASILEIRA · RIO DE JANEIRO", logo
  (`public/img/logo-email.png`), "Cartão de bolso", nome do curso e o lema
  **OLHAR · LIGAR · CUIDAR** em três blocos vermelhos.
- **Por módulo** (comuns na ordem, sem o final): uma linha de seção "Módulo N · Título" no topo da primeira
  página do módulo; depois **uma página por tela** que tenha revisão rápida ou alerta:
  - título da tela (negrito, 13 pt);
  - foto da tela (até 35 mm de altura, cortada para caber), se houver;
  - os itens da revisão rápida como passos numerados (círculo vermelho com o número, frase ao lado, 9,5 pt);
  - o alerta numa caixa de borda vermelha ("ALERTA" + texto).
  - Tela sem revisão e sem alerta não entra.
- **Rodapé** de cada página: "Escola de Educação e Saúde · CVB-RJ" e "Em emergência: 192 (SAMU) · 193 (Bombeiros)".
- Fontes: as embutidas do pdfkit (Helvetica), para não depender de arquivo de fonte.
- Fotos: lidas de `/uploads/...` (disco), `/img/...` (`src/public`) ou URL `https://` do Supabase (fetch com
  limite de 3 MB e 8 s); convertidas com `sharp(...).resize(800).jpeg({ quality: 75 })`. Foto que falha é
  pulada (o cartão sai sem ela).
- Nome do arquivo: `cartao-de-bolso-<slug do curso>.pdf`.

## 5. Telas e rotas

| Rota | O quê |
|---|---|
| `GET /ead-teste/:c/certificado` | Exige login de aluno (`pedirLogin`). Curso não concluído ⇒ redireciona para a capa. Senão `emitirCertificadoEad` e renderiza o modelo (`certificado-imprimir.ejs`) com uma barra própria do aluno no topo: "Baixar PDF / imprimir" (o botão que já existe chama `window.print()`), "Baixar cartão de bolso" e "Voltar ao curso". A barra não sai na impressão. |
| `GET /ead-teste/:c/cartao-de-bolso.pdf` | Exige login de aluno **e curso concluído** (senão capa). `Content-Type: application/pdf`, `Content-Disposition: attachment`. |
| Capa e resultado finais | Com o curso concluído, o cartão "Seu progresso" da capa troca o texto por "Curso concluído" + botões **"Ver meu certificado"** e **"Baixar cartão de bolso"**. O resultado do último cenário e do último quiz também mostram "Ver meu certificado". |
| Painel: `GET /ead/curso/:id/cartao-de-bolso.pdf` | DEV, para conferir o cartão do curso sem concluir. No `curso.ejs`, botão "Baixar cartão de bolso (prévia)". |

A barra do aluno na página do certificado é uma variação do `cert-barra` que já existe (sem o texto da
impressora frente e verso, que é da secretaria). O botão de imprimir continua sendo o script que já existe na view.

## 6. E-mail (`lib/email.js`)

`enviarCertificadoEadPronto(email, nome, { curso, link })`: assunto "Seu certificado está pronto: `<curso>`".
Corpo: parabéns pela conclusão, a ressalva (capacitação teórica; a prática em manequim está nos cursos
presenciais da Escola), botão "Ver meu certificado" (link) e a menção ao cartão de bolso. Mesmo layout dos
outros e-mails do arquivo. Sem `RESEND_API_KEY`, aparece no terminal como os demais.

## 7. Não muda

Certificado presencial (HTML idêntico ao de hoje; teste em 3.4), numeração presencial (mesmos ids e ações),
Redação (mesma chamada), login e cadastro, regras de progresso da etapa 2.

## 8. Verificação

- Testes de unidade:
  - `reservarNumero` / `numerar` (presencial) / `numerarEad`: sequência compartilhada (presencial 1, online 2,
    presencial 3); `numerarEad` duas vezes ⇒ mesmo número; dois `numerarEad` em paralelo de alunos diferentes ⇒ números diferentes.
  - `emitirCertificadoEad`: sem `concluidoEm` ⇒ null; primeira chamada envia o e-mail e a segunda não; Redação
    não configurada ⇒ `avisoRedacao 'nao_configurado'`, sem QR; com uma Redação falsa local (servidor HTTP no
    teste devolvendo um código válido) ⇒ `verificacao.codigo` e o log `cert-redacao-<alunoCursoId>`.
  - Texto: frente com "CURSO ONLINE", "modalidade a distância (100% online)", "concluído em" e a ressalva;
    presencial renderizado igual ao de antes (comparação do HTML).
  - `gerarCartao`: PDF válido (`%PDF-`), número de páginas = 1 capa + telas com revisão ou alerta; foto WEBP
    entra (conversão); foto quebrada é pulada sem erro.
  - Rotas: certificado e cartão sem login ⇒ login; logado sem concluir ⇒ capa; concluído ⇒ 200 e `application/pdf`.
- Ciclo real (390 px e 1280 px), com o curso de teste: concluir ⇒ e-mail no terminal ⇒ capa com "Ver meu
  certificado" ⇒ certificado com selo, ressalva, Livro/Registro e (com a Redação falsa) QR ⇒ "Salvar como PDF"
  do navegador gera 2 páginas A4 deitadas (captura do PDF impresso pelo Playwright) ⇒ cartão baixado e aberto
  (capturas de 2–3 páginas).
- Presencial: imprimir certificados de uma turma de exemplo ⇒ igual ao de antes (mesmo Livro/Registro seguindo a sequência).
- PR para `ead-aluno` (etapa 2), sem merge.
