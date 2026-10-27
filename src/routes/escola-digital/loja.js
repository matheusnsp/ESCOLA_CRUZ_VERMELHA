// routes/escola-digital/loja.js
//
// Vitrine (/digital) e página do curso (/digital/cursos/:slug) da Escola Digital. Montado em
// routes/escola-digital/index.js depois da chave de liga/desliga, então só responde ligada.
//
// O curso é achado pelo nome: o :slug é o slugCurso(nome) de lib/vitrine.js, como no catálogo
// do site. Aqui só se lê o banco (a situação "expirada" é calculada na hora, sem gravar).

const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../../db');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../lib/escola-digital/config');
const regras = require('../../lib/escola-digital/regras');
const { slugCurso, reais } = require('../../lib/vitrine');
const { matricular } = require('../../lib/escola-digital/inscricao');
const { POLITICA_VERSAO } = require('../../lib/cadastro-aluno');

const router = express.Router();

// Texto que marca o conteúdo de exemplo (curso.json) e a ressalva fixa da prática.
const MARCA_ILUSTRATIVO = /\s*\(conteúdo ilustrativo, não validado\)/gi;
const AVISO_PRATICA = 'Curso teórico: ensina a reconhecer e decidir. Não inclui treino prático em manequim.';

// Valor em reais com espaço comum (o Intl usa espaço sem quebra, ruim para busca e teste).
const preco = (valor) => reais(valor).replace(/ /g, ' ');

// Cursos online ativos com os módulos na ordem.
function cursosOnline() {
  return prisma.curso.findMany({
    where: { modalidade: 'ONLINE', ativo: true },
    include: { modulosOnline: { orderBy: { ordem: 'asc' } } },
    orderBy: { nome: 'asc' },
  });
}

// Curso online ativo pelo :slug (o mesmo critério da página do curso).
async function cursoPeloSlug(slug) {
  return (await cursosOnline()).find((c) => slugCurso(c.nome) === slug);
}

const minutosDoCurso = (curso) => curso.modulosOnline.reduce((s, m) => s + (m.minutos || 0), 0);

// "365 dias" → "1 ano"; "180 dias" → "180 dias".
function prazoTexto(dias) {
  if (!dias) return null;
  if (dias % 365 === 0) return dias === 365 ? '1 ano' : `${dias / 365} anos`;
  return `${dias} dias`;
}

// Locais comuns de todas as telas da Escola Digital (topo, abas, endereço para voltar do login).
router.use('/digital', (req, res, next) => {
  res.locals.NOME = config.NOME;
  res.locals.NOME_CURTO = config.NOME_CURTO;
  res.locals.edCaminho = req.originalUrl;
  next();
});

