const express = require('express');
const rateLimit = require('express-rate-limit');

const prisma = require('../db');
const { hashSenha, verificarSenha } = require('../lib/password');
const {
  cadastroSchema,
  loginSchema,
  esqueciSenhaSchema,
  redefinirSenhaSchema,
} = require('../lib/validation');
const {
  criarTokenReset,
  verificarTokenReset,
  criarTokenVerificacao,
  verificarTokenVerificacao,
  consumirToken,
} = require('../lib/tokens');
const { enviarEmailResetSenha, enviarEmailConfirmacao } = require('../lib/email');
const { avaliarSenha, MENSAGEM_SENHA_FRACA } = require('../lib/senha-forte');
const { validarCpfCnpj } = require('../lib/documento');

const router = express.Router();

const POLITICA_VERSAO = '2026-06-16';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ---------- Rate limiters ----------
const cadastroLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const reenvioLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

// Envia o e-mail de confirmacao para um usuario.
async function enviarConfirmacao(usuario) {
  const token = await criarTokenVerificacao(usuario.id);
  const link = `${APP_URL}/confirmar-email?token=${token}`;
  await enviarEmailConfirmacao(usuario.email, usuario.nome, link);
}

// ============================================================
//  CADASTRO
// ============================================================

router.get('/cadastro', (req, res) => {
  res.render('cadastro', { erros: [], valores: {}, politicaVersao: POLITICA_VERSAO });
});

router.post('/cadastro', cadastroLimiter, async (req, res) => {
  const resultado = cadastroSchema.safeParse(req.body);

  const reRender = (erros, status = 400) =>
    res.status(status).render('cadastro', {
      erros,
      valores: { nome: req.body.nome || '', email: req.body.email || '', documento: req.body.documento || '' },
      politicaVersao: POLITICA_VERSAO,
    });

  if (!resultado.success) {
    return reRender(resultado.error.issues.map((i) => i.message));
  }

  const { nome, email, documento, senha } = resultado.data;

  // CPF/CNPJ válido? (dígitos verificadores)
  const doc = validarCpfCnpj(documento);
  if (!doc.ok) {
    return reRender(['CPF ou CNPJ inválido.']);
  }

  // Forca da senha (servidor manda). Penaliza usar nome/e-mail na senha.
  if (!avaliarSenha(senha, [nome, email]).ok) {
    return reRender([MENSAGEM_SENHA_FRACA]);
  }

  try {
    const senhaHash = await hashSenha(senha);
    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        cpfCnpj: doc.normalizado,
        senhaHash,
        papel: 'ALUNO', // cadastro publico NUNCA cria SECRETARIA
        emailVerificado: false, // so ativa apos confirmar o e-mail
        consentimentoLgpdEm: new Date(),
        consentimentoVersao: POLITICA_VERSAO,
      },
    });

    await enviarConfirmacao(usuario);
    return res.render('verifique-email', { email });
  } catch (err) {
    if (err.code === 'P2002') {
      const alvo = String(err.meta && err.meta.target);
      const msg = alvo.includes('cpfCnpj')
        ? 'Já existe uma conta com este CPF/CNPJ.'
        : 'Já existe uma conta com este e-mail.';
      return reRender([msg], 409);
    }
    console.error('Erro no cadastro:', err);
    return res.status(500).render('erro', {
      mensagem: 'Nao foi possivel concluir o cadastro. Tente novamente em instantes.',
    });
  }
});

// ============================================================
//  CONFIRMACAO DE E-MAIL
// ============================================================

router.get('/confirmar-email', async (req, res) => {
  const registro = await verificarTokenVerificacao(req.query.token);
  if (!registro) {
    return res.status(400).render('erro', {
      mensagem: 'Link de confirmacao invalido ou expirado. Faca login para reenviar a confirmacao.',
    });
  }
  try {
    await prisma.usuario.update({
      where: { id: registro.usuarioId },
      data: { emailVerificado: true },
    });
    await consumirToken(registro.id);
    return res.render('email-confirmado');
  } catch (err) {
    console.error('Erro ao confirmar e-mail:', err);
    return res.status(500).render('erro', { mensagem: 'Nao foi possivel confirmar o e-mail.' });
  }
});

router.get('/reenviar-confirmacao', (req, res) => {
  res.render('reenviar-confirmacao', { sucesso: false, erro: null });
});

router.post('/reenviar-confirmacao', reenvioLimiter, async (req, res) => {
  const resultado = esqueciSenhaSchema.safeParse(req.body); // so precisa de e-mail valido
  if (!resultado.success) {
    return res.status(400).render('reenviar-confirmacao', { sucesso: false, erro: 'Informe um e-mail valido.' });
  }
  const { email } = resultado.data;
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario && !usuario.emailVerificado) {
      await enviarConfirmacao(usuario);
    }
    // Resposta SEMPRE igual (anti-enumeracao).
  } catch (err) {
    console.error('Erro ao reenviar confirmacao:', err);
  }
  return res.render('reenviar-confirmacao', { sucesso: true, erro: null });
});

