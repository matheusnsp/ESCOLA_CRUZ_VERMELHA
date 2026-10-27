// routes/escola-digital/loja.js
//
// Vitrine (/digital) e página do curso (/digital/cursos/:slug) da Escola Digital. Montado em
// routes/escola-digital/index.js depois da chave de liga/desliga, então só responde ligada.
//
// O curso é achado pelo nome: o :slug é o slugCurso(nome) de lib/vitrine.js, como no catálogo
// do site. Aqui só se lê o banco (a situação "expirada" é calculada na hora, sem gravar).

const express = require('express');
const prisma = require('../../db');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../lib/escola-digital/config');
const regras = require('../../lib/escola-digital/regras');
const { slugCurso, reais } = require('../../lib/vitrine');

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
  const valido = /^\/digital(\/|\?|#|$)/.test(voltar) && !voltar.startsWith('//') && !/[\r\n\\]/.test(voltar);
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
  const curso = (await cursosOnline()).find((c) => slugCurso(c.nome) === req.params.slug);
  if (!curso) {
    return res.status(404).render('digital/erro', {
      titulo: 'Curso não encontrado',
      mensagem: 'Não encontramos este curso. Veja os cursos disponíveis na Escola Digital.',
      aba: 'cursos',
    });
  }

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

module.exports = router;
