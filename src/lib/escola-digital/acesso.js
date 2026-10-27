// lib/escola-digital/acesso.js
//
// Controle de acesso às rotas de estudo (/digital/estudo/:id/...), spec §5.4. Roda depois do
// requireLogin. Só o dono da inscrição entra: de outra pessoa, ou inexistente, o 404 é o mesmo
// (não revela se o id existe). Depois olha a situação:
//   AGUARDANDO_PAGAMENTO → vai para o pagamento
//   CANCELADA / EXPIRADA → página "encerrado"; ATIVA com acesso vencido é gravada como EXPIRADA
//   ATIVA → estuda e grava progresso
//   CONCLUIDA → vê tudo, mesmo depois do prazo, mas não grava nada (revisão)
// Deixa em req.inscricao (com o curso), req.modoRevisao e nos locals da página.

const prisma = require('../../db');
const asyncHandler = require('../asyncHandler');
const regras = require('./regras');

const dataBR = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

function naoEncontrada(res) {
  return res.status(404).render('digital/erro', {
    titulo: 'Inscrição não encontrada',
    mensagem: 'Não encontramos esta inscrição na sua conta. Veja os cursos da Escola Digital.',
    aba: 'cursos',
  });
}

function encerrado(res, inscricao, situacao) {
  return res.status(200).render('digital/encerrado', {
    titulo: `Acesso encerrado | ${inscricao.curso.nome}`,
    rastrear: false,
    aba: 'cursos',
    cursoNome: inscricao.curso.nome,
    situacao,
    // Cancelada não tem prazo para mostrar.
    acessoAte: situacao === 'EXPIRADA' && inscricao.acessoAte ? dataBR(inscricao.acessoAte) : null,
  });
}

const carregarInscricao = asyncHandler(async function carregarInscricao(req, res, next) {
  const usuarioId = req.session && req.session.usuarioId;
  const inscricao = usuarioId
    ? await prisma.inscricaoOnline.findUnique({ where: { id: String(req.params.id) }, include: { curso: true } })
    : null;
  if (!inscricao || inscricao.alunoId !== usuarioId) return naoEncontrada(res);

  const situacao = regras.situacaoAtual(inscricao);
  if (situacao === 'AGUARDANDO_PAGAMENTO') return res.redirect(`/digital/pagamento/${inscricao.id}`);

  if (situacao === 'EXPIRADA') {
    // Só vira EXPIRADA quem ainda está ATIVA e vencido (não passa por cima de uma conclusão ou
    // estorno que aconteceu agora há pouco).
    if (inscricao.situacao === 'ATIVA') {
      await prisma.inscricaoOnline.updateMany({
        where: { id: inscricao.id, situacao: 'ATIVA', acessoAte: { lt: new Date() } },
        data: { situacao: 'EXPIRADA' },
      });
    }
    return encerrado(res, inscricao, 'EXPIRADA');
  }
  if (situacao === 'CANCELADA') return encerrado(res, inscricao, 'CANCELADA');

  req.inscricao = inscricao;
  req.modoRevisao = situacao === 'CONCLUIDA';
  res.locals.inscricao = inscricao;
  res.locals.modoRevisao = req.modoRevisao;
  return next();
});

module.exports = { carregarInscricao, dataBR };
