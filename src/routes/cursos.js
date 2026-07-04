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

  // Cria o registro de Pagamento ANTES de chamar o gateway, com gatewayRef ainda em branco.
  // Isso garante que já existe uma linha PENDENTE vinculada à matrícula no banco no instante
  // em que o cartão é cobrado — mesmo que o webhook da Únicopag chegue antes desta função
  // terminar de rodar (o que acontece com frequência na API Cloud, que é assíncrona e rápida).
  // Também evita criar uma segunda linha duplicada caso o webhook já tenha processado tudo
  // enquanto aguardávamos a resposta do gateway.
  const pagamentoPendente = await prisma.pagamento.create({
    data: {
      matriculaId: matricula.id,
      gateway: 'unicopag',
      gatewayRef: null,
      metodo: forma,
      valor: total,
      status: 'PENDENTE',
    },
  });

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

    const gatewayRef = String(resultadoGateway.gatewayRef || resultadoGateway.id || resultadoGateway.hash);

    // Só atualiza a linha se ela ainda estiver PENDENTE — se o webhook já chegou e marcou
    // como PAGO nesse meio-tempo, não queremos sobrescrever o status de volta.
    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { gatewayRef },
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
    // Se a chamada ao gateway falhou (ex.: rejeição de cartão, erro 422, timeout), marca a
    // linha PENDENTE criada acima como CANCELADO para não deixar registros órfãos no banco.
    await prisma.pagamento.updateMany({
      where: { id: pagamentoPendente.id, status: 'PENDENTE' },
      data: { status: 'CANCELADO' },
    });
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
    console.log('[Webhook UnicopAg] Notificação recebida:', JSON.stringify(payload));

    // Formato real confirmado em log de produção (payload achatado, sem "data"/"result"):
    // { event, id, hash, payment_method, payment_status, amount_total, customer: {...},
    //   items: [{ hash, title, price, quantity, operation_type }], ... }
    // IMPORTANTE: esse payload NÃO tem metadata/order_id. O único jeito de saber a que
    // matrícula ele se refere é pelo hash (== gatewayRef que salvamos) ou, na janela de
    // corrida em que o gatewayRef ainda não foi gravado, pelo CPF do cliente.
    const hash = payload.hash || payload.id || '';
    const status = payload.payment_status || payload.status || '';
    const amountTotal = Number(payload.amount_total ?? payload.amount ?? 0) / 100;
    const documentoCliente = String(payload.customer?.document || '').replace(/\D/g, '');

    if (!hash) return res.status(200).send('Sem hash para processar');

    // 1. Caminho normal: casa pelo hash da transação já salvo no Pagamento.
    let pagamento = await prisma.pagamento.findFirst({ where: { gatewayRef: String(hash) } });

    // 2. Corrida de dados: o webhook chegou antes de terminarmos de gravar o gatewayRef
    //    (a linha PENDENTE já existe, criada antes de chamar o gateway — ver POST
    //    /inscrever/:turmaId — só falta o gatewayRef). Casa pelo CPF do cliente + valor +
    //    status PENDENTE mais recente, já que é o único vínculo disponível nesse payload.
    if (!pagamento && documentoCliente) {
      const aluno = await prisma.usuario.findUnique({ where: { cpfCnpj: documentoCliente } });
      if (aluno) {
        pagamento = await prisma.pagamento.findFirst({
          where: {
            status: 'PENDENTE',
            valor: amountTotal,
            matricula: { alunoId: aluno.id },
          },
          orderBy: { criadoEm: 'desc' },
        });
        if (pagamento) {
          console.log(`[Webhook UnicopAg] Casado por CPF (corrida de dados) — Pagamento ${pagamento.id}`);
        }
      }
    }

    if (!pagamento) {
      console.error(`[Webhook UnicopAg] Pagamento não identificado. hash=${hash} doc=${documentoCliente} valor=${amountTotal} payload=${JSON.stringify(payload)}`);
      return res.status(200).send('Pagamento não identificado');
    }

    // Idempotência: se um retry do webhook chegar depois de já termos processado, não refaz.
    if (pagamento.status === 'PAGO') {
      return res.status(200).send('Já processado');
    }

    const ehSucesso = ['paid', 'pago', 'success', 'captured', 'approved'].includes(String(status).toLowerCase());
    if (!ehSucesso) {
      console.log(`[Webhook UnicopAg] Status "${status}" ainda não é de sucesso para o Pagamento ${pagamento.id}; nada a atualizar por ora.`);
      return res.status(200).send('Status recebido, aguardando confirmação de pagamento.');
    }

    await prisma.pagamento.updateMany({
      where: { id: pagamento.id },
      data: { status: 'PAGO', gatewayRef: String(hash), atualizadoEm: new Date() },
    });

    const dadosMatricula = await prisma.matricula.findUnique({ where: { id: pagamento.matriculaId } });
    const novoStatusMatricula = dadosMatricula?.plano === 'PARCELADO' ? 'PARCELADO' : 'PAGO';

    await prisma.matricula.update({
      where: { id: pagamento.matriculaId },
      data: {
        statusPagamento: novoStatusMatricula,
        confirmadaEm: new Date(),
        confirmadaPor: 'unicopag',
      },
    });

    console.log(`[Webhook UnicopAg] ✅ Matrícula ${pagamento.matriculaId} atualizada para ${novoStatusMatricula}`);

    return res.status(200).send('Webhook processado com segurança');

  } catch (error) {
    console.error('[Webhook UnicopAg] 💥 Erro interno no processamento do webhook:', error);
    return res.status(500).send('Erro interno');
  }
});

module.exports = router;