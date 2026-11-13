// routes/ead.js
//
// Painel da secretaria → EAD (curso 100% online). Só DEV (requireDev em tudo). Montado no admin.js
// como o contas.js. Cadastro do conteúdo: curso online → módulos → tópicos → telas e perguntas;
// módulo final → cenários → decisões. Selo por módulo: RASCUNHO/VALIDADO; qualquer mudança dentro de
// um módulo validado o devolve a rascunho (invalidarSeValidado, na mesma transação da escrita).
// Spec: docs/superpowers/specs/2026-11-05-ead-estrutura-conteudo.md

const express = require('express');
const escolaDigital = require('../lib/escola-digital');
const imagensLib = require('../lib/ead-imagens');
const iaTextos = require('../lib/ia-textos');
const prisma = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const ead = require('../lib/ead');
const edb = require('../lib/ead-db');
const { transacao } = require('../lib/transacao');
const eadTeste = require('../lib/ead-teste');
const publicacao = require('../lib/ead-publicacao');
const relatorios = require('../lib/ead-relatorios');
const duv = require('../lib/ead-duvidas');
const cursoSoOnline = require('../lib/ead-curso-online');
const lotes = require('../lib/ead-lote');
const cupons = require('../lib/ead-cupom');
const ia = require('../lib/ead-ia');
const iaFila = require('../lib/ead-ia-fila');
const iaEsquema = require('../lib/ead-ia-esquema');
const multer = require('multer');
const { emitirCertificadoEad } = require('../lib/ead-certificado');
const { gerarCartao } = require('../lib/ead-cartao');
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
  // 2026-11-13: Cupons também está no menu Presencial (Financeiro ▸ Cupons): ali ele segue o modo escolhido em vez de pular para o Online.
  router.use('/ead', requireDev, (req, res, next) => {
    res.locals.modoPainel = req.path.startsWith('/cupons') ? (req.session && req.session.modoPainel === 'online' ? 'online' : 'presencial') : 'online';
    res.locals.cssExtra = CSS;
    next();
  });
  // Número de dúvidas aguardando resposta, para o menu do modo Online (etapa 5). Falhar não derruba a página.
  router.use('/ead', (req, res, next) => {
    if (req.method !== 'GET') return next();
    duv.contarAguardando().then((n) => { res.locals.duvidasAguardando = n; next(); }, () => next());
  });

  const ator = (req) => req.session.usuarioId || 'SISTEMA';
  const voltar = (res, url, tipo, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + tipo + '=' + encodeURIComponent(msg));
  const naoAchou = (res) => res.status(404).render('admin/erro', { mensagem: 'Conteúdo EAD não encontrado.' });
  const urlModulo = (id) => `/ead/modulo/${id}`;
  // Escola Digital (2026-11, P4): erro de formulário curto volta com o que foi digitado (?v_<campo>=…).
  const flash = (req) => ({
    ok: req.query.ok || null, erro: req.query.erro || null,
    digitado: Object.fromEntries(Object.entries(req.query).filter(([k]) => k.startsWith('v_')).map(([k, v]) => [k.slice(2), String(v).slice(0, 2000)])),
  });
  const comDigitado = (url, campos) => url + (url.includes('?') ? '&' : '?') + Object.entries(campos).map(([k, v]) => `v_${k}=${encodeURIComponent(String(v || ''))}`).join('&');

  // Escrita que mexe no conteúdo de um módulo: transação + volta a rascunho se estava validado.
  async function escrever(req, moduloId, oQueMudou, fn) {
    return transacao(async (tx) => {
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
    const semEad = await prisma.curso.findMany({ where: { online: null, ebook: null, webinario: null }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } });
    // Vitrine (2026-11-09): os publicados na ordem do site, para o destaque e o ↑ ↓.
    const vitrinePublicados = await publicadosNaOrdem();
    res.render('admin/ead/cursos', {
      lista, semEad, escolaDigitalLigada: await escolaDigital.estaLigada(), algumPublicado: lista.some((c) => c.publicado),
      vitrinePublicados, destaqueId: await escolaDigital.lerDestaque(), ...flash(req),
    });
  });

  const publicadosNaOrdem = () => prisma.cursoOnline.findMany({
    where: { publicado: true }, orderBy: [{ ordemVitrine: 'asc' }, { curso: { nome: 'asc' } }],
    select: { id: true, ordemVitrine: true, gratuito: true, curso: { select: { nome: true } } },
  });

  // Vitrine da Escola Digital (2026-11-09): curso em destaque (vazio = automático, o primeiro da ordem).
  router.post('/ead/escola-digital/destaque', async (req, res) => {
    const r = await escolaDigital.definirDestaque(String(req.body.cursoOnlineId || '').trim() || null, req);
    if (r.erro) return voltar(res, '/ead', 'erro', r.erro);
    require('../lib/cache-rapido').limparTudo();
    voltar(res, '/ead', 'ok', 'Destaque salvo.');
  });

  // ↑ ↓ na ordem da vitrine: renumera 0..n-1 e troca com o vizinho.
  router.post('/ead/escola-digital/ordem/:id/:dir', async (req, res) => {
    const lista = await publicadosNaOrdem();
    const i = lista.findIndex((c) => c.id === req.params.id);
    const j = req.params.dir === 'subir' ? i - 1 : req.params.dir === 'descer' ? i + 1 : -1;
    if (i < 0 || j < 0 || j >= lista.length) return voltar(res, '/ead', 'erro', 'Não dá para mover esse curso.');
    [lista[i], lista[j]] = [lista[j], lista[i]];
    await prisma.$transaction(lista.map((c, k) => prisma.cursoOnline.update({ where: { id: c.id }, data: { ordemVitrine: k } })));
    require('../lib/cache-rapido').limparTudo();
    voltar(res, '/ead', 'ok', 'Ordem da vitrine salva.');
  });

  // Escola Digital (2026-11): liga/desliga a aba dos cursos online no site.
  router.post('/ead/escola-digital', async (req, res) => {
    const ligar = req.body.ligada === '1';
    const r = await escolaDigital.definirLigada(ligar, req);
    if (r.erro) return voltar(res, '/ead', 'erro', r.erro);
    require('../lib/cache-rapido').limparTudo();
    voltar(res, '/ead', 'ok', ligar ? 'Escola Digital ligada: o menu do site já mostra a aba.' : 'Escola Digital desligada: some do site; quem já tem curso continua estudando.');
  });

  router.post('/ead/ativar', async (req, res) => {
    const cursoId = String(req.body.cursoId || '');
    if (!edb.ehId(cursoId) || !(await prisma.curso.findUnique({ where: { id: cursoId } }))) return voltar(res, '/ead', 'erro', 'Escolha um curso.');
    if (await prisma.cursoOnline.findUnique({ where: { cursoId } })) return voltar(res, '/ead', 'erro', 'Esse curso já tem EAD.');
    const nomeCurso = (await prisma.curso.findUnique({ where: { id: cursoId }, select: { nome: true } })).nome;
    if (await require('../lib/ead-acesso').enderecoOnlineEmUso(nomeCurso, cursoId)) return voltar(res, '/ead', 'erro', 'Já existe um curso online com o mesmo endereço no site (nome igual ou parecido). Renomeie um deles antes de ativar o EAD.');
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
    const dadosCurso = co.somenteOnline ? await prisma.curso.findUnique({ where: { id: co.cursoId }, select: { nome: true, descricao: true, cargaHoraria: true, imagemUrl: true } }) : null;
    const venda = {
      pendencias: publicacao.podePublicar({ ...co, modulos }),
      aviso: publicacao.avisoPublicado({ ...co, modulos }),
      urlCurso: `${urlSite}${require('../lib/vitrine').urlOnline(co.curso)}`,
    };
    // Imagens com IA (2026-11-09): a imagem do curso (capa) com selo, descrição e "Gerar outra".
    const imagensIa = {
      curso: await prisma.curso.findUnique({ where: { id: co.cursoId }, select: { id: true, imagemUrl: true, imagemPedido: true, imagemSugestao: true, imagemGeradaPorIa: true } }),
      temOpenAI: imagensLib.temOpenAI(),
      status: await imagensLib.statusDe(`curso-online:${co.id}`),
    };
    res.render('admin/ead/curso', { co, modulos, ead, venda, dadosCurso, imagensIa, linkTeste: codigo ? `${urlSite}/ead-teste/${codigo}` : null, erroForm: null, ...flash(req) });
  });

  router.post('/ead/curso/:id', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const r = ead.schemaCursoOnline.safeParse(req.body);
    if (!r.success) return voltar(res, comDigitado(`/ead/curso/${co.id}`, { notaMinimaQuiz: req.body.notaMinimaQuiz }), 'erro', 'Nota mínima: um número inteiro de 50 a 100.');
    await prisma.cursoOnline.update({ where: { id: co.id }, data: r.data });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'Nota mínima salva.');
  });

  router.post('/ead/curso/:id/desativar', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    // Curso vendido não perde o conteúdo: fora do site e sem nenhuma matrícula na turma online.
    if (co.publicado) return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Tire o curso do site antes de desativar o EAD.');
    if (await prisma.matricula.count({ where: { turma: { cursoId: co.cursoId, status: 'ONLINE' } } })) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Este curso online já tem alunos inscritos: o conteúdo não pode ser apagado.');
    }
    if (await prisma.moduloEad.count({ where: { cursoOnlineId: co.id, status: 'VALIDADO' } })) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Há módulos validados. Reabra (volte para rascunho) todos antes de desativar o EAD.');
    }
    // Escola Digital (2026-11, vistoria B8): cupom e lote de escola prendem o curso online no banco.
    if (await prisma.cupomEad.count({ where: { cursoOnlineId: co.id } })) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Este curso online tem cupom. Apague os cupons dele (Cupons) antes de desativar o EAD.');
    }
    if (await prisma.loteEad.count({ where: { cursoOnlineId: co.id } })) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Este curso online foi vendido para escola (lote). O conteúdo não pode ser apagado.');
    }
    const fotos = await fotosDoCursoOnline(co.id);
    if (co.somenteOnline) {
      // Curso só online (etapa 5): o Curso vai junto (não existe no presencial).
      const foto = (await prisma.curso.findUnique({ where: { id: co.cursoId }, select: { imagemUrl: true } }))?.imagemUrl;
      const r = await cursoSoOnline.apagarCursoSoOnline(co.id);
      if (!r.ok) return voltar(res, `/ead/curso/${co.id}`, 'erro', r.erro);
      if (foto) fotos.push(foto);
    } else {
      await prisma.cursoOnline.delete({ where: { id: co.id } });
    }
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

  // ─── Alunos, detalhe e concluintes (etapa 4) ─────────────────────────────────────────────────
  const FILTROS_ALUNOS = ['todos', 'andamento', 'concluidos', 'cancelados'];
  router.get('/ead/curso/:id/alunos', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const filtro = FILTROS_ALUNOS.includes(req.query.filtro) ? req.query.filtro : 'todos';
    res.render('admin/ead/alunos', { co, filtro, lista: await relatorios.alunosDoCurso(co.id, { filtro }) });
  });

  router.get('/ead/curso/:id/alunos/:alunoCursoId', async (req, res) => {
    const d = await relatorios.detalheDoAluno(req.params.id, req.params.alunoCursoId);
    if (!d) return naoAchou(res);
    res.render('admin/ead/aluno', { d });
  });

  router.get('/ead/curso/:id/concluintes', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    res.render('admin/ead/concluintes', { co, lista: await relatorios.concluintesDoCurso(co.id) });
  });

  // "Abrir certificado": a mesma página da etapa 3 para aquele aluno, sem a barra do aluno.
  router.get('/ead/curso/:id/concluintes/:alunoCursoId/certificado', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    const acId = req.params.alunoCursoId;
    const ac = co && edb.ehId(acId) ? await prisma.alunoCursoEad.findFirst({ where: { id: acId, cursoOnlineId: co.id, concluidoEm: { not: null } } }) : null;
    if (!ac) return naoAchou(res);
    // Inscrição cancelada/estornada depois de concluir: o certificado já emitido fica no Livro (e na
    // Redação), mas a página não abre — e abrir aqui não pode registrar um certificado novo.
    const cancelada = await prisma.matricula.findFirst({ where: { alunoId: ac.usuarioId, turma: { cursoId: co.cursoId, status: 'ONLINE' }, statusPagamento: { in: ['CANCELADO', 'ESTORNADO'] } } });
    if (cancelada) return res.status(409).render('admin/erro', { mensagem: 'A inscrição deste aluno foi cancelada ou estornada: o certificado não abre mais. O número já emitido continua no Livro.' });
    const r = await emitirCertificadoEad(ac.id, { documentoAluno: req.app.locals.documentoAluno });
    if (!r) return naoAchou(res);
    res.render('admin/certificado-imprimir', {
      lista: [{ id: ac.id, ...r.dados, verificacao: r.verificacao }],
      turma: { curso: { nome: co.curso.nome } }, avisoRedacao: r.avisoRedacao,
    });
  });

  router.get('/ead/curso/:id/desempenho', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    res.render('admin/ead/desempenho', { co, d: await relatorios.desempenhoDoCurso(co.id) });
  });

  router.get('/ead/curso/:id/planilha.xlsx', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const nome = require('../lib/vitrine').slugCurso(co.curso.nome) || 'curso';
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="ead-${nome}.xlsx"`);
    res.send(await relatorios.planilhaDoCurso(co.id));
  });

  // ─── Curso só online (etapa 5) ────────────────────────────────────────────────────────────────
  router.get('/ead/curso-online/novo', async (req, res) => {
    res.render('admin/ead/curso-online-form', { co: null, valores: {}, erro: null });
  });

  router.post('/ead/curso-online/novo', uploadFoto, async (req, res) => {
    const valores = { nome: req.body.nome, descricao: req.body.descricao, cargaHoraria: req.body.cargaHoraria };
    // Revisão I2: depois de um erro, as dúvidas sugeridas pela IA voltam no formulário.
    const deNovo = (erro) => res.status(400).render('admin/ead/curso-online-form', { co: null, valores, erro, faqsIniciais: iaTextos.faqsDoCorpo(req.body) });
    if (req.uploadErro) return deNovo(req.uploadErro);
    const imagemUrl = req.file ? await salvarFotoCurso(req.file) : null;
    const r = await cursoSoOnline.criarCursoOnline({ ...valores, imagemUrl });
    if (!r.ok) {
      if (imagemUrl) await removerFotoCurso(imagemUrl);
      return deNovo(r.erro);
    }
    await iaTextos.salvarFaqs(r.co.cursoId, iaTextos.lerFaqsDoForm(req.body)); // dúvidas escritas com IA e marcadas
    await auditar(req, 'EAD_CRIOU_CURSO_ONLINE', 'CursoOnline', r.co.id, { cursoId: r.co.cursoId, nome: String(valores.nome).trim() });
    voltar(res, `/ead/curso/${r.co.id}`, 'ok', 'Curso criado. Agora crie o primeiro módulo.');
  });

  router.get('/ead/curso/:id/dados', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline) return naoAchou(res);
    const c = await prisma.curso.findUnique({ where: { id: co.cursoId }, include: { faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] } } });
    res.render('admin/ead/curso-online-form', { co, valores: c, faqs: c.faqs, erro: null, temOpenAI: imagensLib.temOpenAI(), statusImagem: await imagensLib.statusDe(`curso:${co.cursoId}`) });
  });

  // Dúvidas frequentes do curso só online (2026-11-09): aparecem em sanfona na página de venda.
  router.post('/ead/curso/:id/faqs', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline) return naoAchou(res);
    const volta = `/ead/curso/${co.id}/dados#duvidas`;
    const pergunta = String(req.body.pergunta || '').trim().slice(0, 200);
    const resposta = String(req.body.resposta || '').trim().slice(0, 600);
    if (!pergunta || !resposta) return voltar(res, volta, 'erro', 'Preencha a pergunta e a resposta.');
    const total = await prisma.faqCurso.count({ where: { cursoId: co.cursoId } });
    await prisma.faqCurso.create({ data: { cursoId: co.cursoId, pergunta, resposta, ordem: total } });
    await auditar(req, 'ADICIONOU_FAQ', 'Curso', co.cursoId, { pergunta });
    voltar(res, volta, 'ok', 'Dúvida adicionada.');
  });
  // As dúvidas marcadas de "Escrever dúvidas com IA" (seção de dúvidas), gravadas direto.
  router.post('/ead/curso/:id/faqs-ia', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline) return naoAchou(res);
    const n = await iaTextos.salvarFaqs(co.cursoId, iaTextos.lerFaqsDoForm(req.body));
    if (n) await auditar(req, 'ADICIONOU_FAQ', 'Curso', co.cursoId, { porIa: true, quantas: n });
    voltar(res, `/ead/curso/${co.id}/dados#duvidas`, n ? 'ok' : 'erro', n ? `${n} ${n === 1 ? 'dúvida adicionada' : 'dúvidas adicionadas'}.` : 'Nenhuma dúvida marcada (ou todas já existiam).');
  });
  router.post('/ead/curso/:id/faqs/:faqId/remover', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline || !edb.ehId(req.params.faqId)) return naoAchou(res);
    const r = await prisma.faqCurso.deleteMany({ where: { id: req.params.faqId, cursoId: co.cursoId } });
    if (r.count) await auditar(req, 'REMOVEU_FAQ', 'Curso', co.cursoId, { faqId: req.params.faqId });
    voltar(res, `/ead/curso/${co.id}/dados#duvidas`, 'ok', 'Dúvida removida.');
  });

  // Escrever com IA (2026-11-09): o Claude escreve os textos do curso; a página só preenche os campos (nada é salvo).
  // Responde JSON { ok, textos } ou { ok:false, erro }. Serve ao curso só online (tipo=online).
  router.post('/ead/ia-textos', async (req, res) => {
    if (!ia.ehChaveConfigurada()) return res.json({ ok: false, erro: ia.MSG_CHAVE });
    const t = await ia.dentroDoTeto();
    if (!t.ok) return res.json({ ok: false, erro: t.erro });
    const b = req.body || {};
    const cursoId = edb.ehId(b.cursoId) ? b.cursoId : null;
    // "Escrever dúvidas com IA" na seção de dúvidas: os dados vêm do banco (com as dúvidas que o curso já tem).
    const dados = b.soDuvidas === '1' && cursoId ? await iaTextos.dadosDoCurso(cursoId) : { nome: b.nome, cargaHoraria: b.cargaHoraria, descricao: b.descricao };
    if (!dados) return res.json({ ok: false, erro: 'Curso não encontrado.' });
    try {
      const r = await iaTextos.escrever({ tipo: 'online', ideias: b.ideias, cursoId, dados });
      await ia.somarCustoAvulso(r.usage);
      await auditar(req, 'IA_TEXTOS_CURSO', 'Curso', cursoId || 'novo', { tipo: 'online' });
      return res.json({ ok: true, textos: r.textos });
    } catch (e) {
      if (e.usage) await ia.somarCustoAvulso(e.usage).catch(() => {});
      console.error('[IA TEXTOS]', e.message);
      return res.json({ ok: false, erro: 'A IA não conseguiu escrever agora. Tente de novo em alguns instantes.' });
    }
  });

  // "Gerar imagem com IA" no "Dados do curso" (só a imagem do curso; troca a atual). Em segundo plano.
  router.post('/ead/curso/:id/imagem-curso-ia', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline) return naoAchou(res);
    const volta = `/ead/curso/${co.id}/dados`;
    if (!ia.ehChaveConfigurada()) return voltar(res, volta, 'erro', ia.MSG_CHAVE);
    const t = await ia.dentroDoTeto();
    if (!t.ok) return voltar(res, volta, 'erro', t.erro);
    const nome = `curso:${co.cursoId}`;
    if (await imagensLib.travaOcupada(nome)) return voltar(res, volta, 'erro', imagensLib.OCUPADO);
    const quem = ator(req);
    const pedido = String((req.body && req.body.pedido) || '').trim();
    imagensLib.emSegundoPlano(nome, nome, async () => {
      // Pedido escrito pela pessoa: vai direto para a OpenAI; sem pedido, o Claude escreve.
      const r = pedido ? await imagensLib.gerarOutra({ tipo: 'curso', id: co.cursoId, pedido }) : await imagensLib.imagemDoCurso(co.cursoId, { custo: (u) => ia.somarCustoAvulso(u) });
      if (r.ok) await prisma.logAuditoria.create({ data: { atorId: quem, acao: 'CURSO_IMAGEM_IA', alvoTipo: 'Curso', alvoId: co.cursoId } }).catch(() => {});
      return { ok: r.ok, msg: r.ok ? 'Imagem do curso gerada.' : r.erro };
    });
    voltar(res, volta, 'ok', 'Gerando a imagem em segundo plano (cerca de 1 minuto). Recarregue a página para ver.');
  });

  router.post('/ead/curso/:id/dados', uploadFoto, async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co || !co.somenteOnline) return naoAchou(res);
    const atual = await prisma.curso.findUnique({ where: { id: co.cursoId } });
    const valores = { nome: req.body.nome, descricao: req.body.descricao, cargaHoraria: req.body.cargaHoraria, imagemUrl: atual.imagemUrl, imagemSugestao: atual.imagemSugestao, imagemGeradaPorIa: atual.imagemGeradaPorIa };
    // Revisão I2: o formulário que volta com erro mantém a lista de dúvidas e o botão de imagem.
    const deNovo = async (erro) => res.status(400).render('admin/ead/curso-online-form', {
      co, valores, erro, faqs: await prisma.faqCurso.findMany({ where: { cursoId: co.cursoId }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] }),
      temOpenAI: imagensLib.temOpenAI(), statusImagem: await imagensLib.statusDe(`curso:${co.cursoId}`),
    });
    if (req.uploadErro) return deNovo(req.uploadErro);
    let imagemUrl;
    if (req.file) imagemUrl = await salvarFotoCurso(req.file);
    else if (req.body.removerFoto) imagemUrl = null;
    const r = await cursoSoOnline.editarCursoOnline(co.id, { ...valores, ...(imagemUrl !== undefined ? { imagemUrl } : {}) });
    if (r.ok && imagemUrl !== undefined) await prisma.curso.update({ where: { id: co.cursoId }, data: { imagemGeradaPorIa: false } }); // imagem própria
    if (!r.ok) {
      if (imagemUrl) await removerFotoCurso(imagemUrl);
      return deNovo(r.erro);
    }
    if (imagemUrl !== undefined && atual.imagemUrl) await removerFotoCurso(atual.imagemUrl);
    await iaTextos.salvarFaqs(co.cursoId, iaTextos.lerFaqsDoForm(req.body));
    await auditar(req, 'EAD_EDITOU_CURSO_ONLINE', 'CursoOnline', co.id, { cursoId: co.cursoId });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'Dados do curso salvos.');
  });

  // ─── Imagens com IA (2026-11-09): o Claude escreve o pedido, a OpenAI gera (lib/ead-imagens.js) ─────────────
  // Revisão I4: o trabalho roda em segundo plano (atrás do Cloudflare, mais de 100 s vira erro 524); a página mostra
  // "Gerando as imagens…" e depois o resultado (imagensLib.statusDe).
  const MSG_SEGUNDO_PLANO = 'Gerando as imagens em segundo plano (de 1 a 5 minutos). Recarregue a página para ver o resultado.';
  const plural = (n) => `${n} ${n === 1 ? 'imagem gerada' : 'imagens geradas'}`;
  router.post('/ead/curso/:id/imagens-ia', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const volta = `/ead/curso/${co.id}`;
    if (!ia.ehChaveConfigurada()) return voltar(res, volta, 'erro', ia.MSG_CHAVE);
    const t = await ia.dentroDoTeto();
    if (!t.ok) return voltar(res, volta, 'erro', t.erro);
    const nome = `curso-online:${co.id}`;
    if (await imagensLib.travaOcupada(nome)) return voltar(res, volta, 'erro', imagensLib.OCUPADO);
    const quem = ator(req);
    imagensLib.emSegundoPlano(nome, nome, async () => {
      let r;
      try {
        r = await imagensLib.imagensDoCursoOnline(co.id, { custo: (u) => ia.somarCustoAvulso(u) });
      } catch (e) {
        if (e.usage) await ia.somarCustoAvulso(e.usage).catch(() => {});
        throw e;
      }
      if (r.aviso === imagensLib.OCUPADO) return { ok: false, msg: r.aviso };
      await prisma.logAuditoria.create({ data: { atorId: quem, acao: 'EAD_IMAGENS_IA', alvoTipo: 'CursoOnline', alvoId: co.id, detalhe: { geradas: r.geradas, descricoes: r.descricoes } } }).catch(() => {});
      if (r.aviso) return { ok: !!r.geradas, msg: r.geradas ? `${plural(r.geradas)}. ${r.aviso}` : r.aviso };
      if (!r.descricoes) return { ok: true, msg: 'Nada para preencher: a capa e os módulos já têm imagem.' };
      if (!r.geradas) return { ok: false, msg: `A OpenAI não conseguiu gerar as imagens${r.motivo ? `: ${String(r.motivo).slice(0, 300)}` : ''}. As descrições ficaram em cada módulo; tente de novo ou envie as imagens.` };
      return { ok: true, msg: `${plural(r.geradas)}.` };
    });
    voltar(res, volta, 'ok', MSG_SEGUNDO_PLANO);
  });

  router.post('/ead/curso/:id/capa/gerar-outra', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const volta = `/ead/curso/${co.id}`;
    if (await imagensLib.travaOcupada(`curso:${co.cursoId}`)) return voltar(res, volta, 'erro', imagensLib.OCUPADO);
    const pedido = String((req.body && req.body.pedido) || ''); // pedido escrito/editado pela pessoa (opcional)
    imagensLib.emSegundoPlano(`curso-online:${co.id}`, `curso:${co.cursoId}`, async () => {
      let p = pedido.trim();
      if (!p && !(await prisma.curso.findUnique({ where: { id: co.cursoId }, select: { imagemPedido: true } })).imagemPedido) {
        const t = await ia.dentroDoTeto();
        if (!t.ok) return { ok: false, msg: t.erro };
        const sug = await imagensLib.sugerirPedido({ tipo: 'curso', id: co.cursoId });
        await ia.somarCustoAvulso(sug.usage).catch(() => {});
        p = sug.pedido;
      }
      const r = await imagensLib.gerarOutra({ tipo: 'curso', id: co.cursoId, pedido: p });
      return { ok: r.ok, msg: r.ok ? 'Imagem nova gerada.' : r.erro };
    });
    voltar(res, volta, 'ok', 'Gerando outra imagem em segundo plano (cerca de 1 minuto). Recarregue a página para ver.');
  });

  // "Escrever pedido com o Claude": devolve o pedido (JSON) para a pessoa editar; não gera a imagem.
  router.post('/ead/imagens/pedido', async (req, res) => {
    if (!ia.ehChaveConfigurada()) return res.json({ ok: false, erro: ia.MSG_CHAVE });
    const t = await ia.dentroDoTeto();
    if (!t.ok) return res.json({ ok: false, erro: t.erro });
    const tipo = req.body.tipo === 'modulo' ? 'modulo' : 'curso';
    if (!edb.ehId(req.body.id)) return res.json({ ok: false, erro: 'Não encontrado.' });
    try {
      const r = await imagensLib.sugerirPedido({ tipo, id: req.body.id });
      await ia.somarCustoAvulso(r.usage).catch(() => {});
      return res.json({ ok: true, pedido: r.pedido, descricao: r.descricao });
    } catch (e) {
      if (e.usage) await ia.somarCustoAvulso(e.usage).catch(() => {});
      console.error('[EAD IMAGENS] pedido:', e.message);
      return res.json({ ok: false, erro: e instanceof imagensLib.ErroImagem ? e.message : 'O Claude não conseguiu escrever o pedido agora. Tente de novo.' });
    }
  });

  router.post('/ead/modulo/:id/foto/gerar-outra', async (req, res) => {
    const m = edb.ehId(req.params.id) ? await prisma.moduloEad.findUnique({ where: { id: req.params.id }, select: { id: true } }) : null;
    if (!m) return naoAchou(res);
    const volta = `/ead/modulo/${m.id}/editar`;
    if (await imagensLib.travaOcupada(`modulo:${m.id}`)) return voltar(res, volta, 'erro', imagensLib.OCUPADO);
    const pedido = String((req.body && req.body.pedido) || '');
    imagensLib.emSegundoPlano(`modulo:${m.id}`, `modulo:${m.id}`, async () => {
      // Pedido em branco e módulo ainda sem pedido: o Claude escreve um antes de gerar.
      let p = pedido.trim();
      if (!p && !(await prisma.moduloEad.findUnique({ where: { id: m.id }, select: { fotoPedido: true } })).fotoPedido) {
        const t = await ia.dentroDoTeto();
        if (!t.ok) return { ok: false, msg: t.erro };
        const sug = await imagensLib.sugerirPedido({ tipo: 'modulo', id: m.id });
        await ia.somarCustoAvulso(sug.usage).catch(() => {});
        p = sug.pedido;
      }
      const r = await imagensLib.gerarOutra({ tipo: 'modulo', id: m.id, pedido: p });
      return { ok: r.ok, msg: r.ok ? 'Imagem nova gerada.' : r.erro };
    });
    voltar(res, volta, 'ok', 'Gerando outra imagem em segundo plano (cerca de 1 minuto). Recarregue a página para ver.');
  });


  // ─── Criar curso com IA (etapa 9) ──────────────────────────────────────────────────────────────
  // As regras ficam em lib/ead-ia.js; a fila (lib/ead-ia-fila.js) faz o roteiro e os módulos em segundo plano.
  const MAX_BYTES_MATERIAL = 20 * 1024 * 1024;
  const materialUpload = multer({ storage: multer.memoryStorage(), limits: { files: 3, fileSize: MAX_BYTES_MATERIAL } });
  const ehMaterial = (f) => /\.(pdf|docx)$/i.test(f.originalname || '');
  function uploadMaterial(req, res, next) {
    materialUpload.array('material', 3)(req, res, (err) => {
      if (err) req.uploadErro = err.code === 'LIMIT_FILE_SIZE' ? 'Os arquivos passam de 20 MB.' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Envie até 3 arquivos.' : 'Não foi possível ler os arquivos.';
      next();
    });
  }
  const cursosOnlineParaIa = () => prisma.cursoOnline.findMany({ select: { id: true, publicado: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } });

  // Confere o formulário; devolve { pedido } ou { erro }.
  async function lerPedidoIa(b, arquivos) {
    const tema = String(b.tema || '').trim();
    const publico = String(b.publico || '').trim();
    const observacoes = String(b.observacoes || '').trim();
    const texto = String(b.texto || '');
    const nModulos = Number(b.nModulos);
    if (tema.length < 5 || tema.length > 300) return { erro: 'Tema: de 5 a 300 caracteres.' };
    if (publico.length > 200) return { erro: 'Público: até 200 caracteres.' };
    if (observacoes.length > 2000) return { erro: 'Observações: até 2000 caracteres.' };
    if (!Number.isInteger(nModulos) || nModulos < 2 || nModulos > 12) return { erro: 'Módulos: de 2 a 12.' };
    if (texto.length > 100000) return { erro: 'Texto colado: até 100 mil caracteres.' };
    if (arquivos.some((f) => !ehMaterial(f))) return { erro: 'Envie só arquivos PDF ou Word (.docx).' };
    if (arquivos.reduce((t, f) => t + f.size, 0) > MAX_BYTES_MATERIAL) return { erro: 'Os arquivos passam de 20 MB.' };
    let destino;
    if (b.destino === 'existente') {
      if (!edb.ehId(b.cursoOnlineId) || !(await prisma.cursoOnline.findUnique({ where: { id: b.cursoOnlineId } }))) return { erro: 'Escolha o curso online.' };
      destino = { tipo: 'existente', cursoOnlineId: b.cursoOnlineId };
    } else {
      const v = cursoSoOnline.validar({ nome: b.nome, descricao: b.descricao, cargaHoraria: b.cargaHoraria });
      if (v.erro) return { erro: v.erro };
      if (await cursoSoOnline.nomeEmUso(v.dados.nome)) return { erro: 'Já existe um curso com esse nome (ou com o mesmo endereço no site).' };
      const precoTxt = String(b.precoOnline || '').trim();
      const precoOnline = precoTxt ? publicacao.lerPreco(precoTxt) : null;
      if (precoTxt && precoOnline === null) return { erro: 'Preço: um valor em reais (ex.: 49,90), ou em branco.' };
      const maxParcelas = Number(b.maxParcelas || 1);
      if (!Number.isInteger(maxParcelas) || maxParcelas < 1 || maxParcelas > 12) return { erro: 'Parcelas: de 1 a 12.' };
      destino = { tipo: 'novo', ...v.dados, precoOnline, maxParcelas };
    }
    return { pedido: { destino, tema, publico, nModulos, observacoes }, texto };
  }

  // Passo 1 da criação passo a passo (2026-11): só a ideia, o material e o destino. Devolve { pedido, texto } ou { erro }.
  async function lerIdeiaIa(b, arquivos) {
    const ideia = String(b.ideia || '').trim();
    const texto = String(b.texto || '');
    if (ideia.length < 10) return { erro: 'Conte a ideia em pelo menos 10 caracteres (o que ensinar e para quem).' };
    // Sem limite de tamanho para a ideia (pedido do Matheus, 2026-11-09): vale o limite do envio do formulário.
    if (texto.length > 100000) return { erro: 'Texto colado: até 100 mil caracteres.' };
    if (arquivos.some((f) => !ehMaterial(f))) return { erro: 'Envie só arquivos PDF ou Word (.docx).' };
    if (arquivos.reduce((t, f) => t + f.size, 0) > MAX_BYTES_MATERIAL) return { erro: 'Os arquivos passam de 20 MB.' };
    let destino = { tipo: 'novo' };
    if (b.destino === 'existente') {
      if (!edb.ehId(b.cursoOnlineId) || !(await prisma.cursoOnline.findUnique({ where: { id: b.cursoOnlineId } }))) return { erro: 'Escolha o curso online.' };
      destino = { tipo: 'existente', cursoOnlineId: b.cursoOnlineId };
    }
    return { pedido: { ideia, destino }, texto };
  }

  // As telas nunca leem o material (PDFs em base64 e o texto podem ter dezenas de MB; a página consulta a cada 5 s).
  const COLUNAS_GERACAO = {
    id: true, criadoPor: true, status: true, pedido: true, roteiro: true, cursoOnlineId: true, modulos: true,
    tokensEntrada: true, tokensSaida: true, tokensCache: true, custoUsd: true, erro: true, criadoEm: true, atualizadoEm: true,
  };
  router.get('/ead/ia', async (req, res) => {
    const lista = await prisma.geracaoIaEad.findMany({ orderBy: { criadoEm: 'desc' }, take: 50, select: COLUNAS_GERACAO });
    const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(lista.map((g) => g.criadoPor))].filter(edb.ehId) } }, select: { id: true, nome: true } })).map((u) => [u.id, u.nome]));
    const cos = new Map((await prisma.cursoOnline.findMany({ where: { id: { in: lista.map((g) => g.cursoOnlineId || (g.pedido.destino && g.pedido.destino.cursoOnlineId)).filter(Boolean) } }, select: { id: true, curso: { select: { nome: true } } } })).map((c) => [c.id, c.curso.nome]));
    res.render('admin/ead/ia-lista', {
      lista: lista.map((g) => ({ ...g, quem: nomes.get(g.criadoPor) || 'Dev', cursoNome: cos.get(g.cursoOnlineId || (g.pedido.destino && g.pedido.destino.cursoOnlineId)) || (g.pedido.destino && g.pedido.destino.nome) || '—' })),
      gasto: await ia.gastoDoMes(), teto: await ia.tetoMensal(), imagens: await imagensLib.contagem(), chave: ia.ehChaveConfigurada(), msgChave: ia.MSG_CHAVE, ...flash(req),
    });
  });

  async function formIa(res, { valores = {}, erro = null, status = 200 } = {}) {
    res.status(status).render('admin/ead/ia-form', {
      valores: { destino: 'novo', ...valores }, cursos: await cursosOnlineParaIa(), erro, chave: ia.ehChaveConfigurada(), msgChave: ia.MSG_CHAVE,
    });
  }
  router.get('/ead/ia/novo', async (req, res) => formIa(res));
  router.post('/ead/ia/novo', uploadMaterial, async (req, res) => {
    const valores = { ...req.body };
    if (req.uploadErro) return formIa(res, { valores, erro: req.uploadErro, status: 400 });
    const pode = await ia.podeComecar(ator(req));
    if (!pode.ok) return formIa(res, { valores, erro: pode.erro, status: 400 });
    const arquivos = req.files || [];
    const r = await lerIdeiaIa(req.body, arquivos);
    if (r.erro) return formIa(res, { valores, erro: r.erro, status: 400 });
    let material;
    try {
      material = await ia.prepararMaterial({ arquivos: arquivos.map((f) => ({ nome: f.originalname, mimetype: f.mimetype, buffer: f.buffer })), texto: r.texto });
    } catch (e) {
      return formIa(res, { valores, erro: 'Não foi possível ler o arquivo Word. Confira se é um .docx válido.', status: 400 });
    }
    const g = await ia.criarGeracao({ pedido: r.pedido, material, criadoPor: ator(req) });
    iaFila.acordar();
    res.redirect(`/ead/ia/${g.id}`);
  });

  const acharGeracao = (id) => (edb.ehId(id) ? prisma.geracaoIaEad.findUnique({ where: { id }, select: COLUNAS_GERACAO }) : null);
  async function paginaGeracao(res, g, { erro = null, ok = null, roteiro = null, proposta = null, status = 200 } = {}) {
    const co = g.cursoOnlineId ? await prisma.cursoOnline.findUnique({ where: { id: g.cursoOnlineId }, select: { id: true, curso: { select: { nome: true } } } }) : null;
    const coDestino = !co && g.pedido.destino && g.pedido.destino.cursoOnlineId ? await prisma.cursoOnline.findUnique({ where: { id: g.pedido.destino.cursoOnlineId }, select: { curso: { select: { nome: true } } } }) : null;
    // Passo 2: o formulário da proposta (o que a pessoa digitou depois de um erro, senão a sugestão da IA).
    // Depois de "← Voltar à proposta", mostra o que a pessoa já confirmou (não a sugestão original da IA).
    const p = g.pedido.proposta || {};
    const reais = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));
    const conf = g.pedido.tema ? g.pedido : null;
    const dc = (conf && conf.destino) || {};
    const valoresProposta = proposta || (conf ? {
      nome: dc.nome, descricao: dc.descricao, cargaHoraria: dc.cargaHoraria, tema: conf.tema, publico: conf.publico, nModulos: conf.nModulos,
      observacoes: conf.observacoes, maxParcelas: dc.maxParcelas, precoOnline: reais(dc.precoOnline), faqs: conf.faqs || [],
    } : {
      nome: p.nome, descricao: p.descricao, cargaHoraria: p.cargaHoraria, tema: p.tema, publico: p.publico, nModulos: p.nModulos,
      observacoes: p.observacoes, maxParcelas: p.maxParcelas, precoOnline: p.precoSugerido ? reais(p.precoSugerido) : '', faqs: p.faqs || [],
    });
    res.status(status).render('admin/ead/ia-geracao', { g, roteiro: roteiro || g.roteiro, co, cursoNome: co ? co.curso.nome : coDestino ? coDestino.curso.nome : (g.pedido.destino && g.pedido.destino.nome) || p.nome, erro, ok, valoresProposta });
  }
  router.get('/ead/ia/:id', async (req, res) => {
    const g = await acharGeracao(req.params.id);
    if (!g) return naoAchou(res);
    paginaGeracao(res, g, flash(req));
  });
  router.get('/ead/ia/:id/estado.json', async (req, res) => {
    const g = await acharGeracao(req.params.id);
    if (!g) return res.status(404).json({ erro: 'não encontrada' });
    res.json({ status: g.status, modulos: g.modulos || [], custoUsd: Number(g.custoUsd), erro: g.erro });
  });
  router.post('/ead/ia/:id/confirmar', async (req, res) => {
    const g = await acharGeracao(req.params.id);
    if (!g) return naoAchou(res);
    const roteiro = iaEsquema.roteiroDoFormulario(req.body);
    const r = await ia.confirmarRoteiro(g.id, roteiro, ator(req));
    if (!r.ok) return paginaGeracao(res, await acharGeracao(g.id), { erro: r.erro, roteiro, status: 400 });
    iaFila.acordar();
    voltar(res, `/ead/ia/${g.id}`, 'ok', 'Roteiro confirmado. Os módulos estão sendo escritos.');
  });
  // Passo 2 → 3: a pessoa conferiu a proposta (mesmas regras do formulário antigo) e pede o roteiro.
  router.post('/ead/ia/:id/proposta', async (req, res) => {
    const g = await acharGeracao(req.params.id);
    if (!g) return naoAchou(res);
    if (g.status !== 'PROPOSTA_PRONTA') return voltar(res, `/ead/ia/${g.id}`, 'erro', 'Esta geração não está esperando a proposta.');
    const d = g.pedido.destino || {};
    const r = await lerPedidoIa({ ...req.body, destino: d.tipo, cursoOnlineId: d.cursoOnlineId }, []);
    // Revisão I1: depois de um erro, as dúvidas voltam como a pessoa deixou (desmarcada continua desmarcada).
    const faqsForm = iaTextos.faqsDoCorpo(req.body);
    if (r.erro) return paginaGeracao(res, g, { erro: r.erro, proposta: { ...req.body, faqs: faqsForm }, status: 400 });
    const c = await ia.confirmarProposta(g.id, { ...r.pedido, faqs: iaTextos.lerFaqsDoForm(req.body) }, ator(req));
    if (!c.ok) return paginaGeracao(res, g, { erro: c.erro, proposta: { ...req.body, faqs: faqsForm }, status: 400 });
    iaFila.acordar();
    voltar(res, `/ead/ia/${g.id}`, 'ok', 'Proposta confirmada. A IA está montando o roteiro.');
  });
  router.post('/ead/ia/:id/proposta-de-novo', async (req, res) => {
    const r = await ia.pedirOutraProposta(req.params.id, ator(req));
    if (r.ok) iaFila.acordar();
    voltar(res, `/ead/ia/${req.params.id}`, r.ok ? 'ok' : 'erro', r.ok ? 'Pedimos outra proposta à IA.' : r.erro);
  });
  router.post('/ead/ia/:id/voltar-proposta', async (req, res) => {
    const r = await ia.voltarParaProposta(req.params.id, ator(req));
    voltar(res, `/ead/ia/${req.params.id}`, r.ok ? 'ok' : 'erro', r.ok ? 'De volta à proposta. Ajuste e gere o roteiro de novo.' : r.erro);
  });
  router.post('/ead/ia/:id/roteiro-de-novo', async (req, res) => {
    const r = await ia.pedirOutroRoteiro(req.params.id, ator(req));
    if (r.ok) iaFila.acordar();
    voltar(res, `/ead/ia/${req.params.id}`, r.ok ? 'ok' : 'erro', r.ok ? 'Pedimos outro roteiro à IA.' : r.erro);
  });
  router.post('/ead/ia/:id/modulo/:ordem/tentar', async (req, res) => {
    const r = await ia.tentarDeNovo(req.params.id, Number(req.params.ordem), ator(req));
    if (r.ok) iaFila.acordar();
    voltar(res, `/ead/ia/${req.params.id}`, r.ok ? 'ok' : 'erro', r.ok ? 'O módulo voltou para a fila.' : r.erro);
  });
  router.post('/ead/ia/:id/cancelar', async (req, res) => {
    const r = await ia.cancelar(req.params.id, ator(req));
    voltar(res, `/ead/ia/${req.params.id}`, r.ok ? 'ok' : 'erro', r.ok ? 'Geração cancelada. O que já foi gravado fica no curso.' : r.erro);
  });
  router.post('/ead/ia/teto', async (req, res) => {
    const r = await ia.definirTeto(req.body.teto, ator(req));
    voltar(res, '/ead/ia', r.ok ? 'ok' : 'erro', r.ok ? 'Teto mensal salvo.' : r.erro);
  });

  // ─── Cupons de desconto (etapa 7) ─────────────────────────────────────────────────────────────
  // As regras e a auditoria ficam em lib/ead-cupom.js. Validade: a data do formulário, gravada ao meio-dia no Rio
  // (vale até o fim desse dia).
  const diaDoCupom = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(`${d}T12:00:00-03:00`) : null);
  const dadosDoCupom = (b) => ({
    codigo: b.codigo, tipo: b.tipo, valor: publicacao.lerPreco(b.valor) ?? NaN,
    alvo: b.alvo, cursoOnlineId: b.cursoOnlineId || null, validoAte: diaDoCupom(b.validoAte), limiteUsos: String(b.limiteUsos || '').trim(),
    observacao: b.observacao,
  });
  const valoresDoCupom = (c) => ({
    codigo: c.codigo, tipo: c.tipo, valor: Number(c.valor).toLocaleString('pt-BR', { maximumFractionDigits: 2 }), cursoOnlineId: c.cursoOnlineId || '',
    alvo: c.ebookId ? `ebook:${c.ebookId}` : c.cursoOnlineId ? `curso:${c.cursoOnlineId}` : c.cursoId ? `presencial:${c.cursoId}` : c.todosPresenciais ? 'presenciais' : c.valeTudo ? 'tudo' : '',
    validoAte: c.validoAte ? new Date(c.validoAte).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '',
    limiteUsos: c.limiteUsos === null ? '' : String(c.limiteUsos), observacao: c.observacao || '',
  });
  const cursosDoForm = () => prisma.cursoOnline.findMany({ select: { id: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } });

  router.get('/ead/cupons', async (req, res) => {
    const ativos = req.query.ativos === '1' ? true : req.query.ativos === '0' ? false : undefined;
    res.render('admin/ead/cupons', { lista: await cupons.listarCupons({ ativos }), ativos, ...flash(req) });
  });

  async function formCupom(res, { cupom = null, valores = {}, erro = null, compras = [], status = 200, ok = null } = {}) {
    const ebooks = await prisma.ebook.findMany({ select: { id: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } });
    // Presencial (2026-11-09): os cursos do presencial (sem os só online e os de e-book).
    const presenciais = await cursoSoOnline.semSoOnline(await prisma.curso.findMany({ select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } }));
    res.status(status).render('admin/ead/cupom-form', { cupom, valores, erro, ok, compras, cursos: await cursosDoForm(), ebooks, presenciais, usos: cupom ? await cupons.usosDoCupom(cupom.id) : 0 });
  }
  router.get('/ead/cupons/novo', async (req, res) => formCupom(res, { valores: { tipo: 'PERCENTUAL' } }));
  router.post('/ead/cupons/novo', async (req, res) => {
    const r = await cupons.criarCupom(dadosDoCupom(req.body), ator(req));
    if (r.erro) return formCupom(res, { valores: req.body, erro: r.erro, status: 400 });
    voltar(res, `/ead/cupons/${r.cupom.id}`, 'ok', `Cupom ${r.cupom.codigo} criado.`);
  });
  router.get('/ead/cupons/:id', async (req, res) => {
    const cupom = edb.ehId(req.params.id) ? await prisma.cupomEad.findUnique({ where: { id: req.params.id } }) : null;
    if (!cupom) return naoAchou(res);
    formCupom(res, { cupom, valores: valoresDoCupom(cupom), compras: await cupons.comprasDoCupom(cupom.id), ...flash(req) });
  });
  router.post('/ead/cupons/:id', async (req, res) => {
    const cupom = edb.ehId(req.params.id) ? await prisma.cupomEad.findUnique({ where: { id: req.params.id } }) : null;
    if (!cupom) return naoAchou(res);
    const r = await cupons.alterarCupom(cupom.id, dadosDoCupom(req.body), ator(req));
    if (r.erro) return formCupom(res, { cupom, valores: req.body, erro: r.erro, compras: await cupons.comprasDoCupom(cupom.id), status: 400 });
    voltar(res, `/ead/cupons/${cupom.id}`, 'ok', 'Cupom salvo.');
  });
  router.post('/ead/cupons/:id/ativar', async (req, res) => {
    const ativo = req.body.ativo === '1';
    const r = await cupons.ativarCupom(req.params.id, ativo, ator(req));
    if (r.erro) return naoAchou(res);
    voltar(res, `/ead/cupons/${req.params.id}`, 'ok', ativo ? 'Cupom ativado.' : 'Cupom desativado: ninguém mais consegue usar.');
  });
  router.post('/ead/cupons/:id/apagar', async (req, res) => {
    const r = await cupons.apagarCupom(req.params.id, ator(req));
    if (r.erro) return voltar(res, `/ead/cupons/${req.params.id}`, 'erro', r.erro);
    voltar(res, '/ead/cupons', 'ok', 'Cupom apagado.');
  });

  // ─── Escolas e lotes (etapa 6) ────────────────────────────────────────────────────────────────
  // Data do formulário (AAAA-MM-DD): prazo = fim do dia no Rio; recebido = meio-dia no Rio (cai no dia certo).
  const fimDoDia = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(`${d}T23:59:59-03:00`) : null);
  const meioDia = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? new Date(`${d}T12:00:00-03:00`) : null);
  const lerValor = (t) => { const v = String(t || '').trim(); if (!v || /^0+([.,]0+)?$/.test(v)) return 0; return publicacao.lerPreco(v); };
  const pessoaDoForm = (b, prefixo = '') => ({ nome: b[`${prefixo}nome`] ?? b[`${prefixo}Nome`], email: b[`${prefixo}email`] ?? b[`${prefixo}Email`], celular: b[`${prefixo}celular`] ?? b[`${prefixo}Celular`], cpf: b[`${prefixo}cpf`] ?? b[`${prefixo}Cpf`] });
  const ERRO_LOTE = {
    esgotado: 'Não há mais vagas neste lote.', vencido: 'O prazo para usar as vagas terminou.', ja_tem_acesso: 'Esta pessoa já tem acesso ao curso: nenhuma vaga foi usada.',
    comecou: 'Esta pessoa já começou o curso: a vaga não pode voltar.', vagas: 'O lote não pode ter menos vagas do que as já usadas.', vagas_invalidas: 'Vagas: um número inteiro de 1 a 5000.',
    prazo: 'Prazo inválido.', nao_achou: 'Não encontrado.',
  };
  const urlLote = (id) => `/ead/escolas/lote/${id}`;

  router.get('/ead/escolas', async (req, res) => {
    const filtro = req.query.filtro === 'areceber' ? 'areceber' : 'todos';
    const escolas = await prisma.escolaEad.findMany({
      orderBy: { nome: 'asc' },
      include: { lotes: { orderBy: { criadoEm: 'desc' }, include: { cursoOnline: { select: { curso: { select: { nome: true } } } }, vagasUsadas: { select: { removidaEm: true } } } }, gestores: { include: { usuario: { select: { nome: true } } } } },
    });
    const lista = escolas.map((e) => ({ ...e, lotes: e.lotes.map((l) => ({ ...l, situacao: lotes.situacaoDoLote(l) })) }))
      .map((e) => (filtro === 'areceber' ? { ...e, lotes: e.lotes.filter((l) => !l.recebidoEm && Number(l.valor) > 0) } : e))
      .filter((e) => filtro === 'todos' || e.lotes.length);
    res.render('admin/ead/escolas', { lista, filtro, ...flash(req) });
  });

  async function formLote(res, valores, erro, status = 200) {
    const [escolas, cursos] = await Promise.all([
      prisma.escolaEad.findMany({ select: { id: true, nome: true }, orderBy: { nome: 'asc' } }),
      prisma.cursoOnline.findMany({ select: { id: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } }),
    ]);
    const padrao = new Date(); padrao.setFullYear(padrao.getFullYear() + 1);
    res.status(status).render('admin/ead/escolas-lote-form', { escolas, cursos, formas: lotes.FORMAS, valores: { validoAte: padrao.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), forma: 'PIX', ...valores }, erro });
  }
  router.get('/ead/escolas/lote/novo', async (req, res) => formLote(res, { escolaId: edb.ehId(req.query.escola) ? req.query.escola : '' }, null));
  router.post('/ead/escolas/lote/novo', async (req, res) => {
    const b = req.body;
    const valor = lerValor(b.valor);
    if (valor === null) return formLote(res, b, 'Valor: em reais (ex.: 1.200,00), ou 0.', 400);
    const validoAte = fimDoDia(b.validoAte);
    if (!validoAte) return formLote(res, b, 'Prazo: escolha a data.', 400);
    const r = await lotes.criarLote({
      escola: edb.ehId(b.escolaId) ? { id: b.escolaId } : { nome: b.escolaNome, cnpj: b.escolaCnpj },
      cursoOnlineId: b.cursoOnlineId, vagas: b.vagas, validoAte, valor, forma: b.forma, recebidoEm: meioDia(b.recebidoEm),
      observacao: b.observacao, gestor: pessoaDoForm(b, 'gestor'), atorId: ator(req),
    });
    if (!r.ok) return formLote(res, b, r.erro, 400);
    voltar(res, urlLote(r.lote.id), 'ok', 'Lote criado. O gestor recebeu um e-mail com o acesso a Minha escola.');
  });

  async function acharLote(id) {
    if (!edb.ehId(id)) return null;
    return prisma.loteEad.findUnique({ where: { id }, include: { escola: { include: { gestores: { include: { usuario: { select: { id: true, nome: true, email: true } } } } } }, cursoOnline: { include: { curso: { select: { nome: true } } } }, vagasUsadas: { select: { removidaEm: true } } } });
  }
  router.get('/ead/escolas/lote/:id', async (req, res) => {
    const lote = await acharLote(req.params.id);
    if (!lote) return naoAchou(res);
    const urlSite = (process.env.APP_URL || 'https://escola.cruzvermelhariodejaneiro.org').replace(/\/+$/, '');
    res.render('admin/ead/escolas-lote', {
      lote, situacao: lotes.situacaoDoLote(lote), funcionarios: await lotes.funcionariosDoLote(lote.id),
      conviteUrl: lote.convite ? `${urlSite}/escola/convite/${lote.convite}` : null, formatar: require('../lib/documento').formatar, ...flash(req),
    });
  });
  router.get('/ead/escolas/lote/:id/:arquivo(declaracao.pdf|planilha.xlsx)', async (req, res) => {
    const lote = await acharLote(req.params.id);
    if (!lote) return naoAchou(res);
    const { gerarDeclaracao, gerarPlanilhaLote } = require('../lib/ead-lote-declaracao');
    const pdf = req.params.arquivo === 'declaracao.pdf';
    const { buffer, nomeArquivo } = pdf ? await gerarDeclaracao(lote.id) : await gerarPlanilhaLote(lote.id);
    res.set('Content-Type', pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(buffer);
  });

  router.post('/ead/escolas/lote/:id/:acao(alterar|recebido|desfazer-recebido|gestor|funcionario|apagar)', async (req, res) => {
    const lote = await acharLote(req.params.id);
    if (!lote) return naoAchou(res);
    const b = req.body; const quem = ator(req); const volta = urlLote(lote.id);
    const r = await ({
      alterar: () => {
        const validoAte = fimDoDia(b.validoAte);
        if (!validoAte) return { ok: false, erro: 'prazo' };
        return lotes.alterarLote(lote.id, { vagas: b.vagas, validoAte, observacao: b.observacao }, quem);
      },
      recebido: () => (meioDia(b.recebidoEm) ? lotes.alterarLote(lote.id, { recebidoEm: meioDia(b.recebidoEm) }, quem) : { ok: false, erro: 'prazo' }),
      'desfazer-recebido': () => lotes.alterarLote(lote.id, { recebidoEm: null }, quem),
      gestor: () => lotes.adicionarGestor(lote.escolaId, pessoaDoForm(b), quem),
      funcionario: () => lotes.cadastrarFuncionario(lote.id, pessoaDoForm(b), { origem: 'GESTOR', atorId: quem }),
      apagar: () => lotes.apagarLote(lote.id, quem),
    })[req.params.acao]();
    const MSG = { alterar: 'Lote atualizado.', recebido: 'Pagamento marcado como recebido.', 'desfazer-recebido': 'Recebimento desfeito.', gestor: 'Gestor adicionado (recebeu um e-mail).', funcionario: 'Funcionário cadastrado (recebeu um e-mail).', apagar: 'Lote apagado.' };
    if (r.ok) return voltar(res, req.params.acao === 'apagar' ? '/ead/escolas' : volta, 'ok', MSG[req.params.acao]);
    voltar(res, volta, 'erro', r.erro === 'conta' ? r.mensagem : ERRO_LOTE[r.erro] || r.erro || 'Não foi possível.');
  });
  router.post('/ead/escolas/lote/:id/gestor/:usuarioId/remover', async (req, res) => {
    const lote = await acharLote(req.params.id);
    if (!lote) return naoAchou(res);
    const r = await lotes.removerGestor(lote.escolaId, req.params.usuarioId, ator(req));
    voltar(res, urlLote(lote.id), r.ok ? 'ok' : 'erro', r.ok ? 'Gestor retirado.' : r.erro);
  });
  router.post('/ead/escolas/lote/:id/remover/:vagaId', async (req, res) => {
    const lote = await acharLote(req.params.id);
    const vaga = lote && edb.ehId(req.params.vagaId) ? await prisma.vagaLoteEad.findFirst({ where: { id: req.params.vagaId, loteId: lote.id } }) : null;
    if (!vaga) return naoAchou(res);
    const r = await lotes.removerVaga(vaga.id, ator(req));
    voltar(res, urlLote(lote.id), r.ok ? 'ok' : 'erro', r.ok ? 'Funcionário retirado; a vaga voltou.' : ERRO_LOTE[r.erro]);
  });
  router.post('/ead/escolas/lote/:id/convite/:acao(trocar|desligar)', async (req, res) => {
    const lote = await acharLote(req.params.id);
    if (!lote) return naoAchou(res);
    if (req.params.acao === 'trocar') await lotes.trocarConvite(lote.id, ator(req)); else await lotes.desligarConvite(lote.id, ator(req));
    voltar(res, urlLote(lote.id), 'ok', req.params.acao === 'trocar' ? 'Link de convite novo.' : 'Link de convite desligado.');
  });

  // ─── Central de dúvidas (etapa 5) ─────────────────────────────────────────────────────────────
  const STATUS_DUVIDA = ['AGUARDANDO', 'RESPONDIDA', 'DESCARTADA', 'OCULTA'];
  router.get('/ead/duvidas', async (req, res) => {
    const status = STATUS_DUVIDA.includes(req.query.status) ? req.query.status : 'AGUARDANDO';
    const cursoOnlineId = edb.ehId(req.query.curso) ? req.query.curso : null;
    const [lista, cursos, contagens] = await Promise.all([
      duv.listarCentral({ status, cursoOnlineId }),
      prisma.cursoOnline.findMany({ select: { id: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } }),
      prisma.duvidaEad.groupBy({ by: ['status'], where: cursoOnlineId ? { alunoCurso: { cursoOnlineId } } : {}, _count: { _all: true } }),
    ]);
    const contas = Object.fromEntries(contagens.map((c) => [c.status, c._count._all]));
    res.render('admin/ead/duvidas', { lista, cursos, status, cursoOnlineId, contas, ...flash(req) });
  });

  const MSG_ACAO = {
    responder: 'Resposta publicada e e-mail enviado.', descartar: 'Dúvida descartada.', editar: 'Resposta corrigida.',
    ocultar: 'Dúvida tirada do ar.', reabrir: 'Dúvida de volta para Aguardando.',
  };
  const ERRO_ACAO = {
    vazia: 'Escreva a resposta.', longa: 'A resposta pode ter até 2000 caracteres.', ja_respondida: 'Essa dúvida já tinha sido respondida.',
    nao_achou: 'Dúvida não encontrada.', status: 'Essa ação não vale para a situação atual da dúvida.',
  };
  router.post('/ead/duvidas/:id/:acao(responder|descartar|editar|ocultar|reabrir)', async (req, res) => {
    const { id, acao } = req.params;
    const quem = ator(req);
    let r;
    if (acao === 'responder') {
      const [linha] = edb.ehId(id) ? (await duv.listarCentral({ status: 'AGUARDANDO' })).filter((x) => x.duvida.id === id) : [];
      r = await duv.responder(id, req.body.resposta, quem, { linkBase: linha ? linha.linkBase : null });
    } else if (acao === 'descartar') r = await duv.descartar(id, req.body.motivo, quem);
    else if (acao === 'editar') r = await duv.editarResposta(id, req.body.resposta, quem);
    else if (acao === 'ocultar') r = await duv.tirarDoAr(id, quem);
    else r = await duv.reabrir(id, quem);
    const volta = String(req.body.volta || '').startsWith('/ead/duvidas') ? req.body.volta : '/ead/duvidas';
    voltar(res, volta, r.ok ? 'ok' : 'erro', r.ok ? MSG_ACAO[acao] : ERRO_ACAO[r.erro] || 'Não foi possível.');
  });

  // ─── Venda no site (etapa 4) ──────────────────────────────────────────────────────────────────
  router.post('/ead/curso/:id/preco', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    if (co.gratuito) return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Desmarque "Curso gratuito" para definir um preço.');
    const preco = publicacao.lerPreco(req.body.precoOnline);
    if (preco === null) return voltar(res, comDigitado(`/ead/curso/${co.id}`, { precoOnline: req.body.precoOnline }), 'erro', 'Preço: um valor em reais maior que zero (ex.: 49,90).');
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { precoOnline: preco } });
    await auditar(req, 'EAD_PRECO', 'CursoOnline', co.id, { de: co.precoOnline === null ? null : Number(co.precoOnline), para: preco });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'Preço salvo.');
  });

  // Vitrine (2026-11-09): curso gratuito. Marcado: preço 0, só à vista; desmarcado: sem preço (digita de novo).
  router.post('/ead/curso/:id/gratuito', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const gratuito = req.body.gratuito === '1';
    if (gratuito && (await prisma.cupomEad.count({ where: { cursoOnlineId: co.id, ativo: true } }))) {
      return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Este curso tem cupom ativo. Desative os cupons antes de marcar como gratuito.');
    }
    await prisma.cursoOnline.update({ where: { id: co.id }, data: gratuito ? { gratuito: true, precoOnline: 0, maxParcelas: 1 } : { gratuito: false, precoOnline: null } });
    await auditar(req, 'EAD_GRATUITO', 'CursoOnline', co.id, { gratuito });
    require('../lib/cache-rapido').limparTudo();
    voltar(res, `/ead/curso/${co.id}`, 'ok', gratuito ? 'Curso marcado como gratuito.' : co.publicado ? 'Curso deixou de ser gratuito: defina o preço. Até lá, ele não aparece no site.' : 'Curso deixou de ser gratuito: defina o preço.');
  });

  // Etapa 7: máximo de parcelas no cartão (1 = só à vista). Os juros do Únicopag ficam com o aluno.
  router.post('/ead/curso/:id/parcelas', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const n = Number(String(req.body.maxParcelas || '').trim());
    if (!Number.isInteger(n) || n < 1 || n > 12) return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Parcelas: de 1 a 12.');
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { maxParcelas: n } });
    await auditar(req, 'EAD_PARCELAS', 'CursoOnline', co.id, { de: co.maxParcelas, para: n });
    voltar(res, `/ead/curso/${co.id}`, 'ok', n === 1 ? 'Parcelamento desligado: só à vista.' : `Parcelamento em até ${n}x salvo.`);
  });

  // "Publicar no site": ligar só sem pendências; desligar tira do catálogo, mas quem já pagou continua.
  router.post('/ead/curso/:id/publicar', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    if (req.body.acao === 'desligar') {
      await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: false } });
      await auditar(req, 'EAD_DESPUBLICOU', 'CursoOnline', co.id, null);
      return voltar(res, `/ead/curso/${co.id}`, 'ok', 'Curso fora do site. Quem já comprou continua com acesso.');
    }
    const modulos = await prisma.moduloEad.findMany({ where: { cursoOnlineId: co.id }, select: { titulo: true, status: true } });
    const pend = publicacao.podePublicar({ ...co, modulos });
    if (pend.length) return voltar(res, `/ead/curso/${co.id}`, 'erro', 'Ainda não dá para publicar: ' + pend.join(' '));
    // Vitrine (2026-11-09): quem acabou de ser publicado entra no fim da ordem.
    const ultimo = await prisma.cursoOnline.aggregate({ where: { publicado: true }, _max: { ordemVitrine: true } });
    await prisma.cursoOnline.update({ where: { id: co.id }, data: { publicado: true, ordemVitrine: (ultimo._max.ordemVitrine ?? -1) + 1 } });
    await auditar(req, 'EAD_PUBLICOU', 'CursoOnline', co.id, { precoOnline: Number(co.precoOnline) });
    voltar(res, `/ead/curso/${co.id}`, 'ok', 'Curso publicado no site.');
  });

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

  // Prévia do cartão de bolso (etapa 3): o mesmo PDF que o aluno baixa ao concluir.
  router.get('/ead/curso/:id/cartao-de-bolso.pdf', async (req, res) => {
    const co = await acharCursoOnline(req.params.id);
    if (!co) return naoAchou(res);
    const { buffer, nomeArquivo } = await gerarCartao(co.id);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
    res.send(buffer);
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
    let m;
    try {
      m = await transacao(async (tx) => {
        const novo = await tx.moduloEad.create({ data: { ...dados, cursoOnlineId: co.id, ordem: await edb.proximaOrdem(tx, 'moduloEad', 'cursoOnlineId', co.id) } });
        if (final) { const f = await edb.marcarFinal(tx, novo.id, true, ator(req)); if (f.erro) throw new ErroForm(f.erro); }
        // Escola Digital (2026-11): os tópicos de uma vez ("um por linha"), no módulo comum.
        const titulos = final ? [] : String(req.body.topicos || '').split(/\r?\n/).map((t) => t.trim().slice(0, 120)).filter(Boolean).slice(0, 30);
        for (const [i, titulo] of titulos.entries()) await tx.topicoEad.create({ data: { moduloId: novo.id, titulo, ordem: i } });
        return novo;
      });
    } catch (e) {
      if (!(e instanceof ErroForm)) throw e;
      if (dados.fotoIntroUrl) await removerFotoCurso(dados.fotoIntroUrl);
      return res.status(400).render('admin/ead/modulo-form', { co, modulo: null, valores: req.body, erro: e.message });
    }
    await auditar(req, 'EAD_CRIOU_MODULO', 'ModuloEad', m.id, { moduloId: m.id, titulo: m.titulo });
    voltar(res, urlModulo(m.id), 'ok', 'Módulo criado.');
  });

  router.get('/ead/modulo/:id', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    res.render('admin/ead/modulo', {
      modulo, pendencias: ead.pendencias(modulo), avisos: ead.avisos(modulo), lista: ead.checklist(modulo), minutos: ead.minutosDoModulo(modulo),
      validadoPorNome: await nomeDe(modulo.validadoPor), mmSs: ead.mmSs, ...flash(req),
    });
  });

  router.get('/ead/modulo/:id/editar', async (req, res) => {
    const modulo = await edb.carregarModulo(req.params.id);
    if (!modulo) return naoAchou(res);
    res.render('admin/ead/modulo-form', { co: modulo.cursoOnline, modulo, valores: modulo, erro: null, temOpenAI: imagensLib.temOpenAI(), statusImagem: await imagensLib.statusDe(`modulo:${modulo.id}`) });
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
    if (fotoNova || tirarFoto) { dados.fotoIntroUrl = fotoNova; dados.fotoGeradaPorIa = false; } // imagem própria: sem o selo de IA
    try {
      await escrever(req, modulo.id, 'o próprio módulo', async (tx) => {
        await tx.moduloEad.update({ where: { id: modulo.id }, data: dados });
        const f = await edb.marcarFinal(tx, modulo.id, final, ator(req));
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
    await transacao(async (tx) => {
      // Escola Digital (2026-11, P6): mudar a ordem não mexe no conteúdo; não volta nada para rascunho.
      await edb.mover(tx, 'moduloEad', m.id, req.params.direcao, 'cursoOnlineId', { final: false });
    });
    voltar(res, `/ead/curso/${m.cursoOnlineId}`, 'ok', 'Ordem salva.');
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
    await transacao(async (tx) => {
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
    if (req.body.depois === 'outra') return voltar(res, `/ead/topico/${topico.id}/telas/nova`, 'ok', `Tela "${tela.titulo}" criada. Escreva a próxima.`);
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

  // ─── Cenários (só no módulo final) ────────────────────────────────────────────────────────────
  function lerCenarioDoForm(body) {
    const r = ead.schemaCenario.safeParse({ titulo: body.titulo, cena: body.cena });
    if (!r.success) return { erro: ead.primeiroErro(r) };
    const dados = { ...r.data, videoUrl: null };
    if (String(body.videoUrl || '').trim()) {
      const v = ead.normalizarVideo(body.videoUrl);
      if (v.erro) return { erro: v.erro };
      dados.videoUrl = v.url;
    }
    const seg = ead.lerMmSs(body.tempoSugerido);
    if (seg === null || seg < 30 || seg > 3600) return { erro: 'Tempo sugerido: use minutos:segundos, de 0:30 a 60:00 (ex.: 4:00).' };
    dados.tempoSugeridoSeg = seg;
    return { dados };
  }
  const cenarioParaForm = (c) => ({ ...c, tempoSugerido: ead.mmSs(c.tempoSugeridoSeg) });

  async function moduloComCurso(id) {
    if (!edb.ehId(id)) return null;
    return prisma.moduloEad.findUnique({ where: { id }, include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } });
  }
  async function acharCenario(id) {
    if (!edb.ehId(id)) return null;
    return prisma.cenarioEad.findUnique({ where: { id }, include: { modulo: { include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } }, decisoes: { orderBy: edb.POR_ORDEM, include: { opcoes: { orderBy: { ordem: 'asc' } } } } } });
  }

  router.get('/ead/modulo/:id/cenarios/novo', async (req, res) => {
    const modulo = await moduloComCurso(req.params.id);
    if (!modulo) return naoAchou(res);
    if (!modulo.final) return voltar(res, urlModulo(modulo.id), 'erro', 'Cenários ficam só no módulo final.');
    res.render('admin/ead/cenario-form', { modulo, cenario: null, valores: { tempoSugerido: '4:00' }, erro: null, ok: null });
  });

  router.post('/ead/modulo/:id/cenarios/novo', uploadFoto, async (req, res) => {
    const modulo = await moduloComCurso(req.params.id);
    if (!modulo) return naoAchou(res);
    if (!modulo.final) return voltar(res, urlModulo(modulo.id), 'erro', 'Cenários ficam só no módulo final.');
    const { dados, erro } = lerCenarioDoForm(req.body);
    if (req.uploadErro || erro) return res.status(400).render('admin/ead/cenario-form', { modulo, cenario: null, valores: req.body, erro: req.uploadErro || erro, ok: null });
    dados.fotoUrl = req.file ? await salvarFotoCurso(req.file) : null;
    const c = await escrever(req, modulo.id, `novo cenário "${dados.titulo}"`, async (tx) =>
      tx.cenarioEad.create({ data: { ...dados, moduloId: modulo.id, ordem: await edb.proximaOrdem(tx, 'cenarioEad', 'moduloId', modulo.id) } }));
    await auditar(req, 'EAD_CRIOU_CENARIO', 'CenarioEad', c.id, { moduloId: modulo.id, titulo: c.titulo });
    voltar(res, `/ead/cenario/${c.id}/editar`, 'ok', 'Cenário criado. Agora as decisões.');
  });

  router.get('/ead/cenario/:id/editar', async (req, res) => {
    const c = await acharCenario(req.params.id);
    if (!c) return naoAchou(res);
    res.render('admin/ead/cenario-form', { modulo: c.modulo, cenario: c, valores: cenarioParaForm(c), erro: req.query.erro || null, ok: req.query.ok || null, decisaoValores: {} });
  });

  router.post('/ead/cenario/:id/editar', uploadFoto, async (req, res) => {
    const c = await acharCenario(req.params.id);
    if (!c) return naoAchou(res);
    const { dados, erro } = lerCenarioDoForm(req.body);
    if (req.uploadErro || erro) return res.status(400).render('admin/ead/cenario-form', { modulo: c.modulo, cenario: c, valores: { ...req.body, fotoUrl: c.fotoUrl }, erro: req.uploadErro || erro, ok: null, decisaoValores: {} });
    const fotoNova = req.file ? await salvarFotoCurso(req.file) : null;
    const tirar = req.body.removerFoto === 'on';
    if (fotoNova || tirar) dados.fotoUrl = fotoNova;
    await escrever(req, c.moduloId, `cenário "${dados.titulo}"`, (tx) => tx.cenarioEad.update({ where: { id: c.id }, data: dados }));
    if ((fotoNova || tirar) && c.fotoUrl) await removerFotoCurso(c.fotoUrl);
    voltar(res, `/ead/cenario/${c.id}/editar`, 'ok', 'Cenário salvo.');
  });

  router.post('/ead/cenario/:id/excluir', async (req, res) => {
    const c = await acharCenario(req.params.id);
    if (!c) return naoAchou(res);
    await escrever(req, c.moduloId, `cenário "${c.titulo}" apagado`, (tx) => tx.cenarioEad.delete({ where: { id: c.id } }));
    if (c.fotoUrl) await removerFotoCurso(c.fotoUrl);
    await auditar(req, 'EAD_EXCLUIU_CENARIO', 'CenarioEad', c.id, { moduloId: c.moduloId, titulo: c.titulo });
    voltar(res, urlModulo(c.moduloId), 'ok', `Cenário "${c.titulo}" apagado.`);
  });

  // ─── Decisões do cenário: pergunta + sempre 3 opções (texto, correta, fala do instrutor) ──────
  function lerDecisaoDoForm(body) {
    const op = body.op || {};
    const r = ead.schemaDecisao.safeParse({
      pergunta: body.pergunta,
      opcoes: [0, 1, 2].map((i) => ({ texto: (op[i] && op[i].texto) || '', feedback: (op[i] && op[i].feedback) || '', correta: String(body.correta) === String(i) })),
    });
    if (!r.success) {
      const caminho = r.error.issues[0].path;
      const onde = caminho[0] === 'opcoes' ? `Opção ${caminho[1] + 1}: ` : '';
      return { erro: onde + ead.primeiroErro(r) };
    }
    if (r.data.opcoes.filter((o) => o.correta).length !== 1) return { erro: 'Marque qual das 3 opções é a certa.' };
    return { pergunta: r.data.pergunta, opcoes: r.data.opcoes.map((o, ordem) => ({ ...o, ordem })) };
  }
  const decisaoParaForm = (d) => ({ pergunta: d.pergunta, correta: String(d.opcoes.findIndex((o) => o.correta)), op: d.opcoes.map((o) => ({ texto: o.texto, feedback: o.feedback })) });

  router.post('/ead/cenario/:id/decisoes', async (req, res) => {
    const c = await acharCenario(req.params.id);
    if (!c) return naoAchou(res);
    const d = lerDecisaoDoForm(req.body);
    if (d.erro) return res.status(400).render('admin/ead/cenario-form', { modulo: c.modulo, cenario: c, valores: cenarioParaForm(c), erro: d.erro, ok: null, decisaoValores: req.body });
    const nova = await escrever(req, c.moduloId, `nova decisão no cenário "${c.titulo}"`, async (tx) =>
      tx.decisaoCenario.create({ data: { cenarioId: c.id, pergunta: d.pergunta, ordem: await edb.proximaOrdem(tx, 'decisaoCenario', 'cenarioId', c.id), opcoes: { create: d.opcoes } } }));
    await auditar(req, 'EAD_CRIOU_DECISAO', 'DecisaoCenario', nova.id, { moduloId: c.moduloId, titulo: d.pergunta.slice(0, 80) });
    voltar(res, `/ead/cenario/${c.id}/editar`, 'ok', 'Decisão adicionada.');
  });

  async function acharDecisao(id) {
    if (!edb.ehId(id)) return null;
    return prisma.decisaoCenario.findUnique({ where: { id }, include: { opcoes: { orderBy: { ordem: 'asc' } }, cenario: { include: { modulo: { include: { cursoOnline: { include: { curso: { select: { nome: true } } } } } } } } } });
  }

  router.get('/ead/decisao/:id/editar', async (req, res) => {
    const d = await acharDecisao(req.params.id);
    if (!d) return naoAchou(res);
    res.render('admin/ead/decisao-form', { decisao: d, valores: decisaoParaForm(d), erro: null });
  });

  router.post('/ead/decisao/:id/editar', async (req, res) => {
    const d = await acharDecisao(req.params.id);
    if (!d) return naoAchou(res);
    const r = lerDecisaoDoForm(req.body);
    if (r.erro) return res.status(400).render('admin/ead/decisao-form', { decisao: d, valores: req.body, erro: r.erro });
    await escrever(req, d.cenario.moduloId, `decisão do cenário "${d.cenario.titulo}"`, async (tx) => {
      await tx.opcaoDecisao.deleteMany({ where: { decisaoId: d.id } });
      await tx.decisaoCenario.update({ where: { id: d.id }, data: { pergunta: r.pergunta, opcoes: { create: r.opcoes } } });
    });
    voltar(res, `/ead/cenario/${d.cenarioId}/editar`, 'ok', 'Decisão salva.');
  });

  router.post('/ead/decisao/:id/excluir', async (req, res) => {
    const d = await acharDecisao(req.params.id);
    if (!d) return naoAchou(res);
    await escrever(req, d.cenario.moduloId, `decisão apagada no cenário "${d.cenario.titulo}"`, (tx) => tx.decisaoCenario.delete({ where: { id: d.id } }));
    await auditar(req, 'EAD_EXCLUIU_DECISAO', 'DecisaoCenario', d.id, { moduloId: d.cenario.moduloId, titulo: d.pergunta.slice(0, 80) });
    voltar(res, `/ead/cenario/${d.cenarioId}/editar`, 'ok', 'Decisão apagada.');
  });

  return router;
};
