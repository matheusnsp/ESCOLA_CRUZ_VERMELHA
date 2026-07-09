// ============================================================
//  Painel Administrativo (Secretaria / Coordenacao / Financeiro / Dev)
//  Servido por subdominio (secretaria.<dominio>) em producao
//  ou por porta separada (ADMIN_PORT) em desenvolvimento.
//  Sessao e independente da do aluno (host/porta diferente).
// ============================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { verificarSenha, hashSenha } = require('../lib/password');
const { criarCodigo2fa, verificarCodigo2fa, consumirToken, criarTokenDesbloqueio, verificarTokenDesbloqueio, criarTokenReset, verificarTokenReset } = require('../lib/tokens');
const { enviarCodigo2fa, enviarAlertaLoginSecretaria, enviarLinkDesbloqueio, enviarEmailResetSenha } = require('../lib/email');
const { ESCOLARIDADES: ESCOLARIDADES_ALUNO, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');
const { mascarar, mascararRG, validarCpfCnpj } = require('../lib/documento');
const { formatBRL } = require('../lib/matricula');
const { uploadFoto, salvarFotoCurso, removerFotoCurso } = require('../lib/upload');
const { temPermissao, PAPEIS_ADMIN } = require('../lib/permissoes');

const router = express.Router();

// ---------- Helpers ----------

// Tempo maximo de inatividade no painel antes de deslogar (15 min).
const IDLE_MS = 15 * 60 * 1000;

// Qualquer um dos 4 papeis administrativos pode entrar no painel.
// O que cada um pode FAZER dentro dele e controlado por requirePermissao() em cada rota.
function requireAdmin(req, res, next) {
  if (req.session && req.session.usuarioId && PAPEIS_ADMIN.includes(req.session.papel)) {
    const agora = Date.now();
    if (req.session.adminLastSeen && agora - req.session.adminLastSeen > IDLE_MS) {
      return req.session.destroy(() => res.redirect('/login?expirado=1'));
    }
    req.session.adminLastSeen = agora;
    return next();
  }
  return res.redirect('/login');
}

// Bloqueia a rota a menos que o papel logado tenha pelo menos UMA das permissoes passadas.
// Aceita varias (OR) porque algumas telas sao compartilhadas: quem gerencia OU so le, ve a pagina;
// so quem gerencia ve os botoes de acao (isso e tratado na view com res.locals.pode(...)).
function requirePermissao(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => temPermissao(req.session.papel, p))) return next();
    return res.status(403).render('admin/erro', { mensagem: 'Voce nao tem permissao para esta acao.' });
  };
}

// Registra uma acao administrativa (trilha de auditoria).
async function auditar(req, acao, alvoTipo, alvoId, detalhe) {
  try {
    await prisma.logAuditoria.create({
      data: { 
        atorId: req.session.usuarioId || 'SISTEMA', 
        acao, 
        alvoTipo, 
        alvoId: alvoId ? String(alvoId) : null, 
        detalhe: detalhe ? JSON.stringify(detalhe) : undefined 
      },
    });
  } catch (e) {
    console.error('Falha ao gravar auditoria:', e.message);
  }
}

// Converte texto de formulario em numero decimal valido (ou null se vazio/opcional).
function parseDecimal(v, { opcional = false } = {}) {
  if (v == null || String(v).trim() === '') return opcional ? null : NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function parseInteiro(v, { min = 0 } = {}) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

// Auxiliar para retornar a pagina anterior de forma segura com mensagem de sucesso
function back(req, msg) {
  const url = req.get('Referer') || '/inscricoes';
  const queryConector = url.includes('?') ? '&' : '?';
  return `${url}${queryConector}ok=${encodeURIComponent(msg)}`;
}

function statusBadge(s) {
  const map = {
    PENDENTE:  '<span style="background:#fef9c3;color:#854d0e;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">PENDENTE</span>',
    PAGO:      '<span style="background:#dcfce7;color:#166534;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">PAGO</span>',
    PARCELADO: '<span style="background:#dbeafe;color:#1e40af;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">PARCELADO</span>',
    CANCELADO: '<span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">CANCELADO</span>',
    ESTORNADO: '<span style="background:#f3e8ff;color:#6b21a8;padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600;">ESTORNADO</span>',
  };
  return map[s] || `<span>${s}</span>`;
}

const ESCOLARIDADES = ['', 'Ensino Fundamental', 'Ensino Medio', 'Ensino Superior'];
const STATUS_TURMA = ['ABERTA', 'CONFIRMADA', 'CANCELADA', 'ENCERRADA'];

// ---------- Login administrativo (senha -> 2FA por e-mail) ----------

const MAX_FALHAS = 5;                          
const STRIKE_DURACOES_MIN = [15, 30, 60];      
const MAX_STRIKES_TEMP = STRIKE_DURACOES_MIN.length; 
const PENDENTE_2FA_MS = 10 * 60 * 1000;        

const ADMIN_URL = process.env.ADMIN_URL
  || (process.env.ADMIN_PORT ? `http://localhost:${process.env.ADMIN_PORT}` : null)
  || (process.env.APP_URL
        ? process.env.APP_URL.replace(/^(https?:\/\/)/, `$1${(process.env.ADMIN_HOST || 'secretaria')}.`)
        : 'http://localhost:3001');

const loginAdminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const codigo2faLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false });
const reenvioLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 4, standardHeaders: true, legacyHeaders: false });
const desbloqueioLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

async function enviarDesbloqueio(usuario) {
  const token = await criarTokenDesbloqueio(usuario.id);
  const link = `${ADMIN_URL}/desbloquear?token=${token}`;
  await enviarLinkDesbloqueio(usuario.email, usuario.nome, link);
}

function mascararEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return e || '';
  const ini = u.slice(0, 2);
  return `${ini}${'*'.repeat(Math.max(1, u.length - ini.length))}@${d}`;
}

async function dispararCodigo2fa(pend) {
  const codigo = await criarCodigo2fa(pend.id);
  await enviarCodigo2fa(pend.email, pend.nome, codigo);
}

