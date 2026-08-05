// teste-cartao.js
// Rode na raiz do projeto: node teste-cartao.js
// Lê o .env.dev automaticamente.

require('dotenv').config({ path: '.env.dev' });
const fetch = require('node-fetch');

// ─── PREENCHA AQUI ───────────────────────────────────────────────────────────
const CARTAO = {
  numero:       '5502091449125807',  // número do cartão (só dígitos)
  titular:      'MATHEUS N S PEREIRA',
  mes:          '05',               // mês de expiração (2 dígitos)
  ano:          '2034',             // ano de expiração (4 dígitos)
  cvv:          '949',
  parcelas:     1,
};

const CLIENTE = {
  nome:         'Matheus Neves Soares Pereira',
  email:        'email@teste.com',
  cpf:          '19788026761',      // só dígitos, 11 caracteres
  celular:      '21999999999',      // só dígitos, com DDD
  cep:          '20040020',         // só dígitos
  logradouro:   'Rua da Cruz Vermelha',
  numero:       '10',
  complemento:  '',
  bairro:       'Centro',
  cidade:       'Rio de Janeiro',
  uf:           'RJ',
};

const VALOR_REAIS = 10.00; // valor do teste em reais
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.UNICOPAG_API_TOKEN;
  if (!token) {
    console.error('❌ UNICOPAG_API_TOKEN não encontrado no .env.dev');
    process.exit(1);
  }

  const amountCentavos = Math.round(VALOR_REAIS * 100);

  const payload = {
    amount: amountCentavos,
    payment_method: 'credit_card',
    installments: CARTAO.parcelas,
    postback_url: 'https://httpbin.org/post', // endpoint de teste público
    metadata: { order_id: 'teste-' + Date.now() },
    customer: {
      name:         CLIENTE.nome,
      email:        CLIENTE.email,
      phone_number: CLIENTE.celular,
      document:     CLIENTE.cpf,
      zip_code:     CLIENTE.cep,
      street_name:  CLIENTE.logradouro,
      number:       CLIENTE.numero,
      complement:   CLIENTE.complemento || '',
      neighborhood: CLIENTE.bairro,
      city:         CLIENTE.cidade,
      state:        CLIENTE.uf,
    },
    cart: [{
      id:             'item-teste',
      hash:           'item-teste',
      title:          'Curso Teste',
      price:          amountCentavos,
      quantity:       1,
      operation_type: 1,
    }],
    card: {
      number:     CARTAO.numero.replace(/\D/g, ''),
      holdername: CARTAO.titular,
      exp_month:  CARTAO.mes,
      exp_year:   CARTAO.ano,
      cvv:        CARTAO.cvv,
    },
  };

  const url = `https://api.cloud.unicopag.com.br/public/v1/payments?api_token=${token.trim()}`;

  console.log('\n🔑 Token (primeiros 8 chars):', token.trim().slice(0, 8) + '...');
  console.log('💳 Valor:', `R$ ${VALOR_REAIS.toFixed(2)}`);
  console.log('📦 Payload:\n', JSON.stringify(payload, null, 2));
  console.log('\n⏳ Enviando para a Únicopag...\n');

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }

    if (resp.ok) {
      console.log('✅ SUCESSO! Resposta da API:');
      console.log(JSON.stringify(json, null, 2));
    } else {
      console.error(`❌ ERRO ${resp.status}:`);
      console.error(JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.error('❌ Falha de rede:', err.message);
  }
}

main();
