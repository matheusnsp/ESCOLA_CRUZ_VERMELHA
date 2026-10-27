// Regras da conta de aluno criada no cadastro: usadas pelo /cadastro (routes/auth.js) e pela
// matrícula rápida da Escola Digital, para as duas contas nascerem do mesmo jeito.

const POLITICA_VERSAO = '2026-10-07'; // data da Política de Privacidade em vigor (views/privacidade.ejs)

// Senha inicial: os 4 últimos caracteres do documento (CPF/CNPJ só com dígitos, ou passaporte).
function senhaPadraoDoDocumento({ tipoDocumento, cpfCnpjNormalizado, passaporte }) {
  const base = tipoDocumento === 'PASSAPORTE'
    ? (passaporte || '').replace(/[^A-Z0-9]/g, '')
    : (cpfCnpjNormalizado || '');
  return base.slice(-4);
}

module.exports = { POLITICA_VERSAO, senhaPadraoDoDocumento };
