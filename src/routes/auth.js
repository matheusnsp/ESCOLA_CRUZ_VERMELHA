const express = require('express');
const rateLimit = require('express-rate-limit');

const prisma = require('../db');
const { hashSenha, verificarSenha } = require('../lib/password');
const {
  // cadastroSchema,
  cadastroSimplificadoSchema,   // <-- substitui cadastroSchema aqui
  completarCadastroSchema,
  trocarSenhaSchema,          // 👈 novo
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
const { precisaTrocarSenha, registrarTrocaSenha } = require('../lib/seguranca'); // 👈 novo

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

function senhaPadraoDoDocumento({ tipoDocumento, cpfCnpjNormalizado, passaporte }) {
  const base = tipoDocumento === 'PASSAPORTE'
    ? (passaporte || '').replace(/[^A-Z0-9]/g, '')
    : (cpfCnpjNormalizado || '');
  return base.slice(-4);
}

// ============================================================
//  CADASTRO
// ============================================================

router.get('/cadastro', (req, res) => {
  res.render('cadastro', { erros: [], valores: {}, politicaVersao: POLITICA_VERSAO, escolaridades: ESCOLARIDADES, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, tiposDocumento: TIPOS_DOCUMENTO });
});

router.post('/cadastro', cadastroLimiter, async (req, res) => {
  const resultado = cadastroSimplificadoSchema.safeParse(req.body);

  const reRender = (erros, status = 400) =>
    res.status(status).render('cadastro', {
      erros,
      valores: {
        nome: req.body.nome || '',
        email: req.body.email || '',
        tipoDocumento: req.body.tipoDocumento || '',
        documento: req.body.documento || '',
        passaporte: req.body.passaporte || '',
        paisOrigem: req.body.paisOrigem || '',
        rg: req.body.rg || '',
        celular: req.body.celular || '',
        escolaridade: req.body.escolaridade || '',
        escolaridadeSituacao: req.body.escolaridadeSituacao || '',
      },
      politicaVersao: POLITICA_VERSAO,
      escolaridades: ESCOLARIDADES,
      situacoes: SITUACOES_ESCOLARIDADE,
      tiposDocumento: TIPOS_DOCUMENTO,
    });

  if (!resultado.success) {
    return reRender(resultado.error.issues.map((i) => i.message));
  }

  const { nome, email, tipoDocumento, documento, passaporte, paisOrigem, escolaridade, escolaridadeSituacao, rg, celular } = resultado.data;

  let cpfCnpjNormalizado = null;
  if (tipoDocumento !== 'PASSAPORTE') {
    const doc = validarCpfCnpj(documento);
    if (!doc.ok) return reRender(['CPF ou CNPJ inválido.']);
    cpfCnpjNormalizado = doc.normalizado;
  }

  const senhaPadrao = senhaPadraoDoDocumento({ tipoDocumento, cpfCnpjNormalizado, passaporte });
  if (!senhaPadrao || senhaPadrao.length < 4) {
    return reRender(['Não foi possível gerar sua senha inicial. Confira o documento informado.']);
  }

  try {
    const senhaHash = await hashSenha(senhaPadrao);
    const usuario = await prisma.usuario.create({
      data: {
        nome, email, tipoDocumento,
        cpfCnpj: tipoDocumento === 'PASSAPORTE' ? null : cpfCnpjNormalizado,
        passaporte: tipoDocumento === 'PASSAPORTE' ? passaporte : null,
        paisOrigem: tipoDocumento === 'PASSAPORTE' ? (paisOrigem || null) : null,
        rg: rg || null,
        celular: celular || null,
        escolaridade: escolaridade || null,
        escolaridadeSituacao: escolaridadeSituacao || null,
        senhaHash,
        papel: 'ALUNO',
        emailVerificado: false,
        consentimentoLgpdEm: new Date(),
        consentimentoVersao: POLITICA_VERSAO,
      },
    });

    try { await enviarConfirmacao(usuario); } catch (e) {
      console.error('[Cadastro] Falha ao enviar e-mail de confirmação:', e.message);
    }

    req.session.regenerate((err) => {
      if (err) { console.error('Erro ao iniciar sessão no cadastro:', err); return res.redirect('/login'); }
      req.session.usuarioId = usuario.id;
      req.session.papel = usuario.papel;
      req.session.nome = usuario.nome;
      res.redirect('/minha-conta?sec=seguranca');
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const alvo = String(err.meta && err.meta.target);
      let msg = 'Já existe uma conta com este e-mail.';
      if (alvo.includes('cpfCnpj')) msg = 'Já existe uma conta com este CPF/CNPJ.';
      else if (alvo.includes('passaporte')) msg = 'Já existe uma conta com este passaporte.';
      return reRender([msg], 409);
    }
    console.error('Erro no cadastro:', err);
    return res.status(500).render('erro', { mensagem: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
});


// ============================================================
//  COMPLETAR DADOS (endereço pós-cadastro)
// ============================================================

const { requireLogin } = require('../middleware/auth');

router.get('/completar-dados', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  res.render('completar-dados', {
    erros: [],
    usuario,
    valores: {
      celular: usuario.celular || '',
      escolaridade: usuario.escolaridade || '',
      escolaridadeSituacao: usuario.escolaridadeSituacao || '',
      cep: usuario.cep || '',
      logradouro: usuario.logradouro || '',
      numero: usuario.numero || '',
      complemento: usuario.complemento || '',
      bairro: usuario.bairro || '',
      cidade: usuario.cidade || '',
      uf: usuario.uf || '',
    },
    ufs: UFS,
    escolaridades: ESCOLARIDADES,
    situacoes: SITUACOES_ESCOLARIDADE,
  });
});

router.post('/completar-dados', requireLogin, async (req, res) => {
  const resultado = completarCadastroSchema.safeParse(req.body);

  if (!resultado.success) {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
    return res.status(400).render('completar-dados', {
      erros: resultado.error.issues.map((i) => i.message),
      usuario,
      valores: req.body,
      ufs: UFS,
      escolaridades: ESCOLARIDADES,
      situacoes: SITUACOES_ESCOLARIDADE,
    });
  }

  // 💡 FIX — antes deste ponto, quando a validação passava (resultado.success
  // === true), o handler não fazia mais nada: não gravava no banco e não
  // chamava res.render/res.redirect. A requisição ficava pendurada pra
  // sempre (o Express nunca fechava a resposta), então a página só ficava
  // "carregando" indefinidamente. Faltava justamente o bloco de salvar +
  // responder abaixo.
  const {
    celular,
    escolaridade,
    escolaridadeSituacao,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
  } = resultado.data;

  try {
    await prisma.usuario.update({
      where: { id: req.session.usuarioId },
      data: {
        celular: celular || null,
        escolaridade: escolaridade || null,
        escolaridadeSituacao: escolaridadeSituacao || null,
        cep: cep || null,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        uf: uf || null,
      },
    });

    return res.redirect('/minha-conta?sec=dados');
  } catch (err) {
    console.error('Erro ao completar cadastro:', err);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
    return res.status(500).render('completar-dados', {
      erros: ['Não foi possível salvar seus dados. Tente novamente.'],
      usuario,
      valores: req.body,
      ufs: UFS,
      escolaridades: ESCOLARIDADES,
      situacoes: SITUACOES_ESCOLARIDADE,
    });
  }
});


// ============================================================
//  TROCAR SENHA (usuário logado)
// ============================================================

router.post('/conta/senha', requireLogin, async (req, res) => {
  const resultado = trocarSenhaSchema.safeParse(req.body);

  if (!resultado.success) {
    return res.redirect('/minha-conta?sec=seguranca&erroSenha=' + encodeURIComponent(resultado.error.issues[0].message));
  }

  const { senhaAtual, novaSenha } = resultado.data;

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });

    const senhaOk = usuario.senhaHash && await verificarSenha(usuario.senhaHash, senhaAtual);
    if (!senhaOk) {
      return res.redirect('/minha-conta?sec=seguranca&erroSenha=' + encodeURIComponent('Senha atual incorreta.'));
    }

    if (!(await avaliarSenhaAsync(novaSenha, [usuario.nome, usuario.email])).ok) {
      return res.redirect('/minha-conta?sec=seguranca&erroSenha=' + encodeURIComponent(MENSAGEM_SENHA_FRACA));
    }

    const senhaHash = await hashSenha(novaSenha);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash } });
    await registrarTrocaSenha(usuario.id);

    return res.redirect('/minha-conta?sec=seguranca&senhaAlterada=1');
  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    return res.redirect('/minha-conta?sec=seguranca&erroSenha=' + encodeURIComponent('Não foi possível trocar a senha. Tente novamente.'));
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
  if (req.session.usuarioId && req.session.papel === 'ALUNO') {
    return res.redirect('/minha-conta');
  }
  const sucesso = req.query.redefinida ? 'Senha redefinida com sucesso. Faca login.' : undefined;
  const info = req.query.banido ? 'Sua conta foi suspensa. Em caso de dúvidas, entre em contato com a secretaria.' : null;
  const erro = null;
  res.render('login', {
    erro,
    identificador: '',
    sucesso,
    info,
  });  
});

