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

  const resultado = inscricaoSchema.safeParse(req.body);
  if (!resultado.success) return reRenderErro(resultado.error.issues.map((i) => i.message)[0]);
  
  const { plano, forma, numero, titular, mesExpiracao, anoExpiracao, cvv } = resultado.data;
  const usaGateway = forma !== 'DINHEIRO';

  const total = plano === 'A_VISTA' ? Number(turma.curso.precoAvista) : Number(turma.curso.precoCheio);
    
  let matricula;
  try {
    matricula = await prisma.matricula.create({
      data: { 
        alunoId: req.session.usuarioId, 
        turmaId: turma.id, 
        plano, 
        forma, 
        valorCurso: total,
        statusPagamento: 'PENDENTE' 
      },
    });
  } catch (err) {
    return reRenderErro('Não foi possível concluir a inscrição.');
  }

  if (!usaGateway) return res.redirect('/minha-conta?inscrito=1');

  const aluno = await prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { nome: true, email: true, cpfCnpj: true, celular: true, cep: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, uf: true },
  });

  if (!aluno?.cpfCnpj) return res.render('erro', { mensagem: 'CPF obrigatório.' });

  try {
    const parcelasFinais = plano === 'PARCELADO' ? Number(turma.curso.parcelas || 1) : 1;

    const resultadoGateway = await criarTransacao({
      matriculaId: matricula.id,
      nomeCurso: turma.curso.nome,
      valorTotal: total,
      forma,
      aluno: {
        ...aluno,
        cidade: aluno.cidade || "Rio de Janeiro"
      },
      dadosCartao: forma === 'CREDITO' ? { 
        numero, 
        titular, 
        mesExpiracao, 
        anoExpiracao, 
        cvv, 
        parcelas: parcelasFinais 
      } : null
    });

    await prisma.pagamento.create({
      data: {
        matriculaId: matricula.id,
        gateway: 'unicopag',
        gatewayRef: String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash),
        metodo: forma,
        valor: total,
        status: 'PENDENTE',
      },
    });

    if (resultadoGateway.checkoutUrl) {
      return res.redirect(resultadoGateway.checkoutUrl);
    }

    const rawQr = resultadoGateway.pixQrCode || resultadoGateway.pixUrl || '';
    const rawUrl = resultadoGateway.pixUrl || resultadoGateway.pixQrCode || '';

    const qrParam = encodeURIComponent(rawQr);
    const urlParam = encodeURIComponent(rawUrl);
    return res.redirect(`/inscricao/retorno?matriculaId=${matricula.id}&pix=${forma === 'PIX' ? '1' : '0'}&qr=${qrParam}&url=${urlParam}`);

  } catch (err) {
    console.error('[UnicopAg] Erro no Gateway:', err.message);
    return res.render('erro', { mensagem: 'Houve um problema ao processar o pagamento. Tente novamente.' });
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
    pixUrl: url ? decodeURIComponent(url) : null,
  });
});

router.post('/webhook/unicopag', async (req, res) => {
  try {
    const payload = req.body;
    console.log('[Webhook UnicopAg] Recebido:', JSON.stringify(payload));

    const id = payload.id || payload.gatewaytransaction || '';
    const hash = payload.hash || payload.transactionhash || '';
    const status = payload.payment_status || payload.status || '';

    if (!status) return res.status(400).send('Status ausente');

    // 1. Tenta buscar pelo pagamento já criado
    let pagamento = await prisma.pagamento.findFirst({
      where: { OR: [{ gatewayRef: String(id) }, { gatewayRef: String(hash) }].filter(Boolean) }
    });

    // 2. SE NÃO ACHOU, AQUI ESTÁ O PULO DO GATO:
    // A Únicopag geralmente envia o ID da nossa transação dentro do "items" ou descrição.
    // Se o seu ID de matricula estiver em algum lugar do payload, vamos pegá-lo aqui:
    let matriculaId = pagamento ? pagamento.matriculaId : null;

    if (!matriculaId) {
      // Tenta extrair de qualquer campo possível do JSON enviado pela Únicopag
      // Substitua 'SUA_LOGICA_DE_EXTRAIR_ID' caso você saiba onde ele está vindo no JSON
      // Por enquanto, vamos tentar pegar o ID do primeiro item da lista:
      matriculaId = payload.items && payload.items[0] ? payload.items[0].hash : null;
    }

    if (!matriculaId) {
      console.error(`[Webhook] ERRO: Não foi possível identificar a matrícula para ID: ${id}. Dados:`, JSON.stringify(payload));
      return res.status(200).send('Matrícula não identificada');
    }

    const ehSucesso = ['paid', 'PAGO', 'success', 'captured'].includes(status);

    if (ehSucesso) {
      // 3. Criação de Emergência
      if (!pagamento) {
        console.log(`[Webhook] Criando pagamento de emergência para Matrícula: ${matriculaId}`);
        pagamento = await prisma.pagamento.create({
          data: {
            matriculaId: matriculaId,
            gateway: 'unicopag',
            gatewayRef: String(id || hash),
            metodo: payload.payment_method || 'CREDITO',
            valor: Number(payload.amount_total || 0) / 100,
            status: 'PAGO'
          }
        });
      } else {
        await prisma.pagamento.updateMany({ 
          where: { id: pagamento.id }, 
          data: { status: 'PAGO', atualizadoEm: new Date() } 
        });
      }

      // 4. Atualiza o status da matrícula (PARCELADO ou PAGO)
      const dadosMatricula = await prisma.matricula.findUnique({ where: { id: matriculaId } });
      const novoStatus = dadosMatricula?.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';

      await prisma.matricula.update({ 
        where: { id: matriculaId }, 
        data: { 
          statusPagamento: novoStatus, 
          confirmadaEm: new Date(), 
          confirmadaPor: 'unicopag' 
        } 
      });

      console.log(`[Webhook] ✅ SUCESSO: Matrícula ${matriculaId} atualizada para ${novoStatus}.`);
    }

    return res.status(200).send('OK');

  } catch (error) {
    console.error('[Webhook UnicopAg] Erro:', error);
    return res.status(500).send('Erro interno');
  }
});

module.exports = router;