async function logSeguranca(req, acao, usuarioId, detalhe) {
  try {
    await prisma.logAuditoria.create({
      data: {
        atorId: usuarioId || 'ANONIMO',
        acao,
        alvoTipo: 'LoginSecretaria',
        alvoId: usuarioId || null,
        detalhe: JSON.stringify({ ...(detalhe || {}), ip: req.ip || null, em: new Date().toISOString() }),
      },
    });
  } catch (e) {
    console.error('Falha ao gravar log de seguranca:', e.message);
  }
}

router.get('/login', (req, res) => {
  if (req.session && req.session.usuarioId && PAPEIS_ADMIN.includes(req.session.papel)) {
    return res.redirect('/');
  }
  const info = req.query.expirado ? 'Sessao encerrada por inatividade. Entre novamente.' : null;
  res.render('admin/login', { erro: null, info });
});

router.post('/login', loginAdminLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const falha = () => res.status(401).render('admin/login', { erro: 'E-mail ou senha invalidos.' });

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !PAPEIS_ADMIN.includes(usuario.papel)) {
      await logSeguranca(req, 'LOGIN_FALHO', null, { email, motivo: 'usuario_inexistente_ou_nao_admin' });
      return falha();
    }

    if (usuario.bloqueioTotal) {
      await logSeguranca(req, 'LOGIN_BLOQUEADO', usuario.id, { email, motivo: 'bloqueio_total' });
      return res.status(403).render('admin/login', {
        erro: 'Conta bloqueada por seguranca apos varias tentativas. Use o link de desbloqueio enviado ao e-mail oficial — ou reenvie abaixo.',
        info: null, mostrarReenvio: true, emailTentado: email,
      });
    }

    if (usuario.bloqueadoAte && usuario.bloqueadoAte > new Date()) {
      const minutos = Math.ceil((usuario.bloqueadoAte.getTime() - Date.now()) / 60000);
      await logSeguranca(req, 'LOGIN_BLOQUEADO', usuario.id, { email, motivo: 'bloqueio_temporario', minutos });
      return res.status(429).render('admin/login', { erro: `Muitas tentativas. Tente novamente em ${minutos} min.`, info: null });
    }

    const ok = await verificarSenha(usuario.senhaHash, senha);
    if (!ok) {
      const falhas = usuario.loginFalhas + 1;

      if (falhas < MAX_FALHAS) {
        await prisma.usuario.update({ where: { id: usuario.id }, data: { loginFalhas: falhas } });
        await logSeguranca(req, 'LOGIN_FALHO', usuario.id, { email, motivo: 'senha_incorreta', falhas });
        return falha();
      }

      const strikes = usuario.loginStrikes + 1;

      if (strikes > MAX_STRIKES_TEMP) {
        await prisma.usuario.update({
          where: { id: usuario.id },
          data: { loginFalhas: 0, bloqueadoAte: null, loginStrikes: strikes, bloqueioTotal: true },
        });
        try { await enviarDesbloqueio(usuario); } catch (e) { console.error('Falha ao enviar desbloqueio:', e); }
        await logSeguranca(req, 'BLOQUEIO_TOTAL', usuario.id, { email, strikes });
        return res.status(403).render('admin/login', {
          erro: 'Conta bloqueada por seguranca. Enviamos um link de desbloqueio para o e-mail oficial.',
          info: null, mostrarReenvio: true, emailTentado: email,
        });
      }

      const durMin = STRIKE_DURACOES_MIN[strikes - 1];
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { loginFalhas: 0, loginStrikes: strikes, bloqueadoAte: new Date(Date.now() + durMin * 60000) },
      });
      await logSeguranca(req, 'BLOQUEIO_TEMPORARIO', usuario.id, { email, strike: strikes, minutos: durMin });
      return res.status(429).render('admin/login', { erro: `Muitas tentativas. Acesso bloqueado por ${durMin} min.`, info: null });
    }

    if (usuario.loginFalhas || usuario.bloqueadoAte || usuario.loginStrikes) {
      await prisma.usuario.update({ where: { id: usuario.id }, data: { loginFalhas: 0, bloqueadoAte: null, loginStrikes: 0 } });
    }

    req.session.pendingAdmin2fa = { id: usuario.id, email: usuario.email, nome: usuario.nome, em: Date.now() };
    await dispararCodigo2fa(req.session.pendingAdmin2fa);
    return req.session.save((e) => {
      if (e) { return res.status(500).render('admin/erro', { mensagem: 'Erro ao iniciar o login.' }); }
      return res.redirect('/login/2fa');
    });
  } catch (err) {
    console.error('Erro no login administrativo:', err);
    return res.status(500).render('admin/erro', { mensagem: 'Erro ao processar o login.' });
  }
});

router.get('/login/2fa', (req, res) => {
  const pend = req.session.pendingAdmin2fa;
  if (!pend) return res.redirect('/login');
  const sucesso = req.query.reenviado ? 'Enviamos um novo codigo para o seu e-mail.' : null;
  res.render('admin/login-2fa', { erro: null, sucesso, emailMasc: mascararEmail(pend.email) });
});

router.post('/login/2fa', codigo2faLimiter, async (req, res) => {
  const pend = req.session.pendingAdmin2fa;
  if (!pend) return res.redirect('/login');

  if (Date.now() - pend.em > PENDENTE_2FA_MS) {
    delete req.session.pendingAdmin2fa;
    return res.status(401).render('admin/login', { erro: 'Tempo esgotado. Faca login novamente.' });
  }

  const codigo = String(req.body.codigo || '').replace(/\D/g, '');
  const registro = await verificarCodigo2fa(pend.id, codigo);
  if (!registro) {
    await logSeguranca(req, 'LOGIN_2FA_FALHO', pend.id, { email: pend.email, motivo: 'codigo_invalido' });
    return res.status(401).render('admin/login-2fa', { erro: 'Codigo invalido ou expirado.', sucesso: null, emailMasc: mascararEmail(pend.email) });
  }
  await consumirToken(registro.id);

  const usuario = await prisma.usuario.findUnique({ where: { id: pend.id } });
  if (!usuario || !PAPEIS_ADMIN.includes(usuario.papel)) {
    delete req.session.pendingAdmin2fa;
    return res.redirect('/login');
  }

  const ip = req.ip;
  return req.session.regenerate((err) => {
    if (err) { return res.status(500).render('admin/erro', { mensagem: 'Erro ao iniciar a sessao.' }); }
    req.session.usuarioId = usuario.id;
    req.session.nome = usuario.nome;
    req.session.papel = usuario.papel;
    req.session.adminLastSeen = Date.now();
    req.session.save(async (err2) => {
      if (err2) { return res.status(500).render('admin/erro', { mensagem: 'Erro ao iniciar a sessao.' }); }
      try {
        const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await enviarAlertaLoginSecretaria(usuario.email, usuario.nome, quando, ip);
        await auditar(req, 'LOGIN_ADMIN', 'Usuario', usuario.id, { ip, papel: usuario.papel });
      } catch (e) { console.error('Pos-login (alerta/auditoria):', e); }
      return res.redirect('/');
    });
  });
});

