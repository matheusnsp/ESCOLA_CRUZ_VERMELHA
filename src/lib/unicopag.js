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

  // Telefone: remove tudo que não é dígito, garante pelo menos 10 dígitos
  const telefone = (aluno.celular || '').replace(/\D/g, '') || '00000000000';

  const body = {
    payment_method: metodo,
    amount: valorCentavos,
    installments: 1,
    postback_url: `${appUrl}/webhook/unicopag`,
    expire_in_days: 3,
    customer: {
      name: aluno.nome,
      email: aluno.email,
      document: (aluno.cpfCnpj || '').replace(/\D/g, ''),
      document_type: (aluno.cpfCnpj || '').replace(/\D/g, '').length === 14 ? 'cnpj' : 'cpf',
      phone_number: telefone,
    },
    cart: [
      {
        hash: matriculaId,
        title: nomeCurso,
        price: valorCentavos,
        quantity: 1,
        operation_type: 1,
      },
    ],
    metadata: { order_id: matriculaId },
  };

  const resp = await fetch(`${API_BASE}/public/v1/payments?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  console.log('[UnicopAg] Resposta:', JSON.stringify(data));

  if (!resp.ok) throw new Error(data?.message || 'Erro ao criar pagamento.');

  // Para PIX: retorna QR code (sem link_checkout)
  // Para cartão: pode retornar link_checkout
  const checkoutUrl = data.link_checkout || null;
  const pixQrCode = data.pix?.pix_qr_code || null;
  const pixUrl = data.pix?.pix_url || null;
  const gatewayRef = data.hash ?? data.id;

  return { checkoutUrl, pixQrCode, pixUrl, gatewayRef, raw: data };
}

module.exports = { criarTransacao, mapearMetodo };
