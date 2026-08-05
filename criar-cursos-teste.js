require('dotenv').config({ path: '.env.dev' });
const p = require('./src/db');

(async () => {
  // limpa cursos de teste anteriores
  const antigos = await p.curso.findMany({ where: { nome: { startsWith: 'TESTE ' } }, select: { id: true } });
  for (const c of antigos) {
    const turmas = await p.turma.findMany({ where: { cursoId: c.id }, select: { id: true } });
    for (const t of turmas) {
      await p.aulaData.deleteMany({ where: { turmaId: t.id } });
      await p.matricula.deleteMany({ where: { turmaId: t.id } });
    }
    await p.turma.deleteMany({ where: { cursoId: c.id } });
    await p.curso.delete({ where: { id: c.id } });
  }

  const inicio = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  async function criar(dados) {
    const curso = await p.curso.create({ data: dados });
    const turma = await p.turma.create({ data: { cursoId: curso.id, vagas: 30, minimoAlunos: 1, status: 'ABERTA', inicioPrevisto: inicio } });
    await p.aulaData.create({ data: { turmaId: turma.id, data: inicio, horario: '19:00 as 22:00' } });
    return { curso, turma };
  }

  const a = await criar({ nome: 'TESTE A 1 real PIX', cargaHoraria: 1, precoAvista: 1.00, precoCheio: 1.00, parcelas: 1, valorParcela: 1.00, taxaMatricula: 0, ativo: true });
  const b = await criar({ nome: 'TESTE B 10 reais 2x5', cargaHoraria: 1, precoAvista: 10.00, precoCheio: 10.00, parcelas: 2, valorParcela: 5.00, taxaMatricula: 0, ativo: true });

  console.log('CURSO A (1 real PIX):    curso', a.curso.id, '| turma', a.turma.id);
  console.log('CURSO B (10 reais 2x5):  curso', b.curso.id, '| turma', b.turma.id);
  process.exit(0);
})();
