const fetch = require('node-fetch');

// ── Contas da Únicopag ────────────────────────────────────────────────────
// A escola recebe em duas contas. Cada curso escolhe a sua na secretaria (extra do curso
// "contaUnicopag"; sem escolha = principal). O Pagamento guarda por qual passou em `gateway`:
// 'unicopag' (principal, como sempre foi) ou 'unicopag-2'. O webhook é o mesmo para as duas
// (o pagamento é achado pelo hash). Variáveis no Render:
//   principal: UNICOPAG_API_TOKEN,   SELLER_DOCUMENT,   UNICOPAG_NOME   (nome na tela, opcional)
//   segunda:   UNICOPAG_API_TOKEN_2, SELLER_DOCUMENT_2, UNICOPAG_NOME_2 (nome na tela, opcional)
// A segunda é a conta da matrícula rápida do site da instituição: a aba Matrícula rápida lê as
// transações dela e o "Encaixar na turma" grava a taxa paga lá com gateway 'unicopag-2'.
const CONTAS = {
  principal: { id: 'principal', gateway: 'unicopag', token: 'UNICOPAG_API_TOKEN', doc: 'SELLER_DOCUMENT', nome: 'UNICOPAG_NOME', padrao: 'Conta 1' },
  segunda: { id: 'segunda', gateway: 'unicopag-2', token: 'UNICOPAG_API_TOKEN_2', doc: 'SELLER_DOCUMENT_2', nome: 'UNICOPAG_NOME_2', padrao: 'Instituição (matrícula rápida)' },
};
function conta(id) {
  const c = CONTAS[id] || CONTAS.principal;
  return {
    id: c.id, gateway: c.gateway,
    nome: (process.env[c.nome] || '').trim() || c.padrao,
    token: (process.env[c.token] || '').trim(),
    tokenVar: c.token,
    sellerDoc: process.env[c.doc] || '',
    configurada: !!(process.env[c.token] || '').trim(),
  };
}
// Para telas: [{ id, nome, configurada }]
function listarContas() {
  return Object.keys(CONTAS).map((id) => { const c = conta(id); return { id: c.id, nome: c.nome, configurada: c.configurada }; });
}
// Conta de um Pagamento já feito ('unicopag-2' → segunda; o resto → principal).
const contaDoGateway = (gateway) => (gateway === CONTAS.segunda.gateway ? 'segunda' : 'principal');

/**
 * Sanitiza strings deixando apenas números
 */
function apenasNumeros(valor) {
  if (!valor) return '';
  return String(valor).replace(/\D/g, '');
}

/**
 * Consulta o parcelamento com juros reais para um valor em centavos.
 * Retorna o array de opções (uma por número de parcelas) ou null se falhar.
 *
 * Formato real da resposta da Únicopag (a documentação oficial mostra campos
 * diferentes, então use este formato, confirmado por teste direto na API):
 * {
 *   data: [
 *     { installments: 2, installment_rate: 6, installment_amount: 530, total_amount: 1060 },
 *     ...
 *   ]
 * }
 */


async function consultarParcelamento(amountCentavos, contaId) {
  const c = conta(contaId);
  const token = c.token;
  if (!token) {
    console.warn(`[PARCELAMENTO] ${c.tokenVar} não configurado.`);
    return null;
  }

  try {
    const url = `https://api.cloud.unicopag.com.br/public/v1/installments?amount=${amountCentavos}&api_token=${token.trim()}`;
    const resp = await fetch(url);
    const json = await resp.json();

    if (!resp.ok || !Array.isArray(json.data)) {
      console.warn('[PARCELAMENTO] Resposta inesperada da API:', JSON.stringify(json));
      return null;
    }

    return json.data;
  } catch (err) {
    console.warn('[PARCELAMENTO] Falha ao consultar parcelamento:', err);
    return null;
  }
}

/**
 * Retorna a opção de parcelamento (com juros) para um número específico de parcelas.
 * Se não encontrar ou a consulta falhar, retorna null — quem chamar deve decidir o fallback.
 */
