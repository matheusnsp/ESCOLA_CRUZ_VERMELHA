// lib/ead-acesso.js
//
// Acesso pago ao curso online (etapa 4): quem tem matrícula PAGA na turma ONLINE do curso
// (lib/turma-online.js) entra em /online/<curso>. O endereço aceita o id do Curso ou o mesmo endereço
// de /cursos/<endereço>.

const prisma = require('../db');
const { slugCurso } = require('./vitrine');
const { ONLINE } = require('./turma-online');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// id do CursoOnline pelo endereço (id do Curso ou endereço do curso); null se não houver.
async function cursoOnlineDoEndereco(endereco) {
  const e = String(endereco || '').toLowerCase();
  if (UUID.test(e)) {
    const co = await prisma.cursoOnline.findUnique({ where: { cursoId: e }, select: { id: true } });
    return co ? co.id : null;
  }
  const lista = await prisma.cursoOnline.findMany({ select: { id: true, curso: { select: { nome: true } } }, orderBy: { criadoEm: 'asc' } });
  const achado = lista.find((c) => slugCurso(c.curso.nome) === e);
  if (achado) return achado.id;
  // Endereço de antes de renomear o curso (etapa 8, revisão I2): e-mails e links de campanha continuam abrindo.
  const antigo = await prisma.configuracao.findUnique({ where: { chave: PREFIXO_ENDERECO + e } }).catch(() => null);
  return antigo && lista.some((c) => c.id === antigo.valor) ? antigo.valor : null;
}

const PREFIXO_ENDERECO = 'ead-endereco:';

// Outro curso online já usa este endereço? (dois cursos com o mesmo endereço fariam os links de um abrirem o outro)
async function enderecoOnlineEmUso(nome, exceptoCursoId = null) {
  const e = slugCurso(nome);
  const lista = await prisma.cursoOnline.findMany({ select: { cursoId: true, curso: { select: { nome: true } } } });
  return lista.some((c) => c.cursoId !== exceptoCursoId && slugCurso(c.curso.nome) === e);
}

// Ao renomear um curso com EAD, o endereço antigo fica guardado e continua levando a ele.
async function guardarEnderecoAntigo(cursoId, nomeAntigo, nomeNovo) {
  const antigo = slugCurso(nomeAntigo);
  if (!nomeAntigo || antigo === slugCurso(nomeNovo)) return;
  const co = await prisma.cursoOnline.findUnique({ where: { cursoId }, select: { id: true } });
  if (!co) return;
  await prisma.configuracao.upsert({ where: { chave: PREFIXO_ENDERECO + antigo }, update: { valor: co.id }, create: { chave: PREFIXO_ENDERECO + antigo, valor: co.id } });
}

const SITUACAO = { PAGO: 'pago', PARCELADO: 'pago', PENDENTE: 'pendente', CANCELADO: 'cancelado', ESTORNADO: 'cancelado' };

// { matricula, vaga, liberado, situacao: 'sem'|'pendente'|'pago'|'cancelado', inicio }
// Etapa 6: quem tem vaga ativa num lote de escola entra como quem comprou (situação 'pago'). inicio = de
// quando contam os 7 dias em sequência: o pagamento confirmado, ou a entrada no lote.
async function acessoPago(usuarioId, cursoOnline) {
  const matricula = usuarioId
    ? await prisma.matricula.findFirst({
      where: { alunoId: usuarioId, turma: { cursoId: cursoOnline.cursoId, status: ONLINE } },
      orderBy: { criadoEm: 'asc' },
    })
    : null;
  const situacao = matricula ? SITUACAO[matricula.statusPagamento] || 'cancelado' : 'sem';
  if (situacao === 'pago') return { matricula, vaga: null, liberado: true, situacao, inicio: matricula.confirmadaEm };
  const vaga = usuarioId ? await require('./ead-lote').vagaAtiva(usuarioId, cursoOnline.id) : null;
  if (vaga) return { matricula, vaga, liberado: true, situacao: 'pago', inicio: vaga.criadoEm };
  return { matricula, vaga: null, liberado: false, situacao, inicio: null };
}

module.exports = { cursoOnlineDoEndereco, acessoPago, enderecoOnlineEmUso, guardarEnderecoAntigo };
