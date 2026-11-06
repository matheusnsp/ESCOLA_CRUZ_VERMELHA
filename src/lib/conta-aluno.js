// lib/conta-aluno.js
//
// Conta de aluno criada por outra pessoa (o gestor da escola ou a secretaria, etapa 6), no mesmo formato
// do /cadastro: papel ALUNO, senha inicial com os 4 últimos dígitos do documento, avisos de trocar a senha
// e completar o cadastro no primeiro acesso. Quem já tem conta (mesmo e-mail ou CPF) é reaproveitado.

const prisma = require('../db');
const { hashSenha } = require('./password');
const { validarCpfCnpj, soDigitos } = require('./documento');
const { ehAnonimo } = require('./excluir-conta');

// Senha inicial: os 4 últimos caracteres do documento (CPF/CNPJ ou passaporte).
function senhaPadraoDoDocumento({ tipoDocumento, cpfCnpjNormalizado, passaporte }) {
  const base = tipoDocumento === 'PASSAPORTE'
    ? (passaporte || '').replace(/[^A-Z0-9]/g, '')
    : (cpfCnpjNormalizado || '');
  return base.slice(-4);
}

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Mesma frase para todo dado que não bate com uma conta: quem cadastra (gestor de escola, de fora) não
// pode descobrir, chutando um e-mail ou um CPF, de quem é a conta nem se ela existe.
const ERRO_DADOS = 'Não foi possível usar esses dados. Confira o e-mail e o CPF da pessoa.';

async function contaParaPessoa({ nome, email, celular, cpf }) {
  const n = String(nome || '').trim().replace(/\s+/g, ' ');
  const e = String(email || '').trim().toLowerCase();
  const digitos = soDigitos(cpf || '');
  let cpfN = null;
  if (digitos) {
    const v = validarCpfCnpj(digitos);
    if (!v.ok || v.tipo !== 'CPF') return { ok: false, erro: 'CPF inválido.' };
    cpfN = v.normalizado;
  }
  if (e && !emailValido(e)) return { ok: false, erro: 'E-mail inválido.' };
  // E-mail e CPF sempre juntos, e uma conta existente só é usada se os dois forem dela.
  if (!e || !cpfN) return { ok: false, erro: 'Informe o e-mail e o CPF da pessoa.' };
  const porEmail = await prisma.usuario.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } });
  const porCpf = await prisma.usuario.findFirst({ where: { cpfCnpj: cpfN } });
  if (porEmail || porCpf) {
    const mesma = porEmail && porCpf ? porEmail.id === porCpf.id
      : porEmail ? !porEmail.cpfCnpj || porEmail.cpfCnpj === cpfN
        : false; // achou só pelo CPF: o e-mail digitado não é o da conta
    if (!mesma) return { ok: false, erro: ERRO_DADOS };
    const achada = porEmail || porCpf;
    if (ehAnonimo(achada.email)) return { ok: false, erro: ERRO_DADOS };
    return { ok: true, usuario: achada, nova: false };
  }

  if (n.length < 3) return { ok: false, erro: 'Nome: pelo menos 3 letras.' };
  const senhaInicial = senhaPadraoDoDocumento({ tipoDocumento: 'CPF', cpfCnpjNormalizado: cpfN });
  try {
    const usuario = await prisma.usuario.create({
      data: {
        nome: n, email: e, tipoDocumento: 'CPF', cpfCnpj: cpfN, celular: String(celular || '').trim() || null,
        senhaHash: await hashSenha(senhaInicial), papel: 'ALUNO', emailVerificado: false,
      },
    });
    return { ok: true, usuario, nova: true, senhaInicial };
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    // Corrida: a conta foi criada agora por outro cadastro. Usa ela.
    const usuario = await prisma.usuario.findFirst({ where: { OR: [{ email: { equals: e, mode: 'insensitive' } }, { cpfCnpj: cpfN }] } });
    return usuario ? { ok: true, usuario, nova: false } : { ok: false, erro: 'Não foi possível criar a conta. Tente de novo.' };
  }
}

// Para onde o cadastro novo volta: o curso de onde a pessoa veio (link de teste ou curso pago) ou o
// convite da escola (etapa 6). Qualquer outro destino é ignorado (vai para a Minha conta).
const VOLTAS = [/^\/ead-teste\/[A-Za-z0-9_-]+\/continuar$/, /^\/online\/[A-Za-z0-9_-]+\/continuar$/, /^\/escola\/convite\/[A-Za-z0-9_-]+$/];
const voltaDepoisDoCadastro = (returnTo) => (typeof returnTo === 'string' && VOLTAS.some((r) => r.test(returnTo)) ? returnTo : null);

module.exports = { contaParaPessoa, senhaPadraoDoDocumento, voltaDepoisDoCadastro, ERRO_DADOS };
