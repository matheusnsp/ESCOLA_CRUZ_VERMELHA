// lib/comprovante-saude.js
//
// Comprovante de que o aluno é da área da saúde, exigido nos cursos marcados no cadastro do curso
// ("Exige comprovante da área da saúde", extra do curso exigeComprovanteSaude, lib/extras.js).
//
//   - O comprovante é da PESSOA, não da matrícula: aprovado uma vez, vale para os outros cursos
//     da área. Fica em Configuracao 'saude:comprovante:<alunoId>' (JSON, sem coluna nova):
//       { arquivo: { nome, caminho, tipo, tamanho }, enviadoEm, status, motivo, revisadoPor, revisadoEm }
//     status: 'enviado' (para a secretaria conferir) · 'aprovado' · 'recusado' (com motivo).
//   - O arquivo vai para o bucket PRIVADO (lib/contas-anexos.js, pasta "saude/"): só a secretaria
//     com a permissão aluno:gerenciar abre, por rota do painel. Mandar outro apaga o anterior.
//   - Na inscrição é obrigatório (routes/cursos.js): sem comprovante enviado ou aprovado, não
//     passa para o pagamento. Quem já está inscrito (ou veio pela matrícula rápida) manda em
//     Minha conta. Recusado: o aluno recebe um e-mail e manda outro.

const prisma = require('../db');
const extras = require('./extras');
const anexos = require('./contas-anexos');

const PREFIXO = 'saude:comprovante:';
const chave = (alunoId) => PREFIXO + alunoId;
const ler = (valor) => { try { const o = JSON.parse(valor); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };

// Situação que libera a inscrição: enviado (aguardando a secretaria) ou aprovado.
const liberado = (c) => !!c && (c.status === 'enviado' || c.status === 'aprovado');

async function exige(cursoOuId) {
  const id = typeof cursoOuId === 'string' ? cursoOuId : cursoOuId && cursoOuId.id;
  if (cursoOuId && typeof cursoOuId === 'object' && 'exigeComprovanteSaude' in cursoOuId) return !!cursoOuId.exigeComprovanteSaude;
  if (!id) return false;
  return !!(await extras.lerExtra('curso', id)).exigeComprovanteSaude;
}

// { cursoId: true } dos cursos que exigem, entre os ids dados.
async function cursosQueExigem(cursoIds) {
  const ex = await extras.lerExtras('curso', cursoIds);
  return Object.fromEntries(Object.entries(ex).filter(([, e]) => e.exigeComprovanteSaude).map(([id]) => [id, true]));
}

async function daPessoa(alunoId) {
  const c = await prisma.configuracao.findUnique({ where: { chave: chave(alunoId) } });
  return c ? ler(c.valor) : null;
}

// { alunoId: comprovante } para vários alunos.
async function deVarios(alunoIds) {
  const ids = [...new Set(alunoIds.filter(Boolean))];
  if (!ids.length) return {};
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: ids.map(chave) } } });
  return Object.fromEntries(cfgs.map((c) => [c.chave.slice(PREFIXO.length), ler(c.valor)]).filter(([, v]) => v));
}

// Guarda o arquivo recebido (req.arquivos[0] de anexos.receber) e marca 'enviado'.
async function enviar(alunoId, arquivo) {
  const [salvo] = await anexos.guardar([arquivo], alunoId, 'saude');
  const antigo = await daPessoa(alunoId);
  const valor = JSON.stringify({ arquivo: salvo, enviadoEm: new Date().toISOString(), status: 'enviado' });
  await prisma.configuracao.upsert({ where: { chave: chave(alunoId) }, update: { valor }, create: { chave: chave(alunoId), valor } });
  if (antigo && antigo.arquivo) await anexos.apagar([antigo.arquivo]);
  return salvo;
}

// Aprovar ou recusar (painel). Devolve o comprovante atualizado, ou null se não existe.
async function revisar(alunoId, status, motivo, quem) {
  if (!['aprovado', 'recusado'].includes(status)) throw new Error('Situação inválida.');
  const atual = await daPessoa(alunoId);
  if (!atual) return null;
  const novo = { ...atual, status, motivo: status === 'recusado' ? String(motivo || '').trim().slice(0, 300) || null : null, revisadoPor: quem, revisadoEm: new Date().toISOString() };
  await prisma.configuracao.update({ where: { chave: chave(alunoId) }, data: { valor: JSON.stringify(novo) } });
  return novo;
}

async function abrirArquivo(alunoId) {
  const c = await daPessoa(alunoId);
  if (!c || !c.arquivo) return null;
  return { ...(await anexos.abrir(c.arquivo)), nome: c.arquivo.nome };
}

// Exclusão de conta (lib/excluir-conta.js): apaga o arquivo e o registro.
async function apagarDaPessoa(alunoId) {
  const c = await daPessoa(alunoId);
  if (c && c.arquivo) await anexos.apagar([c.arquivo]);
  await prisma.configuracao.deleteMany({ where: { chave: chave(alunoId) } });
}

// Todos os comprovantes, com o aluno e os cursos da área em que ele está inscrito (tela do painel).
async function listar() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: PREFIXO } } });
  const itens = cfgs.map((c) => ({ alunoId: c.chave.slice(PREFIXO.length), ...ler(c.valor) })).filter((i) => i.status);
  const alunos = await prisma.usuario.findMany({
    where: { id: { in: itens.map((i) => i.alunoId) } },
    select: { id: true, nome: true, email: true, celular: true, matriculas: { select: { statusPagamento: true, taxaConfirmada: true, turma: { select: { id: true, inicioPrevisto: true, curso: { select: { id: true, nome: true } } } } } } },
  });
  const porId = Object.fromEntries(alunos.map((a) => [a.id, a]));
  const exigem = await cursosQueExigem(alunos.flatMap((a) => a.matriculas.map((m) => m.turma.curso.id)));
  return itens.filter((i) => porId[i.alunoId]).map((i) => {
    const a = porId[i.alunoId];
    const cursos = a.matriculas
      .filter((m) => exigem[m.turma.curso.id] && !(m.statusPagamento === 'PENDENTE' && !m.taxaConfirmada))
      .map((m) => ({ nome: m.turma.curso.nome, inicio: m.turma.inicioPrevisto, status: m.statusPagamento }));
    return { ...i, aluno: { id: a.id, nome: a.nome, email: a.email, celular: a.celular }, cursos };
  }).sort((x, y) => String(y.enviadoEm).localeCompare(String(x.enviadoEm)));
}

async function contarParaConferir() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: PREFIXO } }, select: { valor: true } });
  return cfgs.filter((c) => (ler(c.valor) || {}).status === 'enviado').length;
}

module.exports = { exige, cursosQueExigem, daPessoa, deVarios, enviar, revisar, abrirArquivo, apagarDaPessoa, listar, contarParaConferir, liberado, receber: anexos.receber };
