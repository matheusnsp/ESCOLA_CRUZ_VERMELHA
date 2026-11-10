// routes/ebooks.js
//
// E-books da Escola Digital para o aluno (2026-11-09; spec 2026-11-09-escola-digital-ebooks.md §3):
//   GET  /escola-digital/ebook/:end              página do e-book (capa, preço, cupom, botão)
//   GET  /escola-digital/ebook/:end/criar-conta  cadastro, voltando para a página
//   GET  /escola-digital/ebook/:end/entrar       login, voltando para a página
//   POST /escola-digital/ebook/:end/comprar      compra paga (PIX/cartão/cupom de 100%) pela turma online do e-book
//   GET  /escola-digital/ebook/:end/baixar       PDF com "Licenciado para …" no rodapé (conta obrigatória)
// Montado no site antes de ead-online/ead-teste (que tratam /escola-digital/<curso>).

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const eb = require('../lib/ebook');
const arq = require('../lib/ebook-arquivo');
const cupons = require('../lib/ead-cupom');
const { limiteCupom, registrarFalhaCupom, MSG_TENTATIVAS } = require('../lib/limite-cupom');
const { turmaOnline } = require('../lib/turma-online');
const { iniciarCobrancaAVista, urlRetorno } = require('../lib/cobranca-avista');
const { lerOrigem } = require('../lib/origem-da-visita');
const escolaDigital = require('../lib/escola-digital');
const { URL_ESCOLA_DIGITAL } = require('../lib/vitrine');
const { compra } = require('./ead-online');

const router = express.Router();
const P = (resto = '') => `${URL_ESCOLA_DIGITAL}/ebook/:end${resto}`;
const urlDe = (ebook) => `${URL_ESCOLA_DIGITAL}/ebook/${eb.endereco(ebook.curso.nome)}`;
const aluno = (req) => (req.session && req.session.usuarioId && req.session.papel === 'ALUNO' ? req.session.usuarioId : null);
const ehDev = (req) => !!(req.session && req.session.papel === 'DEV');
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Acha o e-book do endereço e decide se a pessoa pode ver a página. Escola Digital desligada: só quem já tem
// o e-book (ou está pagando) vê. DEV vê rascunho. Devolve { ebook, acesso } ou null (404).
async function carregar(req) {
  // Revisão I1: despublicado continua aberto para quem já tem (comprou, está pagando ou baixou grátis).
  const ebook = await eb.doEndereco(req.params.end, { incluirRascunho: true });
  if (!ebook) return null;
  const acesso = await eb.acesso(aluno(req), ebook);
  const jaTem = acesso.situacao === 'pago' || acesso.situacao === 'pendente' || (acesso.situacao === 'gratis' && acesso.desde);
  if (!ebook.publicado && !jaTem && !ehDev(req)) return null;
  if (!jaTem && !ehDev(req) && !(await escolaDigital.estaLigada())) return null;
  return { ebook, acesso };
}
const comEbook = (fn) => asyncHandler(async (req, res, next) => {
  const c = await carregar(req);
  if (!c) return next();
  return fn(req, res, c.ebook, c.acesso, next);
});

// Cupom da página: o do link/formulário (?cupom=), senão o guardado na sessão (chegou pelo link e criou a conta),
// senão o da compra pendente. Como na capa do curso online (routes/ead-teste.js).
async function cupomDaPagina(req, ebook, m) {
  const daSessao = req.session && req.session.cupomEbook && req.session.cupomEbook.e === ebook.id ? req.session.cupomEbook.codigo : '';
  const pediu = req.query.cupom !== undefined;
  let codigo = pediu ? cupons.normalizarCodigo(req.query.cupom) : daSessao;
  if (req.session && pediu) req.session.cupomEbook = undefined;
  if (!codigo && !pediu && m && m.statusPagamento === 'PENDENTE') {
    const cm = await prisma.cupomMatriculaEad.findUnique({ where: { matriculaId: m.id }, include: { cupom: { select: { codigo: true } } } });
    codigo = cm ? cm.cupom.codigo : '';
  }
  if (!codigo || ebook.gratuito) return { cupom: null, erroCupom: null };
  if (req.cupomBloqueado) return { cupom: null, erroCupom: MSG_TENTATIVAS };
  const v = await cupons.validarCupom(codigo, ebook, { ebook: true });
  if (v.erro) { if (pediu && req.query.ja !== '1') registrarFalhaCupom(req); return { cupom: null, erroCupom: v.erro }; }
  if (req.session && pediu) req.session.cupomEbook = { e: ebook.id, codigo: v.cupom.codigo };
  return { cupom: { codigo: v.cupom.codigo, precoCheio: v.precoCheio, desconto: v.desconto, precoFinal: v.precoFinal }, erroCupom: null };
}

