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
const prisma = require('./db'); // usado diretamente pelo webhook da Únicopag, ver abaixo

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

// O webhook da Únicopag PRECISA ficar registrado aqui, antes do app.use(csrfProtection)
// mais abaixo. A Únicopag faz um POST simples de servidor pra servidor, sem cookie de sessão
// nem token CSRF — se essa rota estivesse depois do CSRF (como estava dentro de cursosRoutes),
// o middleware barra a requisição com 403 antes mesmo do handler rodar, e nada aparece no log.
app.post('/webhook/unicopag', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook UnicopAg] Notificação recebida:', JSON.stringify(payload));

    // Formato real confirmado em log de produção (payload achatado, sem "data"/"result"):
    // { event, id, hash, payment_method, payment_status, amount_total, customer: {...},
    //   items: [{ hash, title, price, quantity, operation_type }], ... }
    // IMPORTANTE: esse payload NÃO tem metadata/order_id nem customer.document (confirmado em
    // 2 capturas reais de log). O único jeito de saber a que matrícula ele se refere é pelo
    // hash (== gatewayRef que salvamos) ou, na janela de corrida em que o gatewayRef ainda não
    // foi gravado, pelo e-mail do cliente (customer.email, esse sim presente no payload).
    const hash = payload.hash || payload.id || '';
    const status = payload.payment_status || payload.status || '';
    // 💡 CORRIGIDO: em parcelamento a Únicopag manda "amount" (valor base, o mesmo que
    // enviamos e que fica salvo em Pagamento.valor) e "amount_total" (base + juros do
    // parcelamento — ex.: amount:1000, amount_total:1060 pra 2x). O matching de contingência
    // abaixo usava amount_total, e como o banco guarda o valor SEM juros, a comparação nunca
    // casava em compras parceladas ("Pagamento não identificado" mesmo com email certo).
    // amount_total é mantido só pra log/exibição do valor real cobrado do cliente.
    const amountBase = Number(payload.amount ?? payload.amount_total ?? 0) / 100;
    const amountTotal = Number(payload.amount_total ?? payload.amount ?? 0) / 100;
    // Confirmado em log real: customer.document NÃO vem no payload do webhook (só vinha na
    // requisição de criação). O campo confiável disponível aqui é customer.email.
    const emailCliente = String(payload.customer?.email || '').trim().toLowerCase();

    if (!hash) return res.status(200).send('Sem hash para processar');

    // 1. Caminho normal: casa pelo hash da transação já salvo no Pagamento.
    let pagamento = await prisma.pagamento.findFirst({ where: { gatewayRef: String(hash) } });

    // 2. Corrida de dados: o webhook chegou antes de terminarmos de gravar o gatewayRef
    //    (a linha PENDENTE já existe, criada antes de chamar o gateway — ver POST
    //    /inscrever/:turmaId em cursos.js — só falta o gatewayRef). Casa pelo e-mail do
    //    cliente + valor + status PENDENTE mais recente.
    if (!pagamento && emailCliente) {
      const aluno = await prisma.usuario.findUnique({ where: { email: emailCliente } });
      if (aluno) {
        pagamento = await prisma.pagamento.findFirst({
          where: {
            status: 'PENDENTE',
            valor: amountBase,
            matricula: { alunoId: aluno.id },
          },
          orderBy: { criadoEm: 'desc' },
        });
        if (pagamento) {
          console.log(`[Webhook UnicopAg] Casado por e-mail (corrida de dados) — Pagamento ${pagamento.id}`);
        }
      }
    }

    if (!pagamento) {
      console.error(`[Webhook UnicopAg] Pagamento não identificado. hash=${hash} email=${emailCliente} valor=${amountTotal} payload=${JSON.stringify(payload)}`);
      return res.status(200).send('Pagamento não identificado');
    }

    const statusLower = String(status).toLowerCase();
    const ehSucesso = ['paid', 'pago', 'success', 'captured', 'approved'].includes(statusLower);
    // 💡 CORRIGIDO: antes o webhook só entendia status de sucesso. Um "refunded"/"chargeback"
    // caía direto no "nada a atualizar" e a matrícula nunca saía de PAGO.
    const ehReembolso = ['refunded', 'reembolsado', 'refund', 'chargeback', 'charged_back', 'estornado'].includes(statusLower);
    const ehCancelamento = ['canceled', 'cancelled', 'cancelado', 'voided', 'void'].includes(statusLower);

    // Idempotência: só ignora se o status recebido é O MESMO que já está salvo. Antes,
    // "if (pagamento.status === 'PAGO') return" bloqueava QUALQUER webhook seguinte (inclusive
    // um reembolso) assim que o pagamento tinha sido confirmado uma vez — por isso o estorno
    // nunca era gravado.
    if (
      (pagamento.status === 'PAGO' && ehSucesso) ||
      (pagamento.status === 'ESTORNADO' && ehReembolso) ||
      (pagamento.status === 'CANCELADO' && ehCancelamento)
    ) {
      return res.status(200).send('Já processado');
    }

    if (ehReembolso) {
      await prisma.pagamento.updateMany({
        where: { id: pagamento.id },
        data: { status: 'ESTORNADO', gatewayRef: String(hash), atualizadoEm: new Date() },
      });
      await prisma.matricula.update({
        where: { id: pagamento.matriculaId },
        data: { statusPagamento: 'ESTORNADO' },
      });
      console.log(`[Webhook UnicopAg] 💸 Matrícula ${pagamento.matriculaId} marcada como ESTORNADO (status gateway: "${status}")`);
      return res.status(200).send('Reembolso processado com sucesso');
    }

    if (ehCancelamento) {
      await prisma.pagamento.updateMany({
        where: { id: pagamento.id },
        data: { status: 'CANCELADO', gatewayRef: String(hash), atualizadoEm: new Date() },
      });
      await prisma.matricula.update({
        where: { id: pagamento.matriculaId },
        data: { statusPagamento: 'CANCELADO' },
      });
      console.log(`[Webhook UnicopAg] 🚫 Matrícula ${pagamento.matriculaId} marcada como CANCELADO (status gateway: "${status}")`);
      return res.status(200).send('Cancelamento processado com sucesso');
    }

    if (!ehSucesso) {
      console.log(`[Webhook UnicopAg] Status "${status}" ainda não é de sucesso para o Pagamento ${pagamento.id}; nada a atualizar por ora.`);
      return res.status(200).send('Status recebido, aguardando confirmação de pagamento.');
    }

    await prisma.pagamento.updateMany({
      where: { id: pagamento.id },
      data: { status: 'PAGO', gatewayRef: String(hash), atualizadoEm: new Date() },
    });

    const dadosMatricula = await prisma.matricula.findUnique({ where: { id: pagamento.matriculaId } });
    const novoStatusMatricula = dadosMatricula?.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';

    await prisma.matricula.update({
      where: { id: pagamento.matriculaId },
      data: {
        statusPagamento: novoStatusMatricula,
        confirmadaEm: new Date(),
        confirmadaPor: 'unicopag',
      },
    });

    console.log(`[Webhook UnicopAg] ✅ Matrícula ${pagamento.matriculaId} atualizada para ${novoStatusMatricula}`);

    return res.status(200).send('Webhook processado com segurança');

  } catch (error) {
    console.error('[Webhook UnicopAg] 💥 Erro interno no processamento do webhook:', error);
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