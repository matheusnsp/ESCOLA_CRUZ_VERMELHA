// Validação e formatação de CPF/CNPJ (dígitos verificadores). Tudo no servidor.

function soDigitos(v) {
  return (v || '').replace(/\D/g, '');
}

function validarCPF(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(cpf[10], 10);
}

function validarCNPJ(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base) => {
    let pos = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(cnpj.slice(0, 12));
  if (d1 !== parseInt(cnpj[12], 10)) return false;
  const d2 = calc(cnpj.slice(0, 13));
  return d2 === parseInt(cnpj[13], 10);
}

// Recebe o valor digitado e devolve { ok, tipo, normalizado }.
function validarCpfCnpj(valor) {
  const d = soDigitos(valor);
  if (d.length === 11 && validarCPF(d)) return { ok: true, tipo: 'CPF', normalizado: d };
  if (d.length === 14 && validarCNPJ(d)) return { ok: true, tipo: 'CNPJ', normalizado: d };
  return { ok: false };
}

function formatar(d) {
  d = soDigitos(d);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

// Versão mascarada para exibir no perfil (esconde o miolo).
function mascarar(d) {
  d = soDigitos(d);
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9, 11)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/****-${d.slice(12, 14)}`;
  return d ? '***' : '';
}

module.exports = { validarCpfCnpj, formatar, mascarar, soDigitos };