router.post('/login/2fa/reenviar', reenvioLimiter, async (req, res) => {
  const pend = req.session.pendingAdmin2fa;
  if (!pend) return res.redirect('/login');
  pend.em = Date.now(); 
  try {
    await dispararCodigo2fa(pend);
  } catch (e) {
    console.error('Erro ao reenviar codigo 2FA:', e);
  }
  return req.session.save(() => res.redirect('/login/2fa?reenviado=1'));
});

router.post('/desbloquear/solicitar', desbloqueioLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario && PAPEIS_ADMIN.includes(usuario.papel) && usuario.bloqueioTotal) {
      await enviarDesbloqueio(usuario);
    }
  } catch (e) {
    console.error('Erro ao solicitar desbloqueio:', e);
  }
  return res.render('admin/login', { erro: null, info: 'Se a conta estiver bloqueada, enviamos um link de desbloqueio ao e-mail oficial.' });
});

router.get('/desbloquear', async (req, res) => {
  const token = String(req.query.token || '');
  const registro = await verificarTokenDesbloqueio(token);
  if (!registro) {
    return res.status(400).render('admin/login', { erro: 'Link de desbloqueio invalido ou expirado.', info: null });
  }
  await prisma.usuario.update({
    where: { id: registro.usuarioId },
    data: { bloqueioTotal: false, loginStrikes: 0, loginFalhas: 0, bloqueadoAte: null },
  });
  await consumirToken(registro.id);
  return res.render('admin/login', { erro: null, info: 'Acesso liberado. Faca login normalmente.' });
});

// ---------- Esqueci minha senha (fluxo para pessoas adicionadas sem senha definida) ----------
// Usado tanto por quem esqueceu a senha quanto por conta nova cadastrada pelo script
// scripts/criar-admin.js (que cria o usuário com senhaHash nulo, sem nenhuma senha temporária
// para ninguém digitar ou saber).

const resetSenhaLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.get('/esqueci-senha', (req, res) => {
  res.render('admin/esqueci-senha', { erro: null, sucesso: false });
});

router.post('/esqueci-senha', resetSenhaLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    // So envia se a conta existir E for de fato um papel administrativo — mas a mensagem
    // de resposta e sempre a mesma, exista ou nao, pra nao confirmar quem tem cadastro.
    if (usuario && PAPEIS_ADMIN.includes(usuario.papel)) {
      const token = await criarTokenReset(usuario.id);
      const link = `${ADMIN_URL}/redefinir-senha?token=${token}`;
      await enviarEmailResetSenha(usuario.email, usuario.nome, link);
      await logSeguranca(req, 'RESET_SENHA_SOLICITADO', usuario.id, { email });
    }
  } catch (e) {
    console.error('Erro ao solicitar redefinicao de senha:', e);
  }
  // sucesso:true mesmo se a conta nao existir — a propria view esconde o formulario
  // e mostra so a mensagem generica, evitando confirmar quem tem cadastro ou nao.
  return res.render('admin/esqueci-senha', { erro: null, sucesso: true });
});

router.get('/redefinir-senha', async (req, res) => {
  const token = String(req.query.token || '');
  const registro = await verificarTokenReset(token);
  if (!registro) {
    // Sem token valido nao ha o que preencher no formulario de redefinir-senha;
    // manda de volta pra tela de solicitar um novo link.
    return res.status(400).render('admin/esqueci-senha', { erro: 'Link invalido ou expirado. Solicite um novo abaixo.', sucesso: false });
  }
  res.render('admin/redefinir-senha', { erro: null, token });
});