// Localiza o usuário pelo que foi digitado no login: e-mail (se tiver "@"),
// ou CPF/CNPJ/passaporte (se for majoritariamente números/alfanumérico).
// Assume que cpfCnpj é salvo só com dígitos (ver nota no cadastro).
async function buscarUsuarioPorLogin({ identificador }) {
  const valor = identificador.trim();

  // Se parece ser e-mail, procura pelo e-mail
  if (valor.includes('@')) {
    return prisma.usuario.findUnique({
      where: {
        email: valor.toLowerCase(),
      },
    });
  }

  // Caso contrário, tenta como CPF/CNPJ
  const doc = validarCpfCnpj(valor);

  if (!doc.ok) return null;

  return prisma.usuario.findUnique({
    where: {
      cpfCnpj: doc.normalizado,
    },
  });
}



router.post('/login', loginLimiter, async (req, res) => {
  const resultado = loginSchema.safeParse(req.body);
  const erroGenerico = 'E-mail/CPF ou senha incorretos.';

  const reRender = (identificador = '') =>
    res.status(401).render('login', {
      erro: erroGenerico,
      identificador,
    });

  if (!resultado.success) {
    return res.status(400).render('login', {
      erro:
        resultado.error.issues[0]?.message ||
        'Informe seu e-mail ou CPF e sua senha.',
      identificador: req.body.identificador || '',
    });
  }

  const { identificador, senha } = resultado.data;

  const MAX_FALHAS_ALUNO = 8;
  const BLOQUEIO_MIN_ALUNO = 15;

  try {
    const usuario = await buscarUsuarioPorLogin({ identificador });

    if (!usuario) {
      // Equaliza o tempo para evitar enumeração por timing.
      await hashSenha(senha);

      return reRender(identificador);
    }

    if (usuario.bloqueadoAte && usuario.bloqueadoAte > new Date()) {
      const minutos = Math.ceil(
        (usuario.bloqueadoAte.getTime() - Date.now()) / 60000
      );

      return res.status(429).render('login', {
        erro: `Muitas tentativas. Tente novamente em ${minutos} min.`,
        identificador,
      });
    }

    if (!usuario.senhaHash) {
      await hashSenha(senha);

      return res.status(401).render('login', {
        erro:
          'Esta conta ainda não tem senha. Use "Esqueci minha senha" para definir uma.',
        identificador,
      });
    }

    const senhaOk = await verificarSenha(usuario.senhaHash, senha);

    if (!senhaOk) {
      const falhas = (usuario.loginFalhas || 0) + 1;

      if (falhas >= MAX_FALHAS_ALUNO) {
        await prisma.usuario.update({
          where: { id: usuario.id },
          data: {
            loginFalhas: 0,
            bloqueadoAte: new Date(
              Date.now() + BLOQUEIO_MIN_ALUNO * 60000
            ),
          },
        });

        return res.status(429).render('login', {
          erro: `Muitas tentativas. Acesso bloqueado por ${BLOQUEIO_MIN_ALUNO} min.`,
          identificador,
        });
      }

      await prisma.usuario.update({
        where: { id: usuario.id },
        data: {
          loginFalhas: falhas,
        },
      });

      return reRender(identificador);
    }

    // 💡 FIX — login bem-sucedido: este update agora roda SEMPRE (antes só
    // rodava dentro de um "if (usuario.loginFalhas || usuario.bloqueadoAte)",
    // então na maioria dos logins — sem falhas anteriores — o bloco inteiro
    // era pulado e ultimoLogin/ultimaAtividade nunca eram gravados). Registra
    // o acesso sempre, e só inclui a limpeza de loginFalhas/bloqueadoAte no
    // update quando fazia sentido (evita um write desnecessário no caso comum).
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        ultimoLogin: new Date(),
        ultimaAtividade: new Date(),
        ...(usuario.loginFalhas || usuario.bloqueadoAte ? { loginFalhas: 0, bloqueadoAte: null } : {}),
      },
    });

    // Secretaria não entra pela área do aluno.
    if (usuario.papel === 'SECRETARIA') {
      return res.status(403).render('login', {
        erro:
          'Esta é a área do aluno. O acesso da secretaria é feito pelo painel administrativo.',
        identificador,
      });
    }

    // Regenera a sessão para evitar session fixation.
    return req.session.regenerate((err) => {
      if (err) {
        console.error('Erro ao regenerar sessao:', err);

        return res.status(500).render('erro', {
          mensagem: 'Erro ao iniciar a sessao.',
        });
      }

      req.session.usuarioId = usuario.id;
      req.session.papel = usuario.papel;
      req.session.nome = usuario.nome;

      req.session.save((err2) => {
        if (err2) {
          console.error('Erro ao salvar sessao:', err2);

          return res.status(500).render('erro', {
            mensagem: 'Erro ao iniciar a sessao.',
          });
        }

        return res.redirect('/minha-conta');
      });
    });
  } catch (err) {
    console.error('Erro no login:', err);

    return res.status(500).render('erro', {
      mensagem: 'Erro ao processar o login.',
    });
  }
});


router.post('/logout', (req, res) => {
  const id = req.session?.usuarioId;
  req.session.destroy((err) => {
    if (err) console.error('Erro ao sair:', err);
    if (id) prisma.usuario.update({
      where: { id },
      data: { ultimaAtividade: new Date(0) },
    }).catch(() => {});
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