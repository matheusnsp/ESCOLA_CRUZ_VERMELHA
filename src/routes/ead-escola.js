// routes/ead-escola.js
//
// Etapa 6: "Minha escola" (o gestor cadastra a equipe no curso online, manda o convite, acompanha e baixa a
// declaração) e o convite do lote (/escola/convite/<código>). Layout do curso online (sem Analytics/Pixel).
// Regras em lib/ead-lote.js. Spec: docs/superpowers/specs/2026-11-08-ead-lote.md

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const L = require('../lib/ead-lote');
const { mascararCpf } = require('../lib/ead-lote-texto');

const router = express.Router();
const site = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const alunoDaSessao = (req) => (req.session && req.session.usuarioId && req.session.papel === 'ALUNO' ? req.session.usuarioId : null);

router.use(['/minha-escola', '/escola'], (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.locals.eadModo = 'pago'; // layout do curso online, sem a faixa "versão de teste"
  next();
});

// Atalho "Minha escola" na Minha conta: só para quem é gestor (uma consulta, só nessas páginas).
router.use(['/minha-conta', '/conta'], (req, res, next) => {
  const u = alunoDaSessao(req);
  if (!u || req.method !== 'GET') return next();
  prisma.gestorEscolaEad.count({ where: { usuarioId: u } })
    .then((n) => { res.locals.ehGestorEscola = n > 0; next(); }, () => next());
});

const naoAchou = (res) => res.status(404).render('escola/404');

const MSG_ERRO = {
  esgotado: 'Não há mais vagas neste lote. Fale com a Escola para aumentar.',
  vencido: 'O prazo para usar as vagas deste lote terminou. Fale com a Escola.',
  ja_tem_acesso: 'Esta pessoa já tem acesso ao curso (comprou ou já está num lote): nenhuma vaga foi usada.',
  comecou: 'Esta pessoa já começou o curso: a vaga não pode voltar.',
  nao_achou: 'Não encontrado.',
};

// Gestor do lote, ou 404.
const comLote = (fn) => asyncHandler(async (req, res, next) => {
  const u = alunoDaSessao(req);
  if (!u || !(await L.ehGestorDoLote(u, req.params.id))) return naoAchou(res);
  const lote = await prisma.loteEad.findUnique({ where: { id: req.params.id }, include: { escola: true, cursoOnline: { include: { curso: { select: { nome: true, cargaHoraria: true } } } }, vagasUsadas: { select: { removidaEm: true } } } });
  return fn(req, res, lote, u, next);
});
const voltar = (res, loteId, tipo, msg) => res.redirect(`/minha-escola/lote/${loteId}?${tipo}=${encodeURIComponent(msg)}`);

router.get('/minha-escola', requireLogin, asyncHandler(async (req, res) => {
  const u = alunoDaSessao(req);
  const escolas = u ? await L.escolasDoGestor(u) : [];
  if (!escolas.length) return naoAchou(res);
  res.render('escola/minha-escola', { escolas, titulo: 'Minha escola' });
}));

router.get('/minha-escola/lote/:id', requireLogin, comLote(async (req, res, lote) => {
  const funcionarios = await L.funcionariosDoLote(lote.id);
  res.render('escola/lote', {
    lote, situacao: L.situacaoDoLote(lote), funcionarios, mascararCpf,
    conviteUrl: lote.convite ? `${site()}/escola/convite/${lote.convite}` : null,
    ok: req.query.ok || null, erro: req.query.erro || null, valores: {},
  });
}));

router.post('/minha-escola/lote/:id/funcionario', requireLogin, comLote(async (req, res, lote, u) => {
  const pessoa = { nome: req.body.nome, email: req.body.email, celular: req.body.celular, cpf: req.body.cpf };
  const r = await L.cadastrarFuncionario(lote.id, pessoa, { origem: 'GESTOR', atorId: u });
  if (r.ok) return voltar(res, lote.id, 'ok', `${String(pessoa.nome).trim()} cadastrado(a). Mandamos um e-mail com o acesso.`);
  voltar(res, lote.id, 'erro', r.erro === 'conta' ? r.mensagem : MSG_ERRO[r.erro] || 'Não foi possível cadastrar.');
}));

router.post('/minha-escola/lote/:id/remover/:vagaId', requireLogin, comLote(async (req, res, lote, u) => {
  const vaga = await prisma.vagaLoteEad.findFirst({ where: { id: req.params.vagaId, loteId: lote.id } }).catch(() => null);
  if (!vaga) return naoAchou(res);
  const r = await L.removerVaga(vaga.id, u);
  voltar(res, lote.id, r.ok ? 'ok' : 'erro', r.ok ? 'Funcionário retirado. A vaga voltou para o lote.' : MSG_ERRO[r.erro]);
}));

router.post('/minha-escola/lote/:id/convite/:acao(trocar|desligar)', requireLogin, comLote(async (req, res, lote, u) => {
  if (req.params.acao === 'trocar') await L.trocarConvite(lote.id, u);
  else await L.desligarConvite(lote.id, u);
  voltar(res, lote.id, 'ok', req.params.acao === 'trocar' ? 'Link de convite novo criado. O anterior não abre mais.' : 'Link de convite desligado.');
}));

// ─── Convite ────────────────────────────────────────────────────────────────────────────────────
const comConvite = (fn) => asyncHandler(async (req, res, next) => {
  const lote = await L.loteDoConvite(req.params.codigo);
  if (!lote) return naoAchou(res);
  return fn(req, res, lote, next);
});
const urlConvite = (lote) => `/escola/convite/${lote.convite}`;

router.get('/escola/convite/:codigo', comConvite(async (req, res, lote) => {
  res.render('escola/convite', { lote, situacao: L.situacaoDoLote(lote), logado: !!alunoDaSessao(req), base: urlConvite(lote), erro: null, titulo: lote.escola.nome });
}));
router.get('/escola/convite/:codigo/:para(entrar|criar-conta)', comConvite(async (req, res, lote) => {
  req.session.returnTo = urlConvite(lote);
  res.redirect(req.params.para === 'entrar' ? '/login' : '/cadastro');
}));
router.post('/escola/convite/:codigo', requireLogin, comConvite(async (req, res, lote) => {
  const u = alunoDaSessao(req);
  if (!u) return res.redirect(urlConvite(lote));
  const r = await L.entrarPorConvite(lote.convite, u);
  if (r.ok) return res.redirect(`/online/${lote.cursoOnline.cursoId}/continuar`);
  if (r.erro === 'ja_tem_acesso') return res.redirect(`/online/${lote.cursoOnline.cursoId}/continuar`);
  res.status(409).render('escola/convite', { lote, situacao: L.situacaoDoLote(lote), logado: true, base: urlConvite(lote), erro: MSG_ERRO[r.erro] || 'Não foi possível usar a vaga.', titulo: lote.escola.nome });
}));

module.exports = router;
