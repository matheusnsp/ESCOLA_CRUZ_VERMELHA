// Pequenos formatos da etapa 6 usados nas telas, no PDF e no Excel.
const { soDigitos } = require('./documento');

// CPF mascarado para a escola: ***.456.789-** (só o miolo aparece).
function mascararCpf(cpf) {
  const d = soDigitos(cpf || '');
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : '';
}

const ROTULO_ORIGEM = { GESTOR: 'Cadastrado pela escola', CONVITE: 'Pelo convite' };

module.exports = { mascararCpf, ROTULO_ORIGEM };