router.get(P(), limiteCupom, comEbook(async (req, res, ebook, acesso) => {
  const base = urlDe(ebook);
  const m = acesso.matricula;
  const { cupom, erroCupom } = acesso.situacao === 'pago' ? { cupom: null, erroCupom: null } : await cupomDaPagina(req, ebook, m);
  const faqs = await prisma.faqCurso.findMany({ where: { cursoId: ebook.cursoId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], select: { pergunta: true, resposta: true } }).catch(() => []);
  if (ebook.publicado) res.removeHeader('X-Robots-Tag');
  res.render('ebook', {
    ebook, base, faqs, acesso, cupom, erroCupom, brl,
    titulo: ebook.curso.nome, eadModo: 'pago', indexavel: ebook.publicado, canonicalOnline: base,
    logado: !!aluno(req), preco: Number(ebook.precoOnline),
    retornoUrl: m && acesso.situacao === 'pendente' ? urlRetorno(m.id, { pix: m.forma === 'PIX', etapa: 'curso' }) : null,
    erro: ({ cpf: 'Complete o CPF no seu cadastro para pagar.', forma: 'Escolha PIX ou cartão.', pagamento: 'Houve um problema ao processar o pagamento. Tente novamente.', limite: 'Muitos downloads seguidos; tente daqui a pouco.' })[req.query.erro] || null,
  });
}));

// "Criar conta e baixar/comprar": o /cadastro de sempre, voltando para a página.
router.get(P('/criar-conta'), comEbook(async (req, res, ebook) => {
  if (aluno(req)) return res.redirect(urlDe(ebook));
  req.session.returnTo = urlDe(ebook);
  res.redirect('/cadastro');
}));
router.get(P('/entrar'), requireLogin, comEbook(async (req, res, ebook) => res.redirect(urlDe(ebook))));

router.post(P('/comprar'), requireLogin, limiteCupom, comEbook(async (req, res, ebook, acesso) => {
  const base = urlDe(ebook);
  if (!aluno(req) || ebook.gratuito) return res.redirect(base); // DEV/secretaria não compram; grátis é só baixar
  if (acesso.situacao === 'pago') return res.redirect(base);
  if (!ebook.publicado && acesso.situacao !== 'pendente') return res.redirect(base);
  const preco = Number(ebook.precoOnline);
  if (!(preco > 0)) return res.redirect(base);
  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO', 'CUPOM'].includes(forma)) return res.redirect(`${base}?erro=forma`);
  const codigo = cupons.normalizarCodigo(req.body.cupom);
  let v = null;
  if (codigo) {
    if (req.cupomBloqueado) return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
    v = await cupons.validarCupom(codigo, ebook, { ebook: true });
    if (v.erro) { registrarFalhaCupom(req); return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}&ja=1`); }
  }
  const valor = v ? v.precoFinal : preco;
  if (forma === 'CUPOM' && valor !== 0) return res.redirect(base);
  if (forma !== 'CUPOM' && valor <= 0) return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
  const turma = await turmaOnline({ cursoId: ebook.cursoId });
  const usuarioId = aluno(req);
  if (forma === 'CUPOM') {
    const r = await compra.liberarSemPagamento(usuarioId, turma.id, { confirmadaPor: `cupom:${v.cupom.codigo}`, v });
    if (r.nova) await cupons.auditar(usuarioId, 'EAD_CUPOM_LIBEROU', v.cupom.id, { matriculaId: r.matricula.id, ebookId: ebook.id });
    return res.redirect(base);
  }
  const quem = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: compra.SELECT_ALUNO_CHECKOUT });
  if (!quem || !quem.cpfCnpj) return res.redirect(`${base}?erro=cpf`);
  const matricula = await compra.matriculaDaCompra(usuarioId, turma.id, forma, valor);
  if (['PAGO', 'PARCELADO'].includes(matricula.statusPagamento)) return res.redirect(base);
  await compra.gravarCupom(prisma, matricula.id, v);
  const cobranca = await iniciarCobrancaAVista({ matricula, nomeCurso: `${ebook.curso.nome} (e-book)`, total: valor, forma, aluno: quem, origem: lerOrigem(req), ip: req.ip, alunoId: usuarioId });
  if (cobranca.erro) return res.redirect(`${base}?erro=pagamento`);
  return res.redirect(cobranca.redirect);
}));

router.get(P('/baixar'), requireLogin, comEbook(async (req, res, ebook, acesso) => {
  const base = urlDe(ebook);
  const usuarioId = aluno(req);
  if (!usuarioId || !eb.podeBaixar(acesso)) return res.redirect(base);
  // Revisão I3: o limite é conferido antes de ler e montar o PDF (trabalho pesado com arquivos grandes).
  if (await eb.passouDoLimite(usuarioId)) return res.redirect(`${base}?erro=limite`);
  const original = ebook.arquivoPdf ? await arq.ler(ebook.arquivoPdf) : null;
  let pdf = null;
  if (original) {
    const quem = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true, cpfCnpj: true, passaporte: true } });
    pdf = await arq.marcar(original, arq.textoDoRodape(quem)).catch((e) => { console.error('[ebook] marcar:', e.message); return null; });
  } else {
    console.error('[ebook] arquivo não encontrado:', ebook.id, ebook.arquivoPdf);
  }
  if (!pdf) return res.status(503).render('erro', { mensagem: 'Não conseguimos preparar o seu e-book agora. Tente de novo em alguns minutos.' });
  const r = await eb.registrarDownload(usuarioId, ebook);
  if (r.erro) return res.redirect(`${base}?erro=limite`);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${eb.endereco(ebook.curso.nome)}.pdf"`);
  res.set('Cache-Control', 'private, no-store');
  res.send(pdf);
}));

module.exports = router;
