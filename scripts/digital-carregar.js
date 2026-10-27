// Carrega o conteúdo de um curso da Escola Digital (JSON em conteudo/escola-digital/<pasta>)
// no banco. Não apaga nada: o que está no banco e não está nos arquivos vira aviso.
//
// Uso:  npm run digital:carregar -- primeiros-socorros
//       npm run digital:carregar -- /caminho/da/pasta --confirmo-banco-real   (banco que não é local)
require('dotenv').config();

const { carregarCurso, resolverPasta, ehBancoLocal } = require('../src/lib/escola-digital/conteudo');

async function main() {
  const args = process.argv.slice(2);
  const confirmado = args.includes('--confirmo-banco-real');
  const pasta = args.find((a) => !a.startsWith('--'));

  if (!pasta) {
    console.error('Uso: npm run digital:carregar -- <pasta> [--confirmo-banco-real]\n'
      + 'Exemplo: npm run digital:carregar -- primeiros-socorros');
    return 1;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não está definida (confira o .env). Nada foi carregado.');
    return 1;
  }
  if (!ehBancoLocal(process.env.DATABASE_URL) && !confirmado) {
    console.error('Recusado: DATABASE_URL não aponta para localhost/127.0.0.1, ou seja, é um banco real.\n'
      + 'Se é isso mesmo que você quer, rode de novo com --confirmo-banco-real. Nada foi carregado.');
    return 1;
  }

  const prisma = require('../src/db'); // só depois do dotenv e das recusas acima
  try {
    const r = await carregarCurso(resolverPasta(pasta), prisma);
    console.log(`Curso ${r.cursoId}`);
    console.log(`criados: ${r.criados} · atualizados: ${r.atualizados} · perguntas desativadas: ${r.desativadas} · avisos: ${r.avisos.length}`);
    for (const a of r.avisos) console.log(`  aviso: ${a}`);
    return 0;
  } catch (e) {
    console.error(`Falha na carga: ${e.message}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((codigo) => { process.exitCode = codigo; });