async function obterOpcaoParcelamento(amountCentavos, numeroParcelas, contaId) {
  const opcoes = await consultarParcelamento(amountCentavos, contaId);
  if (!opcoes) return null;
  return opcoes.find((o) => o.installments === numeroParcelas) || null;
}

/**
 * Cria uma transação transparente na Únicopag (Pix ou Crédito)
 *
 * @param {Object} params
 * @param {string} params.tipoPagamento - 'TAXA' ou 'CURSO'. Usado apenas para
 *   logging/clareza; a lógica de negócio de qual é qual fica na rota, não aqui.
 */
async function criarTransacao({ matriculaId, nomeCurso, valorTotal, forma, aluno, dadosCartao, tipoPagamento, conta: contaId }) {
  const c = conta(contaId);
  const token = c.token;

  // Sem a chave da conta escolhida, não cobra (cair na outra conta mandaria o dinheiro para o lugar errado).
  if (!token) {
    throw new Error(`Chave ${c.tokenVar} não configurada no ambiente (.env)`);
  }

  const isCredito = forma === 'CREDITO';
  const appUrl = process.env.APP_URL || 'https://escola-cruz-vermelha.onrender.com';

  const valorTratado = parseFloat(valorTotal || 0).toFixed(2);
  const amountCentavos = Math.round(parseFloat(valorTratado) * 100);

  // Tanto PIX quanto Cartão usam o mesmo endpoint e a mesma autenticação via query string.
  const urlFinal = 'https://api.cloud.unicopag.com.br/public/v1/payments';
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const urlComAuth = `${urlFinal}?api_token=${token.trim()}`;

  let payload;

  if (isCredito) {
    // Formato do metadata de antifraude conforme a doc oficial da Únicopag
    // (campos exigidos/recomendados pela adquirência para aprovar cartão).
    // Datas em 'YYYY-MM-DD HH:mm:ss'. Onde não temos o dado real do aluno,
    // usamos a data de criação da matrícula como referência sensata.
    const agora = new Date();
    const fmt = (d) => {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    // Data de cadastro do aluno, se veio no objeto; senão, agora.
    const cadastroCliente = aluno.criadoEm ? new Date(aluno.criadoEm) : agora;
    // CNPJ da escola (vendedor). Configurável por env; fallback para o CNPJ da CVB-RJ.
    const sellerDoc = apenasNumeros(c.sellerDoc);

    const metadataCartao = {
      order_id: String(matriculaId),
      customer_created_at: fmt(cadastroCliente),
      customer_first_transaction_at: fmt(agora),
      customer_last_transaction_at: fmt(agora),
      number_paid_proposals: 0,
    };
    if (sellerDoc) metadataCartao.seller_document = sellerDoc;

    payload = {
      amount: amountCentavos,
      payment_method: 'credit_card',
      installments: Number(dadosCartao.parcelas || 1),
      postback_url: `${appUrl}/webhook/unicopag`,
      metadata: metadataCartao,
      customer: {
        name: aluno.nome,
        email: aluno.email,
        phone_number: apenasNumeros(aluno.celular),
        document: apenasNumeros(aluno.cpfCnpj),
        zip_code: apenasNumeros(aluno.cep),
        street_name: aluno.logradouro || 'Rua não informada',
        number: aluno.numero || 'SN',
        complement: aluno.complemento || '',
        neighborhood: aluno.bairro || 'Bairro não informado',
        city: aluno.cidade || 'Rio de Janeiro',
        state: aluno.uf || 'RJ'
      },
      cart: [{
        id: String(matriculaId),
        hash: String(matriculaId),
        title: nomeCurso,
        price: amountCentavos,
        quantity: 1,
        operation_type: 1
      }],
      card: {
        number: apenasNumeros(dadosCartao.numero),
        holdername: dadosCartao.titular,
        exp_month: String(dadosCartao.mesExpiracao).padStart(2, '0'),
        exp_year: String(dadosCartao.anoExpiracao),
        cvv: String(dadosCartao.cvv)
      }
    };
  } else {
    // PIX: o gateway passou a exigir installments mesmo no PIX (422 sem ele).
    // metadata.order_id segue o mesmo padrão do cartão — dá um caminho extra
    // de match no webhook caso o postback ecoe o metadata.
    payload = {
      amount: amountCentavos,
      payment_method: 'pix',
      installments: 1,
      postback_url: `${appUrl}/webhook/unicopag`,
      metadata: {
        order_id: String(matriculaId)
      },
      customer: {
        name:         aluno.nome,
        email:        aluno.email,
        phone_number: apenasNumeros(aluno.celular),
        document:     apenasNumeros(aluno.cpfCnpj),
        zip_code:     apenasNumeros(aluno.cep),
        street_name:  aluno.logradouro || 'Rua não informada',
        number:       aluno.numero || 'SN',
        complement:   aluno.complemento || null,
        neighborhood: aluno.bairro || 'Bairro não informado',
        city:         aluno.cidade || 'Rio de Janeiro',
        state:        aluno.uf || 'RJ',
      },
      cart: [{
        hash:           String(matriculaId),
        title:          nomeCurso,
        price:          amountCentavos,
        quantity:       1,
        operation_type: 1,
      }]
    };
  }

  console.log(`[MONITORAMENTO CARTÃO] ➡️ 1. Enviando Transação. Matrícula Original: ${matriculaId} | Tipo: ${tipoPagamento || 'N/A'} | Conta: ${c.id} | Método: ${isCredito ? 'credit_card' : 'pix'}`);

  const fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  };

  // PIX: fluxo síncrono com timeout de 35s.
  // O gateway responde com sucesso em ~30s na maioria dos casos.
  // Se estourar o timeout, lançamos erro para o cursos.js tratar com a
  // janela de espera pelo webhook (comportamento anterior mantido como fallback).
  if (!isCredito) {
    console.log(`[PIX] Payload enviado (tipo: ${tipoPagamento || 'N/A'}):`, JSON.stringify(payload));

    const response = await fetch(urlComAuth, {
      ...fetchOptions,
      signal: AbortSignal.timeout(35000),
    });

    const textBody = await response.text();

    if (!response.ok) {
      console.error(`[PIX] ❌ Resposta de erro do gateway (${response.status}):`, textBody);
      throw new Error(`Gateway Pix: ${textBody || 'Erro desconhecido'}`);
    }

    let result;
    try {
      const json = JSON.parse(textBody);
      result = json.result || json;
    } catch (e) {
      console.warn('[PIX] Resposta não era JSON:', textBody.slice(0, 200));
      throw new Error('Gateway Pix retornou resposta inválida.');
    }

    const pix = result.pix || {};
    console.log(`[PIX] ✅ Resposta recebida. hash: ${result.hash} | id: ${result.id}`);
    console.log('[PIX] Objeto pix completo:', JSON.stringify(pix));

    return {
      success: true,
      gateway: c.gateway, // grava em Pagamento.gateway: diz em qual conta caiu

      id: result.id || null,
      hash: result.hash || null,

      gatewayRef: String(result.hash || result.id || matriculaId),

      paymentStatus: result.payment_status || 'pending',

      pixQrCode: pix.pix_qr_code || null,
      pixUrl: pix.pix_url || null,
      pixBase64: pix.pix_base64 || null
  };
  }

  // CARTÃO: fluxo síncrono normal
  const response = await fetch(urlComAuth, fetchOptions);
  const textBody = await response.text();

  if (!response.ok) {
    console.error(`[MONITORAMENTO CARTÃO] ❌ Erro na API Unicopag (${response.status}):`, textBody);
    throw new Error(`Gateway: ${textBody || 'Erro desconhecido'}`);
  }

  let json;

  try {
      json = JSON.parse(textBody);
  } catch {
      console.error(textBody);
      throw new Error('Resposta inválida da UnicoPag.');
  }
  const result = json.result || json;

  console.log(`[MONITORAMENTO CARTÃO] ⬅️ 2. Resposta da API recebida. hash gerado: ${result.hash} | id gerado: ${result.id}`);

  return {
    success: true,
    gateway: c.gateway,

    id: result.id || null,
    hash: result.hash || null,

    gatewayRef: String(result.hash || result.id || matriculaId),

    paymentStatus: result.payment_status || 'pending',

    installments: result.installments || Number(dadosCartao.parcelas || 1),

    checkoutUrl: result.checkout_url || null,

    pixQrCode: null,
    pixUrl: null,
    pixBase64: null
  };
}

