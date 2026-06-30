// src/lib/unicopag.js
const API_BASE = 'https://api.cloud.unicopag.com.br';

function mapearMetodo(forma) {
  const mapa = { PIX: 'pix', CREDITO: 'credit_card', DEBITO: 'debit_card', DINHEIRO: null };
  return mapa[forma] ?? null;
}

async function criarTransacao({ matriculaId, nomeCurso, valorTotal, forma, aluno }) {
  const token = process.env.UNICOPAG_API_TOKEN;
  if (!token) throw new Error('UNICOPAG_API_TOKEN não configurado.');
  const metodo = mapearMetodo(forma);
  if (!metodo) throw new Error(`Forma "${forma}" não suportada pelo gateway.`);
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const valorCentavos = Math.round(Number(valorTotal) * 100);
  const body = {
    payment_method: metodo,
    amount: valorCentavos,
    postback_url: `${appUrl}/webhook/unicopag`,
    redirect_url: `${appUrl}/inscricao/retorno?matriculaId=${matriculaId}`,
    external_id: matriculaId,
    customer: {
      name: aluno.nome,
      email: aluno.email,
      document: aluno.cpfCnpj,
      document_type: aluno.cpfCnpj?.length === 14 ? 'cnpj' : 'cpf',
    },
    products: [{ name: nomeCurso, quantity: 1, price: valorCentavos }],
  };
  const resp = await fetch(`${API_BASE}/public/v1/transactions?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) { console.error('[UnicopAg] Erro:', data); throw new Error(data?.message || 'Erro no gateway.'); }
  return { checkoutUrl: data.link_checkout ?? data.checkout_url ?? data.url, gatewayRef: data.hash ?? data.id };
}

module.exports = { criarTransacao, mapearMetodo };
