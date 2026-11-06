// lib/ead-conta.js
//
// Avisos de conta no curso online. "Cadastro incompleto" é a MESMA regra da faixa da Minha conta
// (views/minha-conta.ejs) e do /completar-dados. A senha provisória usa lib/seguranca.js precisaTrocarSenha.

const CAMPOS = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'escolaridade', 'escolaridadeSituacao'];

const cadastroIncompleto = (usuario) => CAMPOS.some((c) => !usuario[c]);

module.exports = { cadastroIncompleto };