/**
 * Reembolsa (estorna) uma transação já paga na Únicopag.
 *
 * Endpoint oficial: POST /public/v1/payments/:id/refund
 * Só transações com status "paid" podem ser reembolsadas. A doc oficial retorna:
 *   sucesso → transaction.payment_status === "refunded"
 *   erro    → HTTP 400 com transaction.payment_status diferente (ex.: waiting_payment)
 *
 * @param {string} ref - id/hash da transação (o gatewayRef/gatewayHash salvo no Pagamento).
 * @returns {Promise<{success: boolean, body: object}>} - formato que o admin.js espera.
 */
async function estornarTransacao(ref, contaId) {
  const c = conta(contaId);
  const token = c.token;

  if (!token) {
    console.error(`[REFUND] ${c.tokenVar} não configurado.`);
    return { success: false, body: { message: 'Gateway não configurado (token ausente).' } };
  }
  if (!ref) {
    return { success: false, body: { message: 'Referência da transação ausente.' } };
  }

  // Mesmo host e mesma auth via query string usados nas outras chamadas.
  const url = `https://api.cloud.unicopag.com.br/public/v1/payments/${encodeURIComponent(ref)}/refund?api_token=${token.trim()}`;

  console.log(`[REFUND] ➡️ Solicitando estorno da transação: ${ref}`);

  let response, textBody;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    });
    textBody = await response.text();
  } catch (err) {
    console.error('[REFUND] ❌ Falha de rede ao contatar o gateway:', err.message);
    return { success: false, body: { message: 'Falha ao contatar o gateway.' } };
  }

  // Resposta pode vir embrulhada em .result (como nas outras chamadas) ou crua.
  let json;
  try {
    json = textBody ? JSON.parse(textBody) : {};
  } catch {
    console.error('[REFUND] ❌ Resposta não-JSON do gateway:', textBody.slice(0, 200));
    return { success: false, body: { message: 'Resposta inválida do gateway.' } };
  }
  const body = json.result || json;
  const statusPagamento = body?.transaction?.payment_status;

  // IMPORTANTE: na Únicopag o refund é ASSÍNCRONO. Na prática ela responde
  // HTTP 200 com "Reembolso em processamento" e payment_status ainda "paid" —
  // a confirmação final ("refunded") chega DEPOIS, pelo webhook. Então NÃO dá
  // pra exigir "refunded" na resposta imediata (isso rejeitaria estornos válidos).
  //
  // Critério de sucesso = o gateway ACEITOU o pedido:
  //   - HTTP 2xx, E
  //   - já veio "refunded" (caso síncrono raro) OU a resposta não é um erro
  //     explícito (mensagem não contém "não foi possível" e não veio erro).
  // Um 400 "Não foi possível reembolsar" (ex.: transação não-paga) continua
  // caindo como falha, como manda a doc.
  const msg = String(body?.message || '').toLowerCase();
  const ehErroExplicito = msg.includes('não foi possível') || msg.includes('nao foi possivel') || body?.error;
  const ok = response.ok && !ehErroExplicito && (statusPagamento === 'refunded' || statusPagamento === 'paid' || msg.includes('processamento') || msg.includes('sucesso'));

  if (ok) {
    const assincrono = statusPagamento !== 'refunded';
    console.log(`[REFUND] ✅ Estorno de ${ref} aceito pelo gateway${assincrono ? ' (em processamento — confirmação virá pelo webhook)' : ''}.`);
  } else {
    console.error(`[REFUND] ❌ Estorno recusado. HTTP ${response.status} | payment_status: ${statusPagamento || 'N/A'} | msg: ${body?.message || textBody.slice(0, 200)}`);
  }

  return { success: ok, body };
}

