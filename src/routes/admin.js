// ============================================================
//  Painel da SECRETARIA (área administrativa)
//  Servido por subdomínio (secretaria.<dominio>) em produção
//  ou por porta separada (ADMIN_PORT) in desenvolvimento.
//  Sessão é independente da do aluno (host/porta diferente).
// ============================================================
const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { verificarSenha } = require('../lib/password');
const { criarCodigo2fa, verificarCodigo2fa, consumirToken, criarTokenDesbloqueio, verificarTokenDesbloqueio } = require('../lib/tokens');
const { enviarCodigo2fa, enviarAlertaLoginSecretaria, enviarLinkDesbloqueio } = require('../lib/email');
const { ESCOLARIDADES: ESCOLARIDADES_ALUNO, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');
const { mascarar, mascararRG, validarCpfCnpj } = require('../lib/documento');
const { formatBRL } = require('../lib/matricula');
const { uploadFoto, salvarFotoCurso, removerFotoCurso } = require('../lib/upload');

const router = express.Router();

// ---------- Helpers ----------

// Tempo máximo de inatividade no painel antes de deslogar (15 min).
const IDLE_MS = 15 * 60 * 1000;

function requireAdmin(req, res, next) {
  if (req.session && req.session.usuarioId && req.session.papel === 'SECRETARIA') {
    const agora = Date.now();
    if (req.session.adminLastSeen && agora - req.session.adminLastSeen > IDLE_MS) {
      return req.session.destroy(() => res.redirect('/login?expirado=1'));
    }
    req.session.adminLastSeen = agora;
    return next();
  }
  return res.redirect('/login');
}

// Registra uma ação da secretaria (trilha de auditoria).
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

// Converte texto de formulário em número decimal válido (ou null se vazio/opcional).
function parseDecimal(v, { opcional = false } = {}) {
  if (v == null || String(v).trim() === '') return opcional ? null : NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function parseInteiro(v, { min = 0 } = {}) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

// Auxiliar para retornar à página anterior de forma segura com mensagem de sucesso
function back(req, msg) {
  const url = req.get('Referer') || '/inscricoes';
  const queryConector = url.includes('?') ? '&' : '?';
  return `${url}${queryConector}ok=${encodeURIComponent(msg)}`;
}

const ESCOLARIDADES = ['', 'Ensino Fundamental', 'Ensino Médio', 'Ensino Superior'];
const STATUS_TURMA = ['ABERTA', 'CONFIRMADA', 'CANCELADA', 'ENCERRADA'];

// ---------- Login da secretaria (senha → 2FA por e-mail) ----------

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
    console.error('Falha ao gravar log de segurança:', e.message);
  }
}

router.get('/login', (req, res) => {
  if (req.session && req.session.usuarioId && req.session.papel === 'SECRETARIA') {
    return res.redirect('/');
  }
  const info = req.query.expirado ? 'Sessão encerrada por inatividade. Entre novamente.' : null;
  res.render('admin/login', { erro: null, info });
});

router.post('/login', loginAdminLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const falha = () => res.status(401).render('admin/login', { erro: 'E-mail ou senha inválidos.' });

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || usuario.papel !== 'SECRETARIA') {
      await logSeguranca(req, 'LOGIN_FALHO', null, { email, motivo: 'usuario_inexistente_ou_nao_secretaria' });
      return falha();
    }

    if (usuario.bloqueioTotal) {
      await logSeguranca(req, 'LOGIN_BLOQUEADO', usuario.id, { email, motivo: 'bloqueio_total' });
      return res.status(403).render('admin/login', {
        erro: 'Conta bloqueada por segurança após várias tentativas. Use o link de desbloqueio enviado ao e-mail oficial — ou reenvie abaixo.',
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
          erro: 'Conta bloqueada por segurança. Enviamos um link de desbloqueio para o e-mail oficial da secretaria.',
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
    console.error('Erro no login da secretaria:', err);
    return res.status(500).render('admin/erro', { mensagem: 'Erro ao processar o login.' });
  }
});

