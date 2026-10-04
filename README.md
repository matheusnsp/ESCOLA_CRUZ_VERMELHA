# Plataforma da Escola — Cruz Vermelha Brasileira (RJ)

Site do aluno e painel da secretaria da Escola de Educação e Saúde CVB-RJ, num app só.

| Endereço | O que é |
|---|---|
| escola.cursoscruzvermelha.org (e escola.cruzvermelhariodejaneiro.org) | Site do aluno: cursos, conta, inscrição e pagamento |
| secretaria.cursoscruzvermelha.org | Painel da secretaria (mesmo app, escolhido pelo subdomínio) |

Roda no **Render** (publica a `main` sozinho e roda `prisma migrate deploy` no build), com o banco
**Postgres no Supabase**, compartilhado pelos 3 serviços do Render. Como colocar no ar e a lista de
variáveis: [DEPLOY.md](DEPLOY.md).

## Stack

- **Node.js + Express**, páginas **EJS** renderizadas no servidor (sem etapa de build)
- **PostgreSQL + Prisma** (queries parametrizadas)
- **express-session + connect-pg-simple**: sessão em cookie `httpOnly`, guardada no Postgres
- **argon2id** para senhas, **zxcvbn** no servidor para a força da senha
- **Zod** na validação, **helmet** (+ CSP), **express-rate-limit**, CSRF por token de sessão
- **Únicopag** (PIX e cartão, duas contas), **Resend** (e-mails), **Supabase Storage** (fotos dos cursos)

## Como rodar no computador

Precisa de Node.js 20+ e de um Postgres com um banco vazio.

```bash
npm install
# crie o .env com pelo menos DATABASE_URL e SESSION_SECRET (openssl rand -hex 32);
# para o primeiro acesso da secretaria: SEED_ADMIN_EMAIL, SEED_ADMIN_SENHA
npm run db:migrate      # cria as tabelas
npm run db:seed         # configuração inicial e o usuário da secretaria (SEED_EXEMPLO=true: cursos de exemplo)
npm run dev
```

O site do aluno abre em `http://localhost:3000`. Com `ADMIN_PORT=3001` no `.env`, o painel abre em
`http://localhost:3001` (em produção o painel é pelo subdomínio `secretaria.`; não defina
`ADMIN_PORT` lá).

Sem `RESEND_API_KEY`, os e-mails (confirmação, senha, lembretes) não saem: aparecem no terminal.

## O que o sistema faz

**Site do aluno** (`src/routes/cursos.js`, `auth.js`, `painel.js`)
- Início, catálogo `/cursos` e página de cada curso, com as turmas abertas.
- Conta: cadastro com confirmação por e-mail, login, troca e recuperação de senha, Minha conta
  (inscrições, dados, segurança, excluir conta).
- Inscrição numa turma e pagamento pela Únicopag, à vista ou parcelado (taxa de inscrição e
  curso em cobranças separadas), por PIX ou cartão.
- Pesquisa de satisfação no fim do curso, arquivo de agenda (.ics), Política de Privacidade
  (`/privacidade`), aviso de cookies.

**Painel da secretaria** (`src/routes/admin.js`, `contas.js`)
- Painel inicial, Cursos, Turmas (com boas-vindas, notas, certificados e QR da pesquisa),
  Inscrições, Alunos, Pendentes (quem parou no meio), Horários (respostas do site da instituição),
  Matrícula rápida, Financeiro (por conta da Únicopag, com Excel, PDF e OFX), Contas a pagar,
  Pesquisa, Modelos de texto, Banimentos e Permissões por papel.
- Papéis: SECRETARIA, COORDENADOR, FINANCEIRO, CONSULTA e DEV; ALUNO é quem usa o site. As
  permissões de cada papel são editáveis no painel.

**Pagamento** (`src/lib/unicopag.js`, `src/routes/webhook.js`, `src/lib/status-pagamento.js`)
- Cada cobrança leva o endereço do aviso (`postback_url` = `APP_URL/webhook/unicopag`); não é
  preciso configurar webhook no painel da Únicopag.
- Duas contas: a da escola (`UNICOPAG_API_TOKEN`) cobra no site; a da instituição
  (`UNICOPAG_API_TOKEN_2`) só é lida, para a matrícula rápida. O Pagamento guarda a conta em
  `gateway` (`unicopag`, `unicopag-2` ou `manual`).

**Integrações**
- Site da instituição (cruzvermelhariodejaneiro.org): a aba Horários e a Matrícula rápida leem de
  lá quem pagou a inscrição e os dias e horários escolhidos (`SITE_HORARIOS_TOKEN`).
- Palácio Virtual (sistema da filial): registra cada certificado e devolve o código do QR de
  conferência (`REDACAO_URL`, `REDACAO_ESCOLA_TOKEN`).

## Rotinas automáticas (`src/server.js`)

Rodam nos 3 serviços; cada uma se protege para não repetir o efeito.

| Rotina | Quando | O que faz |
|---|---|---|
| Concluir turmas (`lib/concluir-turmas.js`) | ao subir e a cada hora | turma confirmada vira concluída no dia seguinte à última aula |
| Lembretes (`lib/lembretes.js`) | a cada 30 min | e-mail para quem pagou só a taxa: 1 h depois, 3 dias antes e na véspera |
| Boas-vindas (`lib/boas-vindas.js`) | a cada 15 min | mensagem da turma para quem pagou depois de a secretaria liberar |
| Pesquisa (`lib/pesquisa.js`) | a cada 15 min | e-mail da pesquisa logo depois da última aula |
| Reconciliação (`lib/reconciliacao.js`) | a cada 15 min | pergunta à Únicopag, na conta certa, a situação dos pagamentos pendentes dos últimos 7 dias cujo aviso se perdeu, e aplica a mesma regra do webhook |
| Visitas (`lib/visitas.js`) | a cada minuto | grava a contagem anônima de visitas do dia |

## Taxa de inscrição

Na tabela `Configuracao`, sem mexer no código:

- `matricula_modo` = `POR_CURSO` (padrão) · `POR_ALUNO` · `NENHUMA`
- `matricula_valor_padrao` = `99.00` (desde 30/09/2026; antes era 100,00)

Cada curso pode ter a sua `taxaMatricula`, que vale no lugar do padrão.

A tabela `Configuracao` também guarda extras que não pediram coluna nova (contas a pagar,
pesquisa, boas-vindas, visitas, matrícula rápida, extras de curso e turma): o banco é de produção e
as migrações só acrescentam.

## Scripts

| Comando | Para quê |
|---|---|
| `npm run db:deploy` | aplica as migrações (o Render faz no build) |
| `npm run db:seed` | configuração inicial e o usuário da secretaria |
| `npm run db:seed:limpar` | apaga os cursos de exemplo do seed |
| `npm run admin:desbloquear` | desbloqueia o acesso da secretaria |
| `node scripts/consultar-transacao.js <hash>` | mostra o detalhe de uma transação na Únicopag (motivo de recusa) |
| `node scripts/testar-emails.js [modelo]` | manda um e-mail de teste |
| `node scripts/criar-cursos-teste.js` | cria cursos de teste (só no banco local) |
