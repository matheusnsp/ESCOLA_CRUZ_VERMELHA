// routes/ead-webinarios.js
//
// Painel → modo Online → Conteúdos → Webinários (2026-11-13; spec 2026-11-13-escola-digital-webinarios-design.md §2).
// Só DEV, como e-books (routes/ead-ebooks.js), e montado ao lado deles no admin.js.

const express = require('express');
const multer = require('multer');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const wb = require('../lib/webinario');
const iaTextos = require('../lib/ia-textos');
const { icsDoWebinario } = require('../lib/agenda');
const { salvarFotoCurso, removerFotoCurso } = require('../lib/upload');

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } }).single('foto');
const receber = (req, res, next) => upload(req, res, (err) => {
  if (err) req.uploadErro = err.code === 'LIMIT_FILE_SIZE' ? 'Capa muito grande (máximo 3 MB).' : 'Não foi possível receber o arquivo.';
  next();
});
const ehId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const ORDEM_FAQ = [{ ordem: 'asc' }, { criadoEm: 'asc' }];
const ORDEM_LISTA = [{ ordemVitrine: 'asc' }, { criadoEm: 'asc' }];
const dataBr = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const csv = (v) => { const t = String(v == null ? '' : v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

module.exports = function rotasWebinarios({ requireDev, auditar }) {
  const router = express.Router();
  router.use('/ead/webinarios', requireDev);
  const get = (c, ...h) => router.get(c, ...h.map((f) => asyncHandler(f)));
  const post = (c, ...h) => router.post(c, ...h.map((f) => asyncHandler(f)));
  const voltar = (res, url, tipo, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + tipo + '=' + encodeURIComponent(msg));
  const naoAchou = (res) => res.status(404).render('admin/erro', { mensagem: 'Webinário não encontrado.' });
  const achar = async (id) => (ehId(id) ? wb.porId(id) : null);

  // Inscritos com acesso (grátis: a inscrição; pago: inscrição de quem tem a matrícula paga).
  async function inscritos(w) {
    const lista = await prisma.inscricaoWebinario.findMany({ where: { webinarioId: w.id }, include: { usuario: { select: { id: true, nome: true, email: true } } }, orderBy: { criadoEm: 'asc' } });
    const presencas = await prisma.presencaWebinario.findMany({ where: { webinarioId: w.id } });
    const porUsuario = new Map(presencas.map((p) => [p.usuarioId, p]));
    const comAcesso = [];
    for (const i of lista) {
      const a = await wb.acesso(i.usuarioId, w);
      comAcesso.push({ ...i, forma: w.gratuito ? 'Grátis' : 'Pago', acesso: wb.temAcesso(a), presenca: porUsuario.get(i.usuarioId) || null });
    }
    return comAcesso;
  }

  async function formulario(res, { webinario = null, valores = {}, erro = null, status = 200, faqsIniciais = [] }) {
    const faqs = webinario ? await prisma.faqCurso.findMany({ where: { cursoId: webinario.cursoId }, orderBy: ORDEM_FAQ }) : [];
    const travaGratis = webinario ? (await prisma.inscricaoWebinario.count({ where: { webinarioId: webinario.id } })) + (await prisma.matricula.count({ where: { turma: { cursoId: webinario.cursoId } } })) > 0 : false;
    res.status(status).render('admin/ead/webinario-form', { webinario, valores, erro, faqs, faqsIniciais, travaGratis });
  }
  const valoresDe = (w) => ({ ...w, ...w.curso, inicioEm: wb.paraCampo(w.inicioEm), preco: Number(w.precoOnline).toFixed(2).replace('.', ','), gravacaoUrl: w.gravacaoUrl || '' });

  get('/ead/webinarios', async (req, res) => {
    const lista = await prisma.webinario.findMany({
      include: { curso: { select: { nome: true, imagemUrl: true } }, _count: { select: { inscricoes: true, presencas: true } } },
      orderBy: ORDEM_LISTA,
    });
    const vendas = await prisma.matricula.groupBy({ by: ['turmaId'], where: { statusPagamento: { in: ['PAGO', 'PARCELADO'] }, turma: { status: 'ONLINE', curso: { webinario: { isNot: null } } } }, _count: true });
    const turmas = await prisma.turma.findMany({ where: { id: { in: vendas.map((v) => v.turmaId) } }, select: { id: true, cursoId: true } });
    const porCurso = {};
    for (const v of vendas) { const t = turmas.find((x) => x.id === v.turmaId); if (t) porCurso[t.cursoId] = (porCurso[t.cursoId] || 0) + v._count; }
    res.render('admin/ead/webinarios', {
      lista: lista.map((w) => ({ ...w, vendas: porCurso[w.cursoId] || 0, quando: wb.quandoTexto(w.inicioEm) })),
      ok: req.query.ok || null, erro: req.query.erro || null,
    });
  });

  // ↑↓ na lista: renumera 0..n-1 (como a ordem dos cursos online).
  post('/ead/webinarios/ordem/:id/:dir', async (req, res) => {
    const lista = await prisma.webinario.findMany({ select: { id: true }, orderBy: ORDEM_LISTA });
    const i = lista.findIndex((w) => w.id === req.params.id);
    const j = req.params.dir === 'cima' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < lista.length) {
      [lista[i], lista[j]] = [lista[j], lista[i]];
      await prisma.$transaction(lista.map((w, n) => prisma.webinario.update({ where: { id: w.id }, data: { ordemVitrine: n } })));
      require('../lib/cache-rapido').limparTudo();
    }
    res.redirect('/ead/webinarios');
  });

  async function capaDoForm(req) {
    const f = req.file;
    if (!f) return {};
    if (!TIPOS_FOTO.includes(f.mimetype)) return { erro: 'A capa precisa ser uma imagem JPG, PNG, WEBP ou GIF.' };
    return { url: await salvarFotoCurso(f) };
  }

  get('/ead/webinarios/novo', async (req, res) => formulario(res, { valores: { duracaoMin: 60 } }));
  post('/ead/webinarios/novo', receber, async (req, res) => {
    const deNovo = (erro) => formulario(res, { valores: req.body, erro, status: 400, faqsIniciais: iaTextos.faqsDoCorpo(req.body) });
    if (req.uploadErro) return deNovo(req.uploadErro);
    const capa = await capaDoForm(req);
    if (capa.erro) return deNovo(capa.erro);
    const s = await wb.salvar(req.body, capa.url || null);
    if (s.erro) { if (capa.url) await removerFotoCurso(capa.url); return deNovo(s.erro); }
    await iaTextos.salvarFaqs(s.webinario.cursoId, iaTextos.lerFaqsDoForm(req.body));
    await auditar(req, 'CRIOU_WEBINARIO', 'Webinario', s.webinario.id, { nome: s.webinario.curso.nome });
    voltar(res, `/ead/webinarios/${s.webinario.id}`, 'ok', 'Webinário criado.');
  });

  get('/ead/webinarios/:id', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    res.locals.ok = req.query.ok || null;
    formulario(res, { webinario: w, valores: valoresDe(w), erro: req.query.erro || null });
  });

  // Avisos depois de salvar (spec §2 e §8): novo horário (zera lembretes) e gravação nova depois do fim (uma vez).
  async function avisar(antes, depois) {
    const email = require('../lib/email');
    const link = wb.linkPagina(depois);
    const mudouHorario = antes.inicioEm && depois.inicioEm && new Date(antes.inicioEm).getTime() !== new Date(depois.inicioEm).getTime();
    const gravacaoNova = depois.gravacaoUrl && depois.gravacaoUrl !== antes.gravacaoUrl && !depois.gravacaoAvisadaEm && wb.janela(depois) === 'depois';
    if (!mudouHorario && !gravacaoNova) return;
    if (mudouHorario) await prisma.inscricaoWebinario.updateMany({ where: { webinarioId: depois.id }, data: { lembrete24hEm: null, lembrete1hEm: null } });
    const lista = (await inscritos(depois)).filter((i) => i.acesso);
    if (gravacaoNova) await prisma.webinario.update({ where: { id: depois.id }, data: { gravacaoAvisadaEm: new Date() } });
    for (const i of lista) {
      const nome = String(i.usuario.nome || '').split(' ')[0];
      try {
        if (mudouHorario && wb.janela(depois) !== 'depois') {
          await email.enviarWebinarNovoHorario(i.usuario.email, nome, { webinario: depois.curso.nome, quando: wb.quandoTexto(depois.inicioEm), link, ics: icsDoWebinario(depois, link) });
        }
        if (gravacaoNova) await email.enviarWebinarGravacao(i.usuario.email, nome, { webinario: depois.curso.nome, link });
      } catch (e) { console.error('[WEBINARIO] aviso:', e.message); }
    }
  }

  post('/ead/webinarios/:id', receber, async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    const deNovo = (erro) => formulario(res, { webinario: w, valores: { ...valoresDe(w), ...req.body }, erro, status: 400 });
    if (req.uploadErro) return deNovo(req.uploadErro);
    const capa = await capaDoForm(req);
    if (capa.erro) return deNovo(capa.erro);
    const s = await wb.salvar(req.body, null, w.id);
    if (s.erro) { if (capa.url) await removerFotoCurso(capa.url); return deNovo(s.erro); }
    const antiga = w.curso.imagemUrl;
    if (capa.url || req.body.removerFoto) {
      await prisma.curso.update({ where: { id: w.cursoId }, data: { imagemUrl: capa.url || null, imagemGeradaPorIa: false } });
      if (antiga) await removerFotoCurso(antiga);
    }
    await iaTextos.salvarFaqs(w.cursoId, iaTextos.lerFaqsDoForm(req.body));
    await avisar(s.antes, s.webinario);
    await auditar(req, 'EDITOU_WEBINARIO', 'Webinario', w.id, {});
    voltar(res, `/ead/webinarios/${w.id}`, 'ok', 'Webinário salvo.');
  });

  get('/ead/webinarios/:id/inscritos', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    res.render('admin/ead/webinario-inscritos', { webinario: w, lista: await inscritos(w), dataBr, quando: wb.quandoTexto(w.inicioEm) });
  });
  get('/ead/webinarios/:id/inscritos.csv', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    const linhas = ['Nome;E-mail;Inscrito em;Forma;Presença'];
    for (const i of await inscritos(w)) {
      linhas.push([i.usuario.nome, i.usuario.email, dataBr(i.criadoEm), i.forma + (i.acesso ? '' : ' (sem acesso)'), i.presenca ? 'Sim' : 'Não'].map(csv).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inscritos-${wb.endereco(w.curso.nome)}.csv"`);
    res.send('﻿' + linhas.join('\n') + '\n');
  });

  post('/ead/webinarios/:id/excluir', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    const x = await wb.excluir(w.id);
    if (x.erro) return voltar(res, `/ead/webinarios/${w.id}`, 'erro', x.erro);
    if (w.curso.imagemUrl) await removerFotoCurso(w.curso.imagemUrl).catch(() => {});
    await auditar(req, 'EXCLUIU_WEBINARIO', 'Webinario', w.id, { nome: w.curso.nome });
    voltar(res, '/ead/webinarios', 'ok', 'Webinário excluído.');
  });

  // Dúvidas frequentes (sanfona na página), como no e-book.
  post('/ead/webinarios/:id/faqs', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w) return naoAchou(res);
    const volta = `/ead/webinarios/${w.id}#duvidas`;
    const pergunta = String(req.body.pergunta || '').trim().slice(0, 200);
    const resposta = String(req.body.resposta || '').trim().slice(0, 600);
    if (!pergunta || !resposta) return voltar(res, volta, 'erro', 'Preencha a pergunta e a resposta.');
    const total = await prisma.faqCurso.count({ where: { cursoId: w.cursoId } });
    await prisma.faqCurso.create({ data: { cursoId: w.cursoId, pergunta, resposta, ordem: total } });
    await auditar(req, 'ADICIONOU_FAQ', 'Curso', w.cursoId, { pergunta });
    voltar(res, volta, 'ok', 'Dúvida adicionada.');
  });
  post('/ead/webinarios/:id/faqs/:faqId/remover', async (req, res) => {
    const w = await achar(req.params.id);
    if (!w || !ehId(req.params.faqId)) return naoAchou(res);
    const x = await prisma.faqCurso.deleteMany({ where: { id: req.params.faqId, cursoId: w.cursoId } });
    if (x.count) await auditar(req, 'REMOVEU_FAQ', 'Curso', w.cursoId, { faqId: req.params.faqId });
    voltar(res, `/ead/webinarios/${w.id}#duvidas`, 'ok', 'Dúvida removida.');
  });

  return router;
};
