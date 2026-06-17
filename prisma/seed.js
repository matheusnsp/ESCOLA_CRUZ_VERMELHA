// Popular o banco com dados iniciais:
//   1) Configuração da taxa de matrícula (flexível/removível)
//   2) Conta da secretaria/admin (lida do .env)
//   3) Cursos/turmas de EXEMPLO — só se SEED_EXEMPLO="true" (ver prisma/exemplos.js)
//
// Rode com:  npm run db:seed
require('dotenv').config();

const prisma = require('../src/db');
const { hashSenha } = require('../src/lib/password');
const { inserirExemplos } = require('./exemplos');

async function main() {
  // 1) Taxa de matrícula configurável.
  await prisma.configuracao.upsert({
    where: { chave: 'matricula_modo' },
    update: {},
    create: { chave: 'matricula_modo', valor: 'POR_CURSO' },
  });
  await prisma.configuracao.upsert({
    where: { chave: 'matricula_valor_padrao' },
    update: {},
    create: { chave: 'matricula_valor_padrao', valor: '100.00' },
  });

  // 2) Conta da secretaria/admin.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminSenha = process.env.SEED_ADMIN_SENHA;
  if (adminEmail && adminSenha) {
    const senhaHash = await hashSenha(adminSenha);
    await prisma.usuario.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        nome: process.env.SEED_ADMIN_NOME || 'Secretaria',
        email: adminEmail,
        senhaHash,
        papel: 'SECRETARIA',
        emailVerificado: true,
      },
    });
    console.log(`Secretaria: ${adminEmail}`);
  } else {
    console.log('SEED_ADMIN_EMAIL/SENHA não definidos — pulando criação da secretaria.');
  }

  // 3) Cursos/turmas de EXEMPLO — apenas se habilitado.
  if (process.env.SEED_EXEMPLO === 'true') {
    console.log('SEED_EXEMPLO=true → inserindo cursos/turmas de exemplo...');
    await inserirExemplos(prisma);
  } else {
    console.log('SEED_EXEMPLO != "true" → pulando cursos de exemplo (a secretaria cadastra).');
  }
}

main()
  .then(() => console.log('Seed concluído.'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
