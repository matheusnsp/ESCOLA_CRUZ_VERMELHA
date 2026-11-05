// CPF válido e aleatório para os testes (o campo é único no banco de desenvolvimento).
module.exports = function cpf() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) { const s = d.reduce((a, x, i) => a + x * (n + 1 - i), 0); d.push((s * 10) % 11 % 10); }
  return d.join('');
};
