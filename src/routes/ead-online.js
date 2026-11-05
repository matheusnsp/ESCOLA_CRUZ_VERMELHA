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

const router = express.Router();

const SELECT_ALUNO_CHECKOUT = {
  nome: true, email: true, tipoDocumento: true, cpfCnpj: true, celular: true,
  cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true,
};

// Acha ou cria a matrícula da pessoa na turma online (@@unique alunoId+turmaId: um clique duplo não
// cria duas). Pendente: atualiza forma e valor. Cancelada/estornada: volta a PENDENTE na MESMA
// matrícula; os Pagamentos antigos ficam como histórico.
async function matriculaDaCompra(alunoId, turmaId, forma, valor) {
  const dados = { plano: 'A_VISTA', forma, valorCurso: valor, valorTaxaMatricula: 0, taxaConfirmada: true };
  const existente = await prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
  if (existente) {
    if (['PAGO', 'PARCELADO'].includes(existente.statusPagamento)) return existente;
    return prisma.matricula.update({
      where: { id: existente.id },
      data: { ...dados, statusPagamento: 'PENDENTE', confirmadaEm: null, confirmadaPor: null },
    });
  }
  try {
    return await prisma.matricula.create({ data: { ...dados, alunoId, turmaId, statusPagamento: 'PENDENTE', taxaConfirmadaEm: new Date(), taxaConfirmadaPor: 'curso online (sem taxa)' } });
  } catch (e) {
    if (e.code !== 'P2002') throw e;
    return prisma.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
  }
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
  const valor = co.precoOnline === null ? null : Number(co.precoOnline);
  if (!valor || valor <= 0) return res.redirect(base);
  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO'].includes(forma)) return res.redirect(`${base}?erro=forma`);
  const aluno = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId }, select: SELECT_ALUNO_CHECKOUT });
  if (!aluno || !aluno.cpfCnpj) return res.redirect(`${base}?erro=cpf`);

  const turma = await turmaOnline(co);
  const matricula = await matriculaDaCompra(req.session.usuarioId, turma.id, forma, valor);
  if (['PAGO', 'PARCELADO'].includes(matricula.statusPagamento)) return res.redirect(`${base}/continuar`);
  const cobranca = await iniciarCobrancaAVista({
    matricula, nomeCurso: `${co.curso.nome} (curso online)`, total: valor, forma, aluno, origem: lerOrigem(req),
  });
  if (cobranca.erro) return res.redirect(`${base}?erro=pagamento`);
  return res.redirect(cobranca.redirect);
}));

module.exports = router;
