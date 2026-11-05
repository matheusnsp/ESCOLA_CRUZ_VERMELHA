// routes/ead.js
//
// Painel da secretaria → EAD (curso 100% online). Só DEV (requireDev em tudo). Montado no admin.js
// como o contas.js. Cadastro do conteúdo: curso online → módulos → tópicos → telas e perguntas;
// módulo final → cenários → decisões. Selo por módulo: RASCUNHO/VALIDADO; qualquer mudança dentro de
// um módulo validado o devolve a rascunho (invalidarSeValidado, na mesma transação da escrita).
// Spec: docs/superpowers/specs/2026-11-05-ead-estrutura-conteudo.md

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const ead = require('../lib/ead');
const edb = require('../lib/ead-db');
const eadTeste = require('../lib/ead-teste');
const { uploadFoto, salvarFotoCurso, removerFotoCurso } = require('../lib/upload');

const CSS = ['/ead-admin.css'];

// Erro de formulário lançado dentro de uma transação: desfaz tudo e volta para o form com a mensagem.
class ErroForm extends Error {}

module.exports = function rotasEad({ requireDev, auditar, ADMIN_URL }) {
  const router = express.Router();
  ['get', 'post'].forEach((metodo) => {
    const original = router[metodo].bind(router);
    router[metodo] = (caminho, ...handlers) => original(caminho, ...handlers.map((h) =>
      typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? asyncHandler(h) : h));
  });

  // Tudo do EAD: só DEV, e o menu do painel no modo Online.
  router.use('/ead', requireDev, (req, res, next) => { res.locals.modoPainel = 'online'; res.locals.cssExtra = CSS; next(); });

  const ator = (req) => req.session.usuarioId || 'SISTEMA';
  const voltar = (res, url, tipo, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + tipo + '=' + encodeURIComponent(msg));
  const naoAchou = (res) => res.status(404).render('admin/erro', { mensagem: 'Conteúdo EAD não encontrado.' });
  const urlModulo = (id) => `/ead/modulo/${id}`;
  const flash = (req) => ({ ok: req.query.ok || null, erro: req.query.erro || null });

  // Escrita que mexe no conteúdo de um módulo: transação + volta a rascunho se estava validado.
  async function escrever(req, moduloId, oQueMudou, fn) {
    return prisma.$transaction(async (tx) => {
      const r = await fn(tx);
      await edb.invalidarSeValidado(tx, moduloId, ator(req), oQueMudou);
      return r;
    });
  }

  // Contagens para as listas: telas, perguntas ativas e cenários de cada módulo.
  async function contagensDosModulos(cursoOnlineId) {
    const modulos = await prisma.moduloEad.findMany({
      where: { cursoOnlineId }, orderBy: edb.POR_ORDEM,
      include: { topicos: { include: { _count: { select: { telas: true } }, perguntas: { where: { ativa: true }, select: { id: true } } } }, _count: { select: { cenarios: true, topicos: true } } },
    });
    return ordenarFinalPorUltimo(modulos).map((m) => ({
      ...m,
      nTelas: m.topicos.reduce((s, t) => s + t._count.telas, 0),
      nPerguntas: m.topicos.reduce((s, t) => s + t.perguntas.length, 0),
      nCenarios: m._count.cenarios,
    }));
  }
  const ordenarFinalPorUltimo = (mods) => [...mods.filter((m) => !m.final), ...mods.filter((m) => m.final)];

  async function nomeDe(usuarioId) {
    if (!usuarioId || !edb.ehId(usuarioId)) return null;
    const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
    return u ? u.nome : null;
  }

  // ─── Cursos online ────────────────────────────────────────────────────────────────────────────
  router.get('/ead', async (req, res) => {
    const cursosOnline = await prisma.cursoOnline.findMany({ include: { curso: { select: { nome: true, ativo: true } } }, orderBy: { criadoEm: 'asc' } });
    const lista = [];
    for (const co of cursosOnline) {
      const mods = await contagensDosModulos(co.id);
      lista.push({ ...co, nModulos: mods.length, nValidados: mods.filter((m) => m.status === 'VALIDADO').length, nPerguntas: mods.reduce((s, m) => s + m.nPerguntas, 0) });
    }
    const semEad = await prisma.curso.findMany({ where: { online: null }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } });
    res.render('admin/ead/cursos', { lista, semEad, ...flash(req) });
  });

  router.post('/ead/ativar', async (req, res) => {
    const cursoId = String(req.body.cursoId || '');
    if (!edb.ehId(cursoId) || !(await prisma.curso.findUnique({ where: { id: cursoId } }))) return voltar(res, '/ead', 'erro', 'Escolha um curso.');
    if (await prisma.cursoOnline.findUnique({ where: { cursoId } })) return voltar(res, '/ead', 'erro', 'Esse curso já tem EAD.');
    const co = await prisma.cursoOnline.create({ data: { cursoId } });
    await auditar(req, 'EAD_ATIVOU_CURSO', 'CursoOnline', co.id, { cursoId });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'EAD ativado. Crie o primeiro módulo.');
  });

  async function acharCursoOnline(id) {
    if (!edb.ehId(id)) return null;
    return prisma.cursoOnline.findUnique({ where: { id }, include: { curso: { select: { id: true, nome: true } } } });
  }

  router.get('/ead/curso/:id', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const modulos = await contagensDosModulos(co.id);
    const codigo = await eadTeste.codigoDoCurso(co.id);
    const urlSite = (process.env.APP_URL || 'https://escola.cruzvermelhariodejaneiro.org').replace(/\/+$/, '');
    res.render('admin/ead/curso', { co, modulos, linkTeste: codigo ? `${urlSite}/ead-teste/${codigo}` : null, erroForm: null, ...flash(req) });
  });

  router.post('/ead/curso/:id', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const r = ead.schemaCursoOnline.safeParse(req.body);
    if (!r.success) return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Nota mínima: um número inteiro de 50 a 100.');
    await prisma.cursoOnline.update({ where: { id: co.id }, data: r.data });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'Nota mínima salva.');
  });

  router.post('/ead/curso/:id/desativar', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    if (await prisma.moduloEad.count({ where: { cursoOnlineId: co.id, status: 'VALIDADO' } })) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Há módulos validados. Reabra (volte para rascunho) todos antes de desativar o EAD.');
    }
    const fotos = await fotosDoCursoOnline(co.id);
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await eadTeste.desligar(co.id);
    for (const f of fotos) await removerFotoCurso(f);
    await auditar(req, 'EAD_DESATIVOU_CURSO', 'CursoOnline', co.id, { cursoId: co.cursoId, curso: co.curso.nome });
    voltar(res, '/ead', 'ok', `EAD de "${co.curso.nome}" desativado e conteúdo apagado.`);
  });

  async function fotosDoCursoOnline(cursoOnlineId) {
    const mods = await prisma.moduloEad.findMany({ where: { cursoOnlineId }, select: { id: true } });
    const l = [];
    for (const m of mods) l.push(...(await fotosDoModulo(m.id)));
    return l;
  }
  async function fotosDoModulo(moduloId) {
    const m = await prisma.moduloEad.findUnique({ where: { id: moduloId }, select: { fotoIntroUrl: true, topicos: { select: { telas: { select: { fotoUrl: true } } } }, cenarios: { select: { fotoUrl: true } } } });
    if (!m) return [];
    return [m.fotoIntroUrl, ...m.topicos.flatMap((t) => t.telas.map((x) => x.fotoUrl)), ...m.cenarios.map((c) => c.fotoUrl)].filter(Boolean);
  }

  // Link de teste do curso (site do aluno, /ead-teste/<código>): gerar, trocar, desligar.
  router.post('/ead/curso/:id/link-teste', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const acao = req.body.acao;
    const tinha = await eadTeste.codigoDoCurso(co.id);
    if (acao === 'desligar') {
      await eadTeste.desligar(co.id);
      await auditar(req, 'EAD_LINK_TESTE_DESLIGOU', 'CursoOnline', co.id, null);
      return voltar(res, `/ead/curso/${co.id}`, 'ok', 'Link de teste desligado.');
    }
    await eadTeste.gerarCodigo(co.id);
    await auditar(req, tinha ? 'EAD_LINK_TESTE_TROCOU' : 'EAD_LINK_TESTE_GEROU', 'CursoOnline', co.id, null);
    voltar(res, `/ead/curso/${co.id}`, 'ok', tinha ? 'Link trocado: o anterior não abre mais.' : 'Link de teste criado.');
  });

  // ─── Módulos ──────────────────────────────────────────────────────────────────────────────────
  function lerModuloDoForm(body) {
    return ead.schemaModulo.safeParse({ titulo: body.titulo, minutosEstimados: body.minutosEstimados || 0, introducao: body.introducao, final: body.final === 'on' });
  }

  router.get('/ead/curso/:id/modulos/novo', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    res.render('admin/ead/modulo-form', { co, modulo: null, valores: {}, erro: null });
  });

  router.post('/ead/curso/:id/modulos/novo', uploadFoto, async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const r = lerModuloDoForm(req.body);
    const erro = req.uploadErro || ead.primeiroErro(r);
    if (erro) return res.status(400).render('admin/ead/modulo-form', { co, modulo: null, valores: req.body, erro });
    const { final, ...dados } = r.data;
    dados.fotoIntroUrl = req.file ? await salvarFotoCurso(req.file) : null;
    const m = await prisma.$transaction(async (tx) => {
      const novo = await tx.moduloEad.create({ data: { ...dados, cursoOnlineId: co.id, ordem: await edb.proximaOrdem(tx, 'moduloEad', 'cursoOnlineId', co.id) } });
      if (final) await edb.marcarFinal(tx, novo.id, true);
      return novo;
    });
    await auditar(req, 'EAD_CRIOU_MODULO', 'ModuloEad', m.id, { moduloId: m.id, titulo: m.titulo });
    voltar(res, urlModulo(m.id), 'ok', 'Módulo criado.');
  });

  router.get('/ead/modulo/:id', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    res.render('admin/ead/modulo', {
      modulo, pendencias: ead.pendencias(modulo), avisos: ead.avisos(modulo),
      validadoPorNome: await nomeDe(modulo.validadoPor), mmSs: ead.mmSs, ...flash(req),
    });
  });

  router.get('/ead/modulo/:id/editar', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    res.render('admin/ead/modulo-form', { co: modulo.cursoOnline, modulo, valores: modulo, erro: null });
  });

  router.post('/ead/modulo/:id/editar', uploadFoto, async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    const r = lerModuloDoForm(req.body);
    const erro = req.uploadErro || ead.primeiroErro(r);
    const deNovo = (msg) => res.status(400).render('admin/ead/modulo-form', { co: modulo.cursoOnline, modulo, valores: { ...req.body, fotoIntroUrl: modulo.fotoIntroUrl }, erro: msg });
    if (erro) return deNovo(erro);
    const { final, ...dados } = r.data;
    const fotoNova = req.file ? await salvarFotoCurso(req.file) : null;
    const tirarFoto = req.body.removerFoto === 'on';
    if (fotoNova || tirarFoto) dados.fotoIntroUrl = fotoNova;
    try {
      await escrever(req, modulo.id, 'o próprio módulo', async (tx) => {
        await tx.moduloEad.update({ where: { id: modulo.id }, data: dados });
        const f = await edb.marcarFinal(tx, modulo.id, final);
        if (f.erro) throw new ErroForm(f.erro);
      });
    } catch (e) {
      if (!(e instanceof ErroForm)) throw e;
      if (fotoNova) await removerFotoCurso(fotoNova);
      return deNovo(e.message);
    }
    if ((fotoNova || tirarFoto) && modulo.fotoIntroUrl) await removerFotoCurso(modulo.fotoIntroUrl);
    voltar(res, urlModulo(modulo.id), 'ok', 'Módulo salvo.');
  });

  router.post('/ead/modulo/:id/validar', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    if (ead.pendencias(modulo).length) return voltar(res, urlModulo(modulo.id), 'erro', 'O módulo tem pendências.');
    await prisma.moduloEad.update({ where: { id: modulo.id }, data: { status: 'VALIDADO', validadoPor: ator(req), validadoEm: new Date() } });
    await auditar(req, 'EAD_VALIDOU_MODULO', 'ModuloEad', modulo.id, { moduloId: modulo.id, titulo: modulo.titulo });
    voltar(res, urlModulo(modulo.id), 'ok', 'Módulo validado.');
  });

  router.post('/ead/modulo/:id/reabrir', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    await prisma.moduloEad.update({ where: { id: modulo.id }, data: { status: 'RASCUNHO', validadoPor: null, validadoEm: null } });
    await auditar(req, 'EAD_REABRIU_MODULO', 'ModuloEad', modulo.id, { moduloId: modulo.id, titulo: modulo.titulo });
    voltar(res, urlModulo(modulo.id), 'ok', 'Módulo de volta para rascunho.');
  });

  router.post('/ead/modulo/:id/:direcao(subir|descer)', async (req, res) => {
    const m = edb.ehId(req.params.id) ? await prisma.moduloEad.findUnique({ where: { id: req.params.id } }) : null;
    if (!m) return naoAchou(res);
    await prisma.$transaction(async (tx) => {
      const r = await edb.mover(tx, 'moduloEad', m.id, req.params.direcao, 'cursoOnlineId', { final: false });
      if (!r) return;
      await edb.invalidarSeValidado(tx, m.id, ator(req), 'ordem dos módulos');
      await edb.invalidarSeValidado(tx, r.trocadoCom, ator(req), 'ordem dos módulos');
    });
    res.redirect(`/ead/curso/${m.cursoOnlineId}`);
  });

  router.post('/ead/modulo/:id/excluir', async (req, res) => {
    const m = edb.ehId(req.params.id) ? await prisma.moduloEad.findUnique({ where: { id: req.params.id } }) : null;
    if (!m) return naoAchou(res);
    if (m.status === 'VALIDADO') return voltar(res, urlModulo(m.id), 'erro', 'Módulo validado não pode ser apagado. Reabra antes.');
    const fotos = await fotosDoModulo(m.id);
    await prisma.moduloEad.delete({ where: { id: m.id } });
    for (const f of fotos) await removerFotoCurso(f);
    await auditar(req, 'EAD_EXCLUIU_MODULO', 'ModuloEad', m.id, { moduloId: m.id, titulo: m.titulo });
    voltar(res, `/ead/curso/${m.cursoOnlineId}`, 'ok', `Módulo "${m.titulo}" apagado.`);
  });

  return router;
};
