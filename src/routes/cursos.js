const express = require('express');
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { inscricaoSchema } = require('../lib/validation');
const {
  calcularValores,
  formatBRL,
  lerConfigMatricula,
  totalExibicao,
} = require('../lib/matricula');
const { criarTransacao } = require('../lib/unicopag');

const router = express.Router();

router.get('/', async (req, res) => {
  const [cursos, cfgMap, total] = await Promise.all([
    prisma.curso.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, take: 3 }),
    lerConfigMatricula(),
    prisma.curso.count({ where: { ativo: true } }),
  ]);
  res.render('home', { cursos, cfgMap, temMais: total > cursos.length, formatBRL, totalExibicao });
});

router.get('/sobre', (req, res) => res.render('sobre'));
router.get('/seguranca', (req, res) => res.render('seguranca'));

router.get('/cursos', async (req, res) => {
  const [cursos, cfgMap] = await Promise.all([
    prisma.curso.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      include: { turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 } },
    }),
    lerConfigMatricula(),
  ]);
  res.render('cursos', { cursos, cfgMap, formatBRL, totalExibicao });
});

router.get('/cursos/:cursoId', async (req, res) => {
  const [curso, cfgMap] = await Promise.all([
    prisma.curso.findUnique({
      where: { id: req.params.cursoId },
      include: {
        turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' } },
        faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] },
      },
    }),
    lerConfigMatricula(),
  ]);
  if (!curso || !curso.ativo) return res.status(404).render('erro', { mensagem: 'Curso não encontrado.' });
  const outros = await prisma.curso.findMany({
    where: { ativo: true, id: { not: curso.id } },
    orderBy: { nome: 'asc' },
    take: 3,
    include: { turmas: { where: { status: 'ABERTA' }, orderBy: { inicioPrevisto: 'asc' }, take: 1 } },
  });
  res.render('curso-detalhe', { curso, outros, formatBRL, total: totalExibicao(curso, cfgMap), totalExibicao, cfgMap });
});

router.get('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });
  if (!turma || turma.status !== 'ABERTA') return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });
  const jaInscrito = await prisma.matricula.findUnique({
    where: { alunoId_turmaId: { alunoId: req.session.usuarioId, turmaId: turma.id } },
  });
  if (jaInscrito) return res.render('erro', { mensagem: 'Você já está inscrito nesta turma. Veja em "Minha conta".' });
  const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
  const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
  res.render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: null });
});

