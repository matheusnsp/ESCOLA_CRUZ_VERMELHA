// routes/painel-cursos.js
//
// Telas novas de Cursos (2026-11-13; spec docs/superpowers/specs/2026-11-13-cursos-turmas-telas-design.md):
// o curso abre num resumo com cartões e cada parte é uma tela curta com o seu salvar. Montado em routes/admin.js
// (depois do requireAdmin), no padrão de routes/contas.js: require('./painel-cursos')({ requirePermissao, auditar }).
// Cada seção grava só os seus campos (lib/curso-secoes.js): salvar Valores não mexe em foto, textos nem certificado.

const express = require('express');
const prisma = require('../db');
const extras = require('../lib/extras');
const certificado = require('../lib/certificado');
const S = require('../lib/curso-secoes');
const { assinaturasDoForm, salvarAssinaturasDoCurso } = require('../lib/curso-assinaturas');
const { uploadFoto, salvarFotoCurso, removerFotoCurso } = require('../lib/upload');
const { formatBRL, lerConfigMatricula } = require('../lib/matricula');
const { simularValores } = require('../lib/simular-valores');
const F = require('../lib/curso-faqs');

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NOME_SECAO = 'pagina|valores|certificado|publicacao';
const MSG_SALVO = { pagina: 'Página salva.', valores: 'Valores salvos.', certificado: 'Certificado salvo.', publicacao: 'Inscrição e publicação salvas.' };

async function lerTaxaPadrao() {
  try {
    const cfg = await prisma.configuracao.findUnique({ where: { chave: 'matricula_valor_padrao' } });
    return cfg ? Number(cfg.valor) : null;
  } catch (e) { return null; }
}

// Por que o curso não pode ser excluído (mesmas regras de antes), ou null.
async function motivoNaoExcluir(cursoId) {
  const turmas = await prisma.turma.findMany({ where: { cursoId }, select: { id: true } });
  const matriculas = turmas.length ? await prisma.matricula.count({ where: { turmaId: { in: turmas.map((t) => t.id) } } }) : 0;
  if (turmas.length || matriculas) return `Este curso tem turmas${matriculas ? ' e inscrições' : ''}, então não pode ser excluído (o histórico dos alunos e os certificados dependem dele). Para tirar do site, desmarque "Mostrar este curso no site".`;
  if (await prisma.cursoOnline.count({ where: { cursoId } })) return 'Este curso tem conteúdo EAD. Desative o EAD em EAD → curso antes de excluir.';
  if (await prisma.cupomEad.count({ where: { cursoId } })) return 'Este curso tem cupom de desconto. Apague o cupom em Cupons antes de excluir.';
  return null;
}

// Curso com os extras, a contagem de dúvidas e as próximas turmas (para o resumo e as seções).
async function carregarCurso(id) {
  const curso = await prisma.curso.findUnique({ where: { id }, include: { _count: { select: { faqs: true } } } });
  if (!curso) return null;
  await extras.anexar('curso', [curso]);
  curso.totalFaqs = curso._count.faqs;
  return curso;
}