router.post('/redefinir-senha', resetSenhaLimiter, async (req, res) => {
  const token = String(req.body.token || '');
  const senha = String(req.body.senha || '');
  const confirmar = String(req.body.confirmarSenha || '');

  const registro = await verificarTokenReset(token);
  if (!registro) {
    return res.status(400).render('admin/esqueci-senha', { erro: 'Link invalido ou expirado. Solicite um novo abaixo.', sucesso: false });
  }
  // Mesmo minimo exigido no atributo minlength do campo em redefinir-senha.ejs.
  if (senha.length < 10) {
    return res.status(400).render('admin/redefinir-senha', { erro: 'A senha precisa ter pelo menos 10 caracteres.', token });
  }
  if (senha !== confirmar) {
    return res.status(400).render('admin/redefinir-senha', { erro: 'As senhas nao coincidem.', token });
  }

  const senhaHash = await hashSenha(senha);
  await prisma.usuario.update({
    where: { id: registro.usuarioId },
    data: {
      senhaHash,
      // Redefinir a senha tambem limpa qualquer bloqueio de login anterior.
      loginFalhas: 0, loginStrikes: 0, bloqueadoAte: null, bloqueioTotal: false,
      emailVerificado: true,
    },
  });
  await consumirToken(registro.id);
  await logSeguranca(req, 'RESET_SENHA_CONCLUIDO', registro.usuarioId, {});

  return res.render('admin/login', { erro: null, info: 'Senha definida com sucesso. Faca login normalmente.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Middleware Global de Contexto para as views administradas
router.use((req, res, next) => {
  res.locals.admUsuarioNome = req.session?.nome || '';
  res.locals.admPapel = req.session?.papel || null;
  res.locals.path = req.path;
  // Disponivel em toda view admin/*: <% if (pode('financeiro:aprovar')) { %> ... <% } %>
  res.locals.pode = (perm) => temPermissao(req.session?.papel, perm);
  next();
});

// Restricao global para as rotas abaixo: precisa estar logado como algum papel admin.
// O QUE cada papel pode fazer dentro das rotas e refinado rota a rota com requirePermissao().
router.use(requireAdmin);

// ---------- Dashboard ----------

router.get('/', async (req, res) => {
  const [totalCursos, cursosAtivos, turmasAbertas, pendentes, pagas] = await Promise.all([
    prisma.curso.count(),
    prisma.curso.count({ where: { ativo: true } }),
    prisma.turma.count({ where: { status: 'ABERTA' } }),
    prisma.matricula.count({ where: { statusPagamento: 'PENDENTE' } }),
    prisma.matricula.count({ where: { statusPagamento: 'PAGO' } }),
  ]);
  const ultimas = await prisma.matricula.findMany({
    orderBy: { criadoEm: 'desc' },
    take: 8,
    include: { aluno: true, turma: { include: { curso: true } } },
  });
  res.render('admin/dashboard', {
    stats: { totalCursos, cursosAtivos, turmasAbertas, pendentes, pagas },
    ultimas,
    formatBRL,
  });
});

// ---------- Cursos ----------
// Escrita: so quem tem 'cursos:gerenciar' (Secretaria, Coordenador, Dev).
// Leitura: tambem quem tem 'secretaria:leitura' (Financeiro, modo consulta).

router.get('/cursos', requirePermissao('cursos:gerenciar', 'secretaria:leitura'), async (req, res) => {
  const cursos = await prisma.curso.findMany({
    orderBy: { nome: 'asc' },
    include: { _count: { select: { turmas: true } } },
  });
  res.render('admin/cursos', { cursos, formatBRL, flash: req.query.ok || null, erro: req.query.erro || null });
});

router.get('/cursos/novo', requirePermissao('cursos:gerenciar'), (req, res) => {
  res.render('admin/curso-form', { curso: null, escolaridades: ESCOLARIDADES, erro: null });
});

function lerCursoDoForm(body) {
  const dados = {
    nome: String(body.nome || '').trim(),
    descricao: String(body.descricao || '').trim() || null,
    descricaoLonga: String(body.descricaoLonga || '').trim() || null,
    cargaHoraria: parseInteiro(body.cargaHoraria, { min: 1 }),
    escolaridadeMinima: ESCOLARIDADES.includes(body.escolaridadeMinima) && body.escolaridadeMinima ? body.escolaridadeMinima : null,
    precoAvista: parseDecimal(body.precoAvista),
    precoCheio: parseDecimal(body.precoCheio),
    parcelas: parseInteiro(body.parcelas, { min: 1 }),
    valorParcela: parseDecimal(body.valorParcela),
    taxaMatricula: parseDecimal(body.taxaMatricula, { opcional: true }),
    ativo: body.ativo === 'on' || body.ativo === 'true',
  };
  let erro = null;
  if (!dados.nome) erro = 'Informe o nome do curso.';
  else if (Number.isNaN(dados.cargaHoraria)) erro = 'Carga horaria invalida.';
  else if (Number.isNaN(dados.precoAvista) || Number.isNaN(dados.precoCheio) || Number.isNaN(dados.valorParcela)) erro = 'Verifique os valores (use numeros, ex.: 150.00).';
  else if (Number.isNaN(dados.parcelas)) erro = 'Numero de parcelas invalido.';
  else if (Number.isNaN(dados.taxaMatricula)) erro = 'Taxa de matricula invalida (deixe em branco para usar o padrao).';
  return { dados, erro };
}

router.post('/cursos', requirePermissao('cursos:gerenciar'), uploadFoto, async (req, res) => {
  if (req.uploadErro) return res.status(400).render('admin/curso-form', { curso: req.body, escolaridades: ESCOLARIDADES, erro: req.uploadErro });
  const { dados, erro } = lerCursoDoForm(req.body);
  if (erro) return res.status(400).render('admin/curso-form', { curso: req.body, escolaridades: ESCOLARIDADES, erro });
  dados.imagemUrl = req.file ? await salvarFotoCurso(req.file) : null;
  const curso = await prisma.curso.create({ data: dados });
  await auditar(req, 'CRIOU_CURSO', 'Curso', curso.id, { nome: curso.nome });
  res.redirect('/cursos?ok=Curso criado.');
});

router.get('/cursos/:id/editar', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const curso = await prisma.curso.findUnique({
    where: { id: req.params.id },
    include: { faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] } },
  });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });
  res.render('admin/curso-form', { curso, escolaridades: ESCOLARIDADES, erro: null, erroFaq: req.query.erroFaq || null });
});

router.post('/cursos/:id/faqs', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });
  const pergunta = String(req.body.pergunta || '').trim();
  const resposta = String(req.body.resposta || '').trim();
  if (!pergunta || !resposta) {
    return res.redirect(`/cursos/${curso.id}/editar?erroFaq=` + encodeURIComponent('Preencha a pergunta e a resposta.'));
  }
  const total = await prisma.faqCurso.count({ where: { cursoId: curso.id } });
  await prisma.faqCurso.create({ data: { cursoId: curso.id, pergunta, resposta, ordem: total } });
  await auditar(req, 'ADICIONOU_FAQ', 'Curso', curso.id, { pergunta });
  res.redirect(`/cursos/${curso.id}/editar#duvidas`);
});

router.post('/cursos/:id/faqs/:faqId/remover', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const faq = await prisma.faqCurso.findUnique({ where: { id: req.params.faqId } });
  if (!faq || faq.cursoId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Duvida nao encontrada.' });
  await prisma.faqCurso.delete({ where: { id: faq.id } });
  await auditar(req, 'REMOVEU_FAQ', 'Curso', req.params.id, { pergunta: faq.pergunta });
  res.redirect(`/cursos/${req.params.id}/editar#duvidas`);
});

