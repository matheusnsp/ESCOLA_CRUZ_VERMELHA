# Escola de Capacitação — Cruz Vermelha Brasileira (RJ)

Backend e área autenticada. Esta primeira fatia entrega o **esquema do banco** e o
**cadastro do aluno** já funcionando, com toda a lógica sensível no servidor.

## Stack

- **Node.js + Express** — servidor
- **EJS** — páginas renderizadas no servidor (sem etapa de build)
- **PostgreSQL + Prisma** — banco e ORM (queries parametrizadas → sem SQL injection)
- **express-session + connect-pg-simple** — sessão em cookie `httpOnly`, guardada no Postgres
- **argon2** — hash de senha (argon2id)
- **Zod** — validação de entrada no servidor
- **helmet** — cabeçalhos de segurança (+ CSP)
- **express-rate-limit** — limite de tentativas
- **CSRF** — token de sessão (synchronizer token), sem dependência extra

## Pré-requisitos

- Node.js 20 ou superior
- PostgreSQL rodando e um banco vazio criado

## Como rodar (passo a passo)

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
#    edite o .env: DATABASE_URL, SESSION_SECRET (gere com: openssl rand -hex 32),
#    e a senha do admin (SEED_ADMIN_SENHA)

# 3. Criar as tabelas no banco
npm run db:migrate

# 4. Popular dados iniciais (config de matrícula, admin e cursos)
npm run db:seed

# 5. Subir o servidor
npm run dev
```

Acesse `http://localhost:3000/cadastro`.

## O que já funciona

- `GET/POST /cadastro` — cria o aluno (validação, hash argon2id, papel ALUNO, consentimento LGPD). A conta nasce **não confirmada** e dispara um e-mail de confirmação.
- `GET /confirmar-email` — ativa a conta a partir do link (token de uso único, expira em 24h)
- `GET/POST /reenviar-confirmacao` — reenvia o link de confirmação
- `GET/POST /login` — autentica com sessão; **bloqueia o login enquanto o e-mail não for confirmado**; mensagem genérica e proteção anti-enumeração por timing; regenera a sessão no sucesso
- `POST /logout` — encerra a sessão
- `GET/POST /esqueci-senha` — envia link de redefinição; resposta sempre igual
- `GET/POST /redefinir-senha` — token de uso único, com hash no banco e expiração de 1 hora
- `GET /minha-conta` — área do aluno: lista as inscrições com status (exige login)
- `GET /cursos` — vitrine pública de cursos e turmas abertas
- `GET/POST /inscrever/:turmaId` — inscrição em uma turma (exige login); calcula curso + taxa de matrícula no servidor e cria a matrícula como PENDENTE
- `GET /admin` — painel da secretaria (exige login **e** papel SECRETARIA)
- Site institucional servido em `/`

Senhas passam por avaliação de força no **servidor** (biblioteca `zxcvbn`, exige
nível "Boa"), com uma barra de força no navegador como espelho visual.
Todas as rotas que mudam estado exigem token CSRF e passam por rate limiting.

> Observação: como o login agora exige e-mail confirmado, contas de aluno criadas
> antes desta etapa ficam bloqueadas. Para testar, crie uma conta nova. A conta da
> secretaria (do seed) já nasce confirmada.

### Sobre o e-mail (Resend)

Em desenvolvimento, deixe `RESEND_API_KEY` em branco no `.env`: os links (confirmação
e redefinição) são **impressos no console**. Para enviar de verdade, o Resend exige
um domínio verificado; para testes rápidos, use `EMAIL_REMETENTE="... <onboarding@resend.dev>"`
e envie para o e-mail da sua própria conta Resend.

## Taxa de matrícula (configurável e removível)

A regra fica na tabela `Configuracao`, sem precisar mexer no código:

- `matricula_modo` = `POR_CURSO` (padrão) · `POR_ALUNO` · `NENHUMA`
- `matricula_valor_padrao` = `100.00`

Além disso, cada curso pode ter sua própria `taxaMatricula` (sobrepõe o padrão).
Para remover a taxa, mude o modo para `NENHUMA` ou zere o valor.

## Próximas fatias

1. Turmas + inscrição/matrícula
2. Pagamento via gateway (Pix/cartão) + **webhook** que confirma e libera a vaga
3. Confirmação manual (dinheiro presencial + entrega do 1 kg de alimento)
4. Verificação de e-mail no cadastro
5. Área do aluno completa e painel da secretaria (com log de auditoria)

## Pontos a alinhar antes de publicar

- **Política de Privacidade** real, redigida com o jurídico/DPO (a rota `/privacidade` é um placeholder).
- A mensagem "acesso imediato" da home não vale para os cursos presenciais com data fixa nem para o pagamento em dinheiro — revisar o texto.
- Logo oficial, fotos, estatísticas e depoimentos reais (hoje são placeholders).
- Revisão de segurança humana (autenticação + pagamento + controle de acesso) antes do ar.
# ESCOLA_CRUZ_VERMELHA
# ESCOLA_CRUZ_VERMELHA
# ESCOLA_CRUZ_VERMELHA
