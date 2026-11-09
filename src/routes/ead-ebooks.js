// routes/ead-ebooks.js
//
// Painel → Escola Digital → E-books (2026-11-09; spec 2026-11-09-escola-digital-ebooks.md §2). Só DEV, como o resto
// da EAD (routes/ead.js). Montado no admin.js ao lado dele. O PDF vai para o lugar privado (lib/ebook-arquivo.js).

const express = require('express');
const multer = require('multer');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const eb = require('../lib/ebook');
const arq = require('../lib/ebook-arquivo');
const iaTextos = require('../lib/ia-textos');
const ia = require('../lib/ead-ia');
const imagensLib = require('../lib/ead-imagens');
const { salvarFotoCurso, removerFotoCurso } = require('../lib/upload');

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const uploadEbook = multer({ storage: multer.memoryStorage(), limits: { fileSize: eb.MAX_PDF, files: 2 } })
  .fields([{ name: 'pdf', maxCount: 1 }, { name: 'foto', maxCount: 1 }]);
// Erro do multer (arquivo grande demais) vira mensagem na tela, não erro 500.
const receber = (req, res, next) => uploadEbook(req, res, (err) => {
  if (err) req.uploadErro = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo muito grande (PDF até 50 MB; capa até 3 MB).' : 'Não foi possível receber o arquivo.';
  next();
});
const ehId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const ORDEM_FAQ = [{ ordem: 'asc' }, { criadoEm: 'asc' }];