router.post('/cursos/:id', requirePermissao('cursos:gerenciar'), uploadFoto, async (req, res) => {
  const existe = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });
  if (req.uploadErro) return res.status(400).render('admin/curso-form', { curso: { ...req.body, id: req.params.id, imagemUrl: existe.imagemUrl }, escolaridades: ESCOLARIDADES, erro: req.uploadErro });
  const { dados, erro } = lerCursoDoForm(req.body);
  if (erro) return res.status(400).render('admin/curso-form', { curso: { ...req.body, id: req.params.id, imagemUrl: existe.imagemUrl }, escolaridades: ESCOLARIDADES, erro });
  if (req.file) {
    dados.imagemUrl = await salvarFotoCurso(req.file);
    await removerFotoCurso(existe.imagemUrl); 
  } else if (req.body.removerFoto === 'on') {
    dados.imagemUrl = null;
    await removerFotoCurso(existe.imagemUrl); 
  } else {
    dados.imagemUrl = existe.imagemUrl; 
  }
  await prisma.curso.update({ where: { id: req.params.id }, data: dados });
  await auditar(req, 'EDITOU_CURSO', 'Curso', req.params.id, { nome: dados.nome });
  res.redirect('/cursos?ok=Curso atualizado.');
});

router.post('/cursos/:id/excluir', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });

  const turmas = await prisma.turma.findMany({ where: { cursoId: curso.id }, select: { id: true } });
  const turmaIds = turmas.map((t) => t.id);
  const matriculas = turmaIds.length ? await prisma.matricula.count({ where: { turmaId: { in: turmaIds } } }) : 0;

  if (turmas.length > 0 || matriculas > 0) {
    return res.redirect('/cursos?erro=' + encodeURIComponent('Nao e possivel excluir: o curso tem turmas e/ou matriculas. Use "desativar" para tira-lo do site preservando o historico.'));
  }

  await prisma.curso.delete({ where: { id: curso.id } });
  await removerFotoCurso(curso.imagemUrl);
  await auditar(req, 'EXCLUIU_CURSO', 'Curso', curso.id, { nome: curso.nome });
  res.redirect('/cursos?ok=Curso excluido.');
});

router.post('/cursos/:id/ativar', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });
  await prisma.curso.update({ where: { id: curso.id }, data: { ativo: !curso.ativo } });
  await auditar(req, curso.ativo ? 'DESATIVOU_CURSO' : 'ATIVOU_CURSO', 'Curso', curso.id, null);
  res.redirect('/cursos?ok=' + (curso.ativo ? 'Curso desativado.' : 'Curso ativado.'));
});

// ---------- Turmas ----------
// Mesma logica: escrita exige 'turmas:gerenciar'; leitura tambem aceita 'secretaria:leitura'.

router.get('/turmas', requirePermissao('turmas:gerenciar', 'secretaria:leitura'), async (req, res) => {
  const turmas = await prisma.turma.findMany({
    orderBy: { criadoEm: 'desc' },
    include: {
      curso: true,
      aulas: { orderBy: { data: 'asc' }, take: 1 },
      _count: { select: { matriculas: { where: { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } } } },
    },
  });
  res.render('admin/turmas', { turmas, statusTurma: STATUS_TURMA, flash: req.query.ok || null, erro: req.query.erro || null });
});

router.get('/turmas/nova', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const cursos = await prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } });
  res.render('admin/turma-form', { turma: null, aulas: [], cursos, statusTurma: STATUS_TURMA, erro: null });
});

function parseDateOnly(data) {
  if (!data) return null;

  const [ano, mes, dia] = data.split('-').map(Number);

  // Meio-dia evita problemas de fuso horário
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

function lerTurmaDoForm(body) {
  const dados = {
    cursoId: String(body.cursoId || ''),
    inicioPrevisto: parseDateOnly(body.inicioPrevisto),
    vagas: parseInteiro(body.vagas, { min: 1 }),
    minimoAlunos: parseInteiro(body.minimoAlunos, { min: 0 }),
    status: STATUS_TURMA.includes(body.status) ? body.status : 'ABERTA',
  };

  const aulasRaw = body.aulas || {};

  const aulas = Object.values(aulasRaw)
    .map(a => ({
      data: parseDateOnly(a.data),
      horario: String(a.horario || '').trim(),
    }))
    .filter(a => a.data && !isNaN(a.data.getTime()) && a.horario);

  let erro = null;

  if (!dados.cursoId) erro = 'Selecione o curso.';
  else if (!dados.inicioPrevisto) erro = 'Informe a data de início prevista.';
  else if (Number.isNaN(dados.vagas)) erro = 'Numero de vagas invalido.';
  else if (Number.isNaN(dados.minimoAlunos)) erro = 'Minimo de alunos invalido.';
  // else if (!aulas.length) erro = 'Adicione pelo menos uma aula.';

  return { dados, aulas, erro };
}

router.post('/turmas', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const { dados, aulas, erro } = lerTurmaDoForm(req.body);
  if (erro) {
    const cursos = await prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } });
    return res.status(400).render('admin/turma-form', { turma: req.body, aulas: [], cursos, statusTurma: STATUS_TURMA, erro });
  }
  const turma = await prisma.turma.create({
    data: {
      ...dados,
      aulas: { create: aulas },
    },
  });
  await auditar(req, 'CRIOU_TURMA', 'Turma', turma.id, { cursoId: dados.cursoId });
  res.redirect('/turmas?ok=Turma criada.');
});

router.get('/turmas/:id/editar', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const [turma, cursos] = await Promise.all([
    prisma.turma.findUnique({ where: { id: req.params.id }, include: { aulas: { orderBy: { data: 'asc' } } } }),
    prisma.curso.findMany({ orderBy: { nome: 'asc' } }),
  ]);
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma nao encontrada.' });
  res.render('admin/turma-form', { turma, aulas: turma.aulas, cursos, statusTurma: STATUS_TURMA, erro: null });
});

router.post('/turmas/:id', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const existe = await prisma.turma.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).render('admin/erro', { mensagem: 'Turma nao encontrada.' });
  const { dados, aulas, erro } = lerTurmaDoForm(req.body);
  if (erro) {
    const cursos = await prisma.curso.findMany({ orderBy: { nome: 'asc' } });
    return res.status(400).render('admin/turma-form', { turma: { ...req.body, id: req.params.id }, aulas: [], cursos, statusTurma: STATUS_TURMA, erro });
  }
  // Apaga as aulas antigas e recria (mais simples que diff)
  await prisma.aulaData.deleteMany({ where: { turmaId: req.params.id } });
  await prisma.turma.update({
    where: { id: req.params.id },
    data: {
      ...dados,
      aulas: { create: aulas },
    },
  });
  await auditar(req, 'EDITOU_TURMA', 'Turma', req.params.id, null);
  res.redirect('/turmas?ok=Turma atualizada.');
});

