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

  // ─── Tópicos ──────────────────────────────────────────────────────────────────────────────────
  router.post('/ead/modulo/:id/topicos', async (req, res) => {
    const m = edb.ehId(req.params.id) ? await prisma.moduloEad.findUnique({ where: { id: req.params.id } }) : null;
    if (!m) return naoAchou(res);
    if (m.final) return voltar(res, urlModulo(m.id), 'erro', 'O módulo final tem cenários, não tópicos.');
    const r = ead.schemaTopico.safeParse(req.body);
    if (!r.success) return voltar(res, urlModulo(m.id), 'erro', 'Tópico: ' + ead.primeiroErro(r));
    const t = await escrever(req, m.id, `novo tópico "${r.data.titulo}"`, async (tx) =>
      tx.topicoEad.create({ data: { moduloId: m.id, titulo: r.data.titulo, ordem: await edb.proximaOrdem(tx, 'topicoEad', 'moduloId', m.id) } }));
    await auditar(req, 'EAD_CRIOU_TOPICO', 'TopicoEad', t.id, { moduloId: m.id, titulo: t.titulo });
    voltar(res, urlModulo(m.id), 'ok', 'Tópico criado.');
  });

  router.post('/ead/topico/:id', async (req, res) => {
    const alvo = await edb.moduloDe('topico', req.params.id);
    if (!alvo) return naoAchou(res);
    const r = ead.schemaTopico.safeParse(req.body);
    if (!r.success) return voltar(res, urlModulo(alvo.moduloId), 'erro', 'Tópico: ' + ead.primeiroErro(r));
    await escrever(req, alvo.moduloId, `tópico renomeado para "${r.data.titulo}"`, (tx) => tx.topicoEad.update({ where: { id: req.params.id }, data: { titulo: r.data.titulo } }));
    voltar(res, urlModulo(alvo.moduloId), 'ok', 'Tópico renomeado.');
  });

  // Subir/descer de tópico, tela, cenário e decisão: mesma regra.
  const MOVIVEIS = { topico: ['topicoEad', 'moduloId'], tela: ['telaEad', 'topicoId'], cenario: ['cenarioEad', 'moduloId'], decisao: ['decisaoCenario', 'cenarioId'] };
  router.post('/ead/:tipo(topico|tela|cenario|decisao)/:id/:direcao(subir|descer)', async (req, res) => {
    const { tipo, id, direcao } = req.params;
    const alvo = await edb.moduloDe(tipo, id);
    if (!alvo) return naoAchou(res);
    const [modelo, pai] = MOVIVEIS[tipo];
    await prisma.$transaction(async (tx) => {
      if (await edb.mover(tx, modelo, id, direcao, pai)) await edb.invalidarSeValidado(tx, alvo.moduloId, ator(req), `ordem (${tipo})`);
    });
    if (tipo === 'decisao') {
      const d = await prisma.decisaoCenario.findUnique({ where: { id }, select: { cenarioId: true } });
      return res.redirect(`/ead/cenario/${d.cenarioId}/editar`);
    }
    res.redirect(urlModulo(alvo.moduloId));
  });

  router.post('/ead/topico/:id/excluir', async (req, res) => {
    const alvo = await edb.moduloDe('topico', req.params.id);
    if (!alvo) return naoAchou(res);
    const t = await prisma.topicoEad.findUnique({ where: { id: req.params.id }, include: { telas: { select: { fotoUrl: true } } } });
    await escrever(req, alvo.moduloId, `tópico "${t.titulo}" apagado`, (tx) => tx.topicoEad.delete({ where: { id: t.id } }));
    for (const tela of t.telas) if (tela.fotoUrl) await removerFotoCurso(tela.fotoUrl);
    await auditar(req, 'EAD_EXCLUIU_TOPICO', 'TopicoEad', t.id, { moduloId: alvo.moduloId, titulo: t.titulo });
    voltar(res, urlModulo(alvo.moduloId), 'ok', `Tópico "${t.titulo}" apagado.`);
  });

  // ─── Telas ────────────────────────────────────────────────────────────────────────────────────
  // Lê o form da tela. Devolve { dados } ou { erro } (o vídeo é normalizado aqui).
  function lerTelaDoForm(body) {
    const r = ead.schemaTela.safeParse({
      titulo: body.titulo, ancora: body.ancora, videoTitulo: body.videoTitulo, revisaoTitulo: body.revisaoTitulo,
      alerta: body.alerta, dicaProfissional: body.dicaProfissional,
      revisaoItens: [0, 1, 2, 3].map((i) => String(body['revisao' + i] || '')),
    });
    if (!r.success) return { erro: ead.primeiroErro(r) };
    const dados = { ...r.data, videoUrl: null, videoDuracaoSeg: null };
    if (String(body.videoUrl || '').trim()) {
      const v = ead.normalizarVideo(body.videoUrl);
      if (v.erro) return { erro: v.erro };
      dados.videoUrl = v.url;
    }
    if (String(body.videoDuracao || '').trim()) {
      const seg = ead.lerMmSs(body.videoDuracao);
      if (seg === null || seg > 3600) return { erro: 'Duração do vídeo: use minutos:segundos, ex.: 2:10.' };
      dados.videoDuracaoSeg = seg;
    }
    return { dados };
  }
  // O form mostra a duração em mm:ss e as 4 linhas da revisão separadas.
  const telaParaForm = (t) => ({ ...t, videoDuracao: t.videoDuracaoSeg ? ead.mmSs(t.videoDuracaoSeg) : '', ...Object.fromEntries([0, 1, 2, 3].map((i) => ['revisao' + i, (t.revisaoItens || [])[i] || ''])) });

  async function contextoTopico(topicoId) {
    if (!edb.ehId(topicoId)) return null;
    return prisma.topicoEad.findUnique({ where: { id: topicoId }, include: { modulo: { include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } } } });
  }

  router.get('/ead/topico/:id/telas/nova', async (req, res) => {
    const topico = await contextoTopico(req.params.id);
    if (!topico) return naoAchou(res);
    res.render('admin/ead/tela-form', { topico, tela: null, valores: {}, erro: null });
  });

  router.post('/ead/topico/:id/telas/nova', uploadFoto, async (req, res) => {
    const topico = await contextoTopico(req.params.id);
    if (!topico) return naoAchou(res);
    const { dados, erro } = lerTelaDoForm(req.body);
    if (req.uploadErro || erro) return res.status(400).render('admin/ead/tela-form', { topico, tela: null, valores: req.body, erro: req.uploadErro || erro });
    dados.fotoUrl = req.file ? await salvarFotoCurso(req.file) : null;
    const tela = await escrever(req, topico.moduloId, `nova tela "${dados.titulo}"`, async (tx) =>
      tx.telaEad.create({ data: { ...dados, topicoId: topico.id, ordem: await edb.proximaOrdem(tx, 'telaEad', 'topicoId', topico.id) } }));
    await auditar(req, 'EAD_CRIOU_TELA', 'TelaEad', tela.id, { moduloId: topico.moduloId, titulo: tela.titulo });
    voltar(res, urlModulo(topico.moduloId), 'ok', `Tela "${tela.titulo}" criada.`);
  });

  async function acharTela(id) {
    if (!edb.ehId(id)) return null;
    return prisma.telaEad.findUnique({ where: { id }, include: { topico: { include: { modulo: { include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } } } } } });
  }

  router.get('/ead/tela/:id/editar', async (req, res) => {
    const tela = await acharTela(req.params.id);
    if (!tela) return naoAchou(res);
    res.render('admin/ead/tela-form', { topico: tela.topico, tela, valores: telaParaForm(tela), erro: null });
  });

  router.post('/ead/tela/:id/editar', uploadFoto, async (req, res) => {
    const tela = await acharTela(req.params.id);
    if (!tela) return naoAchou(res);
    const { dados, erro } = lerTelaDoForm(req.body);
    if (req.uploadErro || erro) return res.status(400).render('admin/ead/tela-form', { topico: tela.topico, tela, valores: { ...req.body, fotoUrl: tela.fotoUrl }, erro: req.uploadErro || erro });
    const fotoNova = req.file ? await salvarFotoCurso(req.file) : null;
    const tirar = req.body.removerFoto === 'on';
    if (fotoNova || tirar) dados.fotoUrl = fotoNova;
    await escrever(req, tela.topico.moduloId, `tela "${dados.titulo}"`, (tx) => tx.telaEad.update({ where: { id: tela.id }, data: dados }));
    if ((fotoNova || tirar) && tela.fotoUrl) await removerFotoCurso(tela.fotoUrl);
    voltar(res, urlModulo(tela.topico.moduloId), 'ok', `Tela "${dados.titulo}" salva.`);
  });

  router.post('/ead/tela/:id/excluir', async (req, res) => {
    const tela = await acharTela(req.params.id);
    if (!tela) return naoAchou(res);
    await escrever(req, tela.topico.moduloId, `tela "${tela.titulo}" apagada`, (tx) => tx.telaEad.delete({ where: { id: tela.id } }));
    if (tela.fotoUrl) await removerFotoCurso(tela.fotoUrl);
    await auditar(req, 'EAD_EXCLUIU_TELA', 'TelaEad', tela.id, { moduloId: tela.topico.moduloId, titulo: tela.titulo });
    voltar(res, urlModulo(tela.topico.moduloId), 'ok', `Tela "${tela.titulo}" apagada.`);
  });

  // "Ver como o aluno": a mesma partial do link de teste (views/partials/ead-tela.ejs).
  router.get('/ead/tela/:id/ver', async (req, res) => {
    const tela = await acharTela(req.params.id);
    if (!tela) return naoAchou(res);
    const modulo = await edb.carregarModulo(tela.topico.moduloId);
    const ctx = eadTeste.contextoDaTela(modulo, await numeroDoModulo(modulo), tela.id, (id) => `/ead/tela/${id}/ver`);
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); // o player do YouTube exige o domínio de origem
    res.render('admin/ead/tela-ver', { ...ctx, cssExtra: [...CSS, '/ead.css'] });
  });

  // Posição do módulo como o aluno vê (comuns por ordem; o final por último).
  async function numeroDoModulo(modulo) {
    const mods = ordenarFinalPorUltimo(await prisma.moduloEad.findMany({ where: { cursoOnlineId: modulo.cursoOnlineId }, orderBy: edb.POR_ORDEM, select: { id: true, final: true } }));
    return mods.findIndex((m) => m.id === modulo.id) + 1;
  }

  // ─── Perguntas ────────────────────────────────────────────────────────────────────────────────
  // Form: tipo, enunciado, feedback, alt[0..4][texto|correta] (UNICA/MULTIPLA) ou vf=0|1 (VF).
  function lerPerguntaDoForm(body) {
    const r = ead.schemaPergunta.safeParse({ tipo: body.tipo, enunciado: body.enunciado, feedback: body.feedback });
    if (!r.success) return { erro: ead.primeiroErro(r) };
    let itens;
    if (r.data.tipo === 'VF') itens = [{ correta: body.vf === '0' }, { correta: body.vf === '1' }];
    else {
      const alt = body.alt || {};
      itens = [0, 1, 2, 3, 4].map((i) => ({ texto: String((alt[i] && alt[i].texto) || ''), correta: !!(alt[i] && alt[i].correta) }));
      const longa = itens.find((i) => !ead.schemaAlternativaTexto.safeParse(i.texto).success);
      if (longa) return { erro: 'Alternativa: no máximo 300 caracteres.' };
    }
    const a = ead.normalizarAlternativas(r.data.tipo, itens);
    if (a.erro) return { erro: a.erro };
    return { dados: r.data, alternativas: a.alternativas };
  }
  // Valores do form a partir da pergunta salva.
  const perguntaParaForm = (q) => ({
    tipo: q.tipo, enunciado: q.enunciado, feedback: q.feedback,
    vf: q.tipo === 'VF' ? String(q.alternativas.findIndex((a) => a.correta)) : '',
    alt: q.tipo === 'VF' ? [] : q.alternativas.map((a) => ({ texto: a.texto, correta: a.correta })),
  });

  router.get('/ead/topico/:id/perguntas/nova', async (req, res) => {
    const topico = await contextoTopico(req.params.id);
    if (!topico) return naoAchou(res);
    res.render('admin/ead/pergunta-form', { topico, pergunta: null, valores: { tipo: 'UNICA' }, erro: null, ok: req.query.ok || null });
  });

  router.post('/ead/topico/:id/perguntas/nova', async (req, res) => {
    const topico = await contextoTopico(req.params.id);
    if (!topico) return naoAchou(res);
    const { dados, alternativas, erro } = lerPerguntaDoForm(req.body);
    if (erro) return res.status(400).render('admin/ead/pergunta-form', { topico, pergunta: null, valores: req.body, erro });
    const q = await escrever(req, topico.moduloId, 'nova pergunta', (tx) =>
      tx.perguntaEad.create({ data: { ...dados, topicoId: topico.id, alternativas: { create: alternativas } } }));
    await auditar(req, 'EAD_CRIOU_PERGUNTA', 'PerguntaEad', q.id, { moduloId: topico.moduloId, titulo: q.enunciado.slice(0, 80) });
    if (req.body.depois === 'outra') return voltar(res, `/ead/topico/${topico.id}/perguntas/nova`, 'ok', 'Pergunta salva. Escreva a próxima.');
    voltar(res, urlModulo(topico.moduloId), 'ok', 'Pergunta criada.');
  });

  async function acharPergunta(id) {
    if (!edb.ehId(id)) return null;
    return prisma.perguntaEad.findUnique({ where: { id }, include: { alternativas: { orderBy: { ordem: 'asc' } }, topico: { include: { modulo: { include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } } } } } });
  }

  router.get('/ead/pergunta/:id/editar', async (req, res) => {
    const q = await acharPergunta(req.params.id);
    if (!q) return naoAchou(res);
    res.render('admin/ead/pergunta-form', { topico: q.topico, pergunta: q, valores: perguntaParaForm(q), erro: null });
  });

  router.post('/ead/pergunta/:id/editar', async (req, res) => {
    const q = await acharPergunta(req.params.id);
    if (!q) return naoAchou(res);
    const { dados, alternativas, erro } = lerPerguntaDoForm(req.body);
    if (erro) return res.status(400).render('admin/ead/pergunta-form', { topico: q.topico, pergunta: q, valores: req.body, erro });
    await escrever(req, q.topico.moduloId, `pergunta "${dados.enunciado.slice(0, 60)}"`, async (tx) => {
      await tx.alternativaEad.deleteMany({ where: { perguntaId: q.id } });
      await tx.perguntaEad.update({ where: { id: q.id }, data: { ...dados, alternativas: { create: alternativas } } });
    });
    voltar(res, urlModulo(q.topico.moduloId), 'ok', 'Pergunta salva.');
  });

  router.post('/ead/pergunta/:id/ativar', async (req, res) => {
    const q = await acharPergunta(req.params.id);
    if (!q) return naoAchou(res);
    await escrever(req, q.topico.moduloId, `pergunta ${q.ativa ? 'desativada' : 'ativada'}`, (tx) => tx.perguntaEad.update({ where: { id: q.id }, data: { ativa: !q.ativa } }));
    voltar(res, urlModulo(q.topico.moduloId), 'ok', q.ativa ? 'Pergunta desativada (fora do sorteio).' : 'Pergunta ativada.');
  });

  router.post('/ead/pergunta/:id/excluir', async (req, res) => {
    const q = await acharPergunta(req.params.id);
    if (!q) return naoAchou(res);
    await escrever(req, q.topico.moduloId, 'pergunta apagada', (tx) => tx.perguntaEad.delete({ where: { id: q.id } }));
    await auditar(req, 'EAD_EXCLUIU_PERGUNTA', 'PerguntaEad', q.id, { moduloId: q.topico.moduloId, titulo: q.enunciado.slice(0, 80) });
    voltar(res, urlModulo(q.topico.moduloId), 'ok', 'Pergunta apagada.');
  });

  return router;
};
