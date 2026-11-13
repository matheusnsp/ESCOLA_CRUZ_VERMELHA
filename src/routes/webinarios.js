// routes/webinarios.js
//
// Webinários da Escola Digital para o aluno (2026-11-13; spec 2026-11-13-escola-digital-webinarios-design.md §3):
//   GET  /escola-digital/webinario/:end                       página (o cartão muda conforme a situação)
//   GET  …/criar-conta  |  GET …/entrar                       cadastro/login, voltando para a página
//   POST …/inscrever                                          inscrição grátis
//   POST …/comprar                                            compra paga (PIX/cartão/cupom de 100%), como o e-book
//   GET  …/entrar-na-transmissao                              confere acesso e janela e redireciona para o link
//   GET  …/agenda.ics                                         convite para a agenda (com acesso e data)
// O link da transmissão nunca vai no HTML nem nos e-mails; só sai pelo redirecionamento.

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const wb = require('../lib/webinario');
const cupons = require('../lib/ead-cupom');
const { limiteCupom, registrarFalhaCupom, MSG_TENTATIVAS } = require('../lib/limite-cupom');
const { turmaOnline } = require('../lib/turma-online');
const { iniciarCobrancaAVista, urlRetorno } = require('../lib/cobranca-avista');
const { lerOrigem } = require('../lib/origem-da-visita');
const { icsDoWebinario } = require('../lib/agenda');
const escolaDigital = require('../lib/escola-digital');
const { URL_ESCOLA_DIGITAL } = require('../lib/vitrine');
const { compra } = require('./ead-online');

const router = express.Router();
const P = (resto = '') => `${URL_ESCOLA_DIGITAL}/webinario/:end${resto}`;
const urlDe = (w) => `${URL_ESCOLA_DIGITAL}/webinario/${wb.endereco(w.curso.nome)}`;
const aluno = (req) => (req.session && req.session.usuarioId && req.session.papel === 'ALUNO' ? req.session.usuarioId : null);
const ehDev = (req) => !!(req.session && req.session.papel === 'DEV');
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Despublicado ou Escola Digital desligada: só quem já tem acesso (ou está pagando) e DEV veem. Senão 404.
async function carregar(req) {
  const w = await wb.doEndereco(req.params.end, { incluirRascunho: true });
  if (!w) return null;
  const a = aluno(req) ? await wb.acesso(aluno(req), w) : null;
  const jaTem = a && (wb.temAcesso(a) || a.situacao === 'pendente');
  if (!w.publicado && !jaTem && !ehDev(req)) return null;
  if (!jaTem && !ehDev(req) && !(await escolaDigital.estaLigada())) return null;
  return { w, a };
}
const comWebinario = (fn) => asyncHandler(async (req, res, next) => {
  const c = await carregar(req);
  if (!c) return next();
  return fn(req, res, c.w, c.a, next);
});

// Cupom da página (como no e-book): do link (?cupom=), da sessão ou da compra pendente.
async function cupomDaPagina(req, w, m) {
  const daSessao = req.session && req.session.cupomWebinario && req.session.cupomWebinario.w === w.id ? req.session.cupomWebinario.codigo : '';
  const pediu = req.query.cupom !== undefined;
  let codigo = pediu ? cupons.normalizarCodigo(req.query.cupom) : daSessao;
  if (req.session && pediu) req.session.cupomWebinario = undefined;
  if (!codigo && !pediu && m && m.statusPagamento === 'PENDENTE') {
    const cm = await prisma.cupomMatriculaEad.findUnique({ where: { matriculaId: m.id }, include: { cupom: { select: { codigo: true } } } });
    codigo = cm ? cm.cupom.codigo : '';
  }
  if (!codigo || w.gratuito) return { cupom: null, erroCupom: null };
  if (req.cupomBloqueado) return { cupom: null, erroCupom: MSG_TENTATIVAS };
  const v = await cupons.validarCupom(codigo, w, { webinario: true });
  if (v.erro) { if (pediu && req.query.ja !== '1') registrarFalhaCupom(req); return { cupom: null, erroCupom: v.erro }; }
  if (req.session && pediu) req.session.cupomWebinario = { w: w.id, codigo: v.cupom.codigo };
  return { cupom: { codigo: v.cupom.codigo, precoCheio: v.precoCheio, desconto: v.desconto, precoFinal: v.precoFinal }, erroCupom: null };
}

router.get(P(), limiteCupom, comWebinario(async (req, res, w, a) => {
  const base = urlDe(w);
  const agora = wb.agora();
  const situacao = wb.situacaoCartao(w, a, agora);
  const m = a && a.matricula;
  const vendendo = situacao === 'comprar' || situacao === 'pendente';
  const { cupom, erroCupom } = vendendo ? await cupomDaPagina(req, w, m) : { cupom: null, erroCupom: null };
  const faqs = await prisma.faqCurso.findMany({ where: { cursoId: w.cursoId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], select: { pergunta: true, resposta: true } }).catch(() => []);
  const presenca = a && wb.temAcesso(a) ? await prisma.presencaWebinario.findUnique({ where: { webinarioId_usuarioId: { webinarioId: w.id, usuarioId: aluno(req) } } }) : null;
  // Palavra-código: para quem tem acesso, a partir do início do ao vivo (ou sempre, se só gravado).
  const janela = wb.janela(w, agora);
  const blocoPalavra = !!(a && wb.temAcesso(a) && (janela === 'sem-data' || (w.inicioEm && agora >= new Date(w.inicioEm))));
  if (w.publicado) res.removeHeader('X-Robots-Tag');
  res.render('webinario', {
    w, base, faqs, situacao, cupom, erroCupom, brl, presenca, blocoPalavra,
    // A gravação só vai para o HTML quando o cartão a mostra.
    gravacao: situacao === 'gravacao' ? w.gravacaoUrl : null,
    quando: wb.quandoTexto(w.inicioEm), titulo: w.curso.nome, eadModo: 'pago', indexavel: w.publicado, canonicalOnline: base,
    logado: !!aluno(req), preco: Number(w.precoOnline), cancelado: !!(a && a.situacao === 'cancelado'),
    retornoUrl: m && a.situacao === 'pendente' ? urlRetorno(m.id, { pix: m.forma === 'PIX', etapa: 'curso' }) : null,
    erro: ({ cpf: 'Complete o CPF no seu cadastro para pagar.', forma: 'Escolha PIX ou cartão.', pagamento: 'Houve um problema ao processar o pagamento. Tente novamente.' })[req.query.erro] || null,
    msgPalavra: ({ 'nao-confere': 'Palavra-código não confere.', tentativas: 'Muitas tentativas. Tente de novo daqui a pouco.' })[req.query.palavra] || null,
  });
}));

