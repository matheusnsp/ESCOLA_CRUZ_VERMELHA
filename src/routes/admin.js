// ============================================================
//  Painel Administrativo (Secretaria / Coordenacao / Financeiro / Dev)
//  Servido por subdominio (secretaria.<dominio>) em producao
//  ou por porta separada (ADMIN_PORT) em desenvolvimento.
//  Sessao e independente da do aluno (host/porta diferente).
// ============================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const prisma = require('../db');
const { verificarSenha, hashSenha } = require('../lib/password');
const { criarCodigo2fa, verificarCodigo2fa, consumirToken, criarTokenDesbloqueio, verificarTokenDesbloqueio, criarTokenReset, verificarTokenReset } = require('../lib/tokens');
const { enviarCodigo2fa, enviarAlertaLoginSecretaria, enviarLinkDesbloqueio, enviarEmailResetSenha } = require('../lib/email');
const { ESCOLARIDADES: ESCOLARIDADES_ALUNO, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');
const { mascarar, mascararRG, validarCpfCnpj } = require('../lib/documento');
const { formatBRL, calcularValores } = require('../lib/matricula');
const { estornarTransacao } = require('../lib/unicopag'); // 💡 A3 — refund real no gateway
const { coletarDadosRelatorio, gerarExcel, gerarPdf } = require('../lib/relatorio'); // relatórios Excel/PDF
const { uploadFoto, salvarFotoCurso, removerFotoCurso } = require('../lib/upload');
const { temPermissao, PAPEIS_ADMIN, listarPermissoes } = require('../lib/permissoes');

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

// ---------- Helpers ----------

// Tempo maximo de inatividade no painel antes de deslogar (15 min).
const IDLE_MS = 15 * 60 * 1000;

function whereAlunoOnline() {
  const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000);
  return { papel: 'ALUNO', ultimaAtividade: { gte: cincoMinAtras } };
}

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

function requirePermissao(...perms) {
  return (req, res, next) => {
    if (perms.some((p) => temPermissao(req.session.papel, p))) return next();
    return res.status(403).render('admin/erro', { mensagem: 'Voce nao tem permissao para esta acao.' });
  };
}

function requireDev(req, res, next) {
  if (req.session && req.session.papel === 'DEV') return next();
  return res.status(403).render('admin/erro', { mensagem: 'Esta área é restrita ao Dev.' });
}

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

function parseDecimal(v, { opcional = false } = {}) {
  if (v == null || String(v).trim() === '') return opcional ? null : NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function parseInteiro(v, { min = 0 } = {}) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

async function sincronizarPagamentoManual(req, matricula, tipo, novoStatus) {
  try {
    const existentes = await prisma.pagamento.findMany({
      where: { matriculaId: matricula.id, tipo },
    });
    if (existentes.length > 0) {
      await prisma.pagamento.updateMany({
        where: { matriculaId: matricula.id, tipo },
        data: { status: novoStatus, gatewayStatus: `manual:${novoStatus.toLowerCase()}` },
      });
      return;
    }
    const valor = tipo === 'TAXA'
      ? Number(matricula.valorTaxaMatricula) || 0
      : Number(matricula.valorCurso) || 0;
    await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        tipo,
        metodo: matricula.forma || 'DINHEIRO',
        valor,
        status: novoStatus,
        gateway: 'manual',
        gatewayStatus: `manual:${novoStatus.toLowerCase()} por ${req.session.usuarioId || 'admin'}`,
      },
    });
  } catch (e) {
    console.error('[A2] Falha ao sincronizar Pagamento manual:', e.message);
  }
}

function back(req, msg) {
  const turma = req.body && req.body.turma ? String(req.body.turma) : null;
  const status = req.body && req.body.status ? String(req.body.status) : null;
  const q = req.body && req.body.q ? String(req.body.q) : null;

  let url;
  if (turma || status || q) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (turma) params.set('turma', turma);
    if (status) params.set('status', status);
    url = `/inscricoes?${params.toString()}`;
  } else {
    url = req.get('Referer') || '/inscricoes';
  }

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

const ESCOLARIDADES = ['', 'Ensino Fundamental', 'Ensino Médio', 'Ensino Superior'];
const STATUS_TURMA = ['ABERTA', 'CONFIRMADA', 'CANCELADA', 'ENCERRADA'];

const DEVICE_2FA_COOKIE = 'cvbrj_admin_2fa';

function hojeSPStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

// 💡 FIX — Novo helper: retorna o instante exato da meia-noite de "hoje" em
// horario de Brasilia (America/Sao_Paulo), independente do timezone
// configurado no processo Node/servidor. Antes, o Dashboard calculava
// "inicio do dia" com `new Date(); setHours(0,0,0,0)`, que usa o timezone
// LOCAL do servidor — se o servidor rodar em UTC (comum em hospedagens tipo
// Render/Heroku/Docker sem TZ definida), a meia-noite do Node cai as 21h de
// Brasilia do dia anterior, deslocando o contador "alunosHoje" em 3 horas.
// O Brasil nao usa mais horario de verao desde 2019, entao o offset fixo
// "-03:00" e seguro aqui (diferente do calculo de expiracao do cookie 2FA
// em msAteMeiaNoiteSP, que usa outra abordagem por outro motivo).
function inicioDoDiaSP() {
  const diaSP = hojeSPStr(); // ex.: "2026-08-21"
  return new Date(`${diaSP}T00:00:00-03:00`);
}

function assinarDispositivo(usuarioId, dia) {
  const segredo = process.env.SESSION_SECRET || 'troque-este-segredo';
  return crypto.createHmac('sha256', segredo).update(`${usuarioId}:${dia}`).digest('hex');
}

function lerCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((par) => {
    const idx = par.indexOf('=');
    if (idx === -1) return;
    out[par.slice(0, idx).trim()] = decodeURIComponent(par.slice(idx + 1).trim());
  });
  return out;
}

function dispositivoConfirmadoHoje(req, usuarioId) {
  const val = lerCookies(req)[DEVICE_2FA_COOKIE];
  if (!val) return false;
  const [uid, dia, assinatura] = val.split('.');
  if (uid !== usuarioId || dia !== hojeSPStr()) return false;
  return assinatura === assinarDispositivo(usuarioId, dia);
}

function msAteMeiaNoiteSP() {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const meia = new Date(agora);
  meia.setHours(24, 0, 0, 0);
  return meia.getTime() - agora.getTime();
}

function marcarDispositivoConfirmado(res, usuarioId) {
  const dia = hojeSPStr();
  const valor = `${usuarioId}.${dia}.${assinarDispositivo(usuarioId, dia)}`;
  res.cookie(DEVICE_2FA_COOKIE, valor, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: msAteMeiaNoiteSP(),
  });
}

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

async function logarComoAdmin(req, res, usuario) {
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

    if (dispositivoConfirmadoHoje(req, usuario.id)) {
      return logarComoAdmin(req, res, usuario);
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

  marcarDispositivoConfirmado(res, usuario.id);
  return logarComoAdmin(req, res, usuario);
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

const resetSenhaLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.get('/esqueci-senha', (req, res) => {
  res.render('admin/esqueci-senha', { erro: null, sucesso: false });
});

router.post('/esqueci-senha', resetSenhaLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario && PAPEIS_ADMIN.includes(usuario.papel)) {
      const token = await criarTokenReset(usuario.id);
      const link = `${ADMIN_URL}/redefinir-senha?token=${token}`;
      await enviarEmailResetSenha(usuario.email, usuario.nome, link);
      await logSeguranca(req, 'RESET_SENHA_SOLICITADO', usuario.id, { email });
    }
  } catch (e) {
    console.error('Erro ao solicitar redefinicao de senha:', e);
  }
  return res.render('admin/esqueci-senha', { erro: null, sucesso: true });
});

