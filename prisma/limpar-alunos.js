// ⚠️  APAGA TODOS OS ALUNOS, INSCRIÇÕES E PAGAMENTOS (zera os testes).
// Mantém: contas SECRETARIA, cursos, turmas, configurações, auditoria.
//
// Uso seguro (mostra o que SERIA apagado, sem apagar):
//     npm run db:limpar:alunos
// Para apagar de verdade:
//     npm run db:limpar:alunos -- --confirmar
require('dotenv').config();
const prisma = require('../src/db');

async function main() {
  const confirmar = process.argv.includes('--confirmar');

  const [alunos, matriculas, pagamentos] = await Promise.all([
    prisma.usuario.count({ where: { papel: 'ALUNO' } }),
    prisma.matricula.count(),
    prisma.pagamento.count(),
  ]);

  console.log(`Encontrado: ${alunos} aluno(s), ${matriculas} matrícula(s), ${pagamentos} pagamento(s).`);

  if (!confirmar) {
    console.log('\nNada foi apagado (modo seguro).');
    console.log('Para apagar DE VERDADE, rode:  npm run db:limpar:alunos -- --confirmar');
    return;
  }

  // Ordem respeita as chaves estrangeiras.
  const ids = (await prisma.usuario.findMany({ where: { papel: 'ALUNO' }, select: { id: true } })).map((u) => u.id);
  const pag = await prisma.pagamento.deleteMany({});
  const mat = await prisma.matricula.deleteMany({});
  const tok = ids.length ? await prisma.tokenAuth.deleteMany({ where: { usuarioId: { in: ids } } }) : { count: 0 };
  const us = await prisma.usuario.deleteMany({ where: { papel: 'ALUNO' } });

  console.log(`\nApagado: ${us.count} aluno(s), ${mat.count} matrícula(s), ${pag.count} pagamento(s), ${tok.count} token(s).`);
  console.log('Secretaria, cursos e turmas foram mantidos.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