router.get('/login/2fa', (req, res) => {
  const pend = req.session.pendingAdmin2fa;
  if (!pend) return res.redirect('/login');
  const sucesso = req.query.reenviado ? 'Enviamos um novo código para o seu e-mail.' : null;
  res.render('admin/login-2fa', { erro: null, sucesso, emailMasc: mascararEmail(pend.email) });
});

router.post('/login/2fa', codigo2faLimiter, async (req, res) => {
  const pend = req.session.pendingAdmin2fa;
  if (!pend) return res.redirect('/login');

  if (Date.now() - pend.em > PENDENTE_2FA_MS) {
    delete req.session.pendingAdmin2fa;
    return res.status(401).render('admin/login', { erro: 'Tempo esgotado. Faça login novamente.' });
  }

  const codigo = String(req.body.codigo || '').replace(/\D/g, '');
  const registro = await verificarCodigo2fa(pend.id, codigo);
  if (!registro) {
    await logSeguranca(req, 'LOGIN_2FA_FALHO', pend.id, { email: pend.email, motivo: 'codigo_invalido' });
    return res.status(401).render('admin/login-2fa', { erro: 'Código inválido ou expirado.', sucesso: null, emailMasc: mascararEmail(pend.email) });
  }
  await consumirToken(registro.id);

  const usuario = await prisma.usuario.findUnique({ where: { id: pend.id } });
  if (!usuario || usuario.papel !== 'SECRETARIA') {
    delete req.session.pendingAdmin2fa;
    return res.redirect('/login');
  }

  const ip = req.ip;
  return req.session.regenerate((err) => {
    if (err) { return res.status(500).render('admin/erro', { mensagem: 'Erro ao iniciar a sessão.' }); }
    req.session.usuarioId = usuario.id;
    req.session.nome = usuario.nome;
    req.session.papel = usuario.papel;
    req.session.adminLastSeen = Date.now();
    req.session.save(async (err2) => {
      if (err2) { return res.status(500).render('admin/erro', { mensagem: 'Erro ao iniciar a sessão.' }); }
      try {
        const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        await enviarAlertaLoginSecretaria(usuario.email, usuario.nome, quando, ip);
        await auditar(req, 'LOGIN_SECRETARIA', 'Usuario', usuario.id, { ip });
      } catch (e) { console.error('Pós-login (alerta/auditoria):', e); }
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
    console.error('Erro ao reenviar código 2FA:', e);
  }
  return req.session.save(() => res.redirect('/login/2fa?reenviado=1'));
});

router.post('/desbloquear/solicitar', desbloqueioLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario && usuario.papel === 'SECRETARIA' && usuario.bloqueioTotal) {
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
    return res.status(400).render('admin/login', { erro: 'Link de desbloqueio inválido ou expirado.', info: null });
  }
  await prisma.usuario.update({
    where: { id: registro.usuarioId },
    data: { bloqueioTotal: false, loginStrikes: 0, loginFalhas: 0, bloqueadoAte: null },
  });
  await consumirToken(registro.id);
  return res.render('admin/login', { erro: null, info: 'Acesso liberado. Faça login normalmente.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Middleware Global de Contexto para as views administradas
router.use((req, res, next) => {
  res.locals.admUsuarioNome = req.session?.nome || '';
  res.locals.path = req.path;
  next();
});

// Restrição global para as rotas abaixo
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

router.get('/cursos', async (req, res) => {
  const cursos = await prisma.curso.findMany({
    orderBy: { nome: 'asc' },
    include: { _count: { select: { turmas: true } } },
  });
  res.render('admin/cursos', { cursos, formatBRL, flash: req.query.ok || null, erro: req.query.erro || null });
});

router.get('/cursos/novo', (req, res) => {
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
  else if (Number.isNaN(dados.cargaHoraria)) erro = 'Carga horária inválida.';
  else if (Number.isNaN(dados.precoAvista) || Number.isNaN(dados.precoCheio) || Number.isNaN(dados.valorParcela)) erro = 'Verifique os valores (use números, ex.: 150.00).';
  else if (Number.isNaN(dados.parcelas)) erro = 'Número de parcelas inválido.';
  else if (Number.isNaN(dados.taxaMatricula)) erro = 'Taxa de matrícula inválida (deixe em branco para usar o padrão).';
  return { dados, erro };
}

router.post('/cursos', uploadFoto, async (req, res) => {
  if (req.uploadErro) return res.status(400).render('admin/curso-form', { curso: req.body, escolaridades: ESCOLARIDADES, erro: req.uploadErro });
  const { dados, erro } = lerCursoDoForm(req.body);
  if (erro) return res.status(400).render('admin/curso-form', { curso: req.body, escolaridades: ESCOLARIDADES, erro });
  dados.imagemUrl = req.file ? await salvarFotoCurso(req.file) : null;
  const curso = await prisma.curso.create({ data: dados });
  await auditar(req, 'CRIOU_CURSO', 'Curso', curso.id, { nome: curso.nome });
  res.redirect('/cursos?ok=Curso criado.');
});

router.get('/cursos/:id/editar', async (req, res) => {
  const curso = await prisma.curso.findUnique({
    where: { id: req.params.id },
    include: { faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] } },
  });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
  res.render('admin/curso-form', { curso, escolaridades: ESCOLARIDADES, erro: null, erroFaq: req.query.erroFaq || null });
});

router.post('/cursos/:id/faqs', async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
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

router.post('/cursos/:id/faqs/:faqId/remover', async (req, res) => {
  const faq = await prisma.faqCurso.findUnique({ where: { id: req.params.faqId } });
  if (!faq || faq.cursoId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Dúvida não encontrada.' });
  await prisma.faqCurso.delete({ where: { id: faq.id } });
  await auditar(req, 'REMOVEU_FAQ', 'Curso', req.params.id, { pergunta: faq.pergunta });
  res.redirect(`/cursos/${req.params.id}/editar#duvidas`);
});

router.post('/cursos/:id', uploadFoto, async (req, res) => {
  const existe = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
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

router.post('/cursos/:id/excluir', async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });

  const turmas = await prisma.turma.findMany({ where: { cursoId: curso.id }, select: { id: true } });
  const turmaIds = turmas.map((t) => t.id);
  const matriculas = turmaIds.length ? await prisma.matricula.count({ where: { turmaId: { in: turmaIds } } }) : 0;

  if (turmas.length > 0 || matriculas > 0) {
    return res.redirect('/cursos?erro=' + encodeURIComponent('Não é possível excluir: o curso tem turmas e/ou matrículas. Use "desativar" para tirá-lo do site preservando o histórico.'));
  }

  await prisma.curso.delete({ where: { id: curso.id } });
  await removerFotoCurso(curso.imagemUrl);
  await auditar(req, 'EXCLUIU_CURSO', 'Curso', curso.id, { nome: curso.nome });
  res.redirect('/cursos?ok=Curso excluído.');
});

router.post('/cursos/:id/ativar', async (req, res) => {
  const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
  if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
  await prisma.curso.update({ where: { id: curso.id }, data: { ativo: !curso.ativo } });
  await auditar(req, curso.ativo ? 'DESATIVOU_CURSO' : 'ATIVOU_CURSO', 'Curso', curso.id, null);
  res.redirect('/cursos?ok=' + (curso.ativo ? 'Curso desativado.' : 'Curso ativado.'));
});

// ---------- Turmas ----------

router.get('/turmas', async (req, res) => {
  const turmas = await prisma.turma.findMany({
    orderBy: { inicioPrevisto: 'asc' },
    include: { curso: true, _count: { select: { matriculas: { where: { statusPagamento: 'PAGO' } } } } },
  });
  res.render('admin/turmas', { turmas, statusTurma: STATUS_TURMA, flash: req.query.ok || null, erro: req.query.erro || null });
});

router.get('/turmas/nova', async (req, res) => {
  const cursos = await prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } });
  res.render('admin/turma-form', { turma: null, cursos, statusTurma: STATUS_TURMA, erro: null });
});

function lerTurmaDoForm(body) {
  const dados = {
    cursoId: String(body.cursoId || ''),
    inicioPrevisto: body.inicioPrevisto ? new Date(body.inicioPrevisto) : null,
    fimPrevisto: body.fimPrevisto ? new Date(body.fimPrevisto) : null,
    horario: String(body.horario || '').trim(),
    diasSemana: String(body.diasSemana || '').trim(),
    vagas: parseInteiro(body.vagas, { min: 1 }),
    minimoAlunos: parseInteiro(body.minimoAlunos, { min: 0 }),
    status: STATUS_TURMA.includes(body.status) ? body.status : 'ABERTA',
  };
  let erro = null;
  if (!dados.cursoId) erro = 'Selecione o curso.';
  else if (!dados.inicioPrevisto || isNaN(dados.inicioPrevisto.getTime())) erro = 'Data de início inválida.';
  else if (!dados.horario) erro = 'Informe o horário.';
  else if (!dados.diasSemana) erro = 'Informe os dias da semana.';
  else if (Number.isNaN(dados.vagas)) erro = 'Número de vagas inválido.';
  else if (Number.isNaN(dados.minimoAlunos)) erro = 'Mínimo de alunos inválido.';
  return { dados, erro };
}

router.post('/turmas', async (req, res) => {
  const { dados, erro } = lerTurmaDoForm(req.body);
  if (erro) {
    const cursos = await prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } });
    return res.status(400).render('admin/turma-form', { turma: req.body, cursos, statusTurma: STATUS_TURMA, erro });
  }
  const turma = await prisma.turma.create({ data: dados });
  await auditar(req, 'CRIOU_TURMA', 'Turma', turma.id, { cursoId: dados.cursoId });
  res.redirect('/turmas?ok=Turma criada.');
});