module.exports = function rotasEbooks({ requireDev, auditar }) {
  const router = express.Router();
  router.use('/ead/ebooks', requireDev);
  const get = (c, ...h) => router.get(c, ...h.map((f) => asyncHandler(f)));
  const post = (c, ...h) => router.post(c, ...h.map((f) => asyncHandler(f)));
  const voltar = (res, url, tipo, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + tipo + '=' + encodeURIComponent(msg));
  const naoAchou = (res) => res.status(404).render('admin/erro', { mensagem: 'E-book não encontrado.' });
  const achar = async (id) => (ehId(id) ? eb.porId(id) : null);

  async function formulario(res, { ebook = null, valores = {}, erro = null, status = 200, faqsIniciais = [] }) {
    const faqs = ebook ? await prisma.faqCurso.findMany({ where: { cursoId: ebook.cursoId }, orderBy: ORDEM_FAQ }) : [];
    res.status(status).render('admin/ead/ebook-form', {
      ebook, valores, erro, faqs, faqsIniciais, temOpenAI: imagensLib.temOpenAI(),
      statusImagem: ebook ? await imagensLib.statusDe(`curso:${ebook.cursoId}`) : null,
    });
  }

  get('/ead/ebooks', async (req, res) => {
    const lista = await prisma.ebook.findMany({ include: { curso: { select: { nome: true, imagemUrl: true } }, _count: { select: { downloads: true } } }, orderBy: [{ ordemVitrine: 'asc' }, { criadoEm: 'asc' }] });
    const vendas = await prisma.matricula.groupBy({ by: ['turmaId'], where: { statusPagamento: { in: ['PAGO', 'PARCELADO'] }, turma: { status: 'ONLINE', curso: { ebook: { isNot: null } } } }, _count: true });
    const turmas = await prisma.turma.findMany({ where: { id: { in: vendas.map((v) => v.turmaId) } }, select: { id: true, cursoId: true } });
    const porCurso = {};
    for (const v of vendas) { const t = turmas.find((x) => x.id === v.turmaId); if (t) porCurso[t.cursoId] = (porCurso[t.cursoId] || 0) + v._count; }
    res.render('admin/ead/ebooks', { lista: lista.map((e) => ({ ...e, vendas: porCurso[e.cursoId] || 0 })), ok: req.query.ok || null, erro: req.query.erro || null });
  });

  // (antes de /ead/ebooks/:id: senão "ia-textos" seria lido como id)
  // Escrever com IA: JSON { ok, textos } ou { ok:false, erro }. Com o PDF já enviado, o Claude lê as 4 primeiras páginas.
  post('/ead/ebooks/ia-textos', async (req, res) => {
    if (!ia.ehChaveConfigurada()) return res.json({ ok: false, erro: ia.MSG_CHAVE });
    const t = await ia.dentroDoTeto();
    if (!t.ok) return res.json({ ok: false, erro: t.erro });
    const b = req.body || {};
    // ebookId (testes, links diretos) ou cursoId (o bloco "Escrever com IA" manda o curso escondido do e-book).
    const ebook = ehId(b.ebookId) ? await achar(b.ebookId)
      : ehId(b.cursoId) ? await prisma.ebook.findUnique({ where: { cursoId: b.cursoId }, include: { curso: true } }) : null;
    let pdf = null;
    if (ebook && ebook.arquivoPdf) {
      const buf = await arq.ler(ebook.arquivoPdf);
      if (buf) pdf = await arq.primeirasPaginas(buf, 4).catch(() => null);
    }
    const dados = b.soDuvidas === '1' && ebook ? await iaTextos.dadosDoCurso(ebook.cursoId) : { nome: b.nome || (ebook && ebook.curso.nome), descricao: b.descricao };
    try {
      const x = await iaTextos.escrever({ tipo: 'ebook', ideias: b.ideias, cursoId: ebook ? ebook.cursoId : null, dados, pdf });
      await ia.somarCustoAvulso(x.usage);
      await auditar(req, 'IA_TEXTOS_EBOOK', 'Ebook', ebook ? ebook.id : 'novo', {});
      return res.json({ ok: true, textos: x.textos });
    } catch (e) {
      if (e.usage) await ia.somarCustoAvulso(e.usage).catch(() => {});
      console.error('[IA TEXTOS EBOOK]', e.message);
      return res.json({ ok: false, erro: 'A IA não conseguiu escrever agora. Tente de novo em alguns instantes.' });
    }
  });

  get('/ead/ebooks/novo', async (req, res) => formulario(res, {}));

  // Capa (opcional): imagem até 3 MB, vira WebP. Devolve { url } ou { erro }.
  async function capaDoForm(req) {
    const f = req.files && req.files.foto && req.files.foto[0];
    if (!f) return {};
    if (!TIPOS_FOTO.includes(f.mimetype)) return { erro: 'A capa precisa ser uma imagem JPG, PNG, WEBP ou GIF.' };
    if (f.size > 3 * 1024 * 1024) return { erro: 'Capa muito grande (máximo 3 MB).' };
    return { url: await salvarFotoCurso(f) };
  }
  const pdfDoForm = (req) => (req.files && req.files.pdf && req.files.pdf[0]) || null;

  post('/ead/ebooks/novo', receber, async (req, res) => {
    const valores = req.body;
    const deNovo = (erro) => formulario(res, { valores, erro, status: 400, faqsIniciais: iaTextos.faqsDoCorpo(req.body) });
    if (req.uploadErro) return deNovo(req.uploadErro);
    const capa = await capaDoForm(req);
    if (capa.erro) return deNovo(capa.erro);
    const s = await eb.salvar(req.body, pdfDoForm(req));
    if (s.erro) { if (capa.url) await removerFotoCurso(capa.url); return deNovo(s.erro); }
    if (capa.url) await prisma.curso.update({ where: { id: s.ebook.cursoId }, data: { imagemUrl: capa.url, imagemGeradaPorIa: false } });
    await iaTextos.salvarFaqs(s.ebook.cursoId, iaTextos.lerFaqsDoForm(req.body));
    await auditar(req, 'CRIOU_EBOOK', 'Ebook', s.ebook.id, { nome: s.ebook.curso.nome });
    voltar(res, `/ead/ebooks/${s.ebook.id}`, 'ok', 'E-book criado.');
  });

  get('/ead/ebooks/:id', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    res.locals.ok = req.query.ok || null;
    formulario(res, { ebook, valores: { ...ebook, ...ebook.curso, preco: Number(ebook.precoOnline).toFixed(2).replace('.', ',') }, erro: req.query.erro || null });
  });

  post('/ead/ebooks/:id', receber, async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    const deNovo = (erro) => formulario(res, { ebook, valores: { ...ebook, ...req.body }, erro, status: 400 });
    if (req.uploadErro) return deNovo(req.uploadErro);
    const capa = await capaDoForm(req);
    if (capa.erro) return deNovo(capa.erro);
    const pdf = pdfDoForm(req);
    const s = await eb.salvar(req.body, pdf, ebook.id);
    if (s.erro) { if (capa.url) await removerFotoCurso(capa.url); return deNovo(s.erro); }
    const antiga = ebook.curso.imagemUrl;
    if (capa.url || req.body.removerFoto) {
      await prisma.curso.update({ where: { id: ebook.cursoId }, data: { imagemUrl: capa.url || null, imagemGeradaPorIa: false } });
      if (antiga) await removerFotoCurso(antiga);
    }
    await iaTextos.salvarFaqs(ebook.cursoId, iaTextos.lerFaqsDoForm(req.body));
    await auditar(req, pdf ? 'TROCOU_PDF_EBOOK' : 'EDITOU_EBOOK', 'Ebook', ebook.id, {});
    voltar(res, `/ead/ebooks/${ebook.id}`, 'ok', 'E-book salvo.');
  });

  post('/ead/ebooks/:id/excluir', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    const x = await eb.excluir(ebook.id);
    if (x.erro) return voltar(res, `/ead/ebooks/${ebook.id}`, 'erro', x.erro);
    if (ebook.curso.imagemUrl) await removerFotoCurso(ebook.curso.imagemUrl).catch(() => {});
    await auditar(req, 'EXCLUIU_EBOOK', 'Ebook', ebook.id, { nome: ebook.curso.nome });
    voltar(res, '/ead/ebooks', 'ok', 'E-book excluído.');
  });

  // Dúvidas frequentes (sanfona na página do e-book), como no curso só online.
  post('/ead/ebooks/:id/faqs', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    const volta = `/ead/ebooks/${ebook.id}#duvidas`;
    const pergunta = String(req.body.pergunta || '').trim().slice(0, 200);
    const resposta = String(req.body.resposta || '').trim().slice(0, 600);
    if (!pergunta || !resposta) return voltar(res, volta, 'erro', 'Preencha a pergunta e a resposta.');
    const total = await prisma.faqCurso.count({ where: { cursoId: ebook.cursoId } });
    await prisma.faqCurso.create({ data: { cursoId: ebook.cursoId, pergunta, resposta, ordem: total } });
    await auditar(req, 'ADICIONOU_FAQ', 'Curso', ebook.cursoId, { pergunta });
    voltar(res, volta, 'ok', 'Dúvida adicionada.');
  });
  post('/ead/ebooks/:id/faqs-ia', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    const n = await iaTextos.salvarFaqs(ebook.cursoId, iaTextos.lerFaqsDoForm(req.body));
    if (n) await auditar(req, 'ADICIONOU_FAQ', 'Curso', ebook.cursoId, { porIa: true, quantas: n });
    voltar(res, `/ead/ebooks/${ebook.id}#duvidas`, n ? 'ok' : 'erro', n ? `${n} ${n === 1 ? 'dúvida adicionada' : 'dúvidas adicionadas'}.` : 'Nenhuma dúvida marcada (ou todas já existiam).');
  });
  post('/ead/ebooks/:id/faqs/:faqId/remover', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook || !ehId(req.params.faqId)) return naoAchou(res);
    const x = await prisma.faqCurso.deleteMany({ where: { id: req.params.faqId, cursoId: ebook.cursoId } });
    if (x.count) await auditar(req, 'REMOVEU_FAQ', 'Curso', ebook.cursoId, { faqId: req.params.faqId });
    voltar(res, `/ead/ebooks/${ebook.id}#duvidas`, 'ok', 'Dúvida removida.');
  });

  // Gerar capa com IA (troca a atual), em segundo plano, como a imagem do curso.
  post('/ead/ebooks/:id/capa-ia', async (req, res) => {
    const ebook = await achar(req.params.id);
    if (!ebook) return naoAchou(res);
    const volta = `/ead/ebooks/${ebook.id}`;
    if (!ia.ehChaveConfigurada()) return voltar(res, volta, 'erro', ia.MSG_CHAVE);
    const t = await ia.dentroDoTeto();
    if (!t.ok) return voltar(res, volta, 'erro', t.erro);
    const nome = `curso:${ebook.cursoId}`;
    if (await imagensLib.travaOcupada(nome)) return voltar(res, volta, 'erro', imagensLib.OCUPADO);
    const quem = req.session.usuarioId || 'SISTEMA';
    const pedido = String((req.body && req.body.pedido) || '').trim();
    imagensLib.emSegundoPlano(nome, nome, async () => {
      const x = pedido ? await imagensLib.gerarOutra({ tipo: 'curso', id: ebook.cursoId, pedido }) : await imagensLib.imagemDoCurso(ebook.cursoId, { custo: (u) => ia.somarCustoAvulso(u) });
      if (x.ok) {
        await prisma.ebook.update({ where: { id: ebook.id }, data: { capaGeradaPorIa: true } }).catch(() => {});
        await prisma.logAuditoria.create({ data: { atorId: quem, acao: 'EBOOK_CAPA_IA', alvoTipo: 'Ebook', alvoId: ebook.id } }).catch(() => {});
      }
      return { ok: x.ok, msg: x.ok ? 'Capa gerada.' : x.erro };
    });
    voltar(res, volta, 'ok', 'Gerando a capa em segundo plano (cerca de 1 minuto). Recarregue a página para ver.');
  });

  return router;
};