async function recalcularMedia(matriculaId) {
  const avals = await prisma.avaliacao.findMany({ where: { matriculaId } });
  let media = null;
  if (avals.length) {
    const somaPesos = avals.reduce((s, a) => s + a.peso, 0);
    media = somaPesos > 0 ? Math.round((avals.reduce((s, a) => s + a.nota * a.peso, 0) / somaPesos) * 100) / 100 : null;
  }
  await prisma.matricula.update({ where: { id: matriculaId }, data: { nota: media } });
  return media;
}

router.post('/turmas/:id/notas', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.id },
    include: { matriculas: true },
  });
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma nao encontrada.' });

  const nome = String(req.body.nome || '').trim();
  const peso = Number(String(req.body.peso || '1').replace(',', '.'));
  if (!nome || nome.length > 60) return res.status(400).render('admin/erro', { mensagem: 'De um nome a avaliacao.' });
  if (Number.isNaN(peso) || peso <= 0 || peso > 100) return res.status(400).render('admin/erro', { mensagem: 'Peso invalido.' });

  const mapNotas = req.body || {}; 
  let lancadas = 0;
  for (const m of turma.matriculas) {
    const raw = mapNotas['nota[' + m.id + ']'];
    if (raw === undefined || String(raw).trim() === '') continue; 
    const nota = Number(String(raw).replace(',', '.'));
    if (Number.isNaN(nota) || nota < 0 || nota > 10) {
      return res.status(400).render('admin/erro', { mensagem: `Nota invalida (${nome}). Use valores de 0 a 10.` });
    }
    await prisma.avaliacao.create({ data: { matriculaId: m.id, nome, nota: Math.round(nota * 100) / 100, peso } });
    await recalcularMedia(m.id);
    lancadas++;
  }
  await auditar(req, 'LANCOU_NOTAS_LOTE', 'Turma', turma.id, { nome, peso, lancadas });
  res.redirect(`/turmas/${turma.id}/notas?ok=` + encodeURIComponent(`Avaliacao "${nome}" lancada para ${lancadas} aluno(s).`));
});

router.post('/turmas/:id/excluir', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const turma = await prisma.turma.findUnique({ where: { id: req.params.id }, include: { curso: true } });
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma nao encontrada.' });

  const matriculas = await prisma.matricula.count({ where: { turmaId: turma.id } });
  if (matriculas > 0) {
    return res.redirect('/turmas?erro=' + encodeURIComponent('Nao e possivel excluir: a turma tem aluno(s) matriculado(s). Use o status "CANCELADA" ou "ENCERRADA" para tira-la do site preservando o historico.'));
  }

  await prisma.turma.delete({ where: { id: turma.id } });
  await auditar(req, 'EXCLUIU_TURMA', 'Turma', turma.id, { cursoId: turma.cursoId, curso: turma.curso.nome });
  res.redirect('/turmas?ok=Turma excluida.');
});

// ---------- Inscricoes / Pagamentos ----------
// A pagina e compartilhada: Secretaria (doacao/alimento), Coordenador e Financeiro (pagamento) todos entram,
// mas os BOTOES de acao (confirmar/cancelar/estornar pagamento vs. marcar alimento entregue) sao
// controlados na view via res.locals.pode(...). Cada acao POST tem sua propria permissao especifica.

router.get('/inscricoes', requirePermissao('doacao:confirmar', 'financeiro:aprovar', 'financeiro:leitura'), async (req, res) => {
  const turmaId = req.query.turma || null;
  
  // FIX: Reintroduzido o status 'PENDENTE'. Sem ele, compras PIX novas sumiam do painel impossibilitando a alteracao de tag
  const where = {
    taxaConfirmada: true,
    statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] },
    ...(turmaId ? { turmaId } : {})
  };

  const [inscricoes, turmas] = await Promise.all([
    prisma.matricula.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
    }),
    prisma.turma.findMany({ orderBy: { criadoEm: 'desc' }, include: { curso: true } }),
]);
  res.render('admin/inscricoes', { inscricoes, turmas, turmaId, formatBRL, statusBadge, flash: req.query.ok || null });
});

// Aprovacao de pagamento do curso: EXCLUSIVO de quem tem 'financeiro:aprovar' (Financeiro e Dev).
// Secretaria e Coordenador NAO tem essa permissao (Coordenador so tem financeiro:leitura).
router.post('/inscricoes/:id/confirmar', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({
    where: { id: m.id },
    data: { statusPagamento: 'PAGO', confirmadaPor: req.session.usuarioId, confirmadaEm: new Date() },
  });
  await auditar(req, 'CONFIRMOU_PAGAMENTO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Pagamento confirmado.'));
});

router.post('/inscricoes/:id/cancelar', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'CANCELADO' } });
  await auditar(req, 'CANCELOU_INSCRICAO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Inscricao cancelada.'));
});

router.post('/inscricoes/:id/estornar', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'ESTORNADO' } });
  await auditar(req, 'ESTORNOU_PAGAMENTO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Pagamento estornado.'));
});

// Confirmacao de doacao (entrega de alimento): permissao da Secretaria, nao do Financeiro.
router.post('/inscricoes/:id/alimento', requirePermissao('doacao:confirmar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { alimentoEntregue: !m.alimentoEntregue } });
  await auditar(req, 'ALTEROU_ALIMENTO', 'Matricula', m.id, { entregue: !m.alimentoEntregue });
  res.redirect(back(req, 'Atualizado.'));
});

router.get('/inscricoes/:id/nota', requirePermissao('turmas:gerenciar', 'secretaria:leitura'), async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { aluno: true, turma: { include: { curso: true } }, avaliacoes: { orderBy: { criadoEm: 'desc' } } },
  });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  res.render('admin/nota', { m, erro: null });
});

