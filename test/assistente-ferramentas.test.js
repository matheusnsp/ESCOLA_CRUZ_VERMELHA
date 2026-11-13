// 2026-11-13: assistente da secretaria — ferramentas de consulta (spec §2). Só leitura; permissão da rota de cada tela.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/lib/assistente-ferramentas');

const pode = (...perms) => (p) => perms.includes(p);
const doc = (u) => (u && u.cpfCnpj ? { tipo: 'CPF', numero: String(u.cpfCnpj).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') } : null);
const ctx = (p, extra = {}) => ({ pode: p, vistos: { alunos: new Set(), turmas: new Set() }, documentoAluno: doc, ...extra });

test('definições: só leitura, schema estrito', () => {
  const nomes = f.DEFINICOES_CONSULTA.map((d) => d.name);
  assert.deepEqual(nomes, ['buscar_alunos', 'ver_aluno', 'listar_pendentes', 'listar_turmas', 'listar_cursos']);
  for (const d of f.DEFINICOES_CONSULTA) {
    assert.equal(d.strict, true, d.name);
    assert.equal(d.input_schema.additionalProperties, false, d.name);
  }
});

test('pontuarNome: acentos, ordem e erro de digitação', () => {
  assert.ok(f.pontuarNome('joao', 'João') >= 0.95);
  assert.ok(f.pontuarNome('silva maria', 'Maria Silva Souza') >= 0.85);
  assert.ok(f.pontuarNome('Mariana Sousa', 'Mariane Souza') >= 0.6);
  assert.ok(f.pontuarNome('Pedro', 'Maria Souza') < 0.5);
});

test('sem permissão: nada é consultado', async () => {
  assert.deepEqual(await f.executarConsulta('buscar_alunos', { termo: 'maria' }, ctx(pode())), { erro: 'sem_permissao' });
  assert.deepEqual(await f.executarConsulta('ver_aluno', { alunoId: 'x' }, ctx(pode('pendentes:gerenciar'))), { erro: 'sem_permissao' });
  assert.deepEqual(await f.executarConsulta('listar_pendentes', {}, ctx(pode('painel:leitura', 'aluno:gerenciar'))), { erro: 'sem_permissao' });
  assert.deepEqual(await f.executarConsulta('listar_turmas', {}, ctx(pode('pendentes:gerenciar'))), { erro: 'sem_permissao' });
  assert.deepEqual(await f.executarConsulta('listar_cursos', {}, ctx(pode('painel:leitura'))), { erro: 'sem_permissao' });
});

test('termo curto ou vazio não varre o banco', async () => {
  for (const termo of ['', '  ', 'ab', ' a ']) assert.deepEqual(await f.executarConsulta('buscar_alunos', { termo }, ctx(pode('aluno:gerenciar'))), { erro: 'termo_curto' });
});

test('ferramenta desconhecida', async () => {
  assert.deepEqual(await f.executarConsulta('apagar_tudo', {}, ctx(pode('aluno:gerenciar'))), { erro: 'ferramenta_desconhecida' });
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('consultas no banco', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const prisma = require('../src/db');
  const sufixo = Date.now();
  let aluna, turma, matricula;
  before(async () => {
    aluna = await prisma.usuario.create({ data: { nome: 'Mariane Souza Teste Assistente', email: `mariane-${sufixo}@teste.local`, papel: 'ALUNO', celular: '21987650000', cpfCnpj: String(sufixo).slice(-11).padStart(11, '7') } });
    await prisma.usuario.create({ data: { nome: 'João Pereira Teste Assistente', email: `joao-${sufixo}@teste.local`, papel: 'ALUNO' } });
    turma = await prisma.turma.findFirst({ where: { status: { in: ['ABERTA', 'CONFIRMADA'] }, inicioPrevisto: { gt: new Date() } }, include: { curso: true } });
    if (turma) matricula = await prisma.matricula.create({ data: { alunoId: aluna.id, turmaId: turma.id, plano: 'A_VISTA', forma: 'PIX', valorCurso: 180, valorTaxaMatricula: 50, taxaConfirmada: true, statusPagamento: 'PENDENTE' } });
  });
  after(async () => {
    if (matricula) await prisma.matricula.deleteMany({ where: { id: matricula.id } });
    await prisma.usuario.deleteMany({ where: { email: { in: [`mariane-${sufixo}@teste.local`, `joao-${sufixo}@teste.local`] } } });
    await prisma.$disconnect();
  });

  test('buscar por nome com erro de digitação, sem acento e por e-mail/celular', async () => {
    const c = ctx(pode('aluno:gerenciar'));
    let r = await f.executarConsulta('buscar_alunos', { termo: 'mariana sousa teste assistente' }, c);
    assert.equal(r.alunos[0].nome, 'Mariane Souza Teste Assistente');
    assert.ok(c.vistos.alunos.has(aluna.id));
    r = await f.executarConsulta('buscar_alunos', { termo: 'joao pereira teste assistente' }, c);
    assert.equal(r.alunos[0].nome, 'João Pereira Teste Assistente');
    r = await f.executarConsulta('buscar_alunos', { termo: `mariane-${sufixo}@teste.local` }, c);
    assert.equal(r.alunos.length, 1);
    r = await f.executarConsulta('buscar_alunos', { termo: '(21) 98765-0000' }, c);
    assert.ok(r.alunos.some((a) => a.id === aluna.id));
    assert.equal(r.alunos.find((a) => a.id === aluna.id).celular, '21987650000');
  });

  test('ver aluno: campos da tela, CPF completo, matrículas', async () => {
    const r = await f.executarConsulta('ver_aluno', { alunoId: aluna.id }, ctx(pode('painel:leitura')));
    assert.equal(r.aluno.nome, aluna.nome);
    assert.equal(r.aluno.documento.tipo, 'CPF');
    assert.match(r.aluno.documento.numero, /^\d{3}\.\d{3}\.\d{3}-\d{2}$/);
    if (turma) {
      const m = r.matriculas.find((x) => x.id === matricula.id);
      assert.equal(m.curso, turma.curso.nome);
      assert.equal(m.inscricao, 'paga');
      assert.equal(m.matricula, 'pendente');
    }
    assert.deepEqual(await f.executarConsulta('ver_aluno', { alunoId: 'nao-existe' }, ctx(pode('painel:leitura'))), { erro: 'nao_encontrado' });
  });

  test('pendentes: mesma regra da tela Pendentes', async () => {
    if (!turma) return;
    const c = ctx(pode('pendentes:gerenciar'));
    const r = await f.executarConsulta('listar_pendentes', { turmaId: turma.id }, c);
    const linha = r.pessoas.find((p) => p.aluno.id === aluna.id);
    assert.ok(linha);
    assert.equal(linha.turma.id, turma.id);
    assert.equal(typeof linha.falta, 'number');
    assert.ok(c.vistos.turmas.has(turma.id));
    const { listarPendentes } = require('../src/lib/pendentes');
    const tela = await listarPendentes();
    assert.ok(tela.comTaxa.some((m) => m.id === matricula.id));
  });

  test('turmas e cursos', async () => {
    const t = await f.executarConsulta('listar_turmas', { situacao: 'por-comecar' }, ctx(pode('turmas:gerenciar')));
    assert.ok(Array.isArray(t.turmas));
    if (turma) assert.ok(t.turmas.some((x) => x.id === turma.id));
    const c = await f.executarConsulta('listar_cursos', {}, ctx(pode('cursos:gerenciar')));
    assert.ok(c.cursos.length > 0 && c.cursos.every((x) => x.id && x.nome));
  });
});
