// 2026-11-13: assistente da secretaria — ferramentas de formulário (spec §2 "Preencher formulários"). Não gravam.
require('dotenv').config();
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/lib/assistente-ferramentas');
const pode = (...perms) => (p) => perms.includes(p);

test('definições dos formulários', () => {
  assert.deepEqual(f.DEFINICOES_FORMULARIO.map((d) => d.name), ['escrever_textos_curso', 'preencher_curso', 'preencher_turma']);
});

test('preencher_curso: valida e devolve o evento de preencher (sem gravar)', async () => {
  const r = await f.executarFormulario('preencher_curso', { campos: {
    nome: 'Primeiros Socorros para Gestantes', cargaHoraria: 8, precoAvista: 180, precoCheio: 200, parcelas: 4, taxaMatricula: 50,
    escolaridadeMinima: 'Ensino Fundamental', categoria: 'Emergência e primeiros socorros', exigeComprovanteSaude: false,
    faqs: [{ pergunta: 'Posso levar acompanhante?', resposta: 'Sim, um acompanhante.' }], cor: 'azul',
  } }, { pode: pode('cursos:criar') });
  assert.equal(r.evento.tipo, 'preencher');
  assert.equal(r.evento.formulario, 'curso');
  assert.equal(r.evento.campos.nome, 'Primeiros Socorros para Gestantes');
  assert.equal(r.evento.campos.precoAvista, '180.00');
  assert.equal(r.evento.campos.cargaHoraria, '8');
  assert.equal(r.evento.campos.exigeComprovanteSaude, false);
  assert.deepEqual(r.evento.campos.faqs, [{ pergunta: 'Posso levar acompanhante?', resposta: 'Sim, um acompanhante.' }]);
  assert.deepEqual(r.resultado.ignorados, ['cor']);
  assert.equal(r.resultado.preparado, true);
});

test('preencher_curso: erros por campo', async () => {
  const r = await f.executarFormulario('preencher_curso', { campos: { cargaHoraria: -2, precoAvista: 'muito', parcelas: 40, escolaridadeMinima: 'Doutorado', categoria: 'Culinária' } }, { pode: pode('cursos:gerenciar') });
  assert.equal(r.evento, undefined);
  assert.deepEqual(Object.keys(r.resultado.erros).sort(), ['cargaHoraria', 'categoria', 'escolaridadeMinima', 'parcelas', 'precoAvista']);
});

test('preencher_turma: aulas e horários normalizados', async () => {
  const r = await f.executarFormulario('preencher_turma', { campos: {
    inicioPrevisto: '2026-12-02', vagas: 30, minimoAlunos: 15, status: 'ABERTA', instrutorNome: 'Carla Dias',
    aulas: [{ data: '2026-12-02', horario: '18:00-22:00' }, { data: '2026-12-04', horario: '18:00 – 22:00' }],
  } }, { pode: pode('turmas:gerenciar') });
  assert.equal(r.evento.formulario, 'turma');
  assert.deepEqual(r.evento.campos.aulas, [{ data: '2026-12-02', horario: '18:00 – 22:00' }, { data: '2026-12-04', horario: '18:00 – 22:00' }]);
  assert.equal(r.evento.campos.vagas, '30');
});

test('preencher_turma: data inválida, horário errado, status fora da lista, vagas zero', async () => {
  const r = await f.executarFormulario('preencher_turma', { campos: { inicioPrevisto: '2026-02-31', vagas: 0, status: 'ATIVA', aulas: [{ data: '2026-12-02', horario: 'à noite' }] } }, { pode: pode('turmas:gerenciar') });
  assert.equal(r.evento, undefined);
  assert.deepEqual(Object.keys(r.resultado.erros).sort(), ['aulas', 'inicioPrevisto', 'status', 'vagas']);
});

test('sem permissão', async () => {
  assert.deepEqual((await f.executarFormulario('preencher_curso', { campos: { nome: 'X' } }, { pode: pode('turmas:gerenciar') })).resultado, { erro: 'sem_permissao' });
  assert.deepEqual((await f.executarFormulario('preencher_turma', { campos: {} }, { pode: pode('cursos:criar') })).resultado, { erro: 'sem_permissao' });
  assert.deepEqual((await f.executarFormulario('escrever_textos_curso', { nome: 'X' }, { pode: pode('painel:leitura') })).resultado, { erro: 'sem_permissao' });
});

