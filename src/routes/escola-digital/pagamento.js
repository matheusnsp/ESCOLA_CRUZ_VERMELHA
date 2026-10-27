// routes/escola-digital/pagamento.js
//
// Pagamento da matrícula online (spec §5.3): escolha de plano e forma, PIX com QR Code e consulta
// da situação, cartão, e o pagamento simulado (só fora de produção, com a chave ligada). Montado em
// routes/escola-digital/index.js depois da chave de liga/desliga. A regra fica em
// lib/escola-digital/pagamento.js; aqui só tela, sessão e redirecionamento.
//
// Só o dono da inscrição vê qualquer coisa dela (outra pessoa recebe 404). Os dados do cartão
// chegam no POST e seguem direto para a cobrança: não voltam para a tela nem vão para o log.

const express = require('express');
const QRCode = require('qrcode');
const prisma = require('../../db');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../lib/escola-digital/config');
const regras = require('../../lib/escola-digital/regras');
const pagamentoOnline = require('../../lib/escola-digital/pagamento');
const { requireLogin } = require('../../middleware/auth');
const { reais, slugCurso } = require('../../lib/vitrine');
const { lerOrigem } = require('../../lib/origem-da-visita');
const { pagamentoCursoSchema } = require('../../lib/validation');

const router = express.Router();

// Valor em reais com espaço comum (como em loja.js).
const preco = (valor) => reais(valor).replace(/\u00a0/g, ' ');

const MSG_RECUSADO = 'O banco recusou a cobrança. Confira os dados ou tente outro cartão.';

// Inscrição do :inscricaoId com o curso, só se for de quem está logado; senão null.
async function inscricaoDoAluno(req) {
  const usuarioId = req.session && req.session.usuarioId;
  if (!usuarioId) return null;
  const inscricao = await prisma.inscricaoOnline.findUnique({
    where: { id: String(req.params.inscricaoId) },
    include: { curso: true },
  });
  return inscricao && inscricao.alunoId === usuarioId ? inscricao : null;
}

function naoEncontrada(res) {
  return res.status(404).render('digital/erro', {
    titulo: 'Inscrição não encontrada',
    mensagem: 'Não encontramos esta inscrição na sua conta. Veja os cursos da Escola Digital.',
    aba: 'cursos',
  });
}

// Para onde vai quem já passou do pagamento; null se ainda aguarda (ou foi encerrada).
function destinoSemPagamento(inscricao) {
  const situacao = regras.situacaoAtual(inscricao);
  if (situacao === 'ATIVA' || situacao === 'CONCLUIDA') return `/digital/estudo/${inscricao.id}`;
  return null;
}

const linkSimulado = (pagamento) => (pagamento && pagamento.gateway === 'simulado' ? `/digital/simulado/${pagamento.id}` : null);

// Desenha a tela de pagamento. `modo`: 'escolha' (formulário), 'processando' (cartão em análise ou
// PIX sendo gerado), 'indisponivel' ou 'encerrada'.
async function telaPagamento(res, status, inscricao, modo, extra = {}) {
  const curso = inscricao.curso;
  const opcoes = modo === 'escolha' ? await pagamentoOnline.opcoesDePagamento(curso) : { aVista: Number(curso.precoAvista), parceladas: [] };
  return res.status(status).render('digital/pagamento', {
    titulo: `Pagamento | ${curso.nome} | ${config.NOME}`,
    rastrear: false,
    aba: 'cursos',
    modo,
    inscricaoId: inscricao.id,
    slug: slugCurso(curso.nome),
    curso: { nome: curso.nome },
    aVista: preco(opcoes.aVista),
    parceladas: opcoes.parceladas.map((o) => ({ ...o, valorParcela: preco(o.valorParcela), total: preco(o.total) })),
    semJuros: opcoes.parceladas.some((o) => !o.comJuros),
    escolha: { opcao: 'A_VISTA:1', forma: 'PIX' },
    erro: null, aviso: null, motivo: null, pagamento: null, linkSimulado: null,
    ...extra,
  });
}

