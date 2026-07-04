require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const { csrfProtection } = require('./middleware/csrf');
const { exposeUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const painelRoutes = require('./routes/painel');
const cursosRoutes = require('./routes/cursos');
const adminRoutes = require('./routes/admin');

const app = express();

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

// 💡 O webhook da Únicopag é tratado em src/routes/cursos.js (router.post('/webhook/unicopag')).
// Havia uma segunda definição dessa mesma rota aqui no server.js, registrada ANTES do
// cursosRoutes ser montado — como o Express casa rotas na ordem de registro, essa versão
// duplicada sempre respondia primeiro e a do cursos.js nunca era executada. Ela também tinha
// um bug próprio (marcava qualquer pagamento em cartão como PARCELADO, mesmo à vista, e não
// tratava a corrida de dados do webhook chegando antes do gatewayRef ser salvo). Removida
// para não haver mais duas fontes de verdade conflitantes para o mesmo webhook.

// Arquivos estaticos (CSS, JS, imagens). index:false para a home ser a rota '/'.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Serve a pasta de uploads tambem quando ela fica FORA de public/
const { uploadsDir } = require('./lib/upload');
app.use('/uploads', express.static(uploadsDir));

// Sessao guardada no PostgreSQL (nao no MemoryStore padrao).
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
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
      maxAge: 1000 * 60 * 60 * 24 * 365, // 💡 CORRIGIDO: Alterado para 1 Ano inteiro para evitar deslogamentos espontâneos.
    },
  })
);

// Protecao CSRF (depois da sessao) e usuario disponivel nas views.
app.use(csrfProtection);
app.use(exposeUser);

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

const port = process.env.PORT || 3000;
app.use((req, res, next) => { next(); });

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