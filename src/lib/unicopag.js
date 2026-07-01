const API_BASE = process.env.UNICOPAG_API_BASE || 'https://api.cloud.unicopag.com.br';

// Converte a "forma" usada no nosso formulário (PIX, DEBITO, CREDITO)
// para o payment_method esperado pela API do UnicoPag.
function mapearMetodo(forma) {
  const mapa = {
    PIX: 'pix',
    DEBITO: 'debit_card',
    CREDITO: 'credit_card',
  };
  return mapa[forma] || null;
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
    installments: 1,
    postback_url: `${appUrl}/webhook/unicopag`,
    redirect_url: `${appUrl}/inscricao/retorno?matriculaId=${matriculaId}`,
    external_id: matriculaId,
    customer: {
      name: aluno.nome,
      email: aluno.email,
      document: aluno.cpfCnpj,
      document_type: aluno.cpfCnpj?.length === 14 ? 'cnpj' : 'cpf',
      phone_number: aluno.celular || '00000000000',
    },
    cart: [
      {
        hash: matriculaId,        // identificador único do item — usamos a própria matrícula, já é UUID único
        title: nomeCurso,          // era "name"
        price: valorCentavos,      // era "unit_price"
        quantity: 1,
        operation_type: 1,         // ⚠️ valor de exemplo — ver observação abaixo
      },
    ],
  };

  const resp = await fetch(`${API_BASE}/public/v1/payments?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  console.log('[UnicopAg] Resposta:', JSON.stringify(data));

  if (!resp.ok) throw new Error(data?.message || 'Erro ao criar pagamento.');

  return {
    checkoutUrl: data.link_checkout ?? data.checkout_url ?? data.url ?? data.link,
    gatewayRef: data.hash ?? data.id,
  };
}

module.exports = { criarTransacao };