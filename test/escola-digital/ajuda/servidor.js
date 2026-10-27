// Ajuda dos testes HTTP da Escola Digital: sobe `node src/server.js` como processo filho,
// numa porta livre, e devolve { url, parar() }. O server.js não é refatorado para isso.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { ehBancoLocal } = require('../../../src/lib/escola-digital/conteudo');

const RAIZ = path.join(__dirname, '..', '..', '..');

// Pede ao sistema uma porta livre (abre na 0, lê a porta, fecha).
function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Sobe o servidor com o ambiente de teste (sem chaves de e-mail nem de pagamento) mais `env`.
async function iniciarServidor({ env = {}, tempoMaxMs = 30000 } = {}) {
  // O servidor sobe agendadores (lembretes, boas-vindas, pesquisa, reconciliação) contra o banco
  // que receber: nunca um que não seja local.
  const bancoUrl = env.DATABASE_URL !== undefined ? env.DATABASE_URL : process.env.DATABASE_URL;
  if (!ehBancoLocal(bancoUrl)) throw new Error('iniciarServidor: DATABASE_URL ausente ou não é localhost/127.0.0.1');
  const porta = await portaLivre();
  let portaAdmin = await portaLivre();
  while (portaAdmin === porta) portaAdmin = await portaLivre();
  const url = `http://localhost:${porta}`;

  const ambiente = { ...process.env };
  // Nada de serviços externos nos testes.
  // As chaves da Únicopag são UNICOPAG_API_TOKEN e UNICOPAG_API_TOKEN_2 (lib/unicopag.js).
  for (const k of ['RESEND_API_KEY', 'UNICOPAG_API_KEY', 'UNICOPAG_SECRET', 'UNICOPAG_API_TOKEN', 'UNICOPAG_API_TOKEN_2', 'ESCOLA_DIGITAL', 'ESCOLA_DIGITAL_PAGAMENTO_SIMULADO']) delete ambiente[k];
  Object.assign(ambiente, {
    NODE_ENV: 'development',
    PORT: String(porta),
    ADMIN_PORT: String(portaAdmin),
    SESSION_SECRET: 'teste',
    APP_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
  }, env);
  if (!ehBancoLocal(ambiente.DATABASE_URL)) throw new Error('iniciarServidor: DATABASE_URL ausente ou não é localhost/127.0.0.1');

  const filho = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  let encerrou = false;
  filho.on('exit', () => { encerrou = true; });
  // Se o processo de teste morrer de forma anormal, o servidor não fica para trás.
  const matarFilho = () => { try { filho.kill('SIGKILL'); } catch (e) { /* já saiu */ } };
  process.once('exit', matarFilho);

  const parar = () => new Promise((resolve) => {
    process.removeListener('exit', matarFilho);
    if (encerrou) return resolve();
    filho.once('exit', () => resolve());
    filho.kill('SIGTERM');
    setTimeout(() => filho.kill('SIGKILL'), 5000).unref();
  });

  // Espera o GET / responder.
  const limite = Date.now() + tempoMaxMs;
  for (;;) {
    if (encerrou) throw new Error(`Servidor encerrou ao subir:\n${saida}`);
    try {
      const r = await fetch(url + '/', { redirect: 'manual' });
      if (r.status > 0) break;
    } catch (e) { /* ainda subindo */ }
    if (Date.now() > limite) {
      await parar();
      throw new Error(`Servidor não respondeu em ${tempoMaxMs} ms:\n${saida}`);
    }
    await dormir(250);
  }
  return { url, parar };
}

module.exports = { iniciarServidor };
