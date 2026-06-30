# Como colocar no ar (Render ou Railway)

Seu app é um servidor Node persistente (Express + sessão + upload + Postgres).
Plataformas de servidor persistente são o encaixe natural. Abaixo, os dois caminhos.

---

## Antes de tudo: subir o código pro GitHub

1. Crie um repositório no GitHub (privado tudo bem).
2. Na pasta do projeto:
   ```
   git init
   git add .
   git commit -m "Deploy inicial"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git
   git push -u origin main
   ```
3. **Confirme que o `.env` NÃO foi enviado** (ele tem segredos). Deve haver um `.gitignore` com `.env` e `node_modules`. Se não houver, crie antes do commit.

---

## Opção A — Render (recomendado; tem o `render.yaml` pronto)

### Caminho rápido (Blueprint)
1. Render → **New +** → **Blueprint** → conecte o repositório.
2. O Render lê o `render.yaml` e cria **o site + o banco + o disco** de uma vez.
3. Preencha as variáveis marcadas como `sync: false` (veja a lista abaixo).
4. Deploy. A primeira build roda `prisma migrate deploy` (cria as tabelas).

### Caminho manual (sem blueprint)
1. **New + → PostgreSQL** → crie o banco. Copie a *Internal Database URL*.
2. **New + → Web Service** → conecte o repo. Configure:
   - **Build Command:** `npm install && npx prisma migrate deploy`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/`
3. Em **Environment**, adicione as variáveis (abaixo).
4. (Opcional, recomendado) **Disks** → adicione um disco de 1 GB em `/var/data/uploads`
   e defina `UPLOADS_DIR=/var/data/uploads`. Sem isso, as fotos enviadas somem a cada deploy.

---

## Opção B — Railway

1. Railway → **New Project** → **Deploy from GitHub repo**.
2. **+ New → Database → PostgreSQL.** O Railway injeta a variável `DATABASE_URL` automaticamente.
3. No serviço do site, aba **Settings**:
   - **Build Command:** `npm install && npx prisma migrate deploy`
   - **Start Command:** `npm start`
4. Aba **Variables**: adicione as demais (abaixo). O Railway define `PORT` sozinho.
5. Para uploads persistentes: **+ New → Volume**, monte num caminho (ex.: `/data/uploads`)
   e defina `UPLOADS_DIR=/data/uploads`.

---

## Variáveis de ambiente (as duas plataformas)

| Variável            | Valor / observação                                                        |
|---------------------|---------------------------------------------------------------------------|
| `NODE_ENV`          | `production`                                                              |
| `DATABASE_URL`      | a connection string do Postgres gerenciado                                |
| `DATABASE_SSL`      | `false` no Postgres interno do Render/Railway · `true` no Neon/Supabase   |
| `SESSION_SECRET`    | um segredo longo e aleatório                                              |
| `APP_URL`           | a URL pública final (ex.: `https://escola-cvb.onrender.com`)              |
| `UPLOADS_DIR`       | o caminho do disco/volume (ex.: `/var/data/uploads`)                      |
| `ADMIN_HOST`        | `secretaria` (subdomínio do painel)                                       |
| `RESEND_API_KEY`    | sua chave da Resend (sem ela, o link de confirmação só aparece no log)    |
| `EMAIL_REMETENTE`   | e-mail remetente verificado na Resend                                     |
| `SEED_ADMIN_EMAIL`  | e-mail do primeiro acesso da secretaria                                   |
| `SEED_ADMIN_SENHA`  | senha forte do primeiro acesso (troque depois)                            |

**Não defina `ADMIN_PORT` em produção.** Em produção o painel é acessado por subdomínio,
num único processo. (`ADMIN_PORT` é só pro seu ambiente local, onde o painel sobe na 3001.)

---

## Primeiro acesso da secretaria

As migrations criam as tabelas, mas **não criam o usuário da secretaria** sozinhas.
Depois do primeiro deploy, rode o seed uma vez (com `SEED_ADMIN_*` definidos):

- **Render:** aba **Shell** do serviço → `npm run db:seed`
- **Railway:** `railway run npm run db:seed` (CLI) ou o terminal do serviço

> O `db:seed` também insere cursos de exemplo se `SEED_EXEMPLO=true`. Em produção,
> deixe `SEED_EXEMPLO` em branco para começar limpo, ou rode `npm run db:seed:limpar` depois.

---

## O painel da secretaria (subdomínio)

Em produção o painel responde quando o host começa com `secretaria.` — ex.:
`https://secretaria.seudominio.com.br`. Para isso:

1. Tenha um **domínio próprio** (o subdomínio `.onrender.com` não permite sub-subdomínio).
2. Aponte tanto `seudominio.com.br` quanto `secretaria.seudominio.com.br` para o serviço
   (no Render: **Custom Domains**; configure os dois).
3. Pronto: o mesmo app serve o site no domínio raiz e o painel no `secretaria.`.

Enquanto não tiver domínio, dá para acessar o painel localmente como hoje
(`http://localhost:3001`) — produção e painel por subdomínio entram quando o domínio existir.

---

## Sobre as fotos dos cursos (importante)

Sem disco/volume persistente, o sistema de arquivos é reiniciado a cada deploy e as
imagens enviadas pela secretaria seriam perdidas. Por isso o `UPLOADS_DIR` + disco.
Para escala maior no futuro, o ideal é migrar para armazenamento de objetos
(Cloudinary, S3, Vercel Blob) — mas para começar, o disco persistente resolve.
