// Ajudantes dos testes do painel do EAD (Escola Digital, 2026-11): o roteador do EAD com requireDev liberado,
// e a limpeza de cursos online criados pelo teste (com módulos, tópicos, cenários e o Curso).
const path = require('path');
const express = require('express');

function montarPainel(quem, { requireDev = (req, res, next) => next() } = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', '..', 'src', 'views'));
  app.locals.asset = require('../../src/lib/assets').asset;
  app.locals.montarMenu = require('../../src/lib/menu-painel').montarMenu;
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => { req.session = { usuarioId: quem }; Object.assign(res.locals, { csrfToken: 'x', admPapel: 'DEV', pode: () => true, usuario: { nome: 'Dev', papel: 'DEV', id: quem } }); next(); });
  app.use(require('../../src/routes/ead')({ requireDev, auditar: async () => {}, ADMIN_URL: '' }));
  return app;
}

async function ouvir(app) {
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function apagarCursosOnline(prisma, coIds) {
  const cos = await prisma.cursoOnline.findMany({ where: { id: { in: coIds } }, select: { id: true, cursoId: true } });
  const ids = cos.map((c) => c.id);
  const mods = await prisma.moduloEad.findMany({ where: { cursoOnlineId: { in: ids } }, select: { id: true } });
  const mIds = mods.map((m) => m.id);
  await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: [...ids, ...mIds] } } });
  await prisma.cenarioEad.deleteMany({ where: { moduloId: { in: mIds } } });
  await prisma.topicoEad.deleteMany({ where: { moduloId: { in: mIds } } });
  await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: { in: ids } } });
  await prisma.cupomEad.deleteMany({ where: { cursoOnlineId: { in: ids } } }).catch(() => {});
  await prisma.cursoOnline.deleteMany({ where: { id: { in: ids } } });
  await prisma.curso.deleteMany({ where: { id: { in: cos.map((c) => c.cursoId) } } });
}

module.exports = { montarPainel, ouvir, apagarCursosOnline };
