# Escola Digital, fase 3: webinários (ao vivo e gravados, com certificado)

Data: 2026-11-13 · Branch: `webinarios` · Base: `main` (depois dos PRs #130 e #132)

## Objetivo e porquê

A Escola Digital já vende **cursos online** e **e-books**. Agora entram os **webinários**: palestras curtas com data
marcada ou gravadas. A Escola **ainda não sabe** qual formato vai usar mais, então o mesmo webinário precisa funcionar
de três jeitos: **ao vivo**, **gravado** ou **ao vivo com a gravação depois**. Quem assiste ganha um **certificado de
participação**.

Decisões do Matheus (13/11):

| Pergunta | Resposta |
|---|---|
| Ao vivo ou gravado | **Os dois** ("não sabemos ainda, faz pra ao vivo e gravado") |
| Como construir | **A**: webinário "irmão" do e-book (curso escondido + turma online para pagamento) |
| Certificado | **Sim**, de participação |
| Quando ganha o certificado | **Palavra-código**: dita/mostrada no fim; a pessoa digita na página do webinário |

Regras que já valem na Escola Digital: **conta obrigatória** (página pública; inscrever, comprar, assistir e pegar o
certificado só com login) e **nunca mostrar vagas** (ocupadas ou restantes).

### Objetivos
- A secretaria cria um webinário em poucos minutos: título, descrição, capa, quem apresenta, data e hora (opcional),
  duração, link da transmissão (opcional), link da gravação (opcional), palavra-código, preço ou grátis.
- O aluno se inscreve (ou compra), recebe confirmação e lembretes, entra na transmissão pelo site, vê a gravação
  depois e pega o certificado com a palavra-código.
- O certificado é o **mesmo modelo** do curso online (assinaturas da aba Certificados, livro/registro, código e QR da
  Redação), com selo **WEBINÁRIO**.

### Fora (não-objetivos)
- Transmitir ou guardar vídeo no nosso servidor. A transmissão é no Zoom, Meet ou YouTube; a gravação fica no YouTube
  (não listado) ou no Vimeo, e o site só mostra (embed).
- Integração com a API do Zoom/YouTube (criar sala, puxar lista de presença), chat, perguntas, enquetes.
- Impedir que quem tem o link o repasse (YouTube não listado pode ser repassado; esconder de verdade exige Vimeo pago).
- Limite de inscrições (sem vagas na v1; ver §8).
- Webinário em lote para escolas; IA escrevendo webinário; estatísticas além de inscritos, presenças e vendas.

### Seria um fracasso se…
- O link da transmissão ou da gravação aparecesse no HTML para quem **não** tem acesso (visitante, não inscrito,
  pagamento pendente).
- Alguém conseguisse o certificado **sem** a palavra-código, ou tentando palavras sem limite.
- A página mostrasse qualquer número de vagas ou de inscritos.
- O horário aparecesse errado (tudo no fuso **America/Sao_Paulo**, como o resto do sistema).

## Abordagens consideradas

| | Como | Troca | |
|---|---|---|---|
| **A** | Tabela `Webinario` ligada a um **curso escondido**, como o e-book. Compra = matrícula na turma online. | Reaproveita página/compra/cupom/Financeiro; e-mails e horários são novos. | **Escolhida** |
| B | Curso online de uma tela só com o vídeo | Ganha progresso e certificado, mas o curso online não tem data/hora; o ao vivo ficaria forçado. | — |
| C | Transmissão dentro do site | Caro e pesado; Zoom/YouTube já fazem bem. | — |

## 1. Modelo

- Tabela nova **`Webinario`**: `id`, `cursoId` (único, o curso escondido), `apresentador` (texto, opcional),
  `inicioEm` (DateTime, **opcional**: vazio = só gravado), `duracaoMin` (Int, obrigatório, > 0),
  `linkAoVivo` (texto, opcional, `https://`), `gravacaoUrl` (texto, opcional, embed já normalizado),
  `palavraCodigo` (texto, obrigatório para publicar), `precoOnline` (Decimal), `gratuito` (Bool),
  `maxParcelas` (Int, padrão 1), `publicado` (Bool, padrão false), `ordemVitrine` (Int, padrão 0),
  `gravacaoAvisadaEm` (DateTime, opcional), `criadoEm`, `atualizadoEm`.
- **Curso escondido** (`ativo: false`), como o e-book: nome, descrição curta, descrição longa, capa (`imagemUrl`) e
  dúvidas frequentes (`FaqCurso`). `cargaHoraria` do curso = duração arredondada para cima, em horas (vai no
  certificado). Some de todas as listas de curso pelo mesmo filtro do e-book, agora `ebook: null, webinario: null`
  (relação 1–1 opcional `Curso.webinario`), em todos os lugares onde hoje está `ebook: null`.
- **Acesso** (igual ao e-book): grátis = linha em **`InscricaoWebinario`** (`webinarioId`, `usuarioId`, `criadoEm`,
  `lembrete24hEm`, `lembrete1hEm`; único por par). Pago = **`Matricula` paga** na turma online do curso escondido;
  quando o pagamento confirma, cria-se também a `InscricaoWebinario` (é ela que guia os lembretes, para os dois casos).
- **Presença**: tabela **`PresencaWebinario`** (`id`, `webinarioId`, `usuarioId`, `confirmadaEm`; único por par). Só
  existe depois da palavra-código certa. É o "dono" do número do certificado: `reservarNumero(presenca.id,
  'PresencaWebinario', livro)`.
- **Tentativas** da palavra-código: tabela `TentativaPalavraWebinario` (`webinarioId`, `usuarioId`, `criadoEm`).
- Exclusão de conta (`lib/excluir-conta.js`): inscrição, presença e tentativas saem em cascata com o usuário.
- **Cupons** (`CupomEad`): campo novo `webinarioId`. Mesma regra do e-book: com `webinarioId` vale só para ele; sem
  curso/e-book/webinário, vale para todos. O seletor "Vale para" passa a listar webinários.

## 2. Painel: modo Online → Webinários

Mesma permissão dos cursos online e e-books. Link "Webinários" no menu do modo Online, depois de "E-books".

- **Lista**: capa, título, quando ("20/11/2026 às 19h" / "Gravado"), preço ou "Grátis", publicado/rascunho,
  inscritos, presenças, vendas pagas, ordem (↑ ↓).
- **Formulário** (criar/editar): título, descrição curta, descrição longa, capa (envio, como o e-book), apresentador,
  data e hora de início (opcional), duração em minutos, link da transmissão, link da gravação (aceita os mesmos links
  de YouTube/Vimeo das telas do curso online: `normalizarVideo` de `lib/ead.js`; link inválido é recusado com a mesma
  mensagem), palavra-código, grátis/preço/parcelas, publicado, dúvidas frequentes.
  - Para **publicar**: precisa de palavra-código e de **data de início ou gravação** (um dos dois).
  - Palavra-código: guardada como digitada; comparação ignora maiúsculas, acentos e espaços nas pontas.
    Dica no formulário: "Combine com quem apresenta: falar e mostrar na tela perto do fim. Se houver gravação, a
    palavra precisa aparecer nela."
- **Inscritos** (página do webinário): nome, e-mail, inscrito em, forma (grátis / pago), presença (sim, com data, ou
  não), link do certificado de quem tem presença; botão **Exportar CSV**.
- **Excluir**: só sem inscrições, compras (nem pendentes) e cupons, como o e-book; senão, "despublique".
- Ao salvar uma `gravacaoUrl` pela primeira vez **depois** do fim do ao vivo, com inscritos: e-mail "A gravação já
  está disponível" para os inscritos (uma vez só; marca `gravacaoAvisadaEm`).

## 3. Site: página do webinário

Endereço: `/escola-digital/webinario/<nome-sem-acento>`. Mesmo visual da página do e-book (`ead.css`, topo/fim).
Público lê: título, descrição, capa, apresentador, data/hora ou "Gravado", duração, preço, dúvidas. Nada de vagas.

Janela do ao vivo: **abre 30 min antes** de `inicioEm` e **fecha 30 min depois** de `inicioEm + duracaoMin`.

O cartão da direita muda conforme a situação (de cima para baixo, vale a primeira que bater):

| Situação | Mostra |
|---|---|
| Sem login | "Criar conta e inscrever-se" / "Já tenho conta" (pago: "Criar conta e comprar"); volta para a página depois |
| Ao vivo já encerrado (depois da janela), sem gravação, sem acesso | "Este webinário já aconteceu. A gravação ainda não está disponível." Sem inscrição nem compra (a rota de comprar/inscrever também recusa). Quando a gravação for salva, volta a abrir. |
| Logado, sem acesso, grátis | Botão **Inscrever-se** |
| Logado, sem acesso, pago | Preço, cupom, PIX/cartão (igual ao e-book) |
| Pagamento pendente | "Falta só confirmar o pagamento", link para o pagamento |
| Com acesso, antes da janela | "Você está inscrito · 20/11 às 19h", **Adicionar à agenda** (.ics) |
| Com acesso, dentro da janela, com `linkAoVivo` | **Entrar na transmissão** (abre o link em nova aba) |
| Com acesso, dentro da janela, sem `linkAoVivo` | "O link da transmissão aparece aqui assim que a Escola cadastrar." |
| Com acesso, depois da janela, com gravação | A **gravação** embutida na página |
| Com acesso, depois da janela, sem gravação | "A gravação ficará disponível aqui. Avisaremos por e-mail." |
| Com acesso, só gravado (sem `inicioEm`) | A gravação embutida |

- Os links (`linkAoVivo`, `gravacaoUrl`) **só vão para o HTML** quando a pessoa tem acesso e a situação acima os mostra.
  O botão "Entrar na transmissão" passa por uma rota do site (`…/entrar-na-transmissao`) que confere acesso e janela e
  redireciona; o link não fica na página.
- **Palavra-código** (bloco abaixo do cartão), para quem tem acesso, a partir do **início** do ao vivo (ou sempre, se
  só gravado):
  - Campo "Palavra-código" + "Pegar certificado". Certa: grava a presença e mostra **Ver certificado**. Errada:
    "Palavra-código não confere." **Máximo 10 tentativas por pessoa por webinário por hora**; passou: "Muitas
    tentativas. Tente de novo daqui a pouco."
  - Quem já tem presença vê só "Ver certificado".
- Despublicado continua aberto para quem já tem acesso (como o e-book); Escola Digital desligada idem.

## 4. Certificado de participação

- Rota do site `/escola-digital/webinario/<end>/certificado` (login + presença). Mesma view
  `admin/certificado-imprimir.ejs` com a barra do aluno, mesmo número (livro/registro), mesmo registro na Redação
  (código + QR; falhar não impede o certificado), assinaturas pela regra do online (`assinaturasDoCurso` + "com/sem
  assinatura" da aba Certificados).
- Diferenças do certificado do curso online:
  - Selo **WEBINÁRIO** no lugar de "CURSO ONLINE".
  - Texto: "Portador(a) do documento …, **participou do webinário <TÍTULO>**, promovido pela Cruz Vermelha
    Brasileira – Filial Rio de Janeiro, **realizado em 20/11/2026**, com duração de **02 horas**." Só gravado: "…
    na modalidade gravada, com duração de …". A data do ao vivo vale também para quem assistiu à gravação depois.
  - Sem a ressalva "Capacitação teórica…" do curso online.
  - Verso: título, apresentador (se houver), data (ou "Gravado"), duração; sem "Conteúdo programático".
- E-mail "Seu certificado está pronto" com o link, **só na primeira** presença (mesmo padrão do curso online).
- Aparece em **Minha conta**, numa seção "Webinários": título, quando, link para a página e, com presença, "Certificado".

## 5. E-mails (Resend, como os demais)

| Quando | Para | Conteúdo |
|---|---|---|
| Inscrição (grátis) ou pagamento confirmado | o aluno | Confirmação, data/hora (ou "já disponível" se gravado), link da página, anexo .ics se ao vivo |
| 24 h antes do início | inscritos | Lembrete com data/hora e link da página |
| 1 h antes do início | inscritos | Lembrete "começa em 1 hora" com link da página |
| Data/hora mudou (§8) | inscritos | Novo horário, link da página, novo .ics |
| Gravação salva depois do fim (§2) | inscritos | "A gravação já está disponível" |
| Primeira presença | o aluno | Certificado pronto |

- Os lembretes saem por um job no `server.js` **a cada 10 min** (como os outros `setInterval(...).unref()`), marcando
  `lembrete24hEm` / `lembrete1hEm` para não repetir. Quem se inscreve a menos de 24 h não recebe o de 24 h; a menos
  de 1 h, nenhum (a confirmação basta). Os e-mails levam **o link da página**, nunca o link da transmissão.

## 6. Vitrine

- Fileira **"Webinários"** em `/escola-digital`, depois de "E-books". Só aparece com webinário publicado.
- Ordem: primeiro os **próximos** (início no futuro, do mais perto ao mais longe), depois os **já realizados com
  gravação** e os só gravados (por `ordemVitrine`). Realizado **sem** gravação sai da vitrine.
- Cartão: capa, título, "Ao vivo · 20/11 às 19h" ou "Gravado", preço ou "Grátis"; "Você está inscrito" para quem tem
  acesso.

## 7. Testes (node:test, como os demais)

- Modelo/filtros: curso escondido de webinário fora das listas de curso (as mesmas do e-book) e do seletor de cursos.
- Painel: publicar sem palavra-código recusa; publicar sem data e sem gravação recusa; gravação com link inválido
  recusa; excluir com inscrição recusa; gravação nova após o fim dispara o aviso uma vez só.
- Página, por situação (tabela do §3), com relógio fixo: visitante → "Criar conta"; grátis logado → "Inscrever-se";
  inscrito antes → "Você está inscrito" e **sem** `linkAoVivo` no HTML; na janela → "Entrar na transmissão" e ainda
  sem o link no HTML; rota de entrar fora da janela ou sem acesso → volta para a página; depois com gravação → embed;
  pendente → sem links. Nenhum texto de vaga ("vaga", "restam", "ocupad").
- Palavra-código: errada → mensagem; certa (com maiúsculas/acentos diferentes) → presença; 11ª tentativa na hora →
  bloqueio; antes do início do ao vivo → campo não aparece; sem acesso → recusa.
- Certificado: sem presença → volta; com presença → selo WEBINÁRIO, "participou do webinário", data do ao vivo, duração;
  só gravado → "modalidade gravada"; número reservado uma vez (duas aberturas, mesmo registro); e-mail só na primeira.
- Lembretes: 24 h e 1 h saem uma vez; inscrito a 30 min do início não recebe; e-mail sem link da transmissão.
- Vitrine: fileira some sem publicados; próximos antes dos gravados; realizado sem gravação fora.
- Cupom: de webinário só para ele; geral vale; de e-book não vale para webinário.

## 8. Decisões minhas (o Matheus pode mudar)

- Janela de 30 min antes / 30 min depois para o botão da transmissão.
- 10 tentativas por hora na palavra-código.
- Lembretes 24 h e 1 h antes; job a cada 10 min.
- Sem limite de inscrições na v1 (o Zoom grátis tem limite de participantes; se precisar, um "Inscrições encerradas"
  sem mostrar números entra depois).
- Certificado de quem viu a gravação leva a data do ao vivo.
- O webinário pago segue o padrão de parcelas do e-book (`maxParcelas`, padrão 1).

- **Estorno ou cancelamento** de webinário pago: a pessoa perde o acesso (situação "cancelado", como no e-book).
  Os lembretes conferem o acesso **na hora de enviar** (inscrição de quem perdeu o acesso não recebe nada). Presença e
  certificado já emitidos **continuam válidos** (número reservado não volta, como no curso online).
- **Grátis ↔ pago**: não dá para trocar depois que houver inscrição ou compra (o formulário trava o campo e explica).
- **Mudança de data/hora** com inscritos: permitida; zera `lembrete24hEm`/`lembrete1hEm` dos inscritos e manda e-mail
  "O webinário mudou de horário" com o novo .ics. Certificados já emitidos ficam com a data antiga (só existem depois do
  início, então só muda se a data for trocada depois do evento).
- **Link da transmissão** não é obrigatório para publicar (pode chegar no dia); na janela sem link, aviso no cartão.
- **Exclusão de conta**: matrícula paga de webinário entra na mesma exceção da de e-book em `lib/excluir-conta.js`
  (a turma online nunca "termina" e não pode travar a exclusão).
- **Tentativas da palavra-código**: tabela `TentativaPalavraWebinario` (o `limite-cupom` guarda em memória e zera no
  reinício).

## 9. O que fica com quem constrói

Nomes de arquivos/rotas além dos citados, divisão em libs (sugestão: `lib/webinario.js` espelhando `lib/ebook.js`,
`routes/webinarios.js` e `routes/ead-webinarios.js` espelhando os de e-book), layout fino da página e do painel dentro
do visual existente, texto exato dos e-mails no tom dos atuais.
