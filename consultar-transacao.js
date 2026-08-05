// Uso:  node scripts/consultar-transacao.js f3vvxqvhhk 2wzy8ligbd
// Consulta o detalhe de uma ou mais transações na API legada e imprime o
// motivo da recusa (os campos variam por adquirente — por isso o dump bruto).

require('dotenv').config();
const fetch = require('node-fetch');

const BASE = 'https://api.cloud.unicopag.com.br/public/v1';

async function consultar(hash) {
  const token = process.env.UNICOPAG_API_TOKEN;
  if (!token) {
    console.error('UNICOPAG_API_TOKEN não configurado no .env');
    process.exit(1);
  }

  const url = `${BASE}/transactions/${encodeURIComponent(hash)}?api_token=${token.trim()}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  const texto = await resp.text();

  console.log(`\n${'='.repeat(70)}\nHASH: ${hash}  |  HTTP ${resp.status}\n${'='.repeat(70)}`);

  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    console.log('Resposta não-JSON:\n', texto.slice(0, 800));
    return;
  }

  const t = json.transaction || json.result || json;

  // Resumo do que interessa
  console.log('payment_status :', t.payment_status);
  console.log('payment_method :', t.payment_method);
  console.log('installments   :', t.installments);
  console.log('amount         :', t.amount, '| amount_total:', t.amount_total);
  console.log('produtor/seller:', t.producer?.name || t.seller?.name || t.producer_document || '—');

  // Campos onde o motivo da recusa costuma aparecer
  const motivo = t.refuse_reason || t.refused_reason || t.error_message || t.message
    || t.acquirer_message || t.acquirer_return_code || t.status_reason || json.message;
  console.log('MOTIVO         :', motivo || '(não veio em campo conhecido)');

  // Dump completo — é aqui que mora o detalhe quando o campo acima vem vazio
  console.log('\n--- resposta completa ---');
  console.log(JSON.stringify(json, null, 2));
}

(async () => {
  const hashes = process.argv.slice(2);
  if (!hashes.length) {
    console.error('Informe ao menos um hash. Ex: node scripts/consultar-transacao.js f3vvxqvhhk');
    process.exit(1);
  }
  for (const h of hashes) {
    try {
      await consultar(h);
    } catch (err) {
      console.error(`Erro ao consultar ${h}:`, err.message);
    }
  }
})();
