// routes/ead-teste.js
//
// Site do aluno → link secreto de teste do curso online: /ead-teste/<código>. O curso ainda não aparece
// no site; quem tem o link vê as telas como o aluno verá, sem login. Fora do menu, do Google (noindex
// + robots.txt) e do sitemap; montado ANTES da contagem de visitas. Layout próprio, sem Analytics/Pixel:
// eles gravariam o endereço, e o endereço é o segredo. O DEV gera/troca/desliga em painel → EAD → curso.

const express = require('express');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const eadTeste = require('../lib/ead-teste');
const pdb = require('../lib/ead-progresso-db');
const { estadoDoCurso } = require('../lib/ead-progresso');
const { cadastroIncompleto } = require('../lib/ead-conta');
const { precisaTrocarSenha } = require('../lib/seguranca');
const { requireLogin } = require('../middleware/auth');
const { emitirCertificadoEad } = require('../lib/ead-certificado');
const { gerarCartao } = require('../lib/ead-cartao');

// Etapa 3: ao concluir o curso, emite o certificado (número, Redação, e-mail) SEM esperar.
function dispararEmissao(alunoCursoId, req) {
  const site = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const link = `${site}/ead-teste/${req.params.codigo}/certificado`;
  emitirCertificadoEad(alunoCursoId, { enviarEmail: true, linkCertificado: link, documentoAluno: req.app.locals.documentoAluno })
    .catch((e) => console.error('[EAD] emissão do certificado:', e.message));
}
async function concluirCurso(alunoCursoId, req) {
  await pdb.marcarCursoConcluido(alunoCursoId);
  dispararEmissao(alunoCursoId, req);
}

const router = express.Router();

router.use('/ead-teste', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  // O padrão do site (same-origin) faz o YouTube recusar o player; assim ele recebe só o domínio,
  // nunca o caminho com o código.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// 404 com o layout do link de teste (sem Analytics/Pixel), igual para código inválido, trocado,
// desligado, e módulo/tela que não é do curso. A página de erro do site carregaria o rastreamento.
const naoAchou = (res) => res.status(404).render('ead-teste/404');

// ─── Aluno logado ───────────────────────────────────────────────────────────────────────────────
// Só papel ALUNO conta como aluno; DEV/secretaria logados no site veem como visitante.
const alunoDaSessao = (req) => (req.session && req.session.usuarioId && req.session.papel === 'ALUNO' ? req.session.usuarioId : null);

// Progresso e avisos do aluno logado (null sem login). Abrir o curso logado já conta como início
// (é daí que contam os 7 dias em sequência nesta etapa).
async function contexto(req, co, curso) {
  const usuarioId = alunoDaSessao(req);
  if (!usuarioId) return null;
  const alunoCurso = await pdb.garantirAlunoCurso(usuarioId, co.id);
  const progresso = await pdb.carregarProgresso(alunoCurso.id);
  const estado = estadoDoCurso(curso, progresso, new Date());
  // Curso que termina numa tela vista (ou cujo certificado não saiu): conclui e emite aqui.
  if (estado.concluido && !alunoCurso.concluidoEm) {
    await concluirCurso(alunoCurso.id, req);
    alunoCurso.concluidoEm = new Date();
  }
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  const avisos = { senha: await precisaTrocarSenha(usuarioId), cadastro: cadastroIncompleto(usuario) };
  return { alunoCurso, progresso, estado, avisos, usuario };
}
const estadoDoModulo = (ctx, moduloId) => (ctx ? ctx.estado.modulos.find((m) => m.id === moduloId) : null);

// Endereço de cada "próximo passo" de estadoDoCurso. O quiz é aberto pela última tela do tópico.
function urlDoPasso(co, base, passo) {
  if (!passo) return base;
  if (passo.tipo === 'tela') return `${base}/tela/${passo.id}`;
  if (passo.tipo === 'cenario') return `${base}/cenario/${passo.id}`;
  if (passo.tipo === 'quiz') {
    const t = co.modulos.flatMap((m) => m.topicos).find((x) => x.id === passo.id);
    const ultima = t && t.telas[t.telas.length - 1];
    if (ultima) return `${base}/tela/${ultima.id}`;
    return `${base}/modulo/${t ? t.moduloId : ''}`;
  }
  return `${base}/modulo/${passo.id}`;
}

// Resolve o código; sem código válido, 404 igual a qualquer página que não existe.
const comCurso = (fn) => asyncHandler(async (req, res, next) => {
  const coId = await eadTeste.cursoDoCodigo(req.params.codigo);
  const r = coId ? await pdb.carregarCursoParaAluno(coId) : null;
  if (!r) return naoAchou(res);
  const base = `/ead-teste/${req.params.codigo}`;
  return fn(req, res, r.co, base, r.curso, next);
});

router.get('/ead-teste/:codigo', comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  res.render('ead-teste/capa', { co, base, ctx, continuarUrl: ctx ? urlDoPasso(co, base, ctx.estado.proximo) : null });
}));