router.get('/turmas/:id/notas', async (req, res) => {
  const { id } = req.params;
  const turma = await prisma.turma.findUnique({
    where: { id },
    include: {
      curso: true,
      matriculas: { include: { aluno: true }, orderBy: { criadoEm: 'asc' } },
    },
  });
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });
  res.render('admin/turma-notas', { turma, erro: null, ok: req.query.ok || null });
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

router.post('/turmas/:id/notas', async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.id },
    include: { matriculas: true },
  });
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });

  const nome = String(req.body.nome || '').trim();
  const peso = Number(String(req.body.peso || '1').replace(',', '.'));
  if (!nome || nome.length > 60) return res.status(400).render('admin/erro', { mensagem: 'Dê um nome à avaliação.' });
  if (Number.isNaN(peso) || peso <= 0 || peso > 100) return res.status(400).render('admin/erro', { mensagem: 'Peso inválido.' });

  const mapNotas = req.body || {}; 
  let lancadas = 0;
  for (const m of turma.matriculas) {
    const raw = mapNotas['nota[' + m.id + ']'];
    if (raw === undefined || String(raw).trim() === '') continue; 
    const nota = Number(String(raw).replace(',', '.'));
    if (Number.isNaN(nota) || nota < 0 || nota > 10) {
      return res.status(400).render('admin/erro', { mensagem: `Nota inválida (${nome}). Use valores de 0 a 10.` });
    }
    await prisma.avaliacao.create({ data: { matriculaId: m.id, nome, nota: Math.round(nota * 100) / 100, peso } });
    await recalcularMedia(m.id);
    lancadas++;
  }
  await auditar(req, 'LANCOU_NOTAS_LOTE', 'Turma', turma.id, { nome, peso, lancadas });
  res.redirect(`/turmas/${turma.id}/notas?ok=` + encodeURIComponent(`Avaliação "${nome}" lançada para ${lancadas} aluno(s).`));
});

