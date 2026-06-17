// Avaliacao de forca de senha no SERVIDOR (a barra no navegador e so o espelho).
// Usamos zxcvbn (criada pelo Dropbox): mede a forca real e penaliza senhas
// previsiveis ou que reutilizam dados pessoais (nome, e-mail).
const zxcvbn = require('zxcvbn');

// Exigimos pontuacao >= 3 ("Boa"). Escala do zxcvbn: 0 a 4.
const PONTUACAO_MINIMA = 3;

// userInputs: lista de strings pessoais (nome, e-mail) para a senha NAO poder
// se basear nelas.
function avaliarSenha(senha, userInputs = []) {
  const entradas = userInputs.filter(Boolean).map(String);
  const r = zxcvbn(senha, entradas);
  return {
    score: r.score, // 0..4
    ok: r.score >= PONTUACAO_MINIMA,
  };
}

const MENSAGEM_SENHA_FRACA =
  'Senha muito fraca ou previsível. Use uma combinação mais longa e menos óbvia (evite dados pessoais e sequências comuns).';

module.exports = { avaliarSenha, PONTUACAO_MINIMA, MENSAGEM_SENHA_FRACA };