// "Criar conta e começar": o /cadastro de sempre, voltando para o curso no fim.
router.get('/ead-teste/:codigo/criar-conta', comCurso(async (req, res, co, base) => {
  if (alunoDaSessao(req)) return res.redirect(`${base}/continuar`);
  req.session.returnTo = `${base}/continuar`;
  res.redirect('/cadastro');
}));

// "Já tenho conta" / "Continuar de onde parou": pede login (requireLogin guarda a volta) e vai ao próximo passo.
router.get('/ead-teste/:codigo/continuar', requireLogin, comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  if (!ctx) return res.redirect(base); // logado, mas não é aluno
  res.redirect(urlDoPasso(co, base, ctx.estado.proximo));
}));

router.get('/ead-teste/:codigo/modulo/:moduloId', comCurso(async (req, res, co, base, curso) => {
  const i = co.modulos.findIndex((m) => m.id === req.params.moduloId);
  if (i < 0) return naoAchou(res);
  const modulo = co.modulos[i];
  const ctx = await contexto(req, co, curso);
  const primeira = modulo.topicos.flatMap((t) => t.telas)[0] || null;
  const proximo = co.modulos[i + 1] || null;
  const em = estadoDoModulo(ctx, modulo.id);
  // Primeiro passo pendente deste módulo: tela não vista, senão a última tela do tópico sem teste.
  let inicioModulo = primeira ? `${base}/tela/${primeira.id}` : null;
  if (em) {
    for (const [ti, t] of modulo.topicos.entries()) {
      const nv = t.telas.find((x) => !ctx.progresso.telasVistas.has(x.id));
      if (nv) { inicioModulo = `${base}/tela/${nv.id}`; break; }
      if (!em.topicos[ti].concluido && t.telas.length) { inicioModulo = `${base}/tela/${t.telas[t.telas.length - 1].id}`; break; }
    }
  }
  res.render('ead-teste/modulo', { co, base, modulo, numero: i + 1, primeira, proximo, ctx, em, inicioModulo });
}));

router.get('/ead-teste/:codigo/tela/:telaId', comCurso(async (req, res, co, base, curso) => {
  const i = co.modulos.findIndex((m) => m.topicos.some((t) => t.telas.some((x) => x.id === req.params.telaId)));
  if (i < 0) return naoAchou(res);
  const ctx = await contexto(req, co, curso);
  const em = estadoDoModulo(ctx, co.modulos[i].id);
  if (em && em.estado === 'bloqueado') return res.redirect(`${base}/modulo/${co.modulos[i].id}`);
  if (ctx) await pdb.marcarTelaVista(ctx.alunoCurso.id, req.params.telaId);
  const modulo = { ...co.modulos[i], cursoOnline: { curso: co.curso } };
  const tc = eadTeste.contextoDaTela(modulo, i + 1, req.params.telaId, (id) => `${base}/tela/${id}`);
  // Logado, na última tela de um tópico com perguntas e sem quiz aprovado: "Continuar" vira o teste rápido.
  let quizForm = null;
  const topico = co.modulos[i].topicos[tc.topicoIndex];
  const ehUltima = topico.telas[topico.telas.length - 1].id === req.params.telaId;
  if (ctx && ehUltima && topico.perguntas.length && !em.topicos[tc.topicoIndex].quizAprovado) {
    quizForm = { url: `${base}/topico/${topico.id}/quiz`, titulo: `Teste rápido: ${Math.min(3, topico.perguntas.length)} perguntas` };
  }
  // Na última tela do módulo, "Continuar" leva à introdução do próximo módulo (ou de volta à capa).
  let fimUrl = null; let fimTitulo = null;
  if (!tc.proxima) {
    const p = eadTeste.proximaTela(co.modulos, req.params.telaId);
    if (p && p.tipo === 'modulo') { fimUrl = `${base}/modulo/${p.id}`; fimTitulo = `Módulo ${i + 2}: ${co.modulos[i + 1].titulo}`; }
    else { fimUrl = base; fimTitulo = 'Fim do curso — voltar ao menu'; }
  }
  res.render('ead-teste/tela', { ...tc, base, fimUrl, fimTitulo, menuUrl: base, quizForm, ctx });
}));

