// Remove os cursos/turmas de EXEMPLO do banco.
// Rode com:  npm run db:seed:limpar
// Cursos de exemplo que tiverem matrícula NÃO são apagados (proteção).
require('dotenv').config();

const prisma = require('../src/db');
const { removerExemplos } = require('./exemplos');

removerExemplos(prisma)
  .then(() => console.log('Limpeza dos exemplos concluída.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