// Tela do PIX: QR Code (imagem da Únicopag ou gerada aqui a partir do copia e cola) e consulta da situação.
async function telaPix(res, inscricao, pagamento) {
  let qr = null;
  if (pagamento.pixBase64) {
    qr = /^(https?:|data:)/i.test(pagamento.pixBase64) ? pagamento.pixBase64 : `data:image/png;base64,${pagamento.pixBase64}`;
  } else if (pagamento.pixQrCode) {
    qr = await QRCode.toDataURL(pagamento.pixQrCode, { margin: 1, width: 480 });
  }
  return res.render('digital/pagamento-pix', {
    titulo: `PIX | ${inscricao.curso.nome} | ${config.NOME}`,
    rastrear: false,
    aba: 'cursos',
    inscricaoId: inscricao.id,
    curso: { nome: inscricao.curso.nome },
    valor: preco(pagamento.valor),
    pixQrCode: pagamento.pixQrCode,
    qr,
    pagamentoId: pagamento.id,
    linkSimulado: linkSimulado(pagamento),
  });
}

router.get('/digital/pagamento/:inscricaoId', requireLogin, asyncHandler(async (req, res) => {
  const inscricao = await inscricaoDoAluno(req);
  if (!inscricao) return naoEncontrada(res);
  const destino = destinoSemPagamento(inscricao);
  if (destino) return res.redirect(destino);
  if (regras.situacaoAtual(inscricao) !== 'AGUARDANDO_PAGAMENTO') return telaPagamento(res, 200, inscricao, 'encerrada');
  if (!pagamentoOnline.disponivel()) return telaPagamento(res, 200, inscricao, 'indisponivel');

  // Cobrança em andamento: mostra ela (a menos que a pessoa peça para escolher outra forma).
  if (req.query.trocar !== '1') {
    const pendente = await pagamentoOnline.pendenteAtual(inscricao.id);
    if (pendente && pendente.metodo === 'PIX' && pendente.pixQrCode) return telaPix(res, inscricao, pendente);
    if (pendente) {
      return telaPagamento(res, 200, inscricao, 'processando', { pagamento: pendente, linkSimulado: linkSimulado(pendente) });
    }
  }

  const aviso = req.query.recusado === '1' ? 'recusado' : req.query.vencido === '1' ? 'vencido' : null;
  return telaPagamento(res, 200, inscricao, 'escolha', { aviso, motivo: aviso === 'recusado' ? MSG_RECUSADO : null });
}));

router.post('/digital/pagamento/:inscricaoId', requireLogin, asyncHandler(async (req, res) => {
  const inscricao = await inscricaoDoAluno(req);
  if (!inscricao) return naoEncontrada(res);
  const destino = destinoSemPagamento(inscricao);
  if (destino) return res.redirect(destino);
  if (regras.situacaoAtual(inscricao) !== 'AGUARDANDO_PAGAMENTO') return telaPagamento(res, 200, inscricao, 'encerrada');
  if (!pagamentoOnline.disponivel()) return telaPagamento(res, 503, inscricao, 'indisponivel');

  // "A_VISTA:1" ou "PARCELADO:3" (o rádio da tela) e a forma.
  const opcao = String(req.body.opcao || '');
  const [plano, parcelasTexto] = opcao.split(':');
  const parcelas = Number(parcelasTexto);
  const forma = String(req.body.forma || '');
  const escolha = { opcao, forma };
  const deNovo = (status, mensagem) => telaPagamento(res, status, inscricao, 'escolha', { erro: mensagem, escolha });

  try {
    pagamentoOnline.conferirEscolha(inscricao.curso, { plano, parcelas, forma });
  } catch (e) {
    if (e.codigo === 'invalido') return deNovo(400, e.message);
    throw e;
  }

  let dadosCartao;
  if (forma === 'CREDITO') {
    const lido = pagamentoCursoSchema.safeParse({
      plano, forma, parcelas,
      numero: req.body.numero, titular: req.body.titular, validade: req.body.validade, cvv: req.body.cvv,
    });
    if (!lido.success) return deNovo(400, lido.error.issues[0].message);
    const [mes, anoCurto] = lido.data.validade.split('/');
    dadosCartao = {
      numero: lido.data.numero,
      titular: lido.data.titular.toUpperCase(),
      mesExpiracao: mes,
      anoExpiracao: `20${anoCurto}`,
      cvv: lido.data.cvv,
    };
  }

  let pagamento;
  try {
    pagamento = await pagamentoOnline.cobrar({ inscricaoId: inscricao.id, plano, parcelas, forma, dadosCartao, origem: lerOrigem(req) });
  } catch (e) {
    if (e.codigo === 'invalido') return deNovo(400, e.message);
    if (e.codigo === 'indisponivel') return telaPagamento(res, 503, inscricao, 'indisponivel');
    if (e.codigo === 'gateway') return deNovo(502, e.message);
    if (e.codigo === 'situacao') return res.redirect(`/digital/pagamento/${inscricao.id}`);
    throw e;
  }

  if (pagamento.status === 'PAGO') return res.redirect(`/digital/estudo/${inscricao.id}/continuar`);
  if (pagamento.status === 'CANCELADO') {
    return telaPagamento(res, 200, inscricao, 'escolha', { aviso: 'recusado', motivo: pagamento.motivo || MSG_RECUSADO, escolha });
  }
  // PENDENTE: a tela do GET mostra o QR do PIX ou o cartão em análise.
  return res.redirect(`/digital/pagamento/${inscricao.id}`);
}));