test('escrever_textos_curso: usa a função do "Escrever com IA", soma o custo e respeita o teto', async () => {
  const ia = require('../src/lib/ead-ia');
  const txt = require('../src/lib/ia-textos');
  const orig = { escrever: txt.escrever, teto: ia.dentroDoTeto, somar: ia.somarCustoAvulso };
  const chamadas = [];
  txt.escrever = async (args) => { chamadas.push(args); return { textos: { descricao: 'Resumo.', descricaoLonga: 'Longo.', conteudoProgramatico: 'A\nB', faqs: [{ pergunta: 'P?', resposta: 'R.' }] }, usage: { input_tokens: 10, output_tokens: 5 } }; };
  let custo = null; ia.somarCustoAvulso = async (u) => { custo = u; };
  ia.dentroDoTeto = async () => ({ ok: true });
  try {
    const r = await f.executarFormulario('escrever_textos_curso', { nome: 'Primeiros Socorros para Gestantes', cargaHoraria: 8, ideias: 'para gestantes' }, { pode: pode('cursos:criar') });
    assert.equal(chamadas[0].tipo, 'presencial');
    assert.equal(chamadas[0].dados.nome, 'Primeiros Socorros para Gestantes');
    assert.equal(chamadas[0].ideias, 'para gestantes');
    assert.deepEqual(custo, { input_tokens: 10, output_tokens: 5 });
    assert.equal(r.evento.formulario, 'curso');
    assert.equal(r.evento.campos.descricao, 'Resumo.');
    assert.equal(r.evento.campos.conteudoProgramatico, 'A\nB');
    ia.dentroDoTeto = async () => ({ ok: false, erro: 'Teto atingido.' });
    const t = await f.executarFormulario('escrever_textos_curso', { nome: 'X' }, { pode: pode('cursos:criar') });
    assert.deepEqual(t.resultado, { erro: 'teto_ia', mensagem: 'Teto atingido.' });
  } finally { Object.assign(txt, { escrever: orig.escrever }); ia.dentroDoTeto = orig.teto; ia.somarCustoAvulso = orig.somar; }
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
describe('turma: curso precisa existir e ser presencial', { skip: temBanco ? false : 'sem banco' }, () => {
  const prisma = require('../src/db');
  after(() => prisma.$disconnect());
  test('cursoId inexistente recusa; curso presencial aceita', async () => {
    const r = await f.executarFormulario('preencher_turma', { campos: { cursoId: '00000000-0000-0000-0000-000000000000' } }, { pode: pode('turmas:gerenciar') });
    assert.ok(r.resultado.erros.cursoId);
    const { semSoOnline } = require('../src/lib/ead-curso-online');
    const [c] = await semSoOnline(await prisma.curso.findMany({ where: { ativo: true, ebook: null }, take: 20 }));
    const ok = await f.executarFormulario('preencher_turma', { campos: { cursoId: c.id } }, { pode: pode('turmas:gerenciar') });
    assert.equal(ok.evento.campos.cursoId, c.id);
  });
});

test('schemas estritos sem regras que a API não aceita (maxLength, minimum…)', () => {
  const texto = JSON.stringify([...f.DEFINICOES_CONSULTA, ...f.DEFINICOES_FORMULARIO]);
  for (const proibido of ['maxLength', 'minLength', 'minimum', 'maximum', 'multipleOf', 'maxItems', 'minItems']) assert.ok(!texto.includes(`"${proibido}"`), proibido);
  const objetos = (s, acc = []) => { if (s && typeof s === 'object') { if (s.type === 'object') acc.push(s); Object.values(s).forEach((v) => objetos(v, acc)); } return acc; };
  for (const o of objetos([...f.DEFINICOES_CONSULTA, ...f.DEFINICOES_FORMULARIO].map((d) => d.input_schema))) assert.equal(o.additionalProperties, false);
});

// 2026-11-13 (produção: "fora do ar" em toda pergunta): a API recusa o pedido quando as ferramentas strict somam
// mais de 24 parâmetros opcionais (ou mais de 20 ferramentas strict). Os formulários são validados no servidor.
test('limite da API para ferramentas strict: até 24 opcionais e 20 ferramentas', () => {
  const f = require('../src/lib/assistente-ferramentas');
  const todas = [...f.DEFINICOES_CONSULTA, ...f.DEFINICOES_FORMULARIO];
  let opcionais = 0;
  const contar = (s) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object' && s.properties) {
      const req = new Set(s.required || []);
      for (const [k, v] of Object.entries(s.properties)) { if (!req.has(k)) opcionais++; contar(v.items || v); }
    }
  };
  const strict = todas.filter((d) => d.strict);
  strict.forEach((d) => contar(d.input_schema));
  assert.ok(strict.length <= 20, `${strict.length} ferramentas strict`);
  assert.ok(opcionais <= 24, `${opcionais} parâmetros opcionais em ferramentas strict`);
});

