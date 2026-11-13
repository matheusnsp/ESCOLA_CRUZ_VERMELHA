// lib/parse-form.js — leitura de números dos formulários do painel (movido de routes/admin.js sem mudar nada).

// "150,50" ou "150.50" -> 150.5; vazio -> NaN (ou null se opcional); negativo ou texto -> NaN.
function parseDecimal(v, { opcional = false } = {}) {
  if (v == null || String(v).trim() === '') return opcional ? null : NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function parseInteiro(v, { min = 0 } = {}) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min ? n : NaN;
}

module.exports = { parseDecimal, parseInteiro };
