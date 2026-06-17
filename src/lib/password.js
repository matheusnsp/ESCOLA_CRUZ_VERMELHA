// Hash de senha com argon2id (recomendação atual do OWASP).
const argon2 = require('argon2');

async function hashSenha(senhaEmTextoPuro) {
  return argon2.hash(senhaEmTextoPuro, { type: argon2.argon2id });
}

async function verificarSenha(hashArmazenado, senhaEmTextoPuro) {
  try {
    return await argon2.verify(hashArmazenado, senhaEmTextoPuro);
  } catch {
    // Hash malformado ou erro de verificação: trata como senha incorreta.
    return false;
  }
}

module.exports = { hashSenha, verificarSenha };