// Entrar e voltar para a página em que a pessoa estava. O login do site guarda o destino na
// sessão (req.session.returnTo, ver middleware/auth.js), então guardamos aqui e seguimos para
// /login. Só aceita caminho interno da própria Escola Digital (barra open redirect).
router.get('/digital/entrar', (req, res) => {
  const voltar = String(req.query.voltar || '');
  let valido = /^\/digital(\/|\?|#|$)/.test(voltar) && !voltar.startsWith('//') && !/[\r\n\\]/.test(voltar);
  if (valido) {
    // O caminho já normalizado (sem "..", %2e%2e etc.) também precisa ficar dentro de /digital.
    try { valido = /^\/digital(\/|$)/.test(new URL(voltar, 'http://x').pathname); } catch (e) { valido = false; }
  }
  if (req.session && valido) req.session.returnTo = voltar;
  res.redirect('/login');
});

router.get('/digital', asyncHandler(async (req, res) => {
  const cursos = (await cursosOnline()).map((c) => ({
    nome: c.nome,
    descricao: c.descricao,
    slug: slugCurso(c.nome),
    minutos: minutosDoCurso(c) || c.cargaHoraria * 60,
    modulos: c.modulosOnline.length,
    precoAvista: preco(c.precoAvista),
    parcelas: c.parcelas,
    valorParcela: preco(c.valorParcela),
  }));
  res.render('digital/vitrine', {
    titulo: config.NOME,
    descricao: 'Primeiros socorros no seu ritmo, pelo celular, com certificado de conclusão.',
    rastrear: true,
    aba: 'inicio',
    cursos,
  });
}));

function cursoNaoEncontrado(res) {
  return res.status(404).render('digital/erro', {
    titulo: 'Curso não encontrado',
    mensagem: 'Não encontramos este curso. Veja os cursos disponíveis na Escola Digital.',
    aba: 'cursos',
  });
}

// Qual botão a página mostra, conforme a inscrição da pessoa logada neste curso.
function estadoDoBotao(inscricao) {
  if (!inscricao) return 'matricular';
  switch (regras.situacaoAtual(inscricao)) {
    case 'AGUARDANDO_PAGAMENTO': return 'pagar';
    case 'ATIVA': return 'continuar';
    case 'CONCLUIDA': return 'certificado';
    default: return 'encerrado'; // EXPIRADA, CANCELADA
  }
}

router.get('/digital/cursos/:slug', asyncHandler(async (req, res) => {
  const curso = await cursoPeloSlug(req.params.slug);
  if (!curso) return cursoNaoEncontrado(res);

  let inscricao = null;
  if (res.locals.usuario && res.locals.usuario.papel === 'ALUNO') {
    inscricao = await prisma.inscricaoOnline.findUnique({
      where: { alunoId_cursoId: { alunoId: res.locals.usuario.id, cursoId: curso.id } },
    });
  }
  const estadoBotao = estadoDoBotao(inscricao);

  // Descrição longa em parágrafos, sem a marca de exemplo (vira o selo) e sem a ressalva, que
  // aparece em destaque no aviso.
  const marcado = /conteúdo ilustrativo/i.test(`${curso.descricao || ''} ${curso.descricaoLonga || ''}`);
  const paragrafos = String(curso.descricaoLonga || '').replace(MARCA_ILUSTRATIVO, '')
    .split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && !p.startsWith('Curso teórico:'));

  const base = `/digital/cursos/${slugCurso(curso.nome)}`;
  res.render('digital/curso', {
    titulo: `${curso.nome} | ${config.NOME}`,
    descricao: String(curso.descricao || '').replace(MARCA_ILUSTRATIVO, ''),
    rastrear: true,
    aba: 'cursos',
    curso: {
      nome: curso.nome,
      descricao: String(curso.descricao || '').replace(MARCA_ILUSTRATIVO, ''),
      paragrafos,
      cargaHoraria: curso.cargaHoraria,
      minutos: minutosDoCurso(curso),
      modulos: curso.modulosOnline,
      precoAvista: preco(curso.precoAvista),
      parcelas: curso.parcelas,
      valorParcela: preco(curso.valorParcela),
      prazoAcesso: prazoTexto(curso.prazoAcessoDias),
      validadeMeses: curso.validadeCertificadoMeses,
    },
    ilustrativo: marcado,
    avisoPratica: AVISO_PRATICA,
    estadoBotao,
    linkBotao: {
      matricular: `${base}/matricula`,
      pagar: inscricao && `/digital/pagamento/${inscricao.id}`,
      continuar: inscricao && `/digital/estudo/${inscricao.id}/continuar`,
      certificado: inscricao && `/digital/estudo/${inscricao.id}`,
    }[estadoBotao] || null,
  });
}));

// ---------- Matrícula rápida (spec §5.2) ----------

// Mesmo limite do cadastro do site (10 tentativas por IP em 15 minutos), só nos POSTs.
const matriculaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('digital/erro', {
    titulo: 'Muitas tentativas',
    mensagem: 'Foram muitas tentativas de matrícula deste endereço. Aguarde alguns minutos e tente de novo.',
    aba: 'cursos',
  }),
});

const MSG_SO_ALUNO = 'Para se matricular, entre com uma conta de aluno.';

// Para onde a inscrição existente leva: pagamento, estudo, ou nenhum lugar (encerrada).
function destinoDaInscricao(inscricao) {
  switch (regras.situacaoAtual(inscricao)) {
    case 'AGUARDANDO_PAGAMENTO': return `/digital/pagamento/${inscricao.id}`;
    case 'ATIVA':
    case 'CONCLUIDA': return `/digital/estudo/${inscricao.id}`;
    default: return null; // EXPIRADA, CANCELADA: reinscrição é com a secretaria
  }
}

