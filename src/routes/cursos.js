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
    
    // 🔍 LOG INICIAL DO WEBHOOK
    console.log('[MONITORAMENTO CARTÃO] 🔔 3. Webhook ativado pelo Gateway!');
    console.log('[MONITORAMENTO CARTÃO] Payload integral recebido:', JSON.stringify(payload));

    const id = payload.id || payload.gatewaytransaction || '';
    const hash = payload.hash || payload.transactionhash || '';
    const status = payload.payment_status || payload.status || '';
    
    // Tentativa de extração do ID usando todas as propriedades possíveis
    const matriculaId = payload.metadata?.order_id || payload.order_id || (payload.items && payload.items[0]?.id) || '';

    console.log(`[MONITORAMENTO CARTÃO] Dados Extraídos -> Hash: "${hash}" | ID: "${id}" | Matricula Identificada: "${matriculaId}" | Status: "${status}"`);

    if (!matriculaId) {
      console.error('[MONITORAMENTO CARTÃO] ❌ FALHA CRÍTICA: Não conseguimos determinar a Matrícula por nenhum metadado.');
      return res.status(200).send('Matrícula não identificada');
    }

    // Buscando o pagamento correspondente no banco
    let pagamento = await prisma.pagamento.findFirst({
      where: {
        OR: [
          { matriculaId: matriculaId },
          { gatewayRef: String(id) },
          { gatewayRef: String(hash) }
        ].filter(Boolean)
      }
    });

    console.log(`[MONITORAMENTO CARTÃO] 🔎 Busca no Banco -> Registro de pagamento já existia? ${pagamento ? 'SIM' : 'NÃO'}`);

    const ehSucesso = ['paid', 'PAGO', 'success', 'captured'].includes(status);

    if (ehSucesso) {
      if (!pagamento) {
        console.log(`[MONITORAMENTO CARTÃO] ⚠️ Registro ausente no banco (Race Condition). Criando pagamento de emergência para Matrícula: ${matriculaId}`);
        pagamento = await prisma.pagamento.create({
          data: {
            matriculaId: matriculaId,
            gateway: 'unicopag',
            gatewayRef: String(hash || id),
            metodo: payload.payment_method || 'CREDITO',
            valor: Number(payload.amount_total || 0) / 100,
            status: 'PAGO'
          }
        });
      } else {
        console.log(`[MONITORAMENTO CARTÃO] ✨ Registro encontrado. Atualizando pagamento id: ${pagamento.id} para PAGO`);
        await prisma.pagamento.updateMany({ 
          where: { id: pagamento.id }, 
          data: { status: 'PAGO', gatewayRef: String(hash || id), atualizadoEm: new Date() } 
        });
      }

      // Verificando os detalhes da matrícula para aplicar o status final correto
      const dadosMatricula = await prisma.matricula.findUnique({ where: { id: matriculaId } });
      const novoStatusMatricula = dadosMatricula?.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';

      console.log(`[MONITORAMENTO CARTÃO] 🔄 Atualizando Matrícula ${matriculaId} de "${dadosMatricula?.statusPagamento}" para "${novoStatusMatricula}"`);

      await prisma.matricula.update({ 
        where: { id: matriculaId }, 
        data: { 
          statusPagamento: novoStatusMatricula, 
          confirmadaEm: new Date(), 
          confirmadaPor: 'unicopag' 
        } 
      });

      console.log(`[MONITORAMENTO CARTÃO] ✅ SUCESSO COMPLETO: Matrícula ${matriculaId} liberada com sucesso!`);
    } else {
      console.log(`[MONITORAMENTO CARTÃO] ℹ️ Transação recebida com status não-sucesso ("${status}"). Nenhuma ação de baixa tomada.`);
    }

    return res.status(200).send('Webhook processado com logs');

  } catch (error) {
    console.error('[MONITORAMENTO CARTÃO] 💥 ERRO FATAL NO WEBHOOK:', error);
    return res.status(500).send('Erro interno');
  }
});

module.exports = router;