// ── Consultas (mesma API e mesma autenticação por api_token das cobranças) ───────────────────
const BASE = 'https://api.cloud.unicopag.com.br/public/v1';

// Uma transação no formato da tela. Os nomes de campo seguem a Únicopag (payment_status,
// payment_method, amount em centavos, customer, cart, metadata); o que não vier fica null.
function transacaoDaApi(t) {
  if (!t || typeof t !== 'object') return null;
  const cliente = t.customer || {};
  const item = (Array.isArray(t.cart) && t.cart[0]) || (Array.isArray(t.items) && t.items[0]) || {};
  const centavos = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v) / 100);
  return {
    hash: String(t.hash || t.id || ''),
    status: String(t.payment_status || t.status || '').toLowerCase() || null,
    metodo: String(t.payment_method || '').toLowerCase() || null,
    parcelas: Number(t.installments) || null,
    valor: centavos(t.amount),
    valorTotal: centavos(t.amount_total !== undefined ? t.amount_total : t.amount),
    criadoEm: t.created_at || t.createdAt || null,
    pagoEm: t.paid_at || t.approved_at || null,
    nome: cliente.name || null,
    email: cliente.email ? String(cliente.email).toLowerCase() : null,
    documento: cliente.document ? apenasNumeros(cliente.document) : null,
    telefone: cliente.phone_number ? apenasNumeros(cliente.phone_number) : null,
    titulo: item.title || t.description || null,
    pedido: (t.metadata && t.metadata.order_id) || null,
  };
}