router.post('/inscricoes/:id/avaliacoes', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id }, include: { aluno: true, turma: { include: { curso: true } }, avaliacoes: true } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });

  const reErro = (msg) => res.status(400).render('admin/nota', { m, erro: msg });
  const nome = String(req.body.nome || '').trim();
  const nota = Number(String(req.body.nota || '').replace(',', '.'));
  const peso = Number(String(req.body.peso || '1').replace(',', '.'));

  if (!nome || nome.length > 60) return reErro('De um nome a avaliacao (ex.: Prova 1).');
  if (Number.isNaN(nota) || nota < 0 || nota > 10) return reErro('A nota deve ser um numero entre 0 e 10.');
  if (Number.isNaN(peso) || peso <= 0 || peso > 100) return reErro('O peso deve ser um numero maior que zero.');

  await prisma.avaliacao.create({ data: { matriculaId: m.id, nome, nota: Math.round(nota * 100) / 100, peso } });
  const media = await recalcularMedia(m.id);
  await auditar(req, 'ADICIONOU_AVALIACAO', 'Matricula', m.id, { nome, nota, peso, media });
  res.redirect(`/inscricoes/${m.id}/nota`);
});

router.post('/inscricoes/:id/avaliacoes/:avalId/remover', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const aval = await prisma.avaliacao.findUnique({ where: { id: req.params.avalId } });
  if (!aval || aval.matriculaId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Avaliacao nao encontrada.' });
  await prisma.avaliacao.delete({ where: { id: aval.id } });
  await recalcularMedia(req.params.id);
  await auditar(req, 'REMOVEU_AVALIACAO', 'Matricula', req.params.id, { nome: aval.nome });
  res.redirect(`/inscricoes/${req.params.id}/nota`);
});

router.post('/inscricoes/:id/situacao', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  const s = String(req.body.situacao || '').trim();
  let situacao = null;
  if (s === 'APROVADO' || s === 'REPROVADO') situacao = s;
  else if (s !== '') return res.status(400).render('admin/erro', { mensagem: 'Situacao invalida.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { situacao } });
  await auditar(req, 'DEFINIU_SITUACAO', 'Matricula', m.id, { situacao });
  res.redirect(`/inscricoes/${m.id}/nota`);
});

// Mover aluno de turma: permissao especifica da Secretaria.
router.get('/inscricoes/:id/transferir', requirePermissao('aluno:mover_turma'), async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { aluno: true, turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
});
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  const turmas = await prisma.turma.findMany({
    where: { id: { not: m.turmaId } },
    orderBy: { criadoEm: 'desc' },
    include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
  });
  res.render('admin/transferir', { m, turmas, formatBRL, erro: null });
});

router.post('/inscricoes/:id/transferir', requirePermissao('aluno:mover_turma'), async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { turma: { include: { curso: true } } },
  });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });

  const destinoId = String(req.body.turmaDestino || '');
  const reRenderErro = async (erro) => {
    const turmas = await prisma.turma.findMany({
      where: { id: { not: m.turmaId } },
      orderBy: { criadoEm: 'desc' },
      include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } },
    });
    const mCompleto = await prisma.matricula.findUnique({ where: { id: m.id }, include: { aluno: true, turma: { include: { curso: true } } } });
    return res.status(400).render('admin/transferir', { m: mCompleto, turmas, formatBRL, erro });
  };

  if (!destinoId || destinoId === m.turmaId) return reRenderErro('Selecione uma turma de destino diferente da atual.');

  const destino = await prisma.turma.findUnique({ where: { id: destinoId }, include: { curso: true } });
  if (!destino) return reRenderErro('Turma de destino nao encontrada.');

  const mesmoCurso = destino.cursoId === m.turma.cursoId;
  const dados = { turmaId: destino.id };
  let msg = `Aluno transferido para "${destino.curso.nome}".`;

  if (!mesmoCurso) {
    const novoValor = m.plano === 'A_VISTA' ? Number(destino.curso.precoAvista) : Number(destino.curso.precoCheio);
    const valorAntigo = Number(m.valorCurso);
    const diff = novoValor - valorAntigo;
    dados.valorCurso = novoValor;
    if (diff > 0) msg += ` Diferenca a COBRAR do aluno: ${formatBRL(diff)}.`;
    else if (diff < 0) msg += ` Valor a ESTORNAR ao aluno: ${formatBRL(Math.abs(diff))}.`;
    else msg += ' Sem diferenca de valor.';
  } else {
    msg += ' Mesmo curso — sem alteracao de valores.';
  }

  await prisma.matricula.update({ where: { id: m.id }, data: dados });
  await auditar(req, 'TRANSFERIU_ALUNO', 'Matricula', m.id, {
    de: m.turmaId, para: destino.id, mesmoCurso, novoValorCurso: dados.valorCurso ?? Number(m.valorCurso),
  });
  res.redirect('/inscricoes?ok=' + encodeURIComponent(msg));
});

// ---------- Alunos (listar, buscar, editar dados basicos) ----------

router.get('/alunos', requirePermissao('aluno:gerenciar', 'secretaria:leitura'), async (req, res) => {
  const busca = String(req.query.q || '').trim();
  const soDigitos = busca.replace(/\D/g, '');
  const where = { papel: 'ALUNO' };

  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      { email: { contains: busca, mode: 'insensitive' } },
      ...(soDigitos ? [{ cpfCnpj: { contains: soDigitos } }] : []),
    ];
  }

  try {
    const alunos = await prisma.usuario.findMany({
      where,
      orderBy: { nome: 'asc' },
      take: 200,
      include: { _count: { select: { matriculas: true } } }
    });

    res.render('admin/alunos', { 
      alunos, 
      busca, 
      ok: req.query.ok || null,
      mascarar 
    });
  } catch (err) {
    console.error('Erro ao listar alunos:', err);
    res.status(500).render('admin/erro', { mensagem: 'Erro ao carregar a listagem de alunos.' });
  }
});

router.get('/alunos/:id/editar', requirePermissao('aluno:gerenciar'), async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno nao encontrado.' });
  res.render('admin/aluno-form', {
    aluno,
    cpfCnpjDigitado: '', cpfCnpjAtualMascarado: aluno.cpfCnpj ? mascarar(aluno.cpfCnpj) : null,
    rgDigitado: '', rgAtualMascarado: aluno.rg ? mascararRG(aluno.rg) : null,
    escolaridades: ESCOLARIDADES_ALUNO, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, erro: null, mascarar,
  });
});

