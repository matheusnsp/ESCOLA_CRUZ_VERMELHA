require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const session = require('express-session');

const app = express();   // <- primeiro cria o app

app.use(compression());  // <- depois usa os middlewares

const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const { csrfProtection } = require('./middleware/csrf');
const { exposeUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const painelRoutes = require('./routes/painel');
const cursosRoutes = require('./routes/cursos');
const adminRoutes = require('./routes/admin');



// Atras de um proxy reverso (nginx, Caddy, etc.) que termina o TLS.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper disponível em todas as views: selo de status de pagamento.
app.locals.statusBadge = function (s) {
  const map = {
    PAGO: ['ok', 'PAGO'],
    PARCELADO: ['ok', 'PARCELADO'], // 💡 Adicionado: vai usar a mesma cor verde de sucesso ('ok')
    PENDENTE: ['pend', 'PENDENTE'],
    CANCELADO: ['canc', 'CANCELADO'],
    ESTORNADO: ['est', 'ESTORNADO'],
  }; 
  const [cls, txt] = map[s] || ['mut', s];
  return `<span class="badge ${cls}">${txt}</span>`;
};

// Cabecalhos de seguranca. A CSP libera apenas os CDNs que o site usa.
const isProd = process.env.NODE_ENV === 'production';
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
        // Permite atributos style="" inline usados nas telas (nao libera <style>/scripts).
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        // 💡 CORRIGIDO: Libera a execução do script que mostra/esconde os inputs do cartão na tela inscrever.ejs
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        // Em desenvolvimento (http://localhost) NAO forcar upgrade para https,
        // senao o Safari tenta carregar os assets in https e eles falham.
        ...(isProd ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // HSTS so faz sentido sob HTTPS real (producao). Em dev atrapalha o Safari.
    // 1 ano + subdominios (cobre o painel em secretaria.<dominio>).
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// 💡 CORRIGIDO: Alterado para extended: true. Obrigatório para ler o formulário com dados de cartão.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// O webhook da Únicopag PRECISA ficar montado aqui, antes do app.use(csrfProtection)
// mais abaixo. A Únicopag faz um POST simples de servidor pra servidor, sem cookie de
// sessão nem token CSRF — se a rota ficasse depois do CSRF, o middleware barraria a
// requisição com 403 antes mesmo do handler rodar, e nada apareceria no log.
// Toda a lógica do webhook (matching por hash/e-mail, TAXA x CURSO, idempotência)
// vive em ./routes/webhook.js.
app.use(require('./routes/webhook'));

// Arquivos estaticos (CSS, JS, imagens). index:false para a home ser a rota '/'.
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '7d' }));


// Serve a pasta de uploads tambem quando ela fica FORA de public/
const { uploadsDir } = require('./lib/upload');
app.use('/uploads', express.static(uploadsDir));

// Sessao guardada no PostgreSQL (nao no MemoryStore padrao).
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
app.use(
  session({
    store: new PgSession({ pool: sessionPool, createTableIfMissing: true }),
    name: 'escola.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 90, // 💡 CORRIGIDO (B4): 90 dias em vez de 1 ano — janela menor para conta com dados pessoais/pagamentos.
    },
  })
);

// Protecao CSRF (depois da sessao) e usuario disponivel nas views.
app.use(csrfProtection);
app.use(exposeUser);

// Protecao CSRF (depois da sessao) e usuario disponivel nas views.
app.use(csrfProtection);
app.use(exposeUser);

// Bloqueia alunos banidos em qualquer request — derruba a sessão na hora.
const prisma = require('./db');
app.use(async (req, res, next) => {
  if (!req.session?.usuarioId) return next();
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.session.usuarioId },
      select: { bloqueioTotal: true },
    });
    if (!usuario || usuario.bloqueioTotal) {
      return req.session.destroy(() => {
        const ehAdmin = isAdminReq(req);
        return res.redirect(ehAdmin ? '/login' : '/login?banido=1');
      });
    }
  } catch (e) {
    console.error('[BanCheck] Erro ao verificar ban:', e.message);
  }
  return next();
});

// ---- Roteamento por contexto: site do ALUNO x painel da SECRETARIA ----
const ADMIN_HOST = (process.env.ADMIN_HOST || 'secretaria').toLowerCase();
const ADMIN_PORT = process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : null;

function isAdminReq(req) {
  const host = (req.hostname || '').toLowerCase();
  if (host === ADMIN_HOST || host.startsWith(ADMIN_HOST + '.')) return true;
  if (ADMIN_PORT && req.socket && req.socket.localPort === ADMIN_PORT) return true;
  return false;
}

// Site do aluno.
const siteAluno = express.Router();
siteAluno.use(authRoutes);
siteAluno.use(cursosRoutes);
siteAluno.use(painelRoutes);
siteAluno.use((req, res) => res.status(404).render('erro', { mensagem: 'Página não encontrada.' }));

// Painel da secretaria.
const painelAdmin = express.Router();
painelAdmin.use(adminRoutes);
painelAdmin.use((req, res) => res.status(404).render('admin/erro', { mensagem: 'Página não encontrada.' }));

app.use((req, res, next) => {
  res.locals.isAdmin = isAdminReq(req);
  return res.locals.isAdmin ? painelAdmin(req, res, next) : siteAluno(req, res, next);
});

// ────────────────────────────────────────────────────────────────────────
// 💡 C4 — Middleware de ERRO (tem que ser o ÚLTIMO app.use, com 4 argumentos).
// Qualquer erro encaminhado por next(err) — inclusive os capturados pelo
// asyncHandler nas rotas — cai aqui, vira uma página amigável e é logado,
// em vez de derrubar o processo. A assinatura com 4 parâmetros é o que faz
// o Express reconhecer isto como handler de erro (não remova o `next`).
// ────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERRO NÃO TRATADO]', req.method, req.originalUrl, '—', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err); // resposta já começou: delega ao Express fechar
  let ehAdmin = false;
  try { ehAdmin = isAdminReq(req); } catch (e) { ehAdmin = false; }
  const view = ehAdmin ? 'admin/erro' : 'erro';
  res.status(500).render(view, {
    mensagem: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Site do aluno:      http://localhost:${port}`);
  if (!ADMIN_PORT || ADMIN_PORT === Number(port)) {
    console.log(`Painel (produção):  via subdomínio "${ADMIN_HOST}."`);
  }
});

if (!isProd && ADMIN_PORT && ADMIN_PORT !== Number(port)) {
  app.listen(ADMIN_PORT, () => {
    console.log(`Painel secretaria:  http://localhost:${ADMIN_PORT}`);
  });
}

// ────────────────────────────────────────────────────────────────────────
// 💡 C4 — Rede de segurança final do processo.
// Mesmo com asyncHandler + middleware de erro, um erro pode escapar de fora
// do ciclo de request (ex.: callback de lib, timer). Sem estes handlers, o
// Node pode encerrar o processo silenciosamente. Aqui logamos com destaque
// para aparecer no log do Render/produção. Não derrubamos o processo de
// propósito; numa próxima iteração vale shutdown controlado + supervisor.
// ────────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection]', motivo && motivo.stack ? motivo.stack : motivo);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
});
