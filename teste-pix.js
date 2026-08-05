// listar-transacoes.js
// Rode na raiz do projeto: node listar-transacoes.js
// Lista as transações recentes da conta pra checar se algum teste que deu
// erro do lado da nossa aplicação na verdade foi cobrado do lado da Únicopag.

require('dotenv').config({ path: '.env.dev' });
const fetch = require('node-fetch');

async function main() {
  const token = (process.env.UNICOPAG_API_TOKEN || '').trim();
  if (!token) {
    console.error('❌ UNICOPAG_API_TOKEN não encontrado no .env.dev');
    process.exit(1);
  }

  const url = `https://api.cloud.unicopag.com.br/public/v1/transactions?api_token=${token}`;

  console.log('\n⏳ Buscando transações recentes...\n');

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }

    if (!resp.ok) {
      console.error(`❌ ERRO ${resp.status}:`);
      console.error(JSON.stringify(json, null, 2));
      return;
    }

    // A resposta pode vir em vários formatos possíveis (data/result/direto array).
    const lista = Array.isArray(json) ? json
      : Array.isArray(json.data) ? json.data
      : Array.isArray(json.result) ? json.result
      : Array.isArray(json.transactions) ? json.transactions
      : null;

    if (!lista) {
      console.log('⚠️ Não consegui identificar a lista na resposta. Resposta bruta:');
      console.log(JSON.stringify(json, null, 2));
      return;
    }

    console.log(`✅ ${lista.length} transação(ões) encontrada(s):\n`);

    // Ordena da mais recente pra mais antiga, se tiver created_at
    lista.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    lista.forEach((tx, i) => {
      const valor = ((tx.amount ?? 0) / 100).toFixed(2);
      console.log(
        `${i + 1}. hash: ${tx.hash || tx.id || '?'} | ` +
        `método: ${tx.payment_method || '?'} | ` +
        `status: ${tx.payment_status || '?'} | ` +
        `valor: R$ ${valor} | ` +
        `criado: ${tx.created_at || '?'} | ` +
        `cliente: ${tx.customer?.email || '?'}`
      );
    });

    console.log('\n📋 Resposta completa (JSON):');
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('❌ Falha de rede:', err.message);
  }
}

main();