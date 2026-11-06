// lib/transacao.js
//
// Transação interativa com folga de tempo. No Render cada ida ao Supabase leva dezenas de ms; com os
// padrões do Prisma (2 s para começar, 5 s para terminar) uma transação de poucas consultas estourava e
// as seguintes nem começavam (ver lib/turma-espera.js). test/latencia.test.js mede isso com um proxy
// que atrasa o banco. Mesmo com a folga, leia FORA da transação o que não precisa da trava.

const prisma = require('../db');

const FOLGA = { maxWait: 10000, timeout: 20000 };

const transacao = (fn) => prisma.$transaction(fn, FOLGA);

module.exports = { transacao, FOLGA };