router.post('/inscrever/:turmaId', requireLogin, async (req, res) => {
  const turma = await prisma.turma.findUnique({
    where: { id: req.params.turmaId },
    include: { curso: true },
  });
  if (!turma || turma.status !== 'ABERTA') return res.status(404).render('erro', { mensagem: 'Turma não encontrada ou não está aberta.' });

  const reRenderErro = async (msg) => {
    const aVista = await calcularValores(turma.curso, 'A_VISTA', req.session.usuarioId);
    const parcelado = await calcularValores(turma.curso, 'PARCELADO', req.session.usuarioId);
    return res.status(400).render('inscrever', { turma, curso: turma.curso, formatBRL, aVista, parcelado, erro: msg });
  };

  // 1. Validação com Zod
  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success) return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);
  
  const { plano, forma, numero, titular, mesExpiracao, anoExpiracao, cvv } = resultado.data;
  const usaGateway = forma !== 'DINHEIRO';

  // 2. Cálculo e criação da matrícula
  const { valorCurso, valorTaxaMatricula, total } = await calcularValores(turma.curso, plano, req.session.usuarioId);
  
  let matricula;
  try {
    matricula = await prisma.matricula.create({
      data: { alunoId: req.session.usuarioId, turmaId: turma.id, plano, forma, valorCurso, valorTaxaMatricula, statusPagamento: 'PENDENTE' },
    });
  } catch (err) {
    return reRenderErro('Não foi possível concluir a inscrição.');
  }

  if (!usaGateway) return res.redirect('/minha-conta?inscrito=1');

  // 3. Busca de dados para o Gateway
  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { nome: true, email: true, cpfCnpj: true, celular: true, cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true },
  });

  if (!aluno?.cpfCnpj) return res.render('erro', { mensagem: 'CPF obrigatório para pagamento online.' });

  try {
    // 4. ENVIO DOS DADOS DO CARTÃO (Ajuste crucial)
    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: turma.curso.nome,
      valorTotal: total,
      forma,
      aluno,
      dadosCartao: forma === 'CREDITO' ? { numero, titular, mesExpiracao, anoExpiracao, cvv, parcelas: 1 } : null
    });

    await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        gateway: 'unicopag',
        gatewayRef: resultadoGateway.gatewayRef || String(matricula.id),
        metodo: forma,
        valor: total,
        status: 'PENDENTE',
      },
    });

    if (resultadoGateway.checkoutUrl) return res.redirect(resultadoGateway.checkoutUrl);

    const qrParam = encodeURIComponent(resultadoGateway.pixQrCode || '');
    const urlParam = encodeURIComponent(resultadoGateway.pixUrl || '');
    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=1&qr=${qrParam}&url=${urlParam}`);

  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway:', err.message);
    return res.render('erro', { mensagem: 'Houve um problema ao processar o pagamento. Tente novamente ou contate a secretaria.' });
  }
});

router.get('/inscricao/retorno', requireLogin, async (req, res) => {
  const { matriculaId, pix, qr, url } = req.query;
  const matricula = matriculaId
    ? await prisma.matricula.findUnique({ where: { id: matriculaId }, include: { turma: { include: { curso: true } } } })
    : null;
  res.render('inscricao-retorno', {
    matricula,
    formatBRL,
    isPix: pix === '1',
    pixQrCode: qr ? decodeURIComponent(qr) : null,
    pixUrl: url ? decodeURIComponent(url) : null, // Disponível para o botão "Copiar Código PIX"
  });
});

// Substitua a rota do Webhook dentro de routes/cursos.js por esta versão:
router.post('/webhook/unicopag', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook UnicopAg] Notificação recebida:', JSON.stringify(payload));

    // 💡 Captura todas as variantes possíveis de ID que a Únicopag costuma enviar
    const idPrincipal = payload.gatewaytransaction || payload.id;
    const hashMenor = payload.transactionhash || payload.hash || payload.result?.hash;
    const orderId = payload.order_id || payload.metadata?.order_id || payload.result?.metadata?.order_id;

    // Captura o status do pagamento vindo do gateway
    const payment_status = payload.payment_status || payload.status || payload.result?.status;

    if (!payment_status) {
      console.error('[Webhook UnicopAg] Erro: Status de pagamento não informado no payload.');
      return res.status(400).send('Status inválido');
    }

    // 💡 Busca inteligente: Varre o Supabase procurando por qualquer um dos identificadores vinculados
    const pagamento = await prisma.pagamento.findFirst({
      where: {
        OR: [
          idPrincipal ? { gatewayRef: String(idPrincipal) } : null,
          hashMenor ? { gatewayRef: String(hashMenor) } : null,
          orderId ? { matriculaId: String(orderId) } : null
        ].filter(Boolean) // Remove opções nulas ou vazias da busca
      }
    });

    if (!pagamento) {
      console.error(`[Webhook UnicopAg] Nenhum pagamento localizado para os IDs fornecidos (ID: ${idPrincipal}, Hash: ${hashMenor}, Order: ${orderId})`);
      // Retornamos 200 para a VPS deles saber que a rota existe e parar de travar o servidor
      return res.status(200).send('Ok, mas não encontrado no banco');
    }

    const matriculaId = pagamento.matriculaId;
    console.log(`[Webhook UnicopAg] Localizado! Matrícula: ${matriculaId} | Status atual recebido: ${payment_status}`);

    // 💡 Mapeamento de aprovação automática de pendente para PAGO
    if (payment_status === 'paid' || payment_status === 'PAGO' || payment_status === 'success') {
      await prisma.$transaction([
        // 1. Altera o status do pagamento para PAGO no banco
        prisma.pagamento.updateMany({
          where: { matriculaId: matriculaId },
          data: { status: 'PAGO', atualizadoEm: new Date() }
        }),
        // 2. Ativa a matrícula do aluno de forma automática
        prisma.matricula.update({
          where: { id: matriculaId },
          data: { statusPagamento: 'PAGO', confirmadaEm: new Date(), confirmadaPor: 'unicopag' }
        })
      ]);
      console.log(`[Webhook UnicopAg] 🎉 Sucesso absoluto! Matrícula ${matriculaId} atualizada para PAGO no Supabase.`);
    } 
    // Mapeamento de estorno
    else if (payment_status === 'refunded' || payment_status === 'ESTORNADO') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { matriculaId: matriculaId }, data: { status: 'ESTORNADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: matriculaId }, data: { statusPagamento: 'ESTORNADO' } })
      ]);
    } 
    // Mapeamento de cancelamento ou falha
    else if (payment_status === 'refused' || payment_status === 'failed' || payment_status === 'CANCELADO') {
      await prisma.$transaction([
        prisma.pagamento.updateMany({ where: { matriculaId: matriculaId }, data: { status: 'CANCELADO', atualizadoEm: new Date() } }),
        prisma.matricula.update({ where: { id: matriculaId }, data: { statusPagamento: 'CANCELADO' } })
      ]);
    }

    return res.status(200).send('Webhook processado com sucesso');

  } catch (error) {
    console.error('[Webhook UnicopAg] Erro crítico de banco de dados:', error.message);
    return res.status(500).send('Erro interno do servidor');
  }
});

module.exports = router;
