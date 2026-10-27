// E-mail de confirmação de conta: cria o token de verificação e manda o link. Usado pelo cadastro
// do site (routes/auth.js) e pela matrícula rápida da Escola Digital.
const { criarTokenVerificacao } = require('./tokens');
const { enviarEmailConfirmacao } = require('./email');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Envia o e-mail de confirmacao para um usuario.
async function enviarConfirmacao(usuario) {
  const token = await criarTokenVerificacao(usuario.id);
  const link = `${APP_URL}/confirmar-email?token=${token}`;
  await enviarEmailConfirmacao(usuario.email, usuario.nome, link);
}

module.exports = { enviarConfirmacao };