// ─── Quiz e pré-teste ───────────────────────────────────────────────────────────────────────────
// Sem login: guarda a volta e manda para o login (nada é registrado).
function pedirLogin(req, res, base) {
  req.session.returnTo = `${base}/continuar`;
  return res.redirect('/login');
}
const acharTopico = (co, topicoId) => {
  for (const [i, m] of co.modulos.entries()) {
    const t = m.topicos.find((x) => x.id === topicoId);
    if (t) return { modulo: m, numero: i + 1, topico: t };
  }
  return null;
};
const alternativasDoForm = (body) => [].concat(body.alternativa || [], body.alternativas || []).map(String);

router.post('/ead-teste/:codigo/topico/:topicoId/quiz', comCurso(async (req, res, co, base, curso) => {
  const achado = acharTopico(co, req.params.topicoId);
  if (!achado) return naoAchou(res);
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  if (estadoDoModulo(ctx, achado.modulo.id).estado === 'bloqueado') return res.redirect(`${base}/modulo/${achado.modulo.id}`);
  const t = await pdb.abrirQuiz(ctx.alunoCurso.id, achado.topico.id);
  if (!t) return res.redirect(`${base}/modulo/${achado.modulo.id}`);
  res.redirect(`${base}/tentativa/${t.id}`);
}));

router.post('/ead-teste/:codigo/modulo/:moduloId/pre-teste', comCurso(async (req, res, co, base, curso) => {
  const modulo = co.modulos.find((m) => m.id === req.params.moduloId);
  if (!modulo) return naoAchou(res);
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  const em = estadoDoModulo(ctx, modulo.id);
  const t = em.estado !== 'bloqueado' && em.preTeste === 'disponivel' ? await pdb.abrirPreTeste(ctx.alunoCurso.id, modulo.id) : null;
  if (!t) return res.redirect(`${base}/modulo/${modulo.id}`);
  res.redirect(`${base}/tentativa/${t.id}`);
}));

// Cabeçalho comum das páginas da tentativa (módulo, tópico, número).
function infoDaTentativa(co, t) {
  const i = co.modulos.findIndex((m) => m.id === t.moduloId);
  const modulo = co.modulos[i];
  const topico = t.topicoId && modulo ? modulo.topicos.find((x) => x.id === t.topicoId) : null;
  return { modulo, numero: i + 1, topico };
}