module.exports = function painelCursos({ requirePermissao, auditar }) {
  const router = express.Router();
  const gerenciar = requirePermissao('cursos:gerenciar');

  router.use('/cursos', async (req, res, next) => {
    try { res.locals.certAjustes = await certificado.lerAjustes(); } catch (e) { res.locals.certAjustes = null; }
    res.locals.categoriasCurso = require('../lib/vitrine').CATEGORIAS;
    res.locals.escolaridades = S.ESCOLARIDADES;
    res.locals.SECOES = S.SECOES;
    next();
  });

  // Link antigo (e-mails, favoritos): a edição agora começa no resumo.
  router.get(`/cursos/:id(${ID})/editar`, gerenciar, (req, res) => res.redirect(`/cursos/${req.params.id}`));

  router.get(`/cursos/:id(${ID})`, gerenciar, async (req, res) => {
    const curso = await carregarCurso(req.params.id);
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const agora = new Date();
    const turmas = await prisma.turma.findMany({
      where: { cursoId: curso.id, status: { in: ['ABERTA', 'CONFIRMADA'] }, inicioPrevisto: { gte: agora } },
      orderBy: { inicioPrevisto: 'asc' }, take: 3,
      include: { _count: { select: { matriculas: { where: { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } } } } },
    });
    res.render('admin/curso-resumo', { curso, turmas, faltas: S.faltasCurso(curso), formatBRL, ok: req.query.ok || null, erro: req.query.erro || null });
  });

  async function renderSecao(res, secao, curso, { status = 200, erro = null, valores } = {}) {
    const extra = {};
    if (secao === 'valores') {
      extra.taxaPadrao = await lerTaxaPadrao();
      extra.valores = valores !== undefined ? valores : await simularValores(curso, await lerConfigMatricula()).catch(() => null);
    }
    if (secao === 'pagina') {
      const img = require('../lib/ead-imagens');
      extra.temOpenAI = img.temOpenAI();
      extra.statusImagem = await img.statusDe(`curso:${curso.id}`).catch(() => null);
    }
    if (secao === 'publicacao') extra.motivoNaoExcluir = await motivoNaoExcluir(curso.id);
    return res.status(status).render('admin/curso-secao', { secao, s: S.SECOES[secao], curso, erro, formatBRL, ...extra });
  }

  router.get(`/cursos/:id(${ID})/:secao(${NOME_SECAO})`, gerenciar, async (req, res) => {
    const curso = await carregarCurso(req.params.id);
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    res.locals.okImagem = req.query.okImagem || null;
    res.locals.erroImagem = req.query.erroImagem || null;
    return renderSecao(res, req.params.secao, curso, { erro: req.query.erro || null });
  });

  router.post(`/cursos/:id(${ID})/:secao(${NOME_SECAO})`, gerenciar, uploadFoto, async (req, res) => {
    const { id, secao } = req.params;
    const existe = await carregarCurso(id);
    if (!existe) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const b = req.body || {};
    // Depois de um erro, a tela volta com o que foi digitado por cima do que está gravado.
    const comDigitado = () => ({ ...existe, ...b, id, imagemUrl: existe.imagemUrl, totalFaqs: existe.totalFaqs });
    if (req.uploadErro) return renderSecao(res, secao, comDigitado(), { status: 400, erro: req.uploadErro });

    const { dados, extras: ex, erro } = S.lerSecao(secao, b);
    const erroAssin = secao === 'certificado' && b.assin ? assinaturasDoForm(b).erro : null;
    if (erro || erroAssin) return renderSecao(res, secao, comDigitado(), { status: 400, erro: erro || erroAssin, valores: null });

    if (secao === 'pagina') {
      const eadAcesso = require('../lib/ead-acesso');
      if (await eadAcesso.enderecoOnlineEmUso(dados.nome, id) && await prisma.cursoOnline.count({ where: { cursoId: id } })) {
        return renderSecao(res, secao, comDigitado(), { status: 400, erro: 'Já existe outro curso online com esse endereço. Escolha outro nome.' });
      }
      if (req.file) {
        dados.imagemUrl = await salvarFotoCurso(req.file);
        dados.imagemGeradaPorIa = false; // foto própria: sem o selo de IA
        await removerFotoCurso(existe.imagemUrl);
      } else if (b.removerFoto === 'on') {
        dados.imagemUrl = null;
        dados.imagemGeradaPorIa = false;
        await removerFotoCurso(existe.imagemUrl);
      }
    }
    if (Object.keys(dados).length) await prisma.curso.update({ where: { id }, data: dados });
    if (secao === 'pagina') await require('../lib/ead-acesso').guardarEnderecoAntigo(id, existe.nome, dados.nome);
    if (Object.keys(ex).length) await extras.salvarExtra('curso', id, ex);
    if (secao === 'certificado') await salvarAssinaturasDoCurso(id, b, req, auditar);
    await auditar(req, 'EDITOU_CURSO', 'Curso', id, { secao, nome: dados.nome || existe.nome });
    return res.redirect(`/cursos/${id}?ok=${encodeURIComponent(MSG_SALVO[secao])}`);
  });

  // Turmas deste curso: todas, das próximas para as mais antigas concluídas, com atalho para a nova.
  router.get(`/cursos/:id(${ID})/turmas`, gerenciar, async (req, res) => {
    const curso = await carregarCurso(req.params.id);
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const { FORA_DO_PRESENCIAL } = require('../lib/turma-online');
    const turmas = await prisma.turma.findMany({
      where: { cursoId: curso.id, status: { notIn: FORA_DO_PRESENCIAL } },
      orderBy: { inicioPrevisto: 'desc' }, take: 60,
      include: {
        aulas: { orderBy: { data: 'asc' }, select: { data: true, horario: true } },
        _count: { select: { matriculas: { where: { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO', 'PENDENTE'] } } } } },
      },
    });
    res.render('admin/curso-turmas', { curso, turmas });
  });

  // ---- Dúvidas frequentes: cada ação grava na hora e volta para a seção ----
  const voltaDuvidas = (id, erro) => `/cursos/${id}/duvidas${erro ? `?erro=${encodeURIComponent(erro)}` : ''}`;

  router.get(`/cursos/:id(${ID})/duvidas`, gerenciar, async (req, res) => {
    const curso = await carregarCurso(req.params.id);
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const faqs = await prisma.faqCurso.findMany({ where: { cursoId: curso.id }, orderBy: F.ORDEM });
    res.render('admin/curso-duvidas', { curso, faqs, erro: req.query.erro || null });
  });

  router.post(`/cursos/:id(${ID})/faqs`, gerenciar, async (req, res) => {
    const curso = await prisma.curso.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const pergunta = String(req.body.pergunta || '').trim().slice(0, 200);
    const resposta = String(req.body.resposta || '').trim().slice(0, 1000);
    if (!pergunta || !resposta) return res.redirect(voltaDuvidas(curso.id, 'Preencha a pergunta e a resposta.'));
    const total = await prisma.faqCurso.count({ where: { cursoId: curso.id } });
    await prisma.faqCurso.create({ data: { cursoId: curso.id, pergunta, resposta, ordem: total } });
    await auditar(req, 'ADICIONOU_FAQ', 'Curso', curso.id, { pergunta });
    return res.redirect(voltaDuvidas(curso.id));
  });

  // As marcadas de "Sugerir dúvidas" (IA) ou as que o assistente propôs.
  router.post(`/cursos/:id(${ID})/faqs-ia`, gerenciar, async (req, res) => {
    const curso = await prisma.curso.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const txt = require('../lib/ia-textos');
    const n = await txt.salvarFaqs(curso.id, txt.lerFaqsDoForm(req.body));
    if (n) await auditar(req, 'ADICIONOU_FAQ', 'Curso', curso.id, { porIa: true, quantas: n });
    return res.redirect(voltaDuvidas(curso.id, n ? null : 'Nenhuma dúvida marcada (ou todas já existiam).'));
  });

  router.post(`/cursos/:id(${ID})/faqs/:faqId/:acao(remover|editar|subir|descer)`, gerenciar, async (req, res) => {
    const { id, faqId, acao } = req.params;
    if (acao === 'subir' || acao === 'descer') {
      await F.moverFaq(id, faqId, acao);
      return res.redirect(voltaDuvidas(id));
    }
    if (acao === 'editar') {
      const r = await F.editarFaq(id, faqId, req.body || {});
      if (r.ok) await auditar(req, 'EDITOU_FAQ', 'Curso', id, { faqId });
      return res.redirect(voltaDuvidas(id, r.ok ? null : r.erro));
    }
    const faq = await prisma.faqCurso.findUnique({ where: { id: faqId } }).catch(() => null);
    if (!faq || faq.cursoId !== id) return res.redirect(voltaDuvidas(id, 'Dúvida não encontrada.'));
    await prisma.faqCurso.delete({ where: { id: faq.id } });
    await auditar(req, 'REMOVEU_FAQ', 'Curso', id, { pergunta: faq.pergunta });
    return res.redirect(voltaDuvidas(id));
  });

  router.post(`/cursos/:id(${ID})/excluir`, gerenciar, async (req, res) => {
    const curso = await prisma.curso.findUnique({ where: { id: req.params.id } });
    if (!curso) return res.status(404).render('admin/erro', { mensagem: 'Curso não encontrado.' });
    const motivo = await motivoNaoExcluir(curso.id);
    if (motivo) return res.redirect(`/cursos/${curso.id}/publicacao?erro=${encodeURIComponent(motivo)}`);
    await prisma.curso.delete({ where: { id: curso.id } });
    await removerFotoCurso(curso.imagemUrl);
    await auditar(req, 'EXCLUIU_CURSO', 'Curso', curso.id, { nome: curso.nome });
    return res.redirect('/cursos?ok=Curso excluido.');
  });

  return router;
};

module.exports.motivoNaoExcluir = motivoNaoExcluir;
