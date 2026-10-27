// Ajuda dos testes HTTP da Escola Digital: sobe `node src/server.js` como processo filho,
// numa porta livre, e devolve { url, parar() }. O server.js não é refatorado para isso.
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

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
  const porta = await portaLivre();
  let portaAdmin = await portaLivre();
  while (portaAdmin === porta) portaAdmin = await portaLivre();
  const url = `http://localhost:${porta}`;

  const ambiente = { ...process.env };
  // Nada de serviços externos nos testes.
  for (const k of ['RESEND_API_KEY', 'UNICOPAG_API_KEY', 'UNICOPAG_SECRET', 'ESCOLA_DIGITAL', 'ESCOLA_DIGITAL_PAGAMENTO_SIMULADO']) delete ambiente[k];
  Object.assign(ambiente, {
    NODE_ENV: 'development',
    PORT: String(porta),
    ADMIN_PORT: String(portaAdmin),
    SESSION_SECRET: 'teste',
    APP_URL: url,
    DATABASE_URL: process.env.DATABASE_URL,
  }, env);

  const filho = spawn(process.execPath, ['src/server.js'], { cwd: RAIZ, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  let encerrou = false;
  filho.on('exit', () => { encerrou = true; });

  const parar = () => new Promise((resolve) => {
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