router.get('/turmas/:id/editar', async (req, res) => {
  const [turma, cursos] = await Promise.all([
    prisma.turma.findUnique({ where: { id: req.params.id } }),
    prisma.curso.findMany({ orderBy: { nome: 'asc' } }),
  ]);
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });
  res.render('admin/turma-form', { turma, cursos, statusTurma: STATUS_TURMA, erro: null });
});

router.post('/turmas/:id', async (req, res) => {
  const existe = await prisma.turma.findUnique({ where: { id: req.params.id } });
  if (!existe) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });
  const { dados, erro } = lerTurmaDoForm(req.body);
  if (erro) {
    const cursos = await prisma.curso.findMany({ orderBy: { nome: 'asc' } });
    return res.status(400).render('admin/turma-form', { turma: { ...req.body, id: req.params.id }, cursos, statusTurma: STATUS_TURMA, erro });
  }
  await prisma.turma.update({ where: { id: req.params.id }, data: dados });
  await auditar(req, 'EDITOU_TURMA', 'Turma', req.params.id, null);
  res.redirect('/turmas?ok=Turma atualizada.');
});

router.post('/turmas/:id/excluir', async (req, res) => {
  const turma = await prisma.turma.findUnique({ where: { id: req.params.id }, include: { curso: true } });
  if (!turma) return res.status(404).render('admin/erro', { mensagem: 'Turma não encontrada.' });

  const matriculas = await prisma.matricula.count({ where: { turmaId: turma.id } });
  if (matriculas > 0) {
    return res.redirect('/turmas?erro=' + encodeURIComponent('Não é possível excluir: a turma tem aluno(s) matriculado(s). Use o status "CANCELADA" ou "ENCERRADA" para tirá-la do site preservando o histórico.'));
  }

  await prisma.turma.delete({ where: { id: turma.id } });
  await auditar(req, 'EXCLUIU_TURMA', 'Turma', turma.id, { cursoId: turma.cursoId, curso: turma.curso.nome });
  res.redirect('/turmas?ok=Turma excluída.');
});

