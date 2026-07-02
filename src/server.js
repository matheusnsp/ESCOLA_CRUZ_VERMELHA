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
const prisma = require('./db'); // Importado para uso no Webhook direto

const app = express();

// Atras de um proxy reverso (nginx, Caddy, etc.) que termina o TLS.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Helper disponível em todas as views: selo de status de pagamento.
app.locals.statusBadge = function (s) {
  const map = {
    PAGO: ['ok', 'PAGO'],
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

// 💡 ROTA DO WEBHOOK CORRIGIDA E SINCRONIZADA COM O SEU BANCO DE DADOS:
app.post('/webhook/unicopag', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook UnicopAg] Notificação recebida no servidor:', JSON.stringify(payload));

    const idPrincipal = payload.gatewaytransaction || payload.id;
    const hashMenor = payload.transactionhash || payload.hash || payload.result?.hash;
    const orderId = payload.order_id || payload.metadata?.order_id || payload.result?.metadata?.order_id;
    
    // Normaliza o status vindo do gateway para letras minúsculas
    const payment_status = String(payload.payment_status || payload.status || payload.result?.status).toLowerCase();

    if (!payment_status) {
      console.error('[Webhook UnicopAg] Erro: Status de pagamento ausente.');
      return res.status(400).send('Status inválido');
    }

    const pagamento = await prisma.pagamento.findFirst({
      where: {
        OR: [
          idPrincipal ? { gatewayRef: String(idPrincipal) } : null,
          hashMenor ? { gatewayRef: String(hashMenor) } : null,
          orderId ? { matriculaId: String(orderId) } : null
        ].filter(Boolean)
      }
    });

    if (!pagamento) {
      console.error(`[Webhook UnicopAg] Nenhum pagamento achado no banco.`);
      return res.status(200).send('Não localizado');
    }

    const matriculaId = pagamento.matriculaId;
    console.log(`[Webhook UnicopAg] Localizado! Matrícula associada: ${matriculaId}`);

    // Mapeamento e atualização direta das tabelas no Banco de Dados
    if (payment_status === 'paid' || payment_status === 'pago' || payment_status === 'success') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { matriculaId }, data: { status: 'PAGO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: matriculaId }, data: { statusPagamento: 'PAGO', confirmadaEm: new Date(), confirmadaPor: 'unicopag' } })
      ]);
      console.log(`[Webhook UnicopAg] 🎉 Matrícula ${matriculaId} ATUALIZADA PARA PAGO NO BANCO!`);
    } else if (payment_status === 'refunded' || payment_status === 'estornado') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { matriculaId }, data: { status: 'ESTORNADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: matriculaId }, data: { statusPagamento: 'ESTORNADO' } })
      ]);
      console.log(`[Webhook UnicopAg] ↩️ Matrícula ${matriculaId} atualizada para ESTORNADO.`);
    } else if (payment_status === 'refused' || payment_status === 'failed' || payment_status === 'cancelado') {
      await prisma.$transaction([
        // 💡 CORRIGIDO: Nome do campo corrigido de AIC/updatedAt para o padrão do seu banco: atualizadoEm
        prisma.pagamento.updateMany({ where: { matriculaId }, data: { status: 'CANCELADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: matriculaId }, data: { statusPagamento: 'CANCELADO' } })
      ]);
      console.log(`[Webhook UnicopAg] ❌ Matrícula ${matriculaId} atualizada para CANCELADO.`);
    }

    return res.status(200).send('Webhook processado');
  } catch (error) {
    console.error('[Webhook UnicopAg] Erro crítico no banco:', error.message);
    return res.status(500).send('Erro interno');
  }
});

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
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
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