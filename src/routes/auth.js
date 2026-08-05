const express = require('express');
const rateLimit = require('express-rate-limit');

const prisma = require('../db');
const { hashSenha, verificarSenha } = require('../lib/password');
const {
  cadastroSchema,
  loginSchema,
  esqueciSenhaSchema,
  redefinirSenhaSchema,
  ESCOLARIDADES,
  SITUACOES_ESCOLARIDADE,
  GENEROS,
  UFS,
  TIPOS_DOCUMENTO,
} = require('../lib/validation');
const {
  criarTokenReset,
  verificarTokenReset,
  criarTokenVerificacao,
  verificarTokenVerificacao,
  consumirToken,
} = require('../lib/tokens');
const { enviarEmailResetSenha, enviarEmailConfirmacao } = require('../lib/email');
const { avaliarSenhaAsync, MENSAGEM_SENHA_FRACA } = require('../lib/senha-forte');
const { validarCpfCnpj } = require('../lib/documento');

const router = express.Router();

// 💡 C4 — Blindagem contra erros async: envolve automaticamente todo handler
// async registrado neste router com asyncHandler, pra qualquer exceção (ex.:
// timeout do banco) cair no middleware de erro do server em vez de derrubar o
// processo. Middlewares síncronos (rate limiters, requireLogin) passam intactos.
const asyncHandler = require('../lib/asyncHandler');
['get', 'post', 'put', 'delete', 'patch'].forEach((metodo) => {
  const original = router[metodo].bind(router);
  router[metodo] = (caminho, ...handlers) =>
    original(caminho, ...handlers.map((h) =>
      typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? asyncHandler(h) : h));
});

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
  res.render('cadastro', { erros: [], valores: {}, politicaVersao: POLITICA_VERSAO, escolaridades: ESCOLARIDADES, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, tiposDocumento: TIPOS_DOCUMENTO });
});