router.get('/redefinir-senha', async (req, res) => {
  const token = String(req.query.token || '');
  const registro = await verificarTokenReset(token);
  if (!registro) {
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

router.use((req, res, next) => {
  res.locals.admUsuarioNome = req.session?.nome || '';
  res.locals.admPapel = req.session?.papel || null;
  res.locals.path = req.path;
  res.locals.pode = (perm) => temPermissao(req.session?.papel, perm);
  next();
});

router.use(requireAdmin);

// ---------- Dashboard ----------

// 💡 NOVO — Mesmo filtro de "matrícula fantasma" usado em conta.js (tela do
// aluno): esconde matrículas PENDENTE + taxaConfirmada:false — ou seja,
// gente que nunca chegou a pagar nada (criou a matrícula ao aceitar o
// contrato, mas nem tentou pagar a taxa). Sem isso, o Dashboard mostrava
// esses registros normalmente nas "Últimas inscrições" e no contador
// "Pagamentos pendentes", como se fossem inscrições reais aguardando
// pagamento — quando na verdade é lixo de tentativa abandonada.
const FILTRO_MATRICULA_FANTASMA = {
  NOT: {
    statusPagamento: 'PENDENTE',
    taxaConfirmada: false,
  },
};

router.get('/', async (req, res) => {

  const inicioHoje = inicioDoDiaSP();

  const cincoMinAtras = new Date(
    Date.now() - 5 * 60 * 1000
  );

  const [
    totalCursos,
    cursosAtivos,
    turmasAbertas,
    pendentes,
    pagas,
    alunosOnline,
    alunosHoje,
    alunosHojeLista
  ] = await Promise.all([

    prisma.curso.count(),

    prisma.curso.count({
      where: {
        ativo: true,
      },
    }),

    prisma.turma.count({
      where: {
        status: 'ABERTA',
      },
    }),

    // Pagamentos pendentes
    prisma.matricula.count({
      where: {
        statusPagamento: 'PENDENTE',
        ...FILTRO_MATRICULA_FANTASMA,
      },
    }),

    // Pagos = PAGO + PARCELADO
    prisma.matricula.count({
      where: {
        statusPagamento: {
          in: ['PAGO', 'PARCELADO'],
        },
        ...FILTRO_MATRICULA_FANTASMA,
      },
    }),

    // Alunos online
    prisma.usuario.count({
      where: whereAlunoOnline(),
    }),

    // 💡 FIX — "Entraram hoje" agora inclui também quem criou conta hoje.
    // Antes filtrava só por ultimoLogin, mas quem se cadastra é redirecionado
    // direto para /minha-conta sem passar pelo handler de login, então
    // ultimoLogin fica null e o aluno não aparecia no card no mesmo dia.
    prisma.usuario.count({
      where: {
        papel: 'ALUNO',
        OR: [
          { ultimoLogin: { gte: inicioHoje } },
          { criadoEm:   { gte: inicioHoje } },
        ],
      },
    }),

    // Lista de alunos que entraram hoje (login OU cadastro no dia)
    prisma.usuario.findMany({
      where: {
        papel: 'ALUNO',
        OR: [
          { ultimoLogin: { gte: inicioHoje } },
          { criadoEm:   { gte: inicioHoje } },
        ],
      },

      // Quem fez login aparece antes; dentro do mesmo grupo, mais recente primeiro.
      orderBy: [
        { ultimoLogin: { sort: 'desc', nulls: 'last' } },
        { criadoEm: 'desc' },
      ],

      select: {
        id: true,
        nome: true,
        email: true,
        celular: true,
        ultimoLogin: true,
        criadoEm: true,   // necessário para o fallback no template
      },

      take: 200,
    }),

  ]);

  const ultimas = await prisma.matricula.findMany({

    where: FILTRO_MATRICULA_FANTASMA,

    orderBy: {
      criadoEm: 'desc',
    },

    take: 8,

    include: {
      aluno: true,
      turma: {
        include: {
          curso: true,
        },
      },
    },

  });

  res.render('admin/dashboard', {

    stats: {
      totalCursos,
      cursosAtivos,
      turmasAbertas,
      pendentes,
      pagas,
      alunosOnline,
      alunosHoje,
    },

    alunosHojeLista,

    ultimas,

    formatBRL,

    statusBadge,

  });

});

// ---------- Cursos ----------

router.get('/cursos', requirePermissao('cursos:gerenciar', 'painel:leitura'), async (req, res) => {

  const statusFiltro = ['ATIVO', 'INATIVO'].includes(req.query.status)
    ? req.query.status
    : null;

  const busca = String(req.query.q || '').trim();

  const where = {};

  if (statusFiltro === 'ATIVO') {
    where.ativo = true;
  } else if (statusFiltro === 'INATIVO') {
    where.ativo = false;
  }

  if (busca) {
    where.nome = {
      contains: busca,
      mode: 'insensitive',
    };
  }

  const [cursos, total] = await Promise.all([

    prisma.curso.findMany({
      where,
      orderBy: { nome: 'asc' },
      include: {
        _count: {
          select: {
            turmas: true,
          },
        },
      },
    }),

    prisma.curso.count(),

  ]);

  res.render('admin/cursos', {
    cursos,
    total,
    busca,
    statusFiltro,
    formatBRL,
    flash: req.query.ok || null,
    erro: req.query.erro || null,
  });

});

function backCursos(req, msg, tipo = 'ok') {
  const status = req.body && req.body.status ? String(req.body.status) : null;
  const url = status ? `/cursos?status=${encodeURIComponent(status)}` : '/cursos';
  const conector = url.includes('?') ? '&' : '?';
  return `${url}${conector}${tipo}=${encodeURIComponent(msg)}`;
}

router.get('/cursos/novo', requirePermissao('cursos:criar'), (req, res) => {
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

router.post('/cursos', requirePermissao('cursos:criar'), uploadFoto, async (req, res) => {
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
    return res.redirect(backCursos(req, 'Nao e possivel excluir: o curso tem turmas e/ou matriculas. Use "desativar" para tira-lo do site preservando o historico.', 'erro'));
  }

  await prisma.curso.delete({ where: { id: curso.id } });
  await removerFotoCurso(curso.imagemUrl);
  await auditar(req, 'EXCLUIU_CURSO', 'Curso', curso.id, { nome: curso.nome });
  res.redirect(backCursos(req, 'Curso excluido.'));
});


router.post('/cursos/:id/ativar', requirePermissao('cursos:gerenciar'), async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso nao encontrado.' });
  await prisma.curso.update({ where: { id: curso.id }, data: { ativo: !curso.ativo } });
  await auditar(req, curso.ativo ? 'DESATIVOU_CURSO' : 'ATIVOU_CURSO', 'Curso', curso.id, null);
  res.redirect(backCursos(req, curso.ativo ? 'Curso desativado.' : 'Curso ativado.'));
});

// ---------- Turmas ----------

router.get('/turmas', requirePermissao('turmas:gerenciar', 'painel:leitura'), async (req, res) => {
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
  const cursos = await prisma.curso.findMany({
    where: req.session.papel === 'DEV' ? {} : { ativo: true },
    orderBy: { nome: 'asc' },
  });
  res.render('admin/turma-form', { turma: null, aulas: [], cursos, statusTurma: STATUS_TURMA, erro: null });
});

function parseDateOnly(data) {
  if (!data) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
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

  return { dados, aulas, erro };
}

router.post('/turmas', requirePermissao('turmas:gerenciar'), async (req, res) => {
  const { dados, aulas, erro } = lerTurmaDoForm(req.body);

  const reRenderErro = async (msg) => {
    const cursos = await prisma.curso.findMany({
      where: req.session.papel === 'DEV' ? {} : { ativo: true },
      orderBy: { nome: 'asc' },
    });
    return res.status(400).render('admin/turma-form', { turma: req.body, aulas: [], cursos, statusTurma: STATUS_TURMA, erro: msg });
  };

  if (erro) return reRenderErro(erro);

  if (req.session.papel !== 'DEV') {
    const curso = await prisma.curso.findUnique({ where: { id: dados.cursoId } });
    if (!curso) return reRenderErro('Curso não encontrado.');
    if (!curso.ativo) return reRenderErro('Este curso está inativo. Apenas o Dev pode criar turmas para cursos inativos.');
  }

  const turma = await prisma.turma.create({
    data: { ...dados, aulas: { create: aulas } },
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

router.get('/inscricoes', requirePermissao(
  'doacao:confirmar',
  'financeiro:aprovar',
  'financeiro:leitura'
), async (req, res) => {

  const turmaId = req.query.turma || null;

  const busca = String(req.query.q || '').trim();

  const statusFiltro = ['PAGO,PARCELADO', 'PENDENTE'].includes(req.query.status)
    ? req.query.status
    : null;

  const where = {
    taxaConfirmada: true,

    statusPagamento: {
      in: ['PAGO', 'PARCELADO', 'PENDENTE'],
    },

    ...(turmaId ? { turmaId } : {}),
  };

  // Busca pelo aluno (nome, e-mail, CPF/CNPJ ou passaporte)
  if (busca) {
    where.aluno = {
      OR: [
        { nome: { contains: busca, mode: 'insensitive' } },
        { email: { contains: busca, mode: 'insensitive' } },
        { cpfCnpj: { contains: busca, mode: 'insensitive' } },
        { passaporte: { contains: busca, mode: 'insensitive' } },
      ],
    };
  }

  // Filtro de status
  if (statusFiltro === 'PAGO,PARCELADO') {
    where.statusPagamento = { in: ['PAGO', 'PARCELADO'] };
  } else if (statusFiltro === 'PENDENTE') {
    where.statusPagamento = 'PENDENTE';
  }

  const [inscricoes, turmas, totalFiltrado, totalGeral] = await Promise.all([

    prisma.matricula.findMany({
      where,

      orderBy: { criadoEm: 'desc' },

      include: {
        aluno: {
          include: {
            _count: { select: { matriculas: true } },
          },
        },

        turma: {
          include: {
            curso: true,
            aulas: { orderBy: { data: 'asc' }, take: 1 },
          },
        },
      },
    }),

    prisma.turma.findMany({
      orderBy: { criadoEm: 'desc' },
      include: { curso: true },
    }),

    // Total considerando os filtros atuais (q + turma + status)
    prisma.matricula.count({ where }),

    // Total geral da tela, sem nenhum filtro aplicado
    prisma.matricula.count({
      where: {
        taxaConfirmada: true,
        statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] },
      },
    }),

  ]);

  const filtrosAtivos = Boolean(busca || turmaId || statusFiltro);

  res.render('admin/inscricoes', {
    inscricoes,
    turmas,
    turmaId,
    statusFiltro,
    busca,
    totalFiltrado,
    totalGeral,
    filtrosAtivos,
    formatBRL,
    statusBadge,
    flash: req.query.ok || null,
  });

});

router.post('/inscricoes/:id/confirmar', requirePermissao('financeiro:aprovar', 'pagamento:confirmar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({
    where: { id: m.id },
    data: {
      statusPagamento: 'PAGO',
      confirmadaPor: req.session.usuarioId,
      confirmadaEm: new Date(),
      diferencaTransferencia: null,
    },
  });
  await sincronizarPagamentoManual(req, m, 'CURSO', 'PAGO');
  await auditar(req, 'CONFIRMOU_PAGAMENTO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Pagamento confirmado.'));
});

router.post('/inscricoes/:id/cancelar', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'CANCELADO' } });
  await prisma.pagamento.updateMany({
    where: { matriculaId: m.id, status: 'PENDENTE' },
    data: { status: 'CANCELADO' },
  });
  await auditar(req, 'CANCELOU_INSCRICAO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Inscricao cancelada.'));
});

