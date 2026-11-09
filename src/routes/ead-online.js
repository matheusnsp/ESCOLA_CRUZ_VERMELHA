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
const { limiteCupom, registrarFalhaCupom } = require('../lib/limite-cupom');
const { URL_ESCOLA_DIGITAL } = require('../lib/vitrine');
const escolaDigital = require('../lib/escola-digital');

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
  // Etapa 8: a mesma trava do "Liberar curso" (liberarPorCupom): duas abas ao mesmo tempo não voltam uma
  // matrícula já paga para PENDENTE.
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compra:${alunoId}:${turmaId}`}))`;
    const existente = await tx.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
    if (existente) {
      if (['PAGO', 'PARCELADO'].includes(existente.statusPagamento)) return existente;
      return tx.matricula.update({
        where: { id: existente.id },
        data: { ...dados, statusPagamento: 'PENDENTE', confirmadaEm: null, confirmadaPor: null },
      });
    }
    return tx.matricula.create({ data: { ...dados, alunoId, turmaId, statusPagamento: 'PENDENTE' } });
  });
}

// Cupom da compra (etapa 7): grava, troca ou apaga o CupomMatriculaEad da matrícula.
async function gravarCupom(db, matriculaId, v) {
  if (!v) return db.cupomMatriculaEad.deleteMany({ where: { matriculaId } });
  const dados = { cupomId: v.cupom.id, precoCheio: v.precoCheio, desconto: v.desconto, precoFinal: v.precoFinal };
  return db.cupomMatriculaEad.upsert({ where: { matriculaId }, update: dados, create: { matriculaId, ...dados } });
}

// Sem pagamento (cupom de 100% ou curso gratuito): matrícula paga com R$ 0, sem Pagamento e sem gateway. A trava
// por aluno e turma faz o duplo clique virar uma liberação só (uma auditoria só). v = validação do cupom ou null.
async function liberarSemPagamento(alunoId, turmaId, { confirmadaPor, v = null }) {
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compra:${alunoId}:${turmaId}`}))`;
    const existente = await tx.matricula.findUnique({ where: { alunoId_turmaId: { alunoId, turmaId } } });
    if (existente && ['PAGO', 'PARCELADO'].includes(existente.statusPagamento)) return { matricula: existente, nova: false };
    const agora = new Date();
    const dados = {
      plano: 'A_VISTA', forma: 'PIX', valorCurso: 0, valorTaxaMatricula: 0, statusPagamento: 'PAGO',
      taxaConfirmada: true, taxaConfirmadaEm: agora, taxaConfirmadaPor: confirmadaPor,
      confirmadaEm: agora, confirmadaPor,
    };
    const matricula = existente
      ? await tx.matricula.update({ where: { id: existente.id }, data: dados })
      : await tx.matricula.create({ data: { ...dados, alunoId, turmaId } });
    if (v) await gravarCupom(tx, matricula.id, v);
    // Cobranças de antes (PIX/cartão) não servem mais: o curso foi liberado de graça.
    await tx.pagamento.updateMany({ where: { matriculaId: matricula.id, status: 'PENDENTE' }, data: { status: 'CANCELADO' } });
    return { matricula, nova: true };
  });
}

router.post(['/online/:cursoId/comprar', '/escola-digital/:cursoId/comprar'], requireLogin, limiteCupom, asyncHandler(async (req, res, next) => {
  const coId = await cursoOnlineDoEndereco(req.params.cursoId);
  const co = coId ? await prisma.cursoOnline.findUnique({ where: { id: coId }, include: { curso: { select: { nome: true } } } }) : null;
  if (!co) return next();
  const base = `${URL_ESCOLA_DIGITAL}/${req.params.cursoId}`;
  if (req.session.papel !== 'ALUNO') return res.redirect(base); // DEV/secretaria logados no site não compram
  const acesso = await acessoPago(req.session.usuarioId, co);
  // Escola Digital desligada: não vende (quem já está no meio de um pagamento termina).
  if (acesso.situacao === 'sem' && !(await escolaDigital.estaLigada())) return res.redirect(base);
  // Não publicado: só quem já está no meio de um pagamento pode terminá-lo.
  if (!co.publicado && acesso.situacao !== 'pendente') return acesso.situacao === 'sem' ? next() : res.redirect(base);
  if (acesso.liberado) return res.redirect(`${base}/continuar`);
  // Curso gratuito (vitrine 2026-11-09): libera com um clique, só com conta (requireLogin acima), sem CPF nem cupom.
  if (co.gratuito) {
    if (String(req.body.forma || '') !== 'GRATIS' || !co.publicado) return res.redirect(base);
    const turma = await turmaOnline(co);
    const r = await liberarSemPagamento(req.session.usuarioId, turma.id, { confirmadaPor: 'gratuito' });
    if (r.nova) {
      await prisma.logAuditoria.create({ data: { atorId: req.session.usuarioId, acao: 'EAD_GRATIS_LIBEROU', alvoTipo: 'CursoOnline', alvoId: co.id, detalhe: { matriculaId: r.matricula.id } } })
        .catch((e) => console.error('[EAD] auditoria grátis:', e.message));
    }
    return res.redirect(`${base}/continuar`);
  }
  const preco = co.precoOnline === null ? null : Number(co.precoOnline);
  if (!preco || preco <= 0) return res.redirect(base);
  const forma = String(req.body.forma || '');
  if (!['PIX', 'CREDITO', 'CUPOM'].includes(forma)) return res.redirect(`${base}?erro=forma`);

  // Cupom: conferido de novo aqui, com o preço de agora. Inválido ⇒ a capa mostra o motivo; nada é gravado.
  const codigo = cupons.normalizarCodigo(req.body.cupom);
  const voltaCupom = () => res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}`);
  let v = null;
  if (codigo) {
    if (req.cupomBloqueado) return voltaCupom(); // a capa mostra o aviso de tentativas
    v = await cupons.validarCupom(codigo, co);
    // Revisão final (I-1): o código errado conta aqui também (quem não segue o redirecionamento escapava do
    // limite); a capa recebe ?ja=1 para não contar duas vezes.
    if (v.erro) { registrarFalhaCupom(req); return res.redirect(`${base}?cupom=${encodeURIComponent(codigo)}&ja=1`); }
  }
  const valor = v ? v.precoFinal : preco;
  if (forma === 'CUPOM' && valor !== 0) return v ? voltaCupom() : res.redirect(base);
  if (forma !== 'CUPOM' && valor <= 0) return voltaCupom();

  const turma = await turmaOnline(co);
  if (forma === 'CUPOM') {
    const r = await liberarSemPagamento(req.session.usuarioId, turma.id, { confirmadaPor: `cupom:${v.cupom.codigo}`, v });
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
