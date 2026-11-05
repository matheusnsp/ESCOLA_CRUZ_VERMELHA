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
const edb = require('../lib/ead-db');

const router = express.Router();

router.use('/ead-teste', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  // O padrão do site (same-origin) faz o YouTube recusar o player; assim ele recebe só o domínio,
  // nunca o caminho com o código.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const naoAchou = (res) => res.status(404).render('erro', { mensagem: 'Página não encontrada.' });

// Curso inteiro na ordem do aluno (módulos comuns por ordem, o final por último), com tópicos e telas.
async function carregarCurso(cursoOnlineId) {
  const co = await prisma.cursoOnline.findUnique({
    where: { id: cursoOnlineId },
    include: {
      curso: { select: { nome: true, descricao: true, imagemUrl: true } },
      modulos: {
        orderBy: edb.POR_ORDEM,
        include: {
          topicos: { orderBy: edb.POR_ORDEM, include: { telas: { orderBy: edb.POR_ORDEM } } },
          cenarios: { orderBy: edb.POR_ORDEM, select: { id: true, titulo: true, tempoSugeridoSeg: true } },
        },
      },
    },
  });
  if (!co) return null;
  co.modulos = [...co.modulos.filter((m) => !m.final), ...co.modulos.filter((m) => m.final)];
  return co;
}

// Resolve o código; sem código válido, 404 igual a qualquer página que não existe.
const comCurso = (fn) => asyncHandler(async (req, res) => {
  const coId = await eadTeste.cursoDoCodigo(req.params.codigo);
  const co = coId ? await carregarCurso(coId) : null;
  if (!co) return naoAchou(res);
  const base = `/ead-teste/${req.params.codigo}`;
  return fn(req, res, co, base);
});

router.get('/ead-teste/:codigo', comCurso(async (req, res, co, base) => {
  res.render('ead-teste/capa', { co, base });
}));

router.get('/ead-teste/:codigo/modulo/:moduloId', comCurso(async (req, res, co, base) => {
  const i = co.modulos.findIndex((m) => m.id === req.params.moduloId);
  if (i < 0) return naoAchou(res);
  const modulo = co.modulos[i];
  const primeira = modulo.topicos.flatMap((t) => t.telas)[0] || null;
  const proximo = co.modulos[i + 1] || null;
  res.render('ead-teste/modulo', { co, base, modulo, numero: i + 1, primeira, proximo });
}));

router.get('/ead-teste/:codigo/tela/:telaId', comCurso(async (req, res, co, base) => {
  const i = co.modulos.findIndex((m) => m.topicos.some((t) => t.telas.some((x) => x.id === req.params.telaId)));
  if (i < 0) return naoAchou(res);
  const modulo = { ...co.modulos[i], cursoOnline: { curso: co.curso } };
  const ctx = eadTeste.contextoDaTela(modulo, i + 1, req.params.telaId, (id) => `${base}/tela/${id}`);
  // Na última tela do módulo, "Continuar" leva à introdução do próximo módulo (ou de volta à capa).
  let fimUrl = null; let fimTitulo = null;
  if (!ctx.proxima) {
    const p = eadTeste.proximaTela(co.modulos, req.params.telaId);
    if (p && p.tipo === 'modulo') { fimUrl = `${base}/modulo/${p.id}`; fimTitulo = `Módulo ${i + 2}: ${co.modulos[i + 1].titulo}`; }
    else { fimUrl = base; fimTitulo = 'Fim do curso — voltar ao menu'; }
  }
  res.render('ead-teste/tela', { ...ctx, base, fimUrl, fimTitulo, menuUrl: base });
}));

module.exports = router;
