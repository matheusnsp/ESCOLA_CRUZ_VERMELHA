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
  const porEmail = e ? await prisma.usuario.findFirst({ where: { email: { equals: e, mode: 'insensitive' } } }) : null;
  const porCpf = cpfN ? await prisma.usuario.findFirst({ where: { cpfCnpj: cpfN } }) : null;
  if (porEmail && porCpf && porEmail.id !== porCpf.id) return { ok: false, erro: 'O e-mail e o CPF são de contas diferentes. Confira os dados.' };
  const achada = porEmail || porCpf;
  if (achada && !ehAnonimo(achada.email)) return { ok: true, usuario: achada, nova: false };
  if (achada) return { ok: false, erro: 'Esta conta foi excluída. A pessoa precisa se cadastrar de novo pelo site.' };

  if (n.length < 3) return { ok: false, erro: 'Nome: pelo menos 3 letras.' };
  if (!e || !cpfN) return { ok: false, erro: 'Para criar a conta, informe e-mail e CPF.' };
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

module.exports = { contaParaPessoa, senhaPadraoDoDocumento };