router.get('/ead-teste/:codigo/tentativa/:id', comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  const t = await pdb.tentativaDoAluno(req.params.id, ctx.alunoCurso.id);
  if (!t) return naoAchou(res);
  const info = infoDaTentativa(co, t);
  if (!info.modulo) return naoAchou(res);
  const pergunta = pdb.perguntaAtual(t);
  if (pergunta) {
    return res.render('ead-teste/pergunta', { co, base, ctx, t, ...info, pergunta, n: t.respostas.length + 1 });
  }
  // Resultado: recalcula o estado (o quiz ou o pré-teste pode ter concluído o módulo ou o curso).
  const estado = estadoDoCurso(curso, await pdb.carregarProgresso(ctx.alunoCurso.id), new Date());
  if (estado.concluido) await concluirCurso(ctx.alunoCurso.id, req);
  const primeiraDoTopico = info.topico && info.topico.telas[0];
  const primeiraDoModulo = info.modulo.topicos.flatMap((x) => x.telas)[0];
  res.render('ead-teste/resultado', {
    co, base, ctx, t, ...info, notaMinima: co.notaMinimaQuiz, cursoConcluido: estado.concluido,
    seguirUrl: urlDoPasso(co, base, estado.proximo),
    reverUrl: primeiraDoTopico ? `${base}/tela/${primeiraDoTopico.id}` : `${base}/modulo/${info.modulo.id}`,
    moduloUrl: primeiraDoModulo ? `${base}/tela/${primeiraDoModulo.id}` : `${base}/modulo/${info.modulo.id}`,
  });
}));

router.post('/ead-teste/:codigo/tentativa/:id/responder', comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  const marcadas = alternativasDoForm(req.body);
  // Nada marcado (ex.: múltipla escolha enviada sem querer): não grava, volta para a pergunta.
  if (!marcadas.length) return res.redirect(`${base}/tentativa/${req.params.id}`);
  const r = await pdb.responder(req.params.id, ctx.alunoCurso.id, String(req.body.perguntaId || ''), marcadas);
  if (!r.tentativa) return naoAchou(res);
  const voltar = `${base}/tentativa/${req.params.id}`;
  if (r.ignorada || r.tentativa.tipo === 'PRE_TESTE') return res.redirect(voltar);
  // Quiz: retorno na hora (o porquê), depois a próxima pergunta ou o resultado.
  const info = infoDaTentativa(co, r.tentativa);
  res.render('ead-teste/retorno', {
    co, base, ctx, ...info, pergunta: r.pergunta, correta: r.correta, fechou: r.fechou, voltar,
    n: r.tentativa.respostas.length, total: r.tentativa.total,
    marcadas: new Set(alternativasDoForm(req.body)),
  });
}));

// ─── Cenários (módulo final) ────────────────────────────────────────────────────────────────────
// Cenário do curso, com decisões e opções; null se não for do módulo final deste curso.
async function acharCenario(co, cenarioId) {
  const final = co.modulos.find((m) => m.final);
  if (!final || !final.cenarios.some((c) => c.id === cenarioId)) return null;
  const cenario = await prisma.cenarioEad.findUnique({
    where: { id: cenarioId },
    include: { decisoes: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], include: { opcoes: { orderBy: { ordem: 'asc' } } } } },
  });
  return cenario ? { cenario, final, numero: co.modulos.indexOf(final) + 1 } : null;
}

// Checagens comuns: cenário do curso (404), login, módulo final liberado. Devolve null se já respondeu.
async function prepararCenario(req, res, co, base, curso) {
  const achado = await acharCenario(co, req.params.cenarioId);
  if (!achado) { naoAchou(res); return null; }
  const ctx = await contexto(req, co, curso);
  if (!ctx) { pedirLogin(req, res, base); return null; }
  if (estadoDoModulo(ctx, achado.final.id).estado === 'bloqueado') { res.redirect(`${base}/modulo/${achado.final.id}`); return null; }
  return { ...achado, ctx };
}

function renderCenario(res, dados) {
  const { cenario, feito } = dados;
  const ordem = cenario.decisoes;
  const proximoCenario = dados.final.cenarios.find((c) => c.id !== cenario.id && !dados.ctx.progresso.cenarios.some((f) => f.cenarioId === c.id && f.concluidoEm));
  const emAndamento = pdb.cenarioEmAndamento(feito);
  res.render('ead-teste/cenario', { ...dados, emAndamento, decisao: emAndamento ? ordem[feito.decisaoAtual] || null : null, jogada: emAndamento ? pdb.jogadaDe(feito) : null, total: ordem.length, proximoCenario, agora: new Date() });
}

