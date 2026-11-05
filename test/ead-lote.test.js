// Regras do lote (lib/ead-lote.js e lib/conta-aluno.js), contra o Postgres LOCAL. E-mails por espião.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const cpf = require('./helpers/cpf');

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('lote de escola', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const email = require('../src/lib/email');
  const conta = require('../src/lib/conta-aluno');
  const L = require('../src/lib/ead-lote');
  const { verificarSenha } = require('../src/lib/password');
  const { turmaOnline } = require('../src/lib/turma-online');
  const vagasEmail = []; const gestoresEmail = [];
  const sufixo = Date.now();
  let curso; let co; let lote; let lote2; let gestor; let turma; const criados = []; const escolas = [];
  const pessoa = (n) => ({ nome: `Pessoa ${n} Lote`, email: `p${n}-lote-${sufixo}@teste.local`, celular: '21999990000', cpf: cpf() });

  before(async () => {
    email.enviarVagaLiberada = async (para, nome, dados) => { vagasEmail.push({ para, ...dados }); };
    email.enviarGestorEscola = async (para, nome, dados) => { gestoresEmail.push({ para, ...dados }); };
    curso = await prisma.curso.create({ data: { nome: `TESTE lote ${sufixo}`, cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, precoOnline: 49.9 } });
    turma = await turmaOnline(co);
  });
  after(async () => {
    const lotes = await prisma.loteEad.findMany({ where: { cursoOnlineId: co.id }, select: { id: true, escolaId: true } });
    await prisma.logAuditoria.deleteMany({ where: { alvoId: { in: lotes.map((l) => l.id) } } });
    await prisma.vagaLoteEad.deleteMany({ where: { loteId: { in: lotes.map((l) => l.id) } } });
    await prisma.loteEad.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await prisma.escolaEad.deleteMany({ where: { id: { in: [...new Set([...lotes.map((l) => l.escolaId), ...escolas])] } } });
    await prisma.matricula.deleteMany({ where: { turmaId: turma.id } });
    await prisma.turma.delete({ where: { id: turma.id } });
    await prisma.usuario.deleteMany({ where: { email: { contains: `-lote-${sufixo}@` } } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  test('criarLote: escola nova, gestor novo com senha = 4 últimos do CPF, e-mail e convite', async () => {
    gestor = pessoa('gestor');
    const r = await L.criarLote({
      escola: { nome: `Escola Teste ${sufixo}`, cnpj: '' }, cursoOnlineId: co.id, vagas: 2,
      validoAte: new Date(Date.now() + 365 * 864e5), valor: 1500, forma: 'BOLETO', gestor, atorId: 'dev',
    });
    assert.equal(r.ok, true, r.erro); lote = r.lote; escolas.push(lote.escolaId);
    assert.ok(lote.convite && lote.convite.length >= 32);
    const u = await prisma.usuario.findFirst({ where: { email: gestor.email } });
    assert.equal(u.papel, 'ALUNO'); assert.ok(await verificarSenha(u.senhaHash, gestor.cpf.slice(-4)));
    assert.equal(await prisma.gestorEscolaEad.count({ where: { escolaId: lote.escolaId, usuarioId: u.id } }), 1);
    assert.equal(gestoresEmail.length, 1); assert.equal(gestoresEmail[0].senhaInicial, gestor.cpf.slice(-4));
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: lote.id, acao: 'EAD_LOTE_CRIOU' } }), 1);
  });

  test('contaParaPessoa: e-mail de uma conta com o CPF de outra ⇒ recusa', async () => {
    const outra = await conta.contaParaPessoa(pessoa('outra'));
    assert.equal(outra.ok, true, outra.erro); assert.equal(outra.nova, true);
    const r = await conta.contaParaPessoa({ nome: 'Mistura', email: gestor.email, celular: '', cpf: outra.usuario.cpfCnpj });
    assert.equal(r.ok, false); assert.match(r.erro, /contas diferentes/i);
  });

  test('[Review Focus] contaParaPessoa: acha por CPF formatado ou e-mail em caixa diferente; CPF inválido recusa', async () => {
    const u = await prisma.usuario.findFirst({ where: { email: gestor.email } });
    const c = gestor.cpf;
    const porCpf = await conta.contaParaPessoa({ nome: 'Qualquer', email: '', celular: '', cpf: `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` });
    assert.equal(porCpf.ok, true); assert.equal(porCpf.usuario.id, u.id); assert.equal(porCpf.nova, false);
    const porEmail = await conta.contaParaPessoa({ nome: 'Qualquer', email: ` ${gestor.email.toUpperCase()} `, celular: '', cpf: c });
    assert.equal(porEmail.usuario.id, u.id);
    assert.equal((await conta.contaParaPessoa({ nome: 'Fulano de Tal', email: `inv-lote-${sufixo}@teste.local`, celular: '', cpf: '111.111.111-11' })).ok, false);
  });

  test('cadastrarFuncionario: cria conta, manda e-mail; esgota; vencido; já tem acesso', async () => {
    const p1 = pessoa(1);
    const r1 = await L.cadastrarFuncionario(lote.id, p1, { origem: 'GESTOR', atorId: 'dev' });
    assert.equal(r1.ok, true, r1.erro); assert.equal(r1.nova, true);
    assert.equal(vagasEmail.at(-1).senhaInicial, p1.cpf.slice(-4)); assert.match(vagasEmail.at(-1).link, new RegExp(`/online/${curso.id}$`));
    // quem já comprou o curso não gasta vaga
    const comprou = await conta.contaParaPessoa(pessoa('comprou'));
    await prisma.matricula.create({ data: { alunoId: comprou.usuario.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 49.9, taxaConfirmada: true, statusPagamento: 'PAGO', confirmadaEm: new Date() } });
    assert.deepEqual(await L.cadastrarFuncionario(lote.id, { ...pessoa('comprou'), cpf: '' , email: comprou.usuario.email }, { origem: 'GESTOR', atorId: 'dev' }).then((r) => r.erro), 'ja_tem_acesso');
    const r2 = await L.cadastrarFuncionario(lote.id, pessoa(2), { origem: 'GESTOR', atorId: 'dev' });
    assert.equal(r2.ok, true);
    assert.equal((await L.cadastrarFuncionario(lote.id, pessoa(3), { origem: 'GESTOR', atorId: 'dev' })).erro, 'esgotado');
    // mesma pessoa de novo ⇒ já tem acesso
    assert.equal((await L.cadastrarFuncionario(lote.id, p1, { origem: 'GESTOR', atorId: 'dev' })).erro, 'ja_tem_acesso');
    assert.deepEqual(L.situacaoDoLote({ ...lote, vagasUsadas: await prisma.vagaLoteEad.findMany({ where: { loteId: lote.id } }) }), { usadas: 2, livres: 0, vencido: false, convite: true });
  });

  test('cadastros ao mesmo tempo com 1 vaga livre ⇒ só 1 entra; lote vencido recusa', async () => {
    const r = await L.criarLote({ escola: { id: lote.escolaId }, cursoOnlineId: co.id, vagas: 1, validoAte: new Date(Date.now() + 864e5), valor: 0, forma: 'OUTRO', gestor, atorId: 'dev' });
    assert.equal(r.ok, true, r.erro); lote2 = r.lote;
    const rs = await Promise.all([4, 5, 6].map((n) => L.cadastrarFuncionario(lote2.id, pessoa(n), { origem: 'CONVITE', atorId: 'x' })));
    assert.equal(rs.filter((x) => x.ok).length, 1);
    assert.equal(await prisma.vagaLoteEad.count({ where: { loteId: lote2.id, removidaEm: null } }), 1);
    await L.alterarLote(lote2.id, { validoAte: new Date(Date.now() - 864e5) }, 'dev');
    assert.equal((await L.cadastrarFuncionario(lote2.id, pessoa(7), { origem: 'GESTOR', atorId: 'dev' })).erro, 'vencido');
  });

  test('[Review Focus] o gestor pode ocupar uma vaga do próprio lote', async () => {
    const r = await L.criarLote({ escola: { id: lote.escolaId }, cursoOnlineId: co.id, vagas: 3, validoAte: new Date(Date.now() + 30 * 864e5), valor: 10, forma: 'PIX', gestor, atorId: 'dev' });
    const v = await L.cadastrarFuncionario(r.lote.id, gestor, { origem: 'GESTOR', atorId: 'dev' });
    assert.equal(v.ok, true, v.erro); assert.equal(v.nova, false);
    // libera para os próximos testes: tira o gestor (não começou)
    assert.deepEqual(await L.removerVaga(v.vaga.id, 'dev'), { ok: true });
  });

  test('removerVaga: sem progresso volta a vaga; com progresso recusa', async () => {
    const [va, vb] = await prisma.vagaLoteEad.findMany({ where: { loteId: lote.id, removidaEm: null }, orderBy: { criadoEm: 'asc' } });
    const m = await prisma.moduloEad.create({ data: { cursoOnlineId: co.id, titulo: 'M' } });
    const t = await prisma.topicoEad.create({ data: { moduloId: m.id, titulo: 'T', telas: { create: [{ titulo: 'x' }] } }, include: { telas: true } });
    const ac = await prisma.alunoCursoEad.create({ data: { usuarioId: vb.usuarioId, cursoOnlineId: co.id } });
    await prisma.telaVistaEad.create({ data: { alunoCursoId: ac.id, telaId: t.telas[0].id } });
    assert.deepEqual(await L.removerVaga(vb.id, 'dev'), { ok: false, erro: 'comecou' });
    assert.deepEqual(await L.removerVaga(va.id, 'dev'), { ok: true });
    assert.equal((await prisma.vagaLoteEad.findUnique({ where: { id: va.id } })).removidaEm instanceof Date, true);
    const p8 = await L.cadastrarFuncionario(lote.id, pessoa(8), { origem: 'GESTOR', atorId: 'dev' });
    assert.equal(p8.ok, true); // a vaga voltou
    const lista = await L.funcionariosDoLote(lote.id);
    const b = lista.find((x) => x.vaga.id === vb.id);
    assert.equal(b.comecou, true); assert.equal(typeof b.percentual, 'number');
    assert.ok(lista.some((x) => x.vaga.removidaEm));
  });

  test('convite: entrar, trocar (antigo deixa de valer), desligar', async () => {
    await L.alterarLote(lote.id, { vagas: 5 }, 'dev');
    const u = (await conta.contaParaPessoa(pessoa(9))).usuario;
    const r = await L.entrarPorConvite(lote.convite, u.id);
    assert.equal(r.ok, true, r.erro);
    assert.equal((await prisma.vagaLoteEad.findFirst({ where: { usuarioId: u.id } })).origem, 'CONVITE');
    const antigo = lote.convite;
    await L.trocarConvite(lote.id, 'dev');
    const u2 = (await conta.contaParaPessoa(pessoa(10))).usuario;
    assert.equal((await L.entrarPorConvite(antigo, u2.id)).erro, 'convite');
    const novo = (await prisma.loteEad.findUnique({ where: { id: lote.id } })).convite;
    await L.desligarConvite(lote.id, 'dev');
    assert.equal((await L.entrarPorConvite(novo, u2.id)).erro, 'convite');
    assert.equal(await L.loteDoConvite(novo), null);
  });

  test('alterarLote abaixo das usadas recusa; apagarLote com vaga recusa; escolasDoGestor', async () => {
    assert.deepEqual(await L.alterarLote(lote.id, { vagas: 1 }, 'dev'), { ok: false, erro: 'vagas' });
    assert.equal((await L.apagarLote(lote.id, 'dev')).ok, false);
    const gu = await prisma.usuario.findFirst({ where: { email: gestor.email } });
    const escs = await L.escolasDoGestor(gu.id);
    assert.equal(escs.length, 1); assert.ok(escs[0].lotes.length >= 3);
    const outro = (await conta.contaParaPessoa(pessoa(11))).usuario;
    assert.deepEqual(await L.escolasDoGestor(outro.id), []);
  });

  test('lotesRecebidos por data e lotesAReceber', async () => {
    await L.alterarLote(lote.id, { recebidoEm: new Date('2026-10-15T15:00:00Z') }, 'dev');
    const out = await L.lotesRecebidos({ de: new Date('2026-10-01T00:00:00Z'), ate: new Date('2026-11-01T00:00:00Z') });
    assert.ok(out.some((x) => x.lote.id === lote.id && x.valor === 1500));
    assert.ok(!(await L.lotesRecebidos({ de: new Date('2026-11-01T00:00:00Z') })).some((x) => x.lote.id === lote.id));
    const ar = await L.lotesAReceber();
    assert.ok(!ar.some((x) => x.lote.id === lote.id)); // recebido
    assert.ok(!ar.some((x) => x.lote.id === lote2.id)); // valor 0
  });
});
