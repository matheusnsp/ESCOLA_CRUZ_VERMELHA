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

  // Tenta as rotas possíveis da UnicopAg
  const endpoints = [
    `${API_BASE}/public/v1/transaction?api_token=${token}`,
    `${API_BASE}/public/v1/checkout?api_token=${token}`,
    `${API_BASE}/public/v1/orders?api_token=${token}`,
  ];

  let lastError;
  for (const url of endpoints) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (resp.ok) {
      console.log('[UnicopAg] Transação criada:', JSON.stringify(data));
      return { checkoutUrl: data.link_checkout ?? data.checkout_url ?? data.url ?? data.link, gatewayRef: data.hash ?? data.id };
    }
    lastError = data;
    console.warn(`[UnicopAg] ${url} →`, data?.message || resp.status);
  }
  throw new Error(lastError?.message || 'Erro ao criar transação no gateway.');
}

module.exports = { criarTransacao, mapearMetodo };
