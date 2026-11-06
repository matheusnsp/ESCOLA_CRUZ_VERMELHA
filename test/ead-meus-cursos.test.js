// Minha conta → aba "Cursos online" (etapa 7). Postgres LOCAL; a sessão vem do cabeçalho x-teste-usuario.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { urlOnline } = require('../src/lib/vitrine');
const path = require('path');
const express = require('express');
const session = require('express-session');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

describe('Cursos online na Minha conta', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const { meusCursosOnline } = require('../src/lib/ead-meus-cursos');
  const s = String(Date.now()).slice(-7);
  const cursos = {}; let aluno; let semOnline; let escola; let lote; let server; let site; let cupom;

  const novoCurso = async (chave, nome) => {
    const curso = await prisma.curso.create({ data: { nome: `${nome} ${s}`, cargaHoraria: 2, precoAvista: 0, precoCheio: 0, valorParcela: 0, ativo: false } });
    const co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 50, publicado: true } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M1', ordem: 0, status: 'VALIDADO' } });
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T1', telas: { create: [{ titulo: 'tela 1' }, { titulo: 'tela 2' }] } }, include: { telas: true } });
    const turma = await prisma.turma.create({ data: { cursoId: curso.id, status: 'ONLINE', vagas: 0 } });
    cursos[chave] = { curso, co, turma, telas: t.telas };
    return cursos[chave];
  };
  const matricula = (c, status, extra = {}) => prisma.matricula.create({ data: { alunoId: aluno.id, turmaId: c.turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 50, valorTaxaMatricula: 0, statusPagamento: status, taxaConfirmada: status === 'PAGO', confirmadaEm: status === 'PAGO' ? new Date(Date.now() - 864e5) : null, ...extra } });

  before(async () => {
    aluno = await prisma.usuario.create({ data: { nome: 'Rita Meus Cursos', email: `rita-mc-${s}@teste.local`, papel: 'ALUNO' } });
    semOnline = await prisma.usuario.create({ data: { nome: 'Sem Online', email: `sem-mc-${s}@teste.local`, papel: 'ALUNO' } });
    const andamento = await novoCurso('andamento', 'Online Andamento');
    const cortesia = await novoCurso('cortesia', 'Online Cortesia');
    const escolaC = await novoCurso('escola', 'Online Escola');
    const concluido = await novoCurso('concluido', 'Online Concluido');
    const pendente = await novoCurso('pendente', 'Online Pendente');

    await matricula(andamento, 'PAGO');
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: aluno.id, cursoOnlineId: andamento.co.id } });
    await prisma.telaVistaEad.create({ data: { alunoCursoId: ac.id, telaId: andamento.telas[0].id } });

    cupom = await prisma.cupomEad.create({ data: { codigo: `MC${s}`, tipo: 'PERCENTUAL', valor: 100, criadoPor: 'dev' } });
    const mc = await matricula(cortesia, 'PAGO', { valorCurso: 0 });
    await prisma.cupomMatriculaEad.create({ data: { matriculaId: mc.id, cupomId: cupom.id, precoCheio: 50, desconto: 50, precoFinal: 0 } });

    escola = await prisma.escolaEad.create({ data: { nome: `Escola MC ${s}` } });
    lote = await prisma.loteEad.create({ data: { escolaId: escola.id, cursoOnlineId: escolaC.co.id, vagas: 5, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'OUTRO', criadoPor: 'dev' } });
    await prisma.vagaLoteEad.create({ data: { loteId: lote.id, usuarioId: aluno.id, origem: 'GESTOR' } });
    const loteA = await prisma.loteEad.create({ data: { escolaId: escola.id, cursoOnlineId: andamento.co.id, vagas: 5, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'OUTRO', criadoPor: 'dev' } });
    await prisma.vagaLoteEad.create({ data: { loteId: loteA.id, usuarioId: aluno.id, origem: 'GESTOR' } }); // comprado + vaga ⇒ 1 item, "comprado"

    await matricula(concluido, 'PAGO');
    await prisma.alunoCursoEad.create({ data: { usuarioId: aluno.id, cursoOnlineId: concluido.co.id, concluidoEm: new Date() } });

    const mp = await matricula(pendente, 'PENDENTE', { taxaConfirmada: false });
    await prisma.pagamento.create({ data: { matriculaId: mp.id, tipo: 'CURSO', gateway: 'unicopag', metodo: 'PIX', valor: 50, status: 'PENDENTE' } });

    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    app.locals.asset = require('../src/lib/assets').asset;
    app.locals.urlCurso = require('../src/lib/vitrine').urlCurso;
    app.use(express.urlencoded({ extended: true }));
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      const id = req.get('x-teste-usuario');
      if (id) { req.session.usuarioId = id; req.session.papel = 'ALUNO'; }
      res.locals.csrfToken = 'x';
      next();
    });
    app.use(require('../src/routes/painel'));
    await new Promise((r) => { server = app.listen(0, r); });
    site = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    const ids = Object.values(cursos);
    await prisma.vagaLoteEad.deleteMany({ where: { usuarioId: aluno.id } });
    await prisma.loteEad.deleteMany({ where: { escolaId: escola.id } });
    await prisma.escolaEad.delete({ where: { id: escola.id } });
    await prisma.cupomMatriculaEad.deleteMany({ where: { cupomId: cupom.id } });
    await prisma.cupomEad.delete({ where: { id: cupom.id } });
    const ms = await prisma.matricula.findMany({ where: { alunoId: aluno.id }, select: { id: true } });
    await prisma.pagamento.deleteMany({ where: { matriculaId: { in: ms.map((m) => m.id) } } });
    await prisma.matricula.deleteMany({ where: { alunoId: aluno.id } });
    await prisma.alunoCursoEad.deleteMany({ where: { usuarioId: aluno.id } });
    for (const c of ids) {
      await prisma.turma.delete({ where: { id: c.turma.id } });
      await prisma.topicoEad.deleteMany({ where: { modulo: { cursoOnlineId: c.co.id } } });
      await prisma.moduloEad.deleteMany({ where: { cursoOnlineId: c.co.id } });
      await prisma.cursoOnline.delete({ where: { id: c.co.id } });
      await prisma.curso.delete({ where: { id: c.curso.id } });
    }
    await prisma.usuario.deleteMany({ where: { id: { in: [aluno.id, semOnline.id] } } });
    await prisma.$disconnect();
  });

  const pagina = async (u, q = '') => (await fetch(`${site}/minha-conta${q}`, { headers: { 'x-teste-usuario': u.id } })).text();

  test('meusCursosOnline: um item por curso, origem e situação certas, na ordem', async () => {
    const l = await meusCursosOnline(aluno.id);
    const meus = l.filter((x) => x.curso.endsWith(s));
    assert.deepEqual(meus.map((x) => x.cursoId).length, 5);
    const de = (k) => meus.find((x) => x.cursoId === cursos[k].curso.id);
    assert.deepEqual([de('andamento').origem, de('andamento').situacao], ['comprado', 'andamento']);
    assert.equal(de('andamento').percentual, 0); // a % conta módulos concluídos, como a capa do curso
    assert.ok(de('andamento').ultimoAcesso);
    assert.equal(de('andamento').link, `${urlOnline(cursos.andamento.curso)}/continuar`);
    assert.deepEqual([de('cortesia').origem, de('cortesia').situacao], ['cortesia', 'novo']);
    assert.deepEqual([de('escola').origem, de('escola').situacao, de('escola').escola], ['escola', 'novo', `Escola MC ${s}`]);
    assert.deepEqual([de('concluido').origem, de('concluido').situacao], ['comprado', 'concluido']);
    assert.ok(de('concluido').concluidoEm);
    assert.deepEqual([de('pendente').situacao, de('pendente').link], ['pendente', `${urlOnline(cursos.pendente.curso)}`]);
    const ordem = meus.map((x) => x.situacao);
    assert.deepEqual(ordem, ['andamento', 'novo', 'novo', 'concluido', 'pendente']);
  });

  test('aba Cursos online: continuar, certificado, cartão, pendente, escola e cortesia', async () => {
    const html = await pagina(aluno, '?sec=online');
    assert.match(html, /href="\/minha-conta\?sec=online" class="ativo"/);
    assert.match(html, new RegExp(`href="${urlOnline(cursos.andamento.curso)}/continuar"[^>]*>[^<]*Continuar`));
    assert.match(html, new RegExp(`href="${urlOnline(cursos.concluido.curso)}/certificado"`));
    assert.match(html, new RegExp(`href="${urlOnline(cursos.concluido.curso)}/cartao-de-bolso.pdf"`));
    assert.match(html, /Cartão de bolso \(PDF\)/);
    assert.match(html, /Pagamento pendente/);
    assert.match(html, new RegExp(`Liberado pela Escola MC ${s}`));
    assert.match(html, /Cortesia \(cupom\)/);
    assert.match(html, />\s*Começar/);
  });

  test('inscrições: sem o curso online; link para a aba nova', async () => {
    const html = await pagina(aluno);
    assert.doesNotMatch(html, new RegExp(`Online Andamento ${s}`));
    assert.doesNotMatch(html, new RegExp(`Online Escola ${s}`));
    assert.match(html, /href="\/minha-conta\?sec=online"/);
  });

  test('quem não tem curso online não vê o item no menu', async () => {
    const html = await pagina(semOnline);
    assert.doesNotMatch(html, /sec=online/);
  });
});