// ---------- Inscrições / Pagamentos ----------

router.get('/inscricoes', async (req, res) => {
  const turmaId = req.query.turma || null;
  
  // 💡 FIX: Reintroduzido o status 'PENDENTE'. Sem ele, compras PIX novas sumiam do painel impossibilitando a alteração de tag
  const where = {
    statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] },
    ...(turmaId ? { turmaId } : {})
  };

  const [inscricoes, turmas] = await Promise.all([
    prisma.matricula.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      include: { aluno: true, turma: { include: { curso: true } } },
    }),
    prisma.turma.findMany({ orderBy: { inicioPrevisto: 'asc' }, include: { curso: true } }),
  ]);
  res.render('admin/inscricoes', { inscricoes, turmas, turmaId, formatBRL, flash: req.query.ok || null });
});

router.post('/inscricoes/:id/confirmar', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  await prisma.matricula.update({
    where: { id: m.id },
    data: { statusPagamento: 'PAGO', confirmadaPor: req.session.usuarioId, confirmadaEm: new Date() },
  });
  await auditar(req, 'CONFIRMOU_PAGAMENTO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Pagamento confirmado.'));
});

router.post('/inscricoes/:id/cancelar', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'CANCELADO' } });
  await auditar(req, 'CANCELOU_INSCRICAO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Inscrição cancelada.'));
});

router.post('/inscricoes/:id/estornar', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { statusPagamento: 'ESTORNADO' } });
  await auditar(req, 'ESTORNOU_PAGAMENTO', 'Matricula', m.id, null);
  res.redirect(back(req, 'Pagamento estornado.'));
});

router.post('/inscricoes/:id/alimento', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { alimentoEntregue: !m.alimentoEntregue } });
  await auditar(req, 'ALTEROU_ALIMENTO', 'Matricula', m.id, { entregue: !m.alimentoEntregue });
  res.redirect(back(req, 'Atualizado.'));
});

// ---------- Alunos (listar, buscar, editar dados básicos) ----------

