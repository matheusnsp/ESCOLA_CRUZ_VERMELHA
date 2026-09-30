const { PrismaClient } = require('@prisma/client');

// Monta a URL do Prisma a partir de DATABASE_URL.
//
// pgbouncer=true só quando a conexão passa por um pooler em modo "transação" (o Supabase na
// porta 6543, ou um host "-pooler" do Neon): nesse modo não dá para reaproveitar prepared
// statements. O custo é alto: cada consulta leva 5 idas e voltas ao banco em vez de 1 (medido:
// 808 ms contra 163 ms com 80 ms de latência em cada sentido). Com o pooler do Supabase em modo
// "sessão" (porta 5432) ou conexão direta, o parâmetro fica de fora.
// DATABASE_PGBOUNCER=true|false força a escolha.
//
// connection_limit=10: o painel dispara até 9 consultas em paralelo (Painel); com 5 elas saíam
// em duas levas.
function urlDoPrisma(bruta) {
  if (!bruta) return String(bruta); // sem DATABASE_URL: o Prisma reclama só ao conectar, como antes
  let url;
  try {
    url = new URL(bruta);
  } catch (e) {
    return bruta; // formato inesperado: deixa o Prisma reclamar com a mensagem dele
  }
  const forcado = String(process.env.DATABASE_PGBOUNCER || '').toLowerCase();
  const modoTransacao = forcado
    ? forcado === 'true'
    : url.searchParams.get('pgbouncer') === 'true' // já veio na URL: respeita
      || url.port === '6543' || /-pooler\./.test(url.hostname);
  if (modoTransacao) url.searchParams.set('pgbouncer', 'true');
  else url.searchParams.delete('pgbouncer');
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '10');
  return url.toString();
}

// URL das sessões de login (connect-pg-simple, em server.js).
//
// O pooler do Supabase em modo "sessão" (porta 5432) aceita no máximo pool_size clientes (15)
// somando TODOS os serviços que usam o banco. Com os três serviços do Render (secretaria e as
// duas escolas), cada um com o Prisma + o pool das sessões, a soma passava de 15 e o banco
// recusava conexões (EMAXCONNSESSION), sobretudo durante um deploy, quando o serviço velho e o
// novo ficam no ar juntos. As sessões fazem consultas simples, que funcionam no modo
// "transação" (porta 6543, com limite próprio e bem maior), então elas vão para lá; o Prisma
// continua no 5432, onde cada consulta é mais rápida.
function urlDasSessoes(bruta) {
  if (!bruta) return bruta;
  let url;
  try {
    url = new URL(bruta);
  } catch (e) {
    return bruta;
  }
  if (/\.pooler\.supabase\.com$/.test(url.hostname) && url.port === '5432') url.port = '6543';
  // parâmetros que só o Prisma entende
  ['connection_limit', 'pgbouncer', 'pool_timeout', 'connect_timeout', 'schema'].forEach((p) => url.searchParams.delete(p));
  return url.toString();
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: urlDoPrisma(process.env.DATABASE_URL),
    },
  },
});

module.exports = prisma;
module.exports.urlDoPrisma = urlDoPrisma;
module.exports.urlDasSessoes = urlDasSessoes;