// ---------- Financeiro ----------

function mapaMotivosEstorno(logs) {
  const map = {};
  for (const log of logs) {
    if (map[log.alvoId]) continue;
    try {
      const detalhe = log.detalhe ? JSON.parse(log.detalhe) : {};
      map[log.alvoId] = detalhe.motivo || 'Não informado';
    } catch {
      map[log.alvoId] = 'Não informado';
    }
  }
  return map;
}

function codigoMatricula(m) {
  return `MAT-${m.id.slice(0, 8).toUpperCase()}`;
}

router.get('/financeiro', requirePermissao('financeiro:aprovar', 'financeiro:leitura'), async (req, res) => {
  const [
    taxaPagaLista,
    matriculaGeradaLista,
    taxaPendenteLista,
    cursoPendenteLista,
    estornos,
    logsEstorno,
  ] = await Promise.all([
    prisma.matricula.findMany({
      where: { taxaConfirmada: true },
      orderBy: { taxaConfirmadaEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),

    prisma.matricula.findMany({
      where: { statusPagamento: { in: ['PAGO', 'PARCELADO'] } },
      orderBy: { confirmadaEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),

    prisma.matricula.findMany({
      where: { taxaConfirmada: false, statusPagamento: { notIn: ['ESTORNADO', 'CANCELADO'] } },
      orderBy: { criadoEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),

    prisma.matricula.findMany({
      where: {
        taxaConfirmada: true,
        statusPagamento: 'PENDENTE',
      },
      orderBy: { criadoEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),

    prisma.matricula.findMany({
      where: { statusPagamento: 'ESTORNADO' },
      orderBy: { atualizadoEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),

    prisma.logAuditoria.findMany({
      where: { acao: 'ESTORNOU_PAGAMENTO' },
      orderBy: { criadoEm: 'desc' },
    }),
  ]);

  const motivos = mapaMotivosEstorno(logsEstorno);
  const TAXA_MATRICULA_PADRAO = 100;

  const pendentesLista = [
    ...taxaPendenteLista.map((m) => ({
      m,
      tipo: 'Taxa inscrição',
      valor: Number(m.valorTaxaMatricula) || TAXA_MATRICULA_PADRAO,
      desde: m.criadoEm,
    })),

    ...cursoPendenteLista.map((m) => ({
      m,
      tipo:
        m.diferencaTransferencia != null
          ? 'Curso (diferença de transferência)'
          : 'Curso',
      valor:
        m.diferencaTransferencia != null
          ? Number(m.diferencaTransferencia)
          : Number(m.valorCurso),
      desde: m.criadoEm,
    })),
  ].sort((a, b) => b.desde - a.desde);

  const reembolsosPendentesLista = await prisma.matricula.findMany({
    where: {
      diferencaTransferencia: {
        lt: 0,
      },
    },
    orderBy: {
      atualizadoEm: 'desc',
    },
    include: {
      aluno: true,
      turma: {
        include: {
          curso: true,
        },
      },
    },
  });

  const totalAReembolsar = reembolsosPendentesLista.reduce(
    (s, m) => s + Math.abs(Number(m.diferencaTransferencia)),
    0
  );

  const totalTaxasPagas = taxaPagaLista.reduce(
    (s, m) => s + Number(m.valorTaxaMatricula || 0),
    0
  );

  const totalCursosPagos = matriculaGeradaLista.reduce(
    (s, m) => s + (Number(m.valorCurso || 0) - Number(m.valorTaxaMatricula || 0)),
    0
  );

  const taxaSemMatriculaLista = taxaPagaLista.filter(
    (m) => !['PAGO', 'PARCELADO'].includes(m.statusPagamento)
  );
  const totalTaxaSemMatricula = taxaSemMatriculaLista.reduce(
    (s, m) => s + Number(m.valorTaxaMatricula || 0),
    0
  );

  const totalRecebido =
    matriculaGeradaLista.reduce((s, m) => s + Number(m.valorCurso), 0) +
    totalTaxaSemMatricula;

  const totalPendente = cursoPendenteLista.reduce(
    (s, m) =>
      s +
      (m.diferencaTransferencia != null
        ? Number(m.diferencaTransferencia)
        : Number(m.valorCurso)),
    0
  );

  const totalEstornado = estornos.reduce(
    (s, m) => s + Number(m.valorCurso),
    0
  );

  res.render('admin/financeiro', {
    formatBRL,
    codigoMatricula,
    motivos,

    stats: {
      taxaPagaCount: taxaPagaLista.length,
      matriculaGeradaCount: matriculaGeradaLista.length,
      pendentesCount: pendentesLista.length,
      totalRecebido,
      totalPendente,
      totalTaxasPagas,
      totalCursosPagos,
      estornosCount: estornos.length,
      totalEstornado,

      reembolsosCount: reembolsosPendentesLista.length,
      totalAReembolsar,
    },

    taxaPagaLista,
    matriculaGeradaLista,
    pendentesLista,
    estornos,
    reembolsosPendentesLista,
  });
});

// ---------- Relatórios (Excel + PDF + Csv) ----------

router.get('/relatorios/completo.xlsx', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const dados = await coletarDadosRelatorio(prisma);
  const buffer = await gerarExcel(dados);
  await auditar(req, 'BAIXOU_RELATORIO', 'Relatorio', null, { formato: 'xlsx' });
  const nome = `relatorio-cvbrj-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(Buffer.from(buffer));
});

router.get('/relatorios/completo.pdf', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const dados = await coletarDadosRelatorio(prisma);
  await auditar(req, 'BAIXOU_RELATORIO', 'Relatorio', null, { formato: 'pdf' });
  const nome = `relatorio-cvbrj-${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  gerarPdf(dados, res);
});

router.get('/relatorios/completo.csv', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const dados = await coletarDadosRelatorio(prisma);
  await auditar(req, 'BAIXOU_RELATORIO', 'Relatorio', null, { formato: 'csv' });

  const linhas = [
    ['Aluno', 'E-mail', 'CPF/CNPJ', 'Curso', 'Turma', 'Status', 'Forma', 'Plano', 'Valor Taxa', 'Valor Curso', 'Taxa Confirmada', 'Data Inscrição', 'Data Confirmação'],
    ...dados.matriculas.map((m) => [
      m.aluno.nome,
      m.aluno.email,
      m.aluno.cpfCnpj || m.aluno.passaporte || '',
      m.turma.curso.nome,
      m.turma.id,
      m.statusPagamento,
      m.forma || '',
      m.plano || '',
      Number(m.valorTaxaMatricula || 0).toFixed(2),
      Number(m.valorCurso || 0).toFixed(2),
      m.taxaConfirmada ? 'Sim' : 'Não',
      m.criadoEm ? new Date(m.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
      m.confirmadaEm ? new Date(m.confirmadaEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
    ]),
  ];

  const csv = linhas
    .map((row) => row.map((cel) => `"${String(cel ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const nome = `relatorio-cvbrj-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send('\uFEFF' + csv);
});



router.post('/inscricoes/:id/reembolso-concluido', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
  });

  if (!m) {
    return res.status(404).render('admin/erro', {
      mensagem: 'Inscricao nao encontrada.',
    });
  }

  if (
    m.diferencaTransferencia == null ||
    Number(m.diferencaTransferencia) >= 0
  ) {
    return res.status(400).render('admin/erro', {
      mensagem: 'Esta matricula nao tem reembolso pendente.',
    });
  }

  const valor = m.diferencaTransferencia;

  await prisma.matricula.update({
    where: { id: m.id },
    data: {
      diferencaTransferencia: null,
    },
  });

  await auditar(
    req,
    'CONFIRMOU_REEMBOLSO_TRANSFERENCIA',
    'Matricula',
    m.id,
    { valor }
  );

  res.redirect(back(req, 'Reembolso marcado como concluido.'));
});

router.post('/inscricoes/:id/estornar', requirePermissao('financeiro:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });

  const motivo = String(req.body.motivo || '').trim() || 'Não informado';
  const apenasContabil = req.body.apenasContabil === 'on' || req.body.apenasContabil === 'true';

  async function estornarPagamento(tipo) {
    const pago = await prisma.pagamento.findFirst({
      where: { matriculaId: m.id, tipo, status: 'PAGO' },
      orderBy: { criadoEm: 'desc' },
    });
    const ref = pago?.gatewayRef || pago?.gatewayHash || null;
    if (!ref) return { ok: false, semRef: true };

    let resultado;
    try {
      resultado = await estornarTransacao(ref);
    } catch (e) {
      console.error(`[A3] Erro ao chamar refund (${tipo}):`, e.message);
      return { ok: false, semRef: false };
    }
    if (!resultado.success) return { ok: false, semRef: false };

    await prisma.pagamento.updateMany({
      where: { id: pago.id },
      data: { status: 'ESTORNADO', gatewayStatus: 'refunded', gatewayResponse: resultado.body },
    });
    return { ok: true, semRef: false };
  }

  let taxaRevertida = false;
  let avisoTaxa = null;

  if (!apenasContabil) {
    const curso = await estornarPagamento('CURSO');
    if (!curso.ok) {
      if (curso.semRef) {
        return res.status(400).render('admin/erro', {
          mensagem: 'Não encontrei a transação do curso no gateway para estornar. Se o pagamento foi feito fora da Únicopag (dinheiro/presencial), use a opção "estorno apenas contábil".',
        });
      }
      return res.status(502).render('admin/erro', {
        mensagem: 'O gateway não confirmou o estorno do curso. Nada foi alterado. Verifique no painel da Únicopag e tente novamente.',
      });
    }

    const taxa = await estornarPagamento('TAXA');
    if (taxa.ok) {
      taxaRevertida = true;
    } else if (taxa.semRef) {
      taxaRevertida = true;
    } else {
      avisoTaxa = ' ATENÇÃO: o curso foi estornado, mas o gateway NÃO confirmou o estorno da taxa de inscrição — trate a taxa manualmente no painel da Únicopag.';
      console.warn(`[A3] Taxa não estornada para matrícula ${m.id} — requer ação manual.`);
    }
  } else {
    await sincronizarPagamentoManual(req, m, 'CURSO', 'ESTORNADO');
    await sincronizarPagamentoManual(req, m, 'TAXA', 'ESTORNADO');
    taxaRevertida = true;
  }

  await prisma.matricula.update({
    where: { id: m.id },
    data: {
      statusPagamento: 'ESTORNADO',
      diferencaTransferencia: null,
      ...(taxaRevertida ? { taxaConfirmada: false, taxaConfirmadaPor: null, taxaConfirmadaEm: null } : {}),
    },
  });
  await auditar(req, 'ESTORNOU_PAGAMENTO', 'Matricula', m.id, { motivo, apenasContabil, taxaRevertida });

  const base = apenasContabil ? 'Estorno contábil (curso + taxa) registrado.' : 'Curso e taxa estornados no gateway.';
  res.redirect(back(req, base + (avisoTaxa || '')));
});

router.post('/inscricoes/:id/alimento', requirePermissao('doacao:confirmar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscricao nao encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { alimentoEntregue: !m.alimentoEntregue } });
  await auditar(req, 'ALTEROU_ALIMENTO', 'Matricula', m.id, { entregue: !m.alimentoEntregue });
  res.redirect(back(req, 'Atualizado.'));
});

router.get('/inscricoes/:id/nota', requirePermissao('turmas:gerenciar', 'painel:leitura'), async (req, res) => {
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
  res.render('admin/transferir', {
    m, turmas, formatBRL, erro: null,
    origemQ: req.query.q || '',
    origemTurma: req.query.turma || '',
    origemStatus: req.query.status || '',
  });
});

router.post('/inscricoes/:id/transferir', requirePermissao('aluno:mover_turma'), async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { turma: { include: { curso: true } } },
  });

  if (!m) {
    return res.status(404).render('admin/erro', {
      mensagem: 'Inscricao nao encontrada.',
    });
  }

  const destinoId = String(req.body.turmaDestino || '');

  const reRenderErro = async (erro) => {
    const turmas = await prisma.turma.findMany({
      where: { id: { not: m.turmaId } },
      orderBy: { criadoEm: 'desc' },
      include: {
        curso: true,
        aulas: {
          orderBy: { data: 'asc' },
          take: 1,
        },
      },
    });

    const mCompleto = await prisma.matricula.findUnique({
      where: { id: m.id },
      include: {
        aluno: true,
        turma: { include: { curso: true } },
      },
    });

    return res.status(400).render('admin/transferir', {
      m: mCompleto,
      turmas,
      formatBRL,
      erro,
    });
  };

  if (!destinoId || destinoId === m.turmaId) {
    return reRenderErro('Selecione uma turma de destino diferente da atual.');
  }

  const destino = await prisma.turma.findUnique({
    where: { id: destinoId },
    include: { curso: true },
  });

  if (!destino) {
    return reRenderErro('Turma de destino nao encontrada.');
  }

  const valorAntigo = Number(m.valorCurso);
  const valoresDestino = await calcularValores(destino.curso, m.plano, m.alunoId);
  const valorNovo = Number(valoresDestino.total);
  const diferenca = Math.round((valorNovo - valorAntigo) * 100) / 100;

  const dados = {
    turmaId: destino.id,
    valorCurso: valorNovo,
    diferencaTransferencia: diferenca !== 0 ? diferenca : null,
  };

  let msg = `Aluno transferido para "${destino.curso.nome}".`;

  if (diferenca > 0) {
    dados.statusPagamento = 'PENDENTE';
    msg += ` Diferença de ${formatBRL(diferenca)} registrada como pendente de pagamento.`;
  } else if (diferenca < 0) {
    msg += ` Reembolso de ${formatBRL(Math.abs(diferenca))} registrado.`;
  }

  await prisma.matricula.update({
    where: { id: m.id },
    data: dados,
  });

  await auditar(req, 'TRANSFERIU_ALUNO', 'Matricula', m.id, {
    de: m.turmaId,
    para: destino.id,
    valorAntigo,
    valorNovo,
    diferenca,
  });

  res.redirect(back(req, msg));
});

// ---------- Alunos ----------

router.get('/alunos', requirePermissao('aluno:gerenciar', 'painel:leitura'), async (req, res) => {
  const busca = String(req.query.q || '').trim();
  const soDigitos = busca.replace(/\D/g, '');
  const inscricao = String(req.query.inscricao || '');
  const turmaId = req.query.turma || '';

  const where = { papel: 'ALUNO' };

  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      { email: { contains: busca, mode: 'insensitive' } },
      ...(soDigitos ? [{ cpfCnpj: { contains: soDigitos } }] : []),
      { passaporte: { contains: busca, mode: 'insensitive' } },
    ];
  }

  if (turmaId) {
    where.matriculas = { some: { turmaId } };
  } else if (inscricao === 'com') {
    where.matriculas = { some: {} };
  } else if (inscricao === 'sem') {
    where.matriculas = { none: {} };
  }

  try {
    const [alunos, total, turmas] = await Promise.all([
      prisma.usuario.findMany({
        where,
        orderBy: { nome: 'asc' },
        take: 200,
        include: { _count: { select: { matriculas: true } } }
      }),
      prisma.usuario.count({ where }),
      prisma.turma.findMany({ orderBy: { criadoEm: 'desc' }, include: { curso: true } }),
    ]);

    res.render('admin/alunos', { 
      alunos, 
      total,
      busca, 
      inscricao,
      turmas,
      turmaId,
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
    cpfCnpjDigitado: '', cpfCnpjAtualMascarado: aluno.cpfCnpj ? mascarar(aluno.cpfCnpj) : null, passaporteDigitado: '',
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
  const passaporteDigitado = String(req.body.passaporte || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const paisOrigemDigitado = String(req.body.paisOrigem || '').trim();
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
    passaporte: passaporteDigitado || aluno.passaporte || null,
    paisOrigem: paisOrigemDigitado || aluno.paisOrigem || null,
    escolaridade: escolaridade || null, escolaridadeSituacao: escolaridadeSituacao || null, genero: genero || null,
    cep: cep || null, logradouro: logradouro || null, numero: numero || null, complemento: complemento || null, bairro: bairro || null, cidade: cidade || null, uf: uf || null,
  };

  try {
    await prisma.usuario.update({ where: { id: aluno.id }, data: depois });
  } catch (err) {
    if (err.code === 'P2002') {
      const alvo = String(err.meta && err.meta.target);
      return reErro(alvo.includes('cpfCnpj') ? 'Ja existe outra conta com este CPF/CNPJ.' : alvo.includes('passaporte') ? 'Ja existe outra conta com este passaporte.' : 'Ja existe outra conta com este e-mail.');
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

// ---------- Matriculas do aluno ----------

router.get('/alunos/:id/matriculas', requirePermissao('aluno:gerenciar', 'painel:leitura'), async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno nao encontrado.' });

  const matriculas = await prisma.matricula.findMany({
    where: { alunoId: req.params.id },
    include: {
      turma: {
        include: {
          curso: true,
          aulas: { orderBy: { data: 'asc' }, take: 1 },
        },
      },
    },
    orderBy: { criadoEm: 'desc' },
  });

  res.render('admin/aluno-matriculas', {
    aluno,
    matriculas,
    formatBRL,
    statusBadge,
    ok: req.query.ok || null,
  });
});

router.post('/alunos/:id/matriculas/:matriculaId/confirmar-taxa', requirePermissao('taxa:aprovar'), async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.matriculaId } });
  if (!m || m.alunoId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Matricula nao encontrada.' });

  await prisma.matricula.update({
    where: { id: m.id },
    data: {
      taxaConfirmada: true,
      taxaConfirmadaPor: req.session.usuarioId,
      taxaConfirmadaEm: new Date(),
      ...(m.statusPagamento === 'PAGO' || m.statusPagamento === 'PARCELADO' ? {} : { statusPagamento: 'PENDENTE' }),
    },
  });
  await sincronizarPagamentoManual(req, m, 'TAXA', 'PAGO');
  await auditar(req, 'CONFIRMOU_TAXA_INSCRICAO', 'Matricula', m.id, null);
  res.redirect(`/alunos/${req.params.id}/matriculas?ok=` + encodeURIComponent('Taxa de inscricao confirmada. Aluno adicionado a turma como pendente.'));
});

// ---------- Painel do Dev ----------

router.get('/dev/usuarios', requireDev, async (req, res) => {
  const usuarios = await prisma.usuario.findMany({
    where: { papel: { in: PAPEIS_ADMIN } },
    orderBy: [{ papel: 'asc' }, { nome: 'asc' }],
  });
  const linhas = usuarios.map((u) => ({ ...u, permissoes: listarPermissoes(u.papel) }));
  res.render('admin/dev-usuarios', {
    linhas,
    papeis: PAPEIS_ADMIN,
    meuId: req.session.usuarioId,
    erro: req.query.erro || null,
    ok: req.query.ok || null,
  });
});

router.post('/dev/usuarios/:id/papel', requireDev, async (req, res) => {
  if (req.params.id === req.session.usuarioId) {
    return res.redirect('/dev/usuarios?erro=' + encodeURIComponent('Você não pode alterar o próprio papel.'));
  }

  const novoPapel = String(req.body.papel || '');
  if (!PAPEIS_ADMIN.includes(novoPapel)) {
    return res.redirect('/dev/usuarios?erro=' + encodeURIComponent('Papel inválido.'));
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario || !PAPEIS_ADMIN.includes(usuario.papel)) {
    return res.redirect('/dev/usuarios?erro=' + encodeURIComponent('Usuário não encontrado.'));
  }

  const papelAntigo = usuario.papel;
  await prisma.usuario.update({ where: { id: usuario.id }, data: { papel: novoPapel } });
  await auditar(req, 'ALTEROU_PAPEL_ADMIN', 'Usuario', usuario.id, { de: papelAntigo, para: novoPapel });

  res.redirect('/dev/usuarios?ok=' + encodeURIComponent(`Papel de ${usuario.nome} alterado para ${novoPapel}.`));
});

router.get('/dev/usuarios/novo', requireDev, (req, res) => {
  res.render('admin/dev-usuario-form', { papeis: PAPEIS_ADMIN, erro: null, valores: {} });
});

router.post('/dev/usuarios/novo', requireDev, async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const papel = String(req.body.papel || '');

  const reErro = (erro) => res.status(400).render('admin/dev-usuario-form', {
    papeis: PAPEIS_ADMIN, erro, valores: { nome, email, papel },
  });

  if (nome.split(/\s+/).filter(Boolean).length < 2) return reErro('Informe o nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reErro('Informe um e-mail válido.');
  if (!PAPEIS_ADMIN.includes(papel)) return reErro('Selecione um papel válido.');

  try {
    const usuario = await prisma.usuario.create({
      data: { nome, email, papel, senhaHash: null, emailVerificado: false },
    });
    const token = await criarTokenReset(usuario.id);
    const link = `${ADMIN_URL}/redefinir-senha?token=${token}`;
    await enviarEmailResetSenha(usuario.email, usuario.nome, link);

    await auditar(req, 'CRIOU_ADMIN', 'Usuario', usuario.id, { nome, email, papel });
    res.redirect('/dev/usuarios?ok=' + encodeURIComponent(`${nome} criado como ${papel}. Enviamos um e-mail pra ele definir a senha.`));
  } catch (err) {
    if (err.code === 'P2002') return reErro('Já existe uma conta com este e-mail.');
    throw err;
  }
});

// ---------- Banimento de Alunos ----------

router.get('/banimentos', requireDev, async (req, res) => {
  const busca = String(req.query.q || '').trim();

  const where = { papel: 'ALUNO', bloqueioTotal: true };
  if (busca) {
    where.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      { email: { contains: busca, mode: 'insensitive' } },
    ];
  }

  const banidos = await prisma.usuario.findMany({
    where,
    orderBy: { atualizadoEm: 'desc' },
    include: { _count: { select: { matriculas: true } } },
  });

  const logs = await prisma.logAuditoria.findMany({
    where: { acao: 'BANIU_ALUNO', alvoId: { in: banidos.map((u) => u.id) } },
    orderBy: { criadoEm: 'desc' },
  });

  const motivoMap = {};
  for (const log of logs) {
    if (motivoMap[log.alvoId]) continue;
    try {
      const d = log.detalhe ? JSON.parse(log.detalhe) : {};
      motivoMap[log.alvoId] = { motivo: d.motivo || 'Não informado', em: log.criadoEm };
    } catch {
      motivoMap[log.alvoId] = { motivo: 'Não informado', em: log.criadoEm };
    }
  }

  res.render('admin/banimentos', {
    banidos,
    motivoMap,
    busca,
    flash: req.query.ok || null,
    ativo: 'banimentos',
  });
});

router.post('/alunos/:id/banir', requireDev, async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO')
    return res.status(404).render('admin/erro', { mensagem: 'Aluno não encontrado.' });
  if (aluno.bloqueioTotal)
    return res.redirect('/banimentos?ok=' + encodeURIComponent('Aluno já está banido.'));

  const motivo = String(req.body.motivo || '').trim() || 'Não informado';

  // Cancela matrículas ativas
  await prisma.matricula.updateMany({
    where: {
      alunoId: aluno.id,
      statusPagamento: { notIn: ['CANCELADO', 'ESTORNADO'] },
    },
    data: { statusPagamento: 'CANCELADO' },
  });

  // Cancela pagamentos pendentes
  const matriculas = await prisma.matricula.findMany({
    where: { alunoId: aluno.id },
    select: { id: true },
  });
  const ids = matriculas.map((m) => m.id);
  if (ids.length) {
    await prisma.pagamento.updateMany({
      where: { matriculaId: { in: ids }, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
  }

  await prisma.usuario.update({
    where: { id: aluno.id },
    data: {
      bloqueioTotal: true,
      loginFalhas: 0,
      bloqueadoAte: null,
      loginStrikes: 0,
    },
  });

  // Derruba todas as sessões ativas do aluno no banco
  await prisma.$executeRaw`
  DELETE FROM session WHERE sess->>'usuarioId' = ${aluno.id}
`;

  await auditar(req, 'BANIU_ALUNO', 'Usuario', aluno.id, { motivo });
  res.redirect('/banimentos?ok=' + encodeURIComponent(`${aluno.nome.split(' ')[0]} foi banido.`));
});

router.post('/alunos/:id/desbanir', requireDev, async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO')
    return res.status(404).render('admin/erro', { mensagem: 'Aluno não encontrado.' });
  if (!aluno.bloqueioTotal)
    return res.redirect('/banimentos?ok=' + encodeURIComponent('Aluno não está banido.'));

  await prisma.usuario.update({
    where: { id: aluno.id },
    data: { bloqueioTotal: false, loginFalhas: 0, loginStrikes: 0, bloqueadoAte: null },
  });

  await auditar(req, 'DESBANIU_ALUNO', 'Usuario', aluno.id, {});
  res.redirect('/banimentos?ok=' + encodeURIComponent(`${aluno.nome.split(' ')[0]} foi desbanido.`));
});

const clientesSSE = new Set();

router.get('/stats/online/stream', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clientesSSE.add(res);
  req.on('close', () => clientesSSE.delete(res));
});

router.get('/stats/online/lista', requireAdmin, async (req, res) => {
  const alunos = await prisma.usuario.findMany({
    where: whereAlunoOnline(),
    orderBy: { ultimaAtividade: 'desc' },
    select: { id: true, nome: true, email: true },
    take: 200,
  });
  res.json(alunos);
});

async function emitirOnline() {
  if (!clientesSSE.size) return;
  const online = await prisma.usuario.count({ where: whereAlunoOnline() });
  for (const res of clientesSSE) {
    res.write(`data: ${online}\n\n`);
  }
}

setInterval(emitirOnline, 5_000);

module.exports = router;