// Desenha a página da matrícula. `modo`: 'novo' (formulário), 'aluno' (confirmação de quem já
// está logado), 'outro-papel' (logado sem ser aluno) ou 'encerrada'.
function telaMatricula(res, status, curso, modo, extra = {}) {
  return res.status(status).render('digital/matricula', {
    titulo: `Matrícula | ${curso.nome} | ${config.NOME}`,
    rastrear: false,
    aba: 'cursos',
    modo,
    slug: slugCurso(curso.nome),
    curso: { nome: curso.nome, precoAvista: preco(curso.precoAvista), parcelas: curso.parcelas, valorParcela: preco(curso.valorParcela) },
    erros: [], campos: {}, valores: {}, aluno: null, precisaAceite: false, aceitou: false,
    msgSoAluno: MSG_SO_ALUNO,
    ...extra,
  });
}

// Quem está logado e é aluno (com o nome e o consentimento do banco); null se não há sessão de aluno.
async function alunoDaSessao(req) {
  if (!req.session || !req.session.usuarioId) return null;
  return prisma.usuario.findUnique({
    where: { id: req.session.usuarioId },
    select: { id: true, nome: true, papel: true, consentimentoVersao: true },
  });
}

router.get('/digital/cursos/:slug/matricula', asyncHandler(async (req, res) => {
  const curso = await cursoPeloSlug(req.params.slug);
  if (!curso) return cursoNaoEncontrado(res);

  const logado = await alunoDaSessao(req);
  if (!logado) return telaMatricula(res, 200, curso, 'novo');
  if (logado.papel !== 'ALUNO') return telaMatricula(res, 200, curso, 'outro-papel');

  const inscricao = await prisma.inscricaoOnline.findUnique({
    where: { alunoId_cursoId: { alunoId: logado.id, cursoId: curso.id } },
  });
  if (inscricao) {
    const destino = destinoDaInscricao(inscricao);
    return destino ? res.redirect(destino) : telaMatricula(res, 200, curso, 'encerrada');
  }
  return telaMatricula(res, 200, curso, 'aluno', {
    aluno: { nome: logado.nome },
    precisaAceite: logado.consentimentoVersao !== POLITICA_VERSAO,
  });
}));

router.post('/digital/cursos/:slug/matricula', matriculaLimiter, asyncHandler(async (req, res) => {
  const curso = await cursoPeloSlug(req.params.slug);
  if (!curso) return cursoNaoEncontrado(res);

  const logado = await alunoDaSessao(req);
  if (logado && logado.papel !== 'ALUNO') return telaMatricula(res, 200, curso, 'outro-papel');

  const r = await matricular({
    cursoId: curso.id,
    usuarioLogadoId: logado ? logado.id : undefined,
    dados: req.body,
  });

  if (!r.ok && r.motivo === 'precisa_login') {
    // Não cria nada nem diz mais nada sobre a conta: manda entrar e volta para esta matrícula.
    req.session.returnTo = `/digital/cursos/${slugCurso(curso.nome)}/matricula`;
    return req.session.save(() => res.redirect('/login'));
  }

  if (!r.ok) {
    const b = req.body || {};
    return telaMatricula(res, 400, curso, logado ? 'aluno' : 'novo', {
      erros: r.erros, campos: r.campos,
      valores: { nome: String(b.nome || ''), cpf: String(b.cpf || ''), celular: String(b.celular || ''), email: String(b.email || '') },
      aceitou: b.aceite === 'on',
      aluno: logado ? { nome: logado.nome } : null,
      precisaAceite: !!logado && logado.consentimentoVersao !== POLITICA_VERSAO,
    });
  }

  const destino = destinoDaInscricao(r.inscricao);
  if (!destino) return telaMatricula(res, 200, curso, 'encerrada');
  if (!r.contaNova) return res.redirect(destino);

  // Conta nova: já fica logada, com a sessão renovada (evita session fixation) e as mesmas
  // chaves que o login e o /cadastro gravam. A troca da senha inicial e o complemento dos dados
  // seguem o mecanismo de hoje (precisaTrocarSenha e /completar-dados em Minha conta).
  const aluno = await prisma.usuario.findUnique({ where: { id: r.inscricao.alunoId }, select: { id: true, papel: true, nome: true } });
  return req.session.regenerate((err) => {
    if (err) { console.error('Erro ao iniciar sessão na matrícula:', err); return res.redirect('/login'); }
    req.session.usuarioId = aluno.id;
    req.session.papel = aluno.papel;
    req.session.nome = aluno.nome;
    req.session.save((err2) => {
      if (err2) { console.error('Erro ao salvar sessão na matrícula:', err2); return res.redirect('/login'); }
      return res.redirect(destino);
    });
  });
}));

module.exports = router;
