// lib/escola-digital/inscricao.js
//
// Matrícula rápida da Escola Digital (spec §5.2): cria a conta de aluno, se preciso, e a
// InscricaoOnline aguardando pagamento. Não conhece o Express: recebe os dados e devolve um
// resultado; a rota cuida de sessão, redirecionamento e tela.
//
//   matricular({ cursoId, usuarioLogadoId?, dados?: { nome, cpf, celular, email, aceite } })
//     -> { ok: true, inscricao, contaNova }
//      | { ok: false, motivo: 'precisa_login' }
//      | { ok: false, motivo: 'invalido', erros: string[], campos: { [campo]: string } }

const { z } = require('zod');
const prisma = require('../../db');
const { hashSenha } = require('../password');
const { validarCpfCnpj } = require('../documento');
const { POLITICA_VERSAO, senhaPadraoDoDocumento } = require('../cadastro-aluno');
const { enviarConfirmacao } = require('../confirmacao-email');
const { ehAnonimo } = require('../excluir-conta');

const MSG_ACEITE = 'Aceite os termos do curso online e a Política de Privacidade.';

const emailSchema = z.string().trim().toLowerCase().email().max(180);

const aceitou = (v) => v === true || v === 'on' || v === 'true' || v === '1' || v === 1;

// Confere os dados do formulário. Mesmas regras do /cadastro: nome e sobrenome, e-mail válido,
// CPF com dígitos verificadores, celular com DDD (10 ou 11 dígitos). Devolve os valores já
// normalizados ou uma mensagem por campo.
function validarDados(dados, { exigirAceite = true } = {}) {
  const d = dados || {};
  const campos = {};

  const nome = String(d.nome || '').trim().replace(/\s+/g, ' ');
  if (nome.length < 3 || nome.split(' ').length < 2) campos.nome = 'Informe nome e sobrenome.';

  const cpfValidado = validarCpfCnpj(String(d.cpf || ''));
  if (!cpfValidado.ok || cpfValidado.tipo !== 'CPF') campos.cpf = 'CPF inválido.';

  const celular = String(d.celular || '').replace(/\D/g, '');
  if (celular.length !== 10 && celular.length !== 11) campos.celular = 'Celular inválido. Informe o DDD e o número.';

  const emailLido = emailSchema.safeParse(String(d.email || ''));
  if (!emailLido.success) campos.email = 'E-mail inválido.';

  if (exigirAceite && !aceitou(d.aceite)) campos.aceite = MSG_ACEITE;

  if (Object.keys(campos).length) return { ok: false, campos };
  return { ok: true, valores: { nome, cpf: cpfValidado.normalizado, celular, email: emailLido.data } };
}

const invalido = (campos) => ({ ok: false, motivo: 'invalido', erros: Object.values(campos), campos });

const inscricaoDo = (alunoId, cursoId) =>
  prisma.inscricaoOnline.findUnique({ where: { alunoId_cursoId: { alunoId, cursoId } } });

// P2002 na chave única (alunoId, cursoId): outra requisição criou a inscrição um instante antes.
const ehCorridaDaInscricao = (e) => e && e.code === 'P2002' && String(e.meta && e.meta.target).includes('alunoId');

// Aluno já logado: usa a conta dele e ignora os dados do formulário, exceto o aceite quando o
// consentimento gravado não é o da política em vigor.
async function matricularLogado({ cursoId, usuarioLogadoId, dados }) {
  const aluno = await prisma.usuario.findUnique({
    where: { id: usuarioLogadoId },
    select: { id: true, papel: true, bloqueioTotal: true, consentimentoVersao: true },
  });
  if (!aluno || aluno.papel !== 'ALUNO' || aluno.bloqueioTotal) {
    return invalido({ conta: 'Para se matricular, entre com uma conta de aluno.' });
  }

  const existente = await inscricaoDo(aluno.id, cursoId);
  if (existente) return { ok: true, inscricao: existente, contaNova: false };

  const precisaAceite = aluno.consentimentoVersao !== POLITICA_VERSAO;
  if (precisaAceite && !aceitou(dados && dados.aceite)) return invalido({ aceite: MSG_ACEITE });

  try {
    const inscricao = await prisma.$transaction(async (tx) => {
      if (precisaAceite) {
        await tx.usuario.update({ where: { id: aluno.id }, data: { consentimentoLgpdEm: new Date(), consentimentoVersao: POLITICA_VERSAO } });
      }
      return tx.inscricaoOnline.create({ data: { alunoId: aluno.id, cursoId } });
    });
    return { ok: true, inscricao, contaNova: false };
  } catch (e) {
    if (!ehCorridaDaInscricao(e)) throw e;
    return { ok: true, inscricao: await inscricaoDo(aluno.id, cursoId), contaNova: false };
  }
}

// Visitante: cria a conta (papel ALUNO, CPF, senha = 4 últimos dígitos, e-mail por confirmar,
// consentimento LGPD) e a inscrição numa transação só, para uma falha não deixar conta sem inscrição.
// CPF ou e-mail que já têm conta não criam nada: a pessoa precisa entrar.
async function matricularNovo({ cursoId, dados }) {
  const v = validarDados(dados);
  if (!v.ok) return invalido(v.campos);
  const { nome, cpf, celular, email } = v.valores;

  const existentes = await prisma.usuario.findMany({
    where: { OR: [{ cpfCnpj: cpf }, { email }] },
    select: { id: true, email: true, cpfCnpj: true },
  });
  if (existentes.some((u) => !ehAnonimo(u.email))) return { ok: false, motivo: 'precisa_login' };
  // Conta excluída e anonimizada (lib/excluir-conta.js) com este CPF: volta a ser usada, como no /cadastro.
  const antiga = existentes.find((u) => u.cpfCnpj === cpf);

  const senhaPadrao = senhaPadraoDoDocumento({ tipoDocumento: 'CPF', cpfCnpjNormalizado: cpf });
  const senhaHash = await hashSenha(senhaPadrao);
  const dadosConta = {
    nome, email, celular, senhaHash,
    tipoDocumento: 'CPF', cpfCnpj: cpf,
    papel: 'ALUNO', emailVerificado: false,
    consentimentoLgpdEm: new Date(), consentimentoVersao: POLITICA_VERSAO,
  };

  let usuario;
  let inscricao;
  try {
    ({ usuario, inscricao } = await prisma.$transaction(async (tx) => {
      const u = antiga
        ? await tx.usuario.update({ where: { id: antiga.id }, data: { ...dadosConta, bloqueioTotal: false } })
        : await tx.usuario.create({ data: dadosConta });
      const i = (antiga && await tx.inscricaoOnline.findUnique({ where: { alunoId_cursoId: { alunoId: u.id, cursoId } } }))
        || await tx.inscricaoOnline.create({ data: { alunoId: u.id, cursoId } });
      return { usuario: u, inscricao: i };
    }));
  } catch (e) {
    // Cadastro simultâneo com o mesmo CPF ou e-mail: a outra requisição ganhou, esta precisa entrar.
    if (e && e.code === 'P2002') return { ok: false, motivo: 'precisa_login' };
    throw e;
  }

  try { await enviarConfirmacao(usuario); } catch (e) {
    console.error('[Matrícula] Falha ao enviar e-mail de confirmação:', e.message);
  }
  return { ok: true, inscricao, contaNova: true };
}

async function matricular({ cursoId, usuarioLogadoId, dados }) {
  if (usuarioLogadoId) return matricularLogado({ cursoId, usuarioLogadoId, dados });
  return matricularNovo({ cursoId, dados });
}

module.exports = { matricular, validarDados, MSG_ACEITE };