test('formulário: campos que chegam como texto JSON também valem (ferramenta sem strict)', async () => {
  const f = require('../src/lib/assistente-ferramentas');
  const r = await f.executarFormulario('preencher_curso', { campos: JSON.stringify({ nome: 'Curso Texto', precoAvista: '180,00' }) }, { pode: () => true });
  assert.equal(r.evento.campos.nome, 'Curso Texto');
  assert.equal(r.evento.campos.precoAvista, '180.00');
});

test('pequenos ajustes: editar um curso que não existe dá erro; sem banco não precisa', async () => {
  const f = require('../src/lib/assistente-ferramentas');
  const r = await f.executarFormulario('preencher_curso', { campos: { precoAvista: 500 }, editarCursoId: 'nao-e-id' }, { pode: () => true });
  assert.equal(r.resultado.preparado, false);
  assert.ok(r.resultado.erros.editarCursoId);
  assert.ok(f.DEFINICOES_FORMULARIO.find((d) => d.name === 'preencher_curso').input_schema.properties.editarCursoId);
  assert.ok(f.DEFINICOES_FORMULARIO.find((d) => d.name === 'preencher_turma').input_schema.properties.editarTurmaId);
});

const temBancoEd = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
test('pequenos ajustes: editar curso/turma existente leva o endereço da edição no evento', { skip: temBancoEd ? false : 'sem banco local' }, async () => {
  const f = require('../src/lib/assistente-ferramentas');
  const prisma = require('../src/db');
  const t = await prisma.turma.findFirst({ where: { status: { in: ['ABERTA', 'CONFIRMADA'] } }, include: { curso: true } });
  if (!t) return;
  const r = await f.executarFormulario('preencher_curso', { campos: { precoAvista: 500 }, editarCursoId: t.cursoId }, { pode: () => true });
  assert.deepEqual(r.evento.editar, { id: t.cursoId, caminho: `/cursos/${t.cursoId}/editar`, nome: t.curso.nome });
  const r2 = await f.executarFormulario('preencher_turma', { campos: { vagas: 25 }, editarTurmaId: t.id }, { pode: () => true });
  assert.equal(r2.evento.editar.caminho, `/turmas/${t.id}/editar`);
  const r3 = await f.executarFormulario('preencher_curso', { campos: { nome: 'Novo' } }, { pode: () => true });
  assert.equal(r3.evento.editar, undefined);
});

// 2026-11-13: resumo e texto completo saem só do escrever_textos_curso (padrão do site), nunca escritos pelo assistente.
test('preencher_curso: não aceita resumo nem texto completo escritos pelo assistente', async () => {
  const def = f.DEFINICOES_FORMULARIO.find((d) => d.name === 'preencher_curso');
  const props = def.input_schema.properties.campos.properties;
  assert.equal(props.descricao, undefined);
  assert.equal(props.descricaoLonga, undefined);
  const r = await f.executarFormulario('preencher_curso', { campos: { nome: 'Cuidador Infantil', cargaHoraria: 120, descricao: 'feito à mão', descricaoLonga: 'texto livre' } }, { pode: pode('cursos:criar') });
  assert.equal(r.evento.campos.descricao, undefined);
  assert.equal(r.evento.campos.descricaoLonga, undefined);
  assert.match(r.resultado.aviso, /escrever_textos_curso/);
});

test('regras do assistente: textos do curso só pelo escrever_textos_curso, com as observações em ideias', () => {
  const { REGRAS } = require('../src/lib/assistente-contexto');
  assert.match(REGRAS, /escrever_textos_curso/);
  assert.match(REGRAS, /nunca escreva (esses textos|o resumo|a descrição)/i);
  const def = f.DEFINICOES_FORMULARIO.find((d) => d.name === 'escrever_textos_curso');
  assert.match(def.description, /observações/i);
});