// Situação para a consulta da tela (js/escola-digital.js), a cada 5 s. ?pagamento=<id> pergunta por
// uma cobrança específica desta inscrição; sem ele, pela mais recente.
router.get('/digital/pagamento/:inscricaoId/status', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const inscricao = await inscricaoDoAluno(req);
  if (!inscricao) return res.status(404).json({ ok: false });
  const where = { inscricaoId: inscricao.id };
  if (req.query.pagamento) where.id = String(req.query.pagamento);
  const pagamento = await prisma.pagamentoOnline.findFirst({ where, orderBy: { criadoEm: 'desc' }, select: { status: true } });
  return res.json({ status: pagamento ? pagamento.status : null, situacao: regras.situacaoAtual(inscricao) });
}));

// ---------- Pagamento simulado (só fora de produção, com ESCOLA_DIGITAL_PAGAMENTO_SIMULADO=1) ----------

// Desligado, a rota não existe: passa adiante e o 404 do site responde.
router.use('/digital/simulado', (req, res, next) => (config.pagamentoSimulado() ? next() : next('router')));

// Cobrança simulada do :pagamentoId, só se for de quem está logado; senão null.
async function pagamentoSimuladoDoAluno(req) {
  const usuarioId = req.session && req.session.usuarioId;
  if (!usuarioId) return null;
  const pagamento = await prisma.pagamentoOnline.findUnique({
    where: { id: String(req.params.pagamentoId) },
    include: { inscricao: { include: { curso: true } } },
  });
  if (!pagamento || pagamento.gateway !== 'simulado' || pagamento.inscricao.alunoId !== usuarioId) return null;
  return pagamento;
}

function simuladoNaoEncontrado(res) {
  return res.status(404).render('digital/erro', {
    titulo: 'Pagamento não encontrado', mensagem: 'Não encontramos este pagamento simulado na sua conta.', aba: 'cursos',
  });
}

router.get('/digital/simulado/:pagamentoId', requireLogin, asyncHandler(async (req, res) => {
  const pagamento = await pagamentoSimuladoDoAluno(req);
  if (!pagamento) return simuladoNaoEncontrado(res);
  return res.render('digital/pagamento-simulado', {
    titulo: `Pagamento simulado | ${config.NOME}`,
    rastrear: false,
    aba: 'cursos',
    pagamento: {
      id: pagamento.id,
      inscricaoId: pagamento.inscricaoId,
      curso: pagamento.inscricao.curso.nome,
      forma: pagamento.metodo === 'PIX' ? 'PIX' : pagamento.parcelas > 1 ? `Cartão de crédito em ${pagamento.parcelas}×` : 'Cartão de crédito à vista',
      valor: preco(pagamento.valor),
      status: pagamento.status,
    },
  });
}));

router.post('/digital/simulado/:pagamentoId', requireLogin, asyncHandler(async (req, res) => {
  const pagamento = await pagamentoSimuladoDoAluno(req);
  if (!pagamento) return simuladoNaoEncontrado(res);
  const acao = String(req.body.acao || '');
  if (acao !== 'aprovar' && acao !== 'recusar') return res.redirect(`/digital/simulado/${pagamento.id}`);

  const { inscricao, ...linha } = pagamento;
  await pagamentoOnline.aplicarStatusOnline(linha, {
    status: acao === 'aprovar' ? 'paid' : 'refused',
    payload: { simulado: true, acao },
    origem: 'simulado',
  });
  const atual = await prisma.inscricaoOnline.findUnique({ where: { id: inscricao.id } });
  if (acao === 'aprovar' && atual.situacao === 'ATIVA') return res.redirect(`/digital/estudo/${inscricao.id}/continuar`);
  if (acao === 'aprovar') return res.redirect(`/digital/pagamento/${inscricao.id}`);
  return res.redirect(`/digital/pagamento/${inscricao.id}?recusado=1`);
}));

module.exports = router;