// ============================================================
//  LOGIN / LOGOUT
// ============================================================

router.get('/login', (req, res) => {
  if (req.session.usuarioId) {
    return res.redirect(req.session.papel === 'SECRETARIA' ? '/admin' : '/minha-conta');
  }
  const sucesso = req.query.redefinida ? 'Senha redefinida com sucesso. Faca login.' : undefined;
  res.render('login', { erro: null, email: '', sucesso });
});

router.post('/login', loginLimiter, async (req, res) => {
  const resultado = loginSchema.safeParse(req.body);
  const erroGenerico = 'E-mail ou senha incorretos.';
  const reRender = (email) => res.status(401).render('login', { erro: erroGenerico, email });

  if (!resultado.success) {
    return res.status(400).render('login', {
      erro: 'Preencha e-mail e senha corretamente.',
      email: req.body.email || '',
    });
  }

  const { email, senha } = resultado.data;

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario) {
      await hashSenha(senha); // equaliza o tempo (anti-enumeracao por timing)
      return reRender(email);
    }

    const senhaOk = await verificarSenha(usuario.senhaHash, senha);
    if (!senhaOk) {
      return reRender(email);
    }

    // E-mail ainda nao confirmado: bloqueia o login.
    if (!usuario.emailVerificado) {
      return res.status(403).render('login', {
        erro: 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.',
        email,
      });
    }

    return req.session.regenerate((err) => {
      if (err) {
        console.error('Erro ao regenerar sessao:', err);
        return res.status(500).render('erro', { mensagem: 'Erro ao iniciar a sessao.' });
      }
      req.session.usuarioId = usuario.id;
      req.session.papel = usuario.papel;
      req.session.nome = usuario.nome;
      req.session.save((err2) => {
        if (err2) {
          console.error('Erro ao salvar sessao:', err2);
          return res.status(500).render('erro', { mensagem: 'Erro ao iniciar a sessao.' });
        }
        return res.redirect(usuario.papel === 'SECRETARIA' ? '/admin' : '/minha-conta');
      });
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).render('erro', { mensagem: 'Erro ao processar o login.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Erro ao sair:', err);
    res.clearCookie('escola.sid');
    res.redirect('/login');
  });
});

// ============================================================
//  RECUPERACAO DE SENHA
// ============================================================

router.get('/esqueci-senha', (req, res) => {
  res.render('esqueci-senha', { sucesso: false, erro: null });
});

router.post('/esqueci-senha', resetLimiter, async (req, res) => {
  const resultado = esqueciSenhaSchema.safeParse(req.body);
  if (!resultado.success) {
    return res.status(400).render('esqueci-senha', { sucesso: false, erro: 'Informe um e-mail valido.' });
  }
  const { email } = resultado.data;
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario) {
      const token = await criarTokenReset(usuario.id);
      const link = `${APP_URL}/redefinir-senha?token=${token}`;
      await enviarEmailResetSenha(usuario.email, usuario.nome, link);
    }
  } catch (err) {
    console.error('Erro no esqueci-senha:', err);
  }
  return res.render('esqueci-senha', { sucesso: true, erro: null });
});

router.get('/redefinir-senha', async (req, res) => {
  const registro = await verificarTokenReset(req.query.token);
  if (!registro) {
    return res.status(400).render('erro', {
      mensagem: 'Link de redefinicao invalido ou expirado. Solicite um novo.',
    });
  }
  res.render('redefinir-senha', { erro: null, token: req.query.token });
});

router.post('/redefinir-senha', resetLimiter, async (req, res) => {
  const resultado = redefinirSenhaSchema.safeParse(req.body);
  if (!resultado.success) {
    const erro = resultado.error.issues.map((i) => i.message)[0];
    return res.status(400).render('redefinir-senha', { erro, token: req.body.token || '' });
  }

  const { token, senha } = resultado.data;

  try {
    const registro = await verificarTokenReset(token);
    if (!registro) {
      return res.status(400).render('erro', {
        mensagem: 'Link de redefinicao invalido ou expirado. Solicite um novo.',
      });
    }

    // Forca da senha (servidor manda), usando os dados do dono da conta.
    const usuario = await prisma.usuario.findUnique({ where: { id: registro.usuarioId } });
    if (!avaliarSenha(senha, [usuario && usuario.nome, usuario && usuario.email]).ok) {
      return res.status(400).render('redefinir-senha', { erro: MENSAGEM_SENHA_FRACA, token });
    }

    const senhaHash = await hashSenha(senha);
    await prisma.usuario.update({ where: { id: registro.usuarioId }, data: { senhaHash } });
    await consumirToken(registro.id);

    return res.redirect('/login?redefinida=1');
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    return res.status(500).render('erro', { mensagem: 'Nao foi possivel redefinir a senha. Tente novamente.' });
  }
});

module.exports = router;