router.get('/ead-teste/:codigo/cenario/:cenarioId', comCurso(async (req, res, co, base, curso) => {
  const d = await prepararCenario(req, res, co, base, curso);
  if (!d) return;
  let feito = await prisma.cenarioFeitoEad.findUnique({ where: { alunoCursoId_cenarioId: { alunoCursoId: d.ctx.alunoCurso.id, cenarioId: d.cenario.id } } });
  // Decisão atual apagada no painel depois de o aluno começar: dá o cenário por concluído.
  if (feito) {
    const antes = feito.concluidoEm;
    feito = await pdb.acertarCenarioSemDecisao(feito, d.cenario.decisoes.length);
    if (!antes && feito.concluidoEm) {
      const estado = estadoDoCurso(curso, await pdb.carregarProgresso(d.ctx.alunoCurso.id), new Date());
      if (estado.concluido) await concluirCurso(d.ctx.alunoCurso.id, req);
    }
  }
  renderCenario(res, { ...d, co, base, feito, escolha: null });
}));

router.post('/ead-teste/:codigo/cenario/:cenarioId/comecar', comCurso(async (req, res, co, base, curso) => {
  const d = await prepararCenario(req, res, co, base, curso);
  if (!d) return;
  await pdb.comecarCenario(d.ctx.alunoCurso.id, d.cenario.id);
  res.redirect(`${base}/cenario/${d.cenario.id}`);
}));

router.post('/ead-teste/:codigo/cenario/:cenarioId/escolher', comCurso(async (req, res, co, base, curso) => {
  const d = await prepararCenario(req, res, co, base, curso);
  if (!d) return;
  const r = await pdb.escolherNoCenario(d.ctx.alunoCurso.id, d.cenario.id, String(req.body.decisaoId || ''), String(req.body.opcaoId || ''), String(req.body.jogada || ''));
  if (r.ignorada) return res.redirect(`${base}/cenario/${d.cenario.id}`);
  if (r.fechou) {
    const estado = estadoDoCurso(curso, await pdb.carregarProgresso(d.ctx.alunoCurso.id), new Date());
    if (estado.concluido) await concluirCurso(d.ctx.alunoCurso.id, req);
  }
  // Mostra a fala do instrutor para a opção escolhida, na própria decisão.
  res.render('ead-teste/cenario', {
    ...d, co, base, feito: r.feito, decisao: r.decisao, total: d.cenario.decisoes.length, agora: new Date(), emAndamento: true, jogada: null,
    escolha: { opcao: r.opcao, certa: r.certa, fechou: r.fechou }, proximoCenario: null,
  });
}));

// ─── Certificado e cartão de bolso (etapa 3) ─────────────────────────────────────────────────────
router.get('/ead-teste/:codigo/certificado', comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  if (!ctx.estado.concluido) return res.redirect(base);
  const r = await emitirCertificadoEad(ctx.alunoCurso.id, { documentoAluno: req.app.locals.documentoAluno });
  if (!r) return res.redirect(base);
  if (r.avisoRedacao) console.warn('[EAD] certificado sem QR:', r.avisoRedacao);
  res.render('admin/certificado-imprimir', {
    lista: [{ id: ctx.alunoCurso.id, ...r.dados, verificacao: r.verificacao }],
    turma: { curso: { nome: co.curso.nome } }, avisoRedacao: null,
    barraAluno: { voltarUrl: base, cartaoUrl: `${base}/cartao-de-bolso.pdf` },
  });
}));

router.get('/ead-teste/:codigo/cartao-de-bolso.pdf', comCurso(async (req, res, co, base, curso) => {
  const ctx = await contexto(req, co, curso);
  if (!ctx) return pedirLogin(req, res, base);
  if (!ctx.estado.concluido) return res.redirect(base);
  const { buffer, nomeArquivo } = await gerarCartao(co.id);
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.send(buffer);
}));

// Qualquer outro caminho abaixo de /ead-teste: 404 aqui mesmo, sem cair na contagem de visitas
// nem no 404 do site. Erros também ficam aqui (a página de erro do site tem rastreamento).
router.use('/ead-teste', (req, res) => naoAchou(res));
// eslint-disable-next-line no-unused-vars
router.use('/ead-teste', (err, req, res, next) => {
  console.error('[ead-teste]', err);
  res.status(500).render('ead-teste/404');
});

module.exports = router;
