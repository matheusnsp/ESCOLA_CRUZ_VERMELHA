// Testes do curso online que vendem/abrem a página para quem visita: a Escola Digital (2026-11) começa desligada,
// então ligam o interruptor no começo e devolvem como estava no fim.
async function ligarEscolaDigital() {
  const prisma = require('../../src/db');
  const ed = require('../../src/lib/escola-digital');
  const antes = await prisma.configuracao.findUnique({ where: { chave: ed.CHAVE } });
  await prisma.configuracao.upsert({ where: { chave: ed.CHAVE }, update: { valor: '1' }, create: { chave: ed.CHAVE, valor: '1' } });
  ed.limparCache();
  return async () => {
    if (antes) await prisma.configuracao.update({ where: { chave: ed.CHAVE }, data: { valor: antes.valor } });
    else await prisma.configuracao.deleteMany({ where: { chave: ed.CHAVE } });
    ed.limparCache();
  };
}
module.exports = { ligarEscolaDigital };