router.get(P('/criar-conta'), comWebinario(async (req, res, w) => {
  if (aluno(req)) return res.redirect(urlDe(w));
  req.session.returnTo = urlDe(w);
  res.redirect('/cadastro');
}));
router.get(P('/entrar'), requireLogin, comWebinario(async (req, res, w) => res.redirect(urlDe(w))));

// Inscrição grátis. Recusa quando o ao vivo já passou e não há gravação.
router.post(P('/inscrever'), requireLogin, comWebinario(async (req, res, w, a) => {
  const base = urlDe(w);
  const usuarioId = aluno(req);
  if (!usuarioId || !w.gratuito || !w.publicado) return res.redirect(base);
  if (wb.situacaoCartao(w, a, wb.agora()) !== 'inscrever') return res.redirect(base);
  const nova = await prisma.inscricaoWebinario.create({ data: { webinarioId: w.id, usuarioId } }).catch(() => null); // única por pessoa
  if (nova) await require('../lib/webinario-avisos').confirmarInscricao(w, usuarioId).catch((e) => console.error('[WEBINARIO] confirmação:', e.message));
  require('../lib/cache-rapido').limparLinks(usuarioId);
  res.redirect(base);
}));

router.post(P('/comprar'), requireLogin, limiteCupom, comWebinario(async (req, res, w, a) => {
  const base = urlDe(w);
  if (!aluno(req) || w.gratuito) return res.redirect(base);
  const situacao = wb.situacaoCartao(w, a, wb.agora());
  if (situacao !== 'comprar' && situacao !== 'pendente') return res.redirect(base);
  if (!w.publicado && a.situacao !== 'pendente') return res.redirect(base);
  const preco = Number(w.precoOnline);
  if (!(preco > 0)) return res.redirect(base);
  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO', 'CUPOM'].includes(forma)) return res.redirect(`${base}?erro=forma`);
  const codigo = cupons.normalizarCodigo(req.body.cupom);
  let v = null;
  if (codigo) {
    if (req.cupomBloqueado) return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
    v = await cupons.validarCupom(codigo, w, { webinario: true });
    if (v.erro) { registrarFalhaCupom(req); return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}&ja=1`); }
  }
  const valor = v ? v.precoFinal : preco;
  if (forma === 'CUPOM' && valor !== 0) return res.redirect(base);
  if (forma !== 'CUPOM' && valor <= 0) return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
  const turma = await turmaOnline({ cursoId: w.cursoId });
  const usuarioId = aluno(req);
  if (forma === 'CUPOM') {
    const r = await compra.liberarSemPagamento(usuarioId, turma.id, { confirmadaPor: `cupom:${v.cupom.codigo}`, v });
    if (r.nova) {
      await cupons.auditar(usuarioId, 'EAD_CUPOM_LIBEROU', v.cupom.id, { matriculaId: r.matricula.id, webinarioId: w.id });
      await require('../lib/webinario-avisos').inscricaoPaga(r.matricula.id).catch((e) => console.error('[WEBINARIO] inscrição:', e.message));
    }
    return res.redirect(base);
  }
  const quem = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: compra.SELECT_ALUNO_CHECKOUT });
  if (!quem || !quem.cpfCnpj) return res.redirect(`${base}?erro=cpf`);
  const matricula = await compra.matriculaDaCompra(usuarioId, turma.id, forma, valor);
  if (['PAGO', 'PARCELADO'].includes(matricula.statusPagamento)) return res.redirect(base);
  await compra.gravarCupom(prisma, matricula.id, v);
  const cobranca = await iniciarCobrancaAVista({ matricula, nomeCurso: `${w.curso.nome} (webinário)`, total: valor, forma, aluno: quem, origem: lerOrigem(req), ip: req.ip, alunoId: usuarioId });
  if (cobranca.erro) return res.redirect(`${base}?erro=pagamento`);
  return res.redirect(cobranca.redirect);
}));

router.get(P('/entrar-na-transmissao'), requireLogin, comWebinario(async (req, res, w, a) => {
  if (wb.situacaoCartao(w, a, wb.agora()) === 'transmissao') return res.redirect(w.linkAoVivo);
  return res.redirect(urlDe(w));
}));

router.get(P('/agenda.ics'), requireLogin, comWebinario(async (req, res, w, a) => {
  if (!wb.temAcesso(a) || !w.inicioEm) return res.redirect(urlDe(w));
  const link = wb.linkPagina(w);
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${wb.endereco(w.curso.nome)}.ics"`);
  res.send(icsDoWebinario(w, link));
}));

module.exports = router;
module.exports.carregar = carregar;
module.exports.urlDe = urlDe;