router.post('/alunos/:id/editar', requirePermissao('aluno:gerenciar'), async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno nao encontrado.' });

  const reErro = (erro) => res.status(400).render('admin/aluno-form', {
    aluno: { ...aluno, ...req.body },
    cpfCnpjDigitado: req.body.cpfCnpj || '', cpfCnpjAtualMascarado: aluno.cpfCnpj ? mascarar(aluno.cpfCnpj) : null,
    rgDigitado: req.body.rg || '', rgAtualMascarado: aluno.rg ? mascararRG(aluno.rg) : null,
    escolaridades: ESCOLARIDADES_ALUNO, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, erro, mascarar,
  });

  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const rgDigitado = String(req.body.rg || '').trim();
  const celular = String(req.body.celular || '').replace(/\D/g, '');
  const documentoDigitado = String(req.body.cpfCnpj || '').trim();
  const escolaridade = String(req.body.escolaridade || '').trim();
  const escolaridadeSituacao = String(req.body.escolaridadeSituacao || '').trim();
  const genero = String(req.body.genero || '').trim();
  const cep = String(req.body.cep || '').replace(/\D/g, '');
  const uf = String(req.body.uf || '').trim().toUpperCase();
  const logradouro = String(req.body.logradouro || '').trim();
  const numero = String(req.body.numero || '').trim();
  const complemento = String(req.body.complemento || '').trim();
  const bairro = String(req.body.bairro || '').trim();
  const cidade = String(req.body.cidade || '').trim();

  if (nome.split(/\s+/).filter(Boolean).length < 2) return reErro('Informe o nome completo (nome e sobrenome).');
  if (nome.length > 120) return reErro('Nome muito longo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reErro('Informe um e-mail valido.');
  if (email.length > 180) return reErro('E-mail muito longo.');
  if (rgDigitado.length > 20) return reErro('RG muito longo.');
  if (celular && celular.length !== 10 && celular.length !== 11) return reErro('Celular deve ter 10 ou 11 digitos (com DDD).');

  let cpfCnpjNormalizado = aluno.cpfCnpj; 
  if (documentoDigitado) {
    const doc = validarCpfCnpj(documentoDigitado);
    if (!doc.ok) return reErro('CPF/CNPJ invalido.');
    cpfCnpjNormalizado = doc.normalizado;
  }

  const rgFinal = rgDigitado || aluno.rg; 

  if (escolaridade && !ESCOLARIDADES_ALUNO.includes(escolaridade)) return reErro('Escolaridade invalida.');
  if (escolaridadeSituacao && !SITUACOES_ESCOLARIDADE.includes(escolaridadeSituacao)) return reErro('Situacao de escolaridade invalida.');
  if (escolaridade && !escolaridadeSituacao) return reErro('Selecione se o aluno esta cursando ou ja concluiu.');
  if (genero && !GENEROS.includes(genero)) return reErro('Genero invalido.');
  if (cep && cep.length !== 8) return reErro('CEP deve ter 8 digitos.');
  if (uf && !UFS.includes(uf)) return reErro('UF invalida.');

  const antes = {
    nome: aluno.nome, email: aluno.email, celular: aluno.celular,
    rg: aluno.rg ? mascararRG(aluno.rg) : null,
    cpfCnpj: aluno.cpfCnpj ? mascarar(aluno.cpfCnpj) : null,
    escolaridade: aluno.escolaridade, escolaridadeSituacao: aluno.escolaridadeSituacao, genero: aluno.genero,
    cep: aluno.cep, logradouro: aluno.logradouro, numero: aluno.numero, complemento: aluno.complemento, bairro: aluno.bairro, cidade: aluno.cidade, uf: aluno.uf,
  };
  const depois = {
    nome, email, celular: celular || null, rg: rgFinal || null,
    cpfCnpj: cpfCnpjNormalizado,
    escolaridade: escolaridade || null, escolaridadeSituacao: escolaridadeSituacao || null, genero: genero || null,
    cep: cep || null, logradouro: logradouro || null, numero: numero || null, complemento: complemento || null, bairro: bairro || null, cidade: cidade || null, uf: uf || null,
  };

  try {
    await prisma.usuario.update({ where: { id: aluno.id }, data: depois });
  } catch (err) {
    if (err.code === 'P2002') {
      const alvo = String(err.meta && err.meta.target);
      return reErro(alvo.includes('cpfCnpj') ? 'Ja existe outra conta com este CPF/CNPJ.' : 'Ja existe outra conta com este e-mail.');
    }
    throw err;
  }

  await auditar(req, 'EDITOU_ALUNO', 'Usuario', aluno.id, {
    antes,
    depois: {
      ...depois,
      cpfCnpj: depois.cpfCnpj ? mascarar(depois.cpfCnpj) : null,
      rg: depois.rg ? mascararRG(depois.rg) : null,
    },
  });
  res.redirect('/alunos?ok=' + encodeURIComponent(`Dados de ${nome.split(' ')[0]} atualizados.`));
});

// ---------- Matriculas do aluno (confirmacoes) ----------

router.get('/alunos/:id/matriculas', requirePermissao('aluno:gerenciar', 'secretaria:leitura'), async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno nao encontrado.' });

  const matriculas = await prisma.matricula.findMany({
    where: { alunoId: req.params.id },
    include: { turma: { include: { curso: true } } },
    orderBy: { criadoEm: 'desc' },
  });

  res.render('admin/aluno-matriculas', { aluno, matriculas, formatBRL, ok: req.query.ok || null });
});

// Aprovar taxa de inscricao: permissao especifica da Secretaria.
router.post('/alunos/:id/matriculas/:matriculaId/confirmar-taxa', requirePermissao('taxa:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.matriculaId } });
  if (!m || m.alunoId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Matricula nao encontrada.' });

  await prisma.matricula.update({
    where: { id: m.id },
    data: {
      taxaConfirmada: true,
      taxaConfirmadaPor: req.session.usuarioId,
      taxaConfirmadaEm: new Date(),
      // so muda pra PENDENTE se ainda nao tiver um status de pagamento ativo
      ...(m.statusPagamento === 'PAGO' || m.statusPagamento === 'PARCELADO' ? {} : { statusPagamento: 'PENDENTE' }),
    },
  });
  await auditar(req, 'CONFIRMOU_TAXA_INSCRICAO', 'Matricula', m.id, null);
  res.redirect(`/alunos/${req.params.id}/matriculas?ok=` + encodeURIComponent('Taxa de inscricao confirmada. Aluno adicionado a turma como pendente.'));
});

module.exports = router;