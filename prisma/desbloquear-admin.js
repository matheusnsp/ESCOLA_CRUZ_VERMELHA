// Desbloqueio de emergência da secretaria (chave-mestra via servidor).
// Use quando o e-mail estiver indisponível/comprometido.
//
//   npm run admin:desbloquear                 → desbloqueia TODAS as contas de secretaria
//   npm run admin:desbloquear -- email@x.com  → desbloqueia apenas essa conta
require('dotenv').config();
const prisma = require('../src/db');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const where = { papel: 'SECRETARIA', ...(email ? { email } : {}) };

  const r = await prisma.usuario.updateMany({
    where,
    data: { bloqueioTotal: false, loginStrikes: 0, loginFalhas: 0, bloqueadoAte: null },
  });

  console.log(`Desbloqueado(s): ${r.count} conta(s) de secretaria${email ? ` (${email})` : ''}.`);
  if (r.count === 0) console.log('Nenhuma conta encontrada com esse critério.');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
