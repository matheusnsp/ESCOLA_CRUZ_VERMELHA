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

// Helper disponível em todas as views: nome do status da turma na tela. No banco o valor
// continua ENCERRADA (evita migração); para a secretaria ele aparece como CONCLUÍDA.
const ROTULO_TURMA = { ENCERRADA: 'CONCLUÍDA' };
app.locals.rotuloTurma = (s) => ROTULO_TURMA[s] || s;

// Helper disponível em todas as views: endereço de CSS/JS com a versão do conteúdo
// (<link href="<%= asset('/admin.css') %>">), para um deploy nunca deixar CSS velho no cache.
app.locals.asset = require('./lib/assets').asset;

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
        // googletagmanager (GA4) e connect.facebook.net (Meta Pixel): sem eles o CSP barrava
        // os dois scripts e nada era medido.
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdnjs.cloudflare.com',
          'https://www.googletagmanager.com',
          'https://connect.facebook.net',
        ],
        // Para onde GA4 e Pixel enviam os eventos.
        connectSrc: [
          "'self'",
          'https://*.google-analytics.com',
          'https://analytics.google.com',
          'https://*.analytics.google.com',
          'https://*.googletagmanager.com',
          'https://*.g.doubleclick.net',
          'https://www.google.com',
          'https://www.facebook.com',
          'https://connect.facebook.net',
        ],
        // Em desenvolvimento (http://localhost) NAO forcar upgrade para https,
        // senao o Safari tenta carregar os assets in https e eles falham.
        ...(isProd ? {} : { upgradeInsecureRequests: null }),
      },
    },
    // same-origin: o navegador conta ao próprio site de qual página veio o formulário (o "voltar"
    // das ações do painel usa isso), e continua sem mandar nada para sites de fora. Com o padrão
    // do helmet (no-referrer), toda ação voltava para Matrículas, viesse de onde viesse.
    referrerPolicy: { policy: 'same-origin' },
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

// Libera as imagens de /img para uso fora do site.
//
// O helmet marca todo recurso como cross-origin-resource-policy: same-origin,
// o que faz o navegador RECUSAR a imagem quando ela vem de outra origem.
// E-mail é sempre outra origem (mail.google.com, outlook.com, app do
// celular) — então a logo dos e-mails aparecia como texto alternativo.
//
// Só /img: são assets públicos, não há nada sensível ali. O resto do site
// continua com o padrão restritivo do helmet.
//
// ⚠️ Precisa vir ANTES do express.static — depois dele a resposta já saiu.
app.use('/img', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Service Worker: nunca pode ficar preso no cache HTTP (maxAge 7d abaixo),
// senão uma versão nova do sw.js demoraria dias para chegar aos alunos.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Arquivos estaticos (CSS, JS, imagens). index:false para a home ser a rota '/'.
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '7d' }));


// Serve a pasta de uploads tambem quando ela fica FORA de public/
const { uploadsDir } = require('./lib/upload');
app.use('/uploads', express.static(uploadsDir));

// Sessao guardada no PostgreSQL (nao no MemoryStore padrao).
// Pelo pooler em modo transação quando o banco é o Supabase: ver urlDasSessoes em db.js.
const sessionPool = new Pool({
  connectionString: require('./db').urlDasSessoes(process.env.DATABASE_URL),
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
app.use(
  session({
    // disableTouch: sem ele, toda página regravava a validade da sessão no banco. Com rolling
    // desligado (padrão), o cookie do navegador vence na data fixada no login de qualquer jeito,
    // então essa gravação não servia para nada.
    store: new PgSession({ pool: sessionPool, createTableIfMissing: true, disableTouch: true }),
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

// Bloqueia alunos banidos em qualquer request — derruba a sessão na hora.
const prisma = require('./db');
const cacheRapido = require('./lib/cache-rapido');
app.use(async (req, res, next) => {
  if (!req.session?.usuarioId) return next();
  try {
    // Guardado por 30 s (lib/cache-rapido.js): antes era uma consulta ao banco em toda página
    // de quem está logado. Banir alguém no painel limpa o cache na hora.
    let achado = cacheRapido.banGuardado(req.session.usuarioId);
    if (!achado) {
      const usuario = await prisma.usuario.findUnique({
        where: { id: req.session.usuarioId },
        select: { bloqueioTotal: true },
      });
      achado = { bloqueado: !usuario || usuario.bloqueioTotal };
      cacheRapido.guardarBan(req.session.usuarioId, achado.bloqueado);
    }
    if (achado.bloqueado) {
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

// Conclui as turmas confirmadas cujo último dia de aula já passou (lib/concluir-turmas.js).
// Roda ao subir e depois de hora em hora; as telas de turmas e o site também chamam.
const { concluirTurmasPassadas } = require('./lib/concluir-turmas');
concluirTurmasPassadas();
setInterval(concluirTurmasPassadas, 60 * 60 * 1000).unref();

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
