// routes/ead-online.js
//
// Compra do curso online (etapa 4): POST /online/:cursoId/comprar. A pessoa vira uma Matrícula à vista
// na turma ONLINE do curso (lib/turma-online.js), sem taxa, e paga pela mesma cobrança do POST /inscrever
// (lib/cobranca-avista.js): PIX ⇒ retorno com o QR; cartão ⇒ o formulário de cartão de hoje. O webhook,
// a reconciliação, o Financeiro e o estorno são os de sempre. As telas do curso ficam em routes/ead-teste.js.

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireLogin } = require('../middleware/auth');
const { cursoOnlineDoEndereco, acessoPago } = require('../lib/ead-acesso');
const { turmaOnline } = require('../lib/turma-online');
const { iniciarCobrancaAVista } = require('../lib/cobranca-avista');
const { lerOrigem } = require('../lib/origem-da-visita');
const { transacao } = require('../lib/transacao');
const cupons = require('../lib/ead-cupom');

const router = express.Router();

const SELECT_ALUNO_CHECKOUT = {
  nome: true, email: true, tipoDocumento: true, cpfCnpj: true, celular: true,
  cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true,
};

// Acha ou cria a matrícula da pessoa na turma online (@@unique alunoId+turmaId: um clique duplo não
// cria duas). Pendente: atualiza forma e valor. Cancelada/estornada: volta a PENDENTE na MESMA
// matrícula; os Pagamentos antigos ficam como histórico.
// taxaConfirmada fica FALSE até o pagamento (o aplicarStatus confirma a taxa do à vista junto): o Painel,
// o Financeiro e a taxa POR_ALUNO leem taxaConfirmada como "entrou dinheiro". Sem pagar, a matrícula é
// uma tentativa abandonada como qualquer outra (FILTRO_MATRICULA_FANTASMA).
async function matriculaDaCompra(alunoId, turmaId, forma, valor) {
  const dados = { plano: 'A_VISTA', forma, valorCurso: valor, valorTaxaMatricula: 0, taxaConfirmada: false, taxaConfirmadaEm: null, taxaConfirmadaPor: null };
  const existente = await prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
  if (existente) {
    if (['PAGO', 'PARCELADO'].includes(existente.statusPagamento)) return existente;
    return prisma.matricula.update({
      where: { id: existente.id },
      data: { ...dados, statusPagamento: 'PENDENTE', confirmadaEm: null, confirmadaPor: null },
    });
  }
  try {
    return await prisma.matricula.create({ data: { ...dados, alunoId, turmaId, statusPagamento: 'PENDENTE' } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    return prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
  }
}

// Cupom da compra (etapa 7): grava, troca ou apaga o CupomMatriculaEad da matrícula.
async function gravarCupom(db, matriculaId, v) {
  if (!v) return db.cupomMatriculaEad.deleteMany({ where: { matriculaId } });
  const dados = { cupomId: v.cupom.id, precoCheio: v.precoCheio, desconto: v.desconto, precoFinal: v.precoFinal };
  return db.cupomMatriculaEad.upsert({ where: { matriculaId }, update: dados, create: { matriculaId, ...dados } });
}

// Cupom de 100%: matrícula paga com R$ 0, sem Pagamento e sem gateway. A trava por aluno e turma faz o
// duplo clique virar uma liberação só (uma auditoria só).
async function liberarPorCupom(alunoId, turmaId, v) {
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compra:${alunoId}:${turmaId}`}))`;
    const existente = await tx.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
    if (existente && ['PAGO', 'PARCELADO'].includes(existente.statusPagamento)) return { matricula: existente, nova: false };
    const agora = new Date();
    const dados = {
      plano: 'A_VISTA', forma: 'PIX', valorCurso: 0, valorTaxaMatricula: 0, statusPagamento: 'PAGO',
      taxaConfirmada: true, taxaConfirmadaEm: agora, taxaConfirmadaPor: `cupom:${v.cupom.codigo}`,
      confirmadaEm: agora, confirmadaPor: `cupom:${v.cupom.codigo}`,
    };
    const matricula = existente
      ? await tx.matricula.update({ where: { id: existente.id }, data: dados })
      : await tx.matricula.create({ data: { ...dados, alunoId, turmaId } });
    await gravarCupom(tx, matricula.id, v);
    return { matricula, nova: true };
  });
}

router.post('/online/:cursoId/comprar', requireLogin, asyncHandler(async (req, res, next) => {
  const coId = await cursoOnlineDoEndereco(req.params.cursoId);
  const co = coId ? await prisma.cursoOnline.findUnique({ where: { id: coId }, include: { curso: { select: { nome: true } } } }) : null;
  if (!co) return next();
  const base = `/online/${req.params.cursoId}`;
  if (req.session.papel !== 'ALUNO') return res.redirect(base); // DEV/secretaria logados no site não compram
  const acesso = await acessoPago(req.session.usuarioId, co);
  // Não publicado: só quem já está no meio de um pagamento pode terminá-lo.
  if (!co.publicado && acesso.situacao !== 'pendente') return acesso.situacao === 'sem' ? next() : res.redirect(base);
  if (acesso.liberado) return res.redirect(`${base}/continuar`);
  const preco = co.precoOnline === null ? null : Number(co.precoOnline);
  if (!preco || preco <= 0) return res.redirect(base);
  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO', 'CUPOM'].includes(forma)) return res.redirect(`${base}?erro=forma`);

  // Cupom: conferido de novo aqui, com o preço de agora. Inválido ⇒ a capa mostra o motivo; nada é gravado.
  const codigo = cupons.normalizarCodigo(req.body.cupom);
  const voltaCupom = () => res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
  let v = null;
  if (codigo) {
    v = await cupons.validarCupom(codigo, co);
    if (v.erro) return voltaCupom();
  }
  const valor = v ? v.precoFinal : preco;
  if (forma === 'CUPOM' && valor !== 0) return v ? voltaCupom() : res.redirect(base);
  if (forma !== 'CUPOM' && valor <= 0) return voltaCupom();

  const turma = await turmaOnline(co);
  if (forma === 'CUPOM') {
    const r = await liberarPorCupom(req.session.usuarioId, turma.id, v);
    if (r.nova) await cupons.auditar(req.session.usuarioId, 'EAD_CUPOM_LIBEROU', v.cupom.id, { matriculaId: r.matricula.id, cursoOnlineId: co.id });
    return res.redirect(`${base}/continuar`);
  }

  const aluno = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId }, select: SELECT_ALUNO_CHECKOUT });
  if (!aluno || !aluno.cpfCnpj) return res.redirect(`${base}?erro=cpf`);
  const matricula = await matriculaDaCompra(req.session.usuarioId, turma.id, forma, valor);
  if (['PAGO', 'PARCELADO'].includes(matricula.statusPagamento)) return res.redirect(`${base}/continuar`);
  await gravarCupom(prisma, matricula.id, v);
  const cobranca = await iniciarCobrancaAVista({
    matricula, nomeCurso: `${co.curso.nome} (curso online)`, total: valor, forma, aluno, origem: lerOrigem(req),
  });
  if (cobranca.erro) return res.redirect(`${base}?erro=pagamento`);
  return res.redirect(cobranca.redirect);
}));

module.exports = router;
