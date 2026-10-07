// lib/excluir-conta.js
//
// "Excluir minha conta" (Minha conta → Excluir), conforme a Política de Privacidade (/privacidade):
//   - Só bloqueia com inscrição EM ANDAMENTO: taxa ou curso pago (ou parcelado, ou com a taxa já
//     confirmada) numa turma que ainda não foi concluída. Curso já concluído, cancelado ou
//     estornado não impede. Turma CANCELADA com dinheiro pago ainda bloqueia: falta o reembolso.
//   - Inscrição em que nunca entrou dinheiro (sem pagamento PAGO/ESTORNADO e sem status pago) é
//     apagada, com os pagamentos pendentes dela.
//   - Inscrição em que entrou dinheiro fica, porque a lei manda guardar o registro de pagamento
//     (obrigação legal, art. 7º, II e art. 16, I da LGPD). A conta então é ANONIMIZADA: ficam só o
//     nome e o documento (o mínimo que identifica quem pagou, para a contabilidade e para o
//     certificado já emitido); e-mail, celular, endereço, RG, senha e o resto são apagados, e a
//     conta fica bloqueada (o login para de funcionar e as outras sessões caem no requireLogin).
//   - Sem nenhuma inscrição guardada, a conta é apagada de vez (como antes).
//   - Respostas da pesquisa de satisfação: saem do site e perdem o nome.
//   - Comprovante da área da saúde: o arquivo e o registro são apagados.

const prisma = require('../db');
const comprovanteSaude = require('./comprovante-saude');

const FANTASMA = { NOT: { statusPagamento: 'PENDENTE', taxaConfirmada: false } };

// Inscrição em andamento: o que impede excluir.
const EM_ANDAMENTO = {
  ...FANTASMA,
  statusPagamento: { in: ['PENDENTE', 'PAGO', 'PARCELADO'] },
  turma: { status: { not: 'ENCERRADA' } },
};

function contarEmAndamento(alunoId) {
  return prisma.matricula.count({ where: { alunoId, ...EM_ANDAMENTO } });
}

const entrouDinheiro = (m) => ['PAGO', 'PARCELADO', 'ESTORNADO'].includes(m.statusPagamento)
  || m.taxaConfirmada
  || m.pagamentos.some((p) => p.status === 'PAGO' || p.status === 'ESTORNADO');

// E-mail que nunca recebe nada (domínio .invalid é reservado, RFC 2606) e não colide com outro.
const emailAnonimo = (id) => `conta-excluida-${id}@excluida.invalid`;
const ehAnonimo = (email) => /@excluida\.invalid$/i.test(String(email || ''));

// Tira a pesquisa do site e apaga o nome dela.
function opsPesquisa(cfgs) {
  return cfgs.map((c) => {
    let v = {};
    try { v = JSON.parse(c.valor); } catch (e) { v = {}; }
    const valor = JSON.stringify({ ...v, nome: null, nomePublico: 'Aluno', alunoId: null, autoriza: false, status: v.status === 'aprovada' ? 'oculta' : v.status });
    return prisma.configuracao.update({ where: { chave: c.chave }, data: { valor } });
  });
}

// Devolve 'apagada' ou 'anonimizada'. Quem chama já conferiu a senha e contarEmAndamento() === 0.
async function excluir(usuario) {
  const matriculas = await prisma.matricula.findMany({
    where: { alunoId: usuario.id },
    select: { id: true, statusPagamento: true, taxaConfirmada: true, pagamentos: { select: { status: true } } },
  });
  const guardar = matriculas.filter(entrouDinheiro).map((m) => m.id);
  const descartar = matriculas.filter((m) => !guardar.includes(m.id)).map((m) => m.id);
  const pesquisas = matriculas.length
    ? await prisma.configuracao.findMany({ where: { chave: { in: matriculas.map((m) => 'pesquisa:resp:' + m.id) } } })
    : [];

  // Comprovante da área da saúde: arquivo e registro saem junto (não é registro de pagamento).
  await comprovanteSaude.apagarDaPessoa(usuario.id).catch((e) => console.error('[EXCLUIR-CONTA] comprovante:', e.message));

  const ops = [
    ...opsPesquisa(pesquisas),
    prisma.pagamento.deleteMany({ where: { matriculaId: { in: descartar } } }),
    prisma.matricula.deleteMany({ where: { id: { in: descartar } } }),
    prisma.tokenAuth.deleteMany({ where: { usuarioId: usuario.id } }),
  ];

  if (!guardar.length) {
    await prisma.$transaction([...ops, prisma.usuario.delete({ where: { id: usuario.id } })]);
    return 'apagada';
  }

  await prisma.$transaction([
    ...ops,
    prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        email: emailAnonimo(usuario.id),
        emailVerificado: false,
        senhaHash: null,
        celular: null, rg: null,
        cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null,
        escolaridade: null, escolaridadeSituacao: null, genero: null, avatarUrl: null,
        bloqueioTotal: true, bloqueadoAte: null, loginFalhas: 0, loginStrikes: 0,
      },
    }),
    prisma.logAuditoria.create({
      data: { atorId: usuario.id, acao: 'CONTA_EXCLUIDA', alvoTipo: 'Usuario', alvoId: usuario.id, detalhe: { anonimizada: true, matriculasGuardadas: guardar.length, matriculasApagadas: descartar.length } },
    }),
  ]);
  return 'anonimizada';
}

module.exports = { contarEmAndamento, excluir, ehAnonimo, EM_ANDAMENTO };
