// lib/escola-digital/config.js
//
// Chave de liga/desliga da Escola Digital (cursos online). As variáveis de ambiente são lidas
// a cada chamada, e não no carregamento do módulo, para que testes e servidor vejam mudanças.
//
// ESCOLA_DIGITAL=1 liga a área /digital; qualquer outro valor (ou ausente) mantém desligada.
// ESCOLA_DIGITAL_PAGAMENTO_SIMULADO=1 troca o pagamento real por um simulado, só fora de produção.

const NOME = 'Escola Digital CVB-RJ';
const NOME_CURTO = 'Escola Digital';

function ligada() {
  return process.env.ESCOLA_DIGITAL === '1';
}

// Nunca simula pagamento em produção, mesmo com a variável ligada.
function pagamentoSimulado() {
  return process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO === '1' && process.env.NODE_ENV !== 'production';
}

module.exports = { ligada, pagamentoSimulado, NOME, NOME_CURTO };