router.post('/cadastro', cadastroLimiter, async (req, res) => {
  const resultado = cadastroSchema.safeParse(req.body);

  const reRender = (erros, status = 400) =>
    res.status(status).render('cadastro', {
      erros,
      valores: {
        nome: req.body.nome || '', email: req.body.email || '',
        tipoDocumento: req.body.tipoDocumento || '', documento: req.body.documento || '',
        passaporte: req.body.passaporte || '', paisOrigem: req.body.paisOrigem || '',
        rg: req.body.rg || '', celular: req.body.celular || '',
        escolaridade: req.body.escolaridade || '', escolaridadeSituacao: req.body.escolaridadeSituacao || '', genero: req.body.genero || '',
        cep: req.body.cep || '', logradouro: req.body.logradouro || '', numero: req.body.numero || '',
        complemento: req.body.complemento || '', bairro: req.body.bairro || '', cidade: req.body.cidade || '', uf: req.body.uf || '',
      },
      politicaVersao: POLITICA_VERSAO,
      escolaridades: ESCOLARIDADES,
      situacoes: SITUACOES_ESCOLARIDADE,
      generos: GENEROS,
      ufs: UFS,
      tiposDocumento: TIPOS_DOCUMENTO,
    });

  if (!resultado.success) {
    return reRender(resultado.error.issues.map((i) => i.message));
  }

  const { nome, email, tipoDocumento, documento, passaporte, paisOrigem, senha, escolaridade, escolaridadeSituacao, genero, cep, logradouro, numero, complemento, bairro, cidade, uf, rg, celular } = resultado.data;

  // CPF/CNPJ válido? (dígitos verificadores) — passaporte já teve o formato checado no schema.
  let cpfCnpjNormalizado = null;
  if (tipoDocumento === 'PASSAPORTE') {
    // nada a normalizar aqui: passaporte já vem em maiúsculas e no formato AA123456 do schema.
  } else {
    const doc = validarCpfCnpj(documento);
    if (!doc.ok) {
      return reRender(['CPF ou CNPJ inválido.']);
    }
    cpfCnpjNormalizado = doc.normalizado;
  }

  // Forca da senha (servidor manda). Penaliza usar nome/e-mail na senha.
  if (!(await avaliarSenhaAsync(senha, [nome, email])).ok) {
    return reRender([MENSAGEM_SENHA_FRACA]);
  }

  try {
    const senhaHash = await hashSenha(senha);
    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        tipoDocumento,
        cpfCnpj: tipoDocumento === 'PASSAPORTE' ? null : cpfCnpjNormalizado,
        passaporte: tipoDocumento === 'PASSAPORTE' ? passaporte : null,
        paisOrigem: tipoDocumento === 'PASSAPORTE' ? (paisOrigem || null) : null,
        rg: rg || null,
        celular: celular || null,
        escolaridade: escolaridade || null,
        escolaridadeSituacao: escolaridadeSituacao || null,
        genero: genero || null,
        cep: cep || null,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        uf: uf || null,
        senhaHash,
        papel: 'ALUNO', // cadastro publico NUNCA cria SECRETARIA
        // 💡 CORRIGIDO (M4): verificação de e-mail RELIGADA. Antes entrava com
        // emailVerificado:true fixo, então e-mail errado = aluno sem recibo e
        // sem reset de senha. Toda a máquina de confirmação já existia; só
        // estava desativada. O aluno ainda entra logado (não bloqueia o acesso),
        // mas recebe o e-mail de confirmação e o status fica pendente até clicar.
        emailVerificado: false,
        consentimentoLgpdEm: new Date(),
        consentimentoVersao: POLITICA_VERSAO,
      },
    });

    // 💡 M4 — dispara o e-mail de confirmação (best-effort: falha de e-mail não
    // impede o cadastro, o aluno pode reenviar depois em /reenviar-confirmacao).
    try {
      await enviarConfirmacao(usuario);
    } catch (e) {
      console.error('[Cadastro] Falha ao enviar e-mail de confirmação:', e.message);
    }

    // Autentica o aluno na hora (sem confirmar e-mail).
    req.session.regenerate((err) => {
      if (err) {
        console.error('Erro ao iniciar sessão no cadastro:', err);
        return res.redirect('/login');
      }
      req.session.usuarioId = usuario.id;
      req.session.papel = usuario.papel;
      req.session.nome = usuario.nome;
      res.redirect('/minha-conta');
    });
    return;
  } catch (err) {
    if (err.code === 'P2002') {
      const alvo = String(err.meta && err.meta.target);
      let msg = 'Já existe uma conta com este e-mail.';
      if (alvo.includes('cpfCnpj')) msg = 'Já existe uma conta com este CPF/CNPJ.';
      else if (alvo.includes('passaporte')) msg = 'Já existe uma conta com este passaporte.';
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
  // No site do aluno só faz sentido redirecionar quem é ALUNO.
  // (Em localhost o cookie de sessão é compartilhado entre as portas 3000/3001,
  // então uma sessão da secretaria pode aparecer aqui — não a mandamos para /admin,
  // que não existe nesta porta.)
  if (req.session.usuarioId && req.session.papel === 'ALUNO') {
    return res.redirect('/minha-conta');
  }
  const sucesso = req.query.redefinida ? 'Senha redefinida com sucesso. Faca login.' : undefined;
  const erro = null;
  res.render('login', { erro, email: '', sucesso });
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

  // 💡 CORRIGIDO (M5): lockout POR CONTA no login do aluno. Antes só havia rate
  // limit por IP (loginLimiter), então força bruta distribuída (vários IPs)
  // contra UMA conta não encontrava trava. Reaproveita os campos que já existem
  // no schema (loginFalhas/bloqueadoAte) — os mesmos que o painel admin usa.
  const MAX_FALHAS_ALUNO = 8;         // tentativas antes de bloquear
  const BLOQUEIO_MIN_ALUNO = 15;      // minutos de bloqueio ao estourar

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario) {
      await hashSenha(senha); // equaliza o tempo (anti-enumeracao por timing)
      return reRender(email);
    }

    // Conta temporariamente bloqueada por tentativas seguidas.
    if (usuario.bloqueadoAte && usuario.bloqueadoAte > new Date()) {
      const minutos = Math.ceil((usuario.bloqueadoAte.getTime() - Date.now()) / 60000);
      return res.status(429).render('login', {
        erro: `Muitas tentativas. Tente novamente em ${minutos} min.`,
        email,
      });
    }

    // Conta sem senha definida.
    if (!usuario.senhaHash) {
      await hashSenha(senha); // mantém o tempo de resposta parecido
      return res.status(401).render('login', {
        erro: 'Esta conta ainda não tem senha. Use "Esqueci minha senha" para definir uma.',
        email,
      });
    }

    const senhaOk = await verificarSenha(usuario.senhaHash, senha);
    if (!senhaOk) {
      // Incrementa o contador; ao atingir o teto, bloqueia por uma janela.
      const falhas = (usuario.loginFalhas || 0) + 1;
      if (falhas >= MAX_FALHAS_ALUNO) {
        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { loginFalhas: 0, bloqueadoAte: new Date(Date.now() + BLOQUEIO_MIN_ALUNO * 60000) },
        });
        return res.status(429).render('login', {
          erro: `Muitas tentativas. Acesso bloqueado por ${BLOQUEIO_MIN_ALUNO} min.`,
          email,
        });
      }
      await prisma.usuario.update({ where: { id: usuario.id }, data: { loginFalhas: falhas } });
      return reRender(email);
    }

    // Login OK: zera contadores se houver resquício de tentativas anteriores.
    if (usuario.loginFalhas || usuario.bloqueadoAte) {
      await prisma.usuario.update({ where: { id: usuario.id }, data: { loginFalhas: 0, bloqueadoAte: null } });
    }

    // Conta da secretaria não entra pela área do aluno (o painel fica em outro endereço).
    if (usuario.papel === 'SECRETARIA') {
      return res.status(403).render('login', {
        erro: 'Esta é a área do aluno. O acesso da secretaria é feito pelo painel administrativo.',
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
        return res.redirect('/minha-conta');
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
    if (!(await avaliarSenhaAsync(senha, [usuario && usuario.nome, usuario && usuario.email])).ok) {
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