router.get('/alunos', async (req, res) => {
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

router.get('/alunos/:id/editar', async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno não encontrado.' });
  res.render('admin/aluno-form', {
    aluno,
    cpfCnpjDigitado: '', cpfCnpjAtualMascarado: aluno.cpfCnpj ? mascarar(aluno.cpfCnpj) : null,
    rgDigitado: '', rgAtualMascarado: aluno.rg ? mascararRG(aluno.rg) : null,
    escolaridades: ESCOLARIDADES_ALUNO, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, erro: null, mascarar,
  });
});

router.post('/alunos/:id/editar', async (req, res) => {
  const aluno = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!aluno || aluno.papel !== 'ALUNO') return res.status(404).render('admin/erro', { mensagem: 'Aluno não encontrado.' });

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reErro('Informe um e-mail válido.');
  if (email.length > 180) return reErro('E-mail muito longo.');
  if (rgDigitado.length > 20) return reErro('RG muito longo.');
  if (celular && celular.length !== 10 && celular.length !== 11) return reErro('Celular deve ter 10 ou 11 dígitos (com DDD).');

  let cpfCnpjNormalizado = aluno.cpfCnpj; 
  if (documentoDigitado) {
    const doc = validarCpfCnpj(documentoDigitado);
    if (!doc.ok) return reErro('CPF/CNPJ inválido.');
    cpfCnpjNormalizado = doc.normalizado;
  }

  const rgFinal = rgDigitado || aluno.rg; 

  if (escolaridade && !ESCOLARIDADES_ALUNO.includes(escolaridade)) return reErro('Escolaridade inválida.');
  if (escolaridadeSituacao && !SITUACOES_ESCOLARIDADE.includes(escolaridadeSituacao)) return reErro('Situação de escolaridade inválida.');
  if (escolaridade && !escolaridadeSituacao) return reErro('Selecione se o aluno está cursando ou já concluiu.');
  if (genero && !GENEROS.includes(genero)) return reErro('Gênero inválido.');
  if (cep && cep.length !== 8) return reErro('CEP deve ter 8 dígitos.');
  if (uf && !UFS.includes(uf)) return reErro('UF inválida.');

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
      return reErro(alvo.includes('cpfCnpj') ? 'Já existe outra conta com este CPF/CNPJ.' : 'Já existe outra conta com este e-mail.');
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

router.get('/inscricoes/:id/nota', async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { aluno: true, turma: { include: { curso: true } }, avaliacoes: { orderBy: { criadoEm: 'asc' } } },
  });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  res.render('admin/nota', { m, erro: null });
});

router.post('/inscricoes/:id/avaliacoes', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id }, include: { aluno: true, turma: { include: { curso: true } }, avaliacoes: true } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });

  const reErro = (msg) => res.status(400).render('admin/nota', { m, erro: msg });
  const nome = String(req.body.nome || '').trim();
  const nota = Number(String(req.body.nota || '').replace(',', '.'));
  const peso = Number(String(req.body.peso || '1').replace(',', '.'));

  if (!nome || nome.length > 60) return reErro('Dê um nome à avaliação (ex.: Prova 1).');
  if (Number.isNaN(nota) || nota < 0 || nota > 10) return reErro('A nota deve ser um número entre 0 e 10.');
  if (Number.isNaN(peso) || peso <= 0 || peso > 100) return reErro('O peso deve ser um número maior que zero.');

  await prisma.avaliacao.create({ data: { matriculaId: m.id, nome, nota: Math.round(nota * 100) / 100, peso } });
  const media = await recalcularMedia(m.id);
  await auditar(req, 'ADICIONOU_AVALIACAO', 'Matricula', m.id, { nome, nota, peso, media });
  res.redirect(`/inscricoes/${m.id}/nota`);
});

