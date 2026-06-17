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

const app = express();

// Atras de um proxy reverso (nginx, Caddy, etc.) que termina o TLS.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
        scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        // Em desenvolvimento (http://localhost) NAO forcar upgrade para https,
        // senao o Safari tenta carregar os assets em https e eles falham.
        ...(isProd ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // HSTS so faz sentido sob HTTPS real (producao). Em dev atrapalha o Safari.
    hsts: isProd,
  })
);

app.use(express.urlencoded({ extended: false }));

// Arquivos estaticos (CSS, JS, imagens). index:false para a home ser a rota '/'.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Sessao guardada no PostgreSQL (nao no MemoryStore padrao).
const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });
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
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  })
);

// Protecao CSRF (depois da sessao) e usuario disponivel nas views.
app.use(csrfProtection);
app.use(exposeUser);

// Rotas
app.use('/', authRoutes);
app.use('/', cursosRoutes);
app.use('/', painelRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('erro', { mensagem: 'Pagina nao encontrada.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
