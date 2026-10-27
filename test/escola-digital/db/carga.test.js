// Teste da carga do conteúdo no banco. Só roda contra banco local (localhost / 127.0.0.1):
// DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carregarCurso, ehBancoLocal, resolverPasta } = require('../../../src/lib/escola-digital/conteudo');

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const PASTA = resolverPasta('primeiros-socorros');
const NOME = `Teste de carga ${process.pid}-${Date.now()}`;
let prisma;
let tmp;

// Cópia da pasta com outro nome de curso; `ajustar` mexe no conteúdo copiado antes de gravar.
function copiar(ajustar) {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const f of fs.readdirSync(PASTA)) {
    const dados = JSON.parse(fs.readFileSync(path.join(PASTA, f), 'utf8'));
    if (f === 'curso.json') dados.nome = NOME;
    if (ajustar) ajustar(f, dados);
    fs.writeFileSync(path.join(tmp, f), JSON.stringify(dados));
  }
  return tmp;
}

async function contar(cursoId) {
  const where = { topico: { modulo: { cursoId } } };
  return {
    modulos: await prisma.moduloOnline.count({ where: { cursoId } }),
    topicos: await prisma.topicoOnline.count({ where: { modulo: { cursoId } } }),
    telas: await prisma.telaOnline.count({ where }),
    perguntas: await prisma.perguntaOnline.count({ where }),
    cenarios: await prisma.cenarioOnline.count({ where: { modulo: { cursoId } } }),
    decisoes: await prisma.decisaoCenario.count({ where: { cenario: { modulo: { cursoId } } } }),
  };
}

if (!skip) {
  prisma = require('../../../src/db');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carga-ead-')) + '/curso';
}

test('carga do conteúdo no banco', { skip }, async (t) => {
  let cursoId;

  await t.test('carrega, é idempotente e preenche o curso', async () => {
    const pasta = copiar();
    const r1 = await carregarCurso(pasta, prisma);
    cursoId = r1.cursoId;
    assert.ok(r1.criados > 0);
    assert.equal(r1.desativadas, 0);
    assert.deepEqual(r1.avisos, []);
    const c1 = await contar(cursoId);
    assert.deepEqual(c1, { modulos: 8, topicos: 9, telas: 9, perguntas: 27, cenarios: 5, decisoes: 15 });

    const r2 = await carregarCurso(pasta, prisma);
    assert.equal(r2.cursoId, cursoId);
    assert.equal(r2.criados, 0);
    assert.ok(r2.atualizados > 0);
    assert.deepEqual(await contar(cursoId), c1);
    assert.equal(await prisma.curso.count({ where: { modalidade: 'ONLINE', nome: NOME } }), 1);

    const curso = await prisma.curso.findUnique({ where: { id: cursoId } });
    assert.equal(curso.modalidade, 'ONLINE');
    assert.equal(curso.ativo, true);
    assert.equal(curso.cargaHoraria, 3);
    assert.equal(curso.taxaMatricula, null);
    assert.equal(Number(curso.precoAvista), 79.9);
    assert.equal(Number(curso.precoCheio), 89.9);
    assert.equal(Number(curso.valorParcela), 29.97);
    assert.equal(curso.parcelas, 3);
    assert.equal(curso.prazoAcessoDias, 365);
    assert.equal(curso.validadeCertificadoMeses, 24);

    // sem vídeo na tela e sem videoSubstituto: videoId nulo
    const telas = await prisma.telaOnline.findMany({ where: { topico: { modulo: { cursoId } } } });
    assert.ok(telas.every((x) => x.videoId === null));
    const m8 = await prisma.moduloOnline.findFirst({ where: { cursoId, ordem: 8 } });
    assert.equal(m8.final, true);
    assert.equal(m8.temPreTeste, false);
    const dec1 = await prisma.decisaoCenario.findFirst({ where: { ordem: 1, cenario: { moduloId: m8.id, ordem: 1 } } });
    assert.deepEqual(dec1.opcoes, ['OLHAR', 'LIGAR', 'CUIDAR']);
  });

  await t.test('pergunta que saiu do arquivo fica inativa, e volta a ativa se reaparecer', async () => {
    const semPao = copiar((f, d) => {
      if (f !== 'modulo-04.json') return;
      d.topicos[0].perguntas = d.topicos[0].perguntas.filter((p) => p.chave !== 'pedaco-de-pao');
    });
    const r = await carregarCurso(semPao, prisma);
    assert.equal(r.cursoId, cursoId);
    assert.equal(r.desativadas, 1);
    assert.deepEqual(r.avisos, []);
    const pao = await prisma.perguntaOnline.findFirst({ where: { chave: 'pedaco-de-pao', topico: { modulo: { cursoId } } } });
    assert.equal(pao.ativa, false);
    assert.equal((await contar(cursoId)).perguntas, 27, 'nenhuma pergunta é apagada');

    const r2 = await carregarCurso(copiar(), prisma);
    assert.equal(r2.desativadas, 0);
    const volta = await prisma.perguntaOnline.findUnique({ where: { id: pao.id } });
    assert.equal(volta.ativa, true);
    assert.equal(volta.id, pao.id, 'mesma linha: o histórico dos alunos continua apontando para ela');
  });

  await t.test('nunca apaga: módulo, tela e decisão que sumiram do arquivo viram aviso', async () => {
    const reduzido = copiar((f, d) => {
      if (f === 'modulo-04.json') d.topicos[0].telas = [];
      if (f === 'modulo-08.json') d.cenarios[0].decisoes = d.cenarios[0].decisoes.slice(0, 2);
    });
    fs.rmSync(path.join(reduzido, 'modulo-07.json'));
    const antes = await contar(cursoId);
    const r = await carregarCurso(reduzido, prisma);
    assert.deepEqual(await contar(cursoId), antes, 'nenhuma linha some');
    assert.equal(r.avisos.length, 3);
    assert.ok(r.avisos.some((a) => a.includes('Módulo "lesoes-e-ambiente"')));
    assert.ok(r.avisos.some((a) => a.includes('Tela "engasgo/reconhecer-o-engasgo/crianca-no-recreio"')));
    assert.ok(r.avisos.some((a) => a.includes('lanche-na-creche') && a.includes('decisão')));
  });

  await t.test('conteúdo inválido não grava nada', async () => {
    const quebrado = copiar((f, d) => {
      if (f === 'modulo-01.json') d.topicos[0].perguntas[0].correta = 9;
    });
    const antes = await contar(cursoId);
    await assert.rejects(() => carregarCurso(quebrado, prisma), /Conteúdo inválido/);
    assert.deepEqual(await contar(cursoId), antes, 'contagens iguais depois da carga recusada');
  });
});

after(async () => {
  if (skip) return;
  try {
    // apaga o que o teste criou, de baixo para cima (o curso copiado tem nome único; não há inscrições)
    const cursos = await prisma.curso.findMany({ where: { modalidade: 'ONLINE', nome: NOME }, select: { id: true } });
    for (const { id: cursoId } of cursos) {
      const modulo = { cursoId };
      await prisma.decisaoCenario.deleteMany({ where: { cenario: { modulo } } });
      await prisma.cenarioOnline.deleteMany({ where: { modulo } });
      await prisma.perguntaOnline.deleteMany({ where: { topico: { modulo } } });
      await prisma.telaOnline.deleteMany({ where: { topico: { modulo } } });
      await prisma.topicoOnline.deleteMany({ where: { modulo } });
      await prisma.moduloOnline.deleteMany({ where: modulo });
      await prisma.curso.delete({ where: { id: cursoId } });
    }
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