router.post('/inscricoes/:id/avaliacoes/:avalId/remover', async (req, res) => {
  const aval = await prisma.avaliacao.findUnique({ where: { id: req.params.avalId } });
  if (!aval || aval.matriculaId !== req.params.id) return res.status(404).render('admin/erro', { mensagem: 'Avaliação não encontrada.' });
  await prisma.avaliacao.delete({ where: { id: aval.id } });
  await recalcularMedia(req.params.id);
  await auditar(req, 'REMOVEU_AVALIACAO', 'Matricula', req.params.id, { nome: aval.nome });
  res.redirect(`/inscricoes/${req.params.id}/nota`);
});

router.post('/inscricoes/:id/situacao', async (req, res) => {
  const m = await prisma.matricula.findUnique({ where: { id: req.params.id } });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  const s = String(req.body.situacao || '').trim();
  let situacao = null;
  if (s === 'APROVADO' || s === 'REPROVADO') situacao = s;
  else if (s !== '') return res.status(400).render('admin/erro', { mensagem: 'Situação inválida.' });
  await prisma.matricula.update({ where: { id: m.id }, data: { situacao } });
  await auditar(req, 'DEFINIU_SITUACAO', 'Matricula', m.id, { situacao });
  res.redirect(`/inscricoes/${m.id}/nota`);
});

router.get('/inscricoes/:id/transferir', async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { aluno: true, turma: { include: { curso: true } } },
  });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });
  const turmas = await prisma.turma.findMany({
    where: { id: { not: m.turmaId } },
    orderBy: { inicioPrevisto: 'asc' },
    include: { curso: true },
  });
  res.render('admin/transferir', { m, turmas, formatBRL, erro: null });
});

router.post('/inscricoes/:id/transferir', async (req, res) => {
  const m = await prisma.matricula.findUnique({
    where: { id: req.params.id },
    include: { turma: { include: { curso: true } } },
  });
  if (!m) return res.status(404).render('admin/erro', { mensagem: 'Inscrição não encontrada.' });

  const destinoId = String(req.body.turmaDestino || '');
  const reRenderErro = async (erro) => {
    const turmas = await prisma.turma.findMany({
      where: { id: { not: m.turmaId } }, orderBy: { inicioPrevisto: 'asc' }, include: { curso: true },
    });
    const mCompleto = await prisma.matricula.findUnique({ where: { id: m.id }, include: { aluno: true, turma: { include: { curso: true } } } });
    return res.status(400).render('admin/transferir', { m: mCompleto, turmas, formatBRL, erro });
  };

  if (!destinoId || destinoId === m.turmaId) return reRenderErro('Selecione uma turma de destino diferente da atual.');

  const destino = await prisma.turma.findUnique({ where: { id: destinoId }, include: { curso: true } });
  if (!destino) return reRenderErro('Turma de destino não encontrada.');

  const mesmoCurso = destino.cursoId === m.turma.cursoId;
  const dados = { turmaId: destino.id };
  let msg = `Aluno transferido para "${destino.curso.nome}".`;

  if (!mesmoCurso) {
    const novoValor = m.plano === 'A_VISTA' ? Number(destino.curso.precoAvista) : Number(destino.curso.precoCheio);
    const valorAntigo = Number(m.valorCurso);
    const diff = novoValor - valorAntigo;
    dados.valorCurso = novoValor;
    if (diff > 0) msg += ` Diferença a COBRAR do aluno: ${formatBRL(diff)}.`;
    else if (diff < 0) msg += ` Valor a ESTORNAR ao aluno: ${formatBRL(Math.abs(diff))}.`;
    else msg += ' Sem diferença de valor.';
  } else {
    msg += ' Mesmo curso — sem alteração de valores.';
  }

  await prisma.matricula.update({ where: { id: m.id }, data: dados });
  await auditar(req, 'TRANSFERIU_ALUNO', 'Matricula', m.id, {
    de: m.turmaId, para: destino.id, mesmoCurso, novoValorCurso: dados.valorCurso ?? Number(m.valorCurso),
  });
  res.redirect('/inscricoes?ok=' + encodeURIComponent(msg));
});

module.exports = router;