// Uma transação pelo hash (como o consultar-transacao.js). { status, raw } ou null.
async function consultarTransacao(ref, contaId) {
  const c = conta(contaId);
  if (!c.token || !ref) return null;
  try {
    const resp = await fetch(`${BASE}/transactions/${encodeURIComponent(ref)}?api_token=${c.token}`, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const t = json.transaction || json.result || json;
    return { status: String(t.payment_status || '').toLowerCase(), raw: t, transacao: transacaoDaApi(t) };
  } catch (e) {
    console.warn(`[UNICOPAG] consulta ${ref} (${c.id}) falhou:`, e.message);
    return null;
  }
}

// Todas as transações da conta (aba Matrícula rápida, com a conta da instituição). Lê página por
// página (até 10 de 100) e para quando a página vem vazia ou repetida. Guardado 2 min em memória.
// { ok: true, lista } ou { ok: false, erro: 'sem_chave' | 'chave' | 'formato' | 'gateway' }.
const cacheTransacoes = new Map();
async function listarTransacoes(contaId, { forcar = false } = {}) {
  const c = conta(contaId);
  if (!c.token) return { ok: false, erro: 'sem_chave' };
  const guardado = cacheTransacoes.get(c.id);
  if (!forcar && guardado && Date.now() - guardado.em < 2 * 60000) return guardado.r;
  const lista = [];
  const vistos = new Set();
  try {
    for (let pagina = 1; pagina <= 10; pagina++) {
      const resp = await fetch(`${BASE}/transactions?api_token=${c.token}&page=${pagina}&per_page=100`, { headers: { Accept: 'application/json' } });
      if (resp.status === 401 || resp.status === 403) return { ok: false, erro: 'chave' };
      if (!resp.ok) { if (pagina === 1) return { ok: false, erro: 'gateway' }; break; }
      const json = await resp.json();
      const bruto = json.data || (json.result && (json.result.data || json.result)) || json.transactions || json;
      const itens = Array.isArray(bruto) ? bruto : (bruto && Array.isArray(bruto.data) ? bruto.data : null);
      if (!itens) { if (pagina === 1) return { ok: false, erro: 'formato' }; break; }
      const novos = itens.map(transacaoDaApi).filter((t) => t && t.hash && !vistos.has(t.hash));
      if (!novos.length) break;
      novos.forEach((t) => { vistos.add(t.hash); lista.push(t); });
      if (itens.length < 100) break;
    }
  } catch (e) {
    console.warn(`[UNICOPAG] lista de transações (${c.id}) falhou:`, e.message);
    return { ok: false, erro: 'gateway' };
  }
  const r = { ok: true, lista };
  cacheTransacoes.set(c.id, { em: Date.now(), r });
  return r;
}

module.exports = {
  criarTransacao, consultarParcelamento, obterOpcaoParcelamento, estornarTransacao, conta, listarContas, contaDoGateway,
  consultarTransacao, listarTransacoes,
};