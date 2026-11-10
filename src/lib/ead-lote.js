// lib/ead-lote.js
//
// Venda em lote do curso online (etapa 6). A secretaria cria o lote no painel (escola, curso, vagas, prazo,
// valor); o gestor da escola cadastra funcionários ou manda o link de convite. Cada pessoa ocupa uma vaga
// (VagaLoteEad) e entra no curso como quem comprou (lib/ead-acesso.js). Tirar só quem ainda não começou: a
// vaga volta. As escritas de vaga passam por uma trava de aviso por lote: o número de vagas nunca estoura.
// Spec: docs/superpowers/specs/2026-11-08-ead-lote.md

const crypto = require('crypto');
const prisma = require('../db');
const { transacao } = require('./transacao');
const { contaParaPessoa } = require('./conta-aluno');
const { soDigitos, validarCpfCnpj } = require('./documento');
const { ehId, POR_ORDEM } = require('./ead-db');

const FORMAS = ['PIX', 'BOLETO', 'TRANSFERENCIA', 'EMPENHO', 'OUTRO'];
const MAX_VAGAS = 5000;
const site = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const novoConvite = () => crypto.randomBytes(24).toString('base64url');

async function auditar(atorId, acao, loteId, detalhe) {
  await prisma.logAuditoria.create({ data: { atorId: atorId || 'SISTEMA', acao, alvoTipo: 'LoteEad', alvoId: loteId, detalhe: detalhe || undefined } });
}

function situacaoDoLote(lote, agora = new Date()) {
  const usadas = (lote.vagasUsadas || []).filter((v) => !v.removidaEm).length;
  return { usadas, livres: Math.max(0, lote.vagas - usadas), vencido: new Date(lote.validoAte) <= agora, convite: !!lote.convite };
}

// Quem já tem acesso ao curso: matrícula paga na turma online ou vaga ativa num lote do mesmo curso.
async function jaTemAcesso(db, usuarioId, cursoOnline) {
  const [mat, vaga] = await Promise.all([
    db.matricula.count({ where: { alunoId: usuarioId, statusPagamento: { in: ['PAGO', 'PARCELADO'] }, turma: { cursoId: cursoOnline.cursoId, status: 'ONLINE' } } }),
    db.vagaLoteEad.count({ where: { usuarioId, removidaEm: null, lote: { cursoOnlineId: cursoOnline.id } } }),
  ]);
  return mat + vaga > 0;
}

const vagaAtiva = (usuarioId, cursoOnlineId) => (usuarioId && cursoOnlineId
  ? prisma.vagaLoteEad.findFirst({ where: { usuarioId, removidaEm: null, lote: { cursoOnlineId } }, orderBy: { criadoEm: 'asc' }, include: { lote: { include: { escola: { select: { nome: true } } } } } })
  : Promise.resolve(null));

async function avisarGestor(usuario, escola, senhaInicial) {
  try { await require('./email').enviarGestorEscola(usuario.email, String(usuario.nome).trim().split(/\s+/)[0], { escola: escola.nome, link: `${site()}/minha-escola`, senhaInicial }); } catch (e) {
    console.error('[EAD] e-mail do gestor:', e.message);
  }
}

async function ligarGestor(escola, pessoa) {
  const c = await contaParaPessoa(pessoa);
  if (!c.ok) return c;
  await prisma.gestorEscolaEad.upsert({ where: { escolaId_usuarioId: { escolaId: escola.id, usuarioId: c.usuario.id } }, update: {}, create: { escolaId: escola.id, usuarioId: c.usuario.id } });
  require('./cache-rapido').limparLinks(c.usuario.id); // o link "Minha escola" do menu aparece na hora
  await avisarGestor(c.usuario, escola, c.nova ? c.senhaInicial : undefined);
  return { ok: true, usuario: c.usuario };
}

// "Futuro" = depois do fim de hoje no Rio (a data do formulário é gravada ao meio-dia; hoje vale).
const fimDeHojeRio = () => new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })}T23:59:59.999-03:00`);
const MSG_RECEBIDO_FUTURO = 'A data de recebimento não pode ser no futuro.';
const recebidoNoFuturo = (d) => !!d && new Date(d) > fimDeHojeRio();

function validarDados({ vagas, validoAte, valor, forma }) {
  const v = Number(vagas);
  if (!Number.isInteger(v) || v < 1 || v > MAX_VAGAS) return `Vagas: um número inteiro de 1 a ${MAX_VAGAS}.`;
  const d = new Date(validoAte);
  if (Number.isNaN(d.getTime())) return 'Prazo inválido.';
  const r = Number(valor);
  if (!Number.isFinite(r) || r < 0) return 'Valor inválido.';
  if (!FORMAS.includes(forma)) return 'Forma de pagamento inválida.';
  return null;
}

async function criarLote({ escola, cursoOnlineId, vagas, validoAte, valor, forma, recebidoEm = null, observacao = null, gestor, atorId }) {
  const erro = validarDados({ vagas, validoAte, valor, forma });
  if (erro) return { ok: false, erro };
  if (new Date(validoAte) <= new Date()) return { ok: false, erro: 'O prazo precisa ser uma data futura.' };
  if (recebidoNoFuturo(recebidoEm)) return { ok: false, erro: MSG_RECEBIDO_FUTURO };
  if (!ehId(cursoOnlineId) || !(await prisma.cursoOnline.findUnique({ where: { id: cursoOnlineId } }))) return { ok: false, erro: 'Escolha o curso online.' };
  let esc;
  if (escola && escola.id) {
    esc = ehId(escola.id) ? await prisma.escolaEad.findUnique({ where: { id: escola.id } }) : null;
    if (!esc) return { ok: false, erro: 'Escola não encontrada.' };
  } else {
    const nome = String(escola?.nome || '').trim().replace(/\s+/g, ' ');
    if (nome.length < 3) return { ok: false, erro: 'Nome da escola: pelo menos 3 letras.' };
    const cnpj = soDigitos(escola?.cnpj || '');
    if (cnpj) {
      const v = validarCpfCnpj(cnpj);
      if (!v.ok || v.tipo !== 'CNPJ') return { ok: false, erro: 'CNPJ inválido.' };
      if (await prisma.escolaEad.findUnique({ where: { cnpj } })) return { ok: false, erro: 'Já existe uma escola com esse CNPJ: escolha ela na lista.' };
    }
    esc = { nome, cnpj: cnpj || null };
  }
  // Gestor primeiro (pode recusar: CPF inválido, contas diferentes); a escola nova só nasce se ele for válido.
  const c = await contaParaPessoa(gestor || {});
  if (!c.ok) return { ok: false, erro: `Gestor: ${c.erro}` };
  // Escola, lote e gestor numa transação só (etapa 8): se algo falhar, nada fica pela metade, e a conta nova do
  // gestor (criada antes, fora da transação) é apagada, como no cadastro de funcionário.
  let lote;
  try {
    ({ lote, esc } = await transacao(async (tx) => {
      const e = esc.id ? esc : await tx.escolaEad.create({ data: esc });
      const l = await tx.loteEad.create({
        data: {
          escolaId: e.id, cursoOnlineId, vagas: Number(vagas), validoAte: new Date(validoAte), valor: Number(valor), forma,
          recebidoEm: recebidoEm ? new Date(recebidoEm) : null, observacao: String(observacao || '').trim() || null,
          convite: novoConvite(), criadoPor: atorId || 'SISTEMA',
        },
      });
      await tx.gestorEscolaEad.upsert({ where: { escolaId_usuarioId: { escolaId: e.id, usuarioId: c.usuario.id } }, update: {}, create: { escolaId: e.id, usuarioId: c.usuario.id } });
      return { lote: l, esc: e };
    }));
    require('./cache-rapido').limparLinks(c.usuario.id); // o link "Minha escola" do menu aparece na hora
  } catch (e) {
    if (c.nova) await prisma.usuario.delete({ where: { id: c.usuario.id } }).catch(() => {});
    console.error('[EAD] criar lote:', e.message);
    return { ok: false, erro: 'Não foi possível criar o lote. Confira os dados (valor, vagas) e tente de novo.' };
  }
  await avisarGestor(c.usuario, esc, c.nova ? c.senhaInicial : undefined);
  await auditar(atorId, 'EAD_LOTE_CRIOU', lote.id, { escola: esc.nome, vagas: lote.vagas, valor: Number(valor), forma });
  return { ok: true, lote, escola: esc };
}

// Ocupa uma vaga para o usuário, sob a trava do lote. { ok, vaga } | { ok: false, erro }.
async function ocupar(loteId, usuarioId, origem) {
  return transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'lote:' + loteId}))`;
    const lote = await tx.loteEad.findUnique({ where: { id: loteId }, include: { cursoOnline: true } });
    if (!lote) return { ok: false, erro: 'nao_achou' };
    if (new Date(lote.validoAte) <= new Date()) return { ok: false, erro: 'vencido' };
    if (await jaTemAcesso(tx, usuarioId, lote.cursoOnline)) return { ok: false, erro: 'ja_tem_acesso' };
    const usadas = await tx.vagaLoteEad.count({ where: { loteId, removidaEm: null } });
    if (usadas >= lote.vagas) return { ok: false, erro: 'esgotado' };
    const vaga = await tx.vagaLoteEad.create({ data: { loteId, usuarioId, origem } });
    return { ok: true, vaga, lote };
  });
}

async function avisarVaga(usuario, lote, senhaInicial) {
  const l = await prisma.loteEad.findUnique({ where: { id: lote.id }, include: { escola: true, cursoOnline: { include: { curso: { select: { nome: true } } } } } });
  try {
    await require('./email').enviarVagaLiberada(usuario.email, String(usuario.nome).trim().split(/\s+/)[0], {
      escola: l.escola.nome, curso: l.cursoOnline.curso.nome, link: `${site()}${require('./vitrine').urlOnline(l.cursoOnline.curso)}`, senhaInicial,
    });
  } catch (e) {
    console.error('[EAD] e-mail da vaga:', e.message);
  }
}

async function cadastrarFuncionario(loteId, pessoa, { origem = 'GESTOR', atorId } = {}) {
  if (!ehId(loteId)) return { ok: false, erro: 'nao_achou' };
  const lote = await prisma.loteEad.findUnique({ where: { id: loteId } });
  if (!lote) return { ok: false, erro: 'nao_achou' };
  if (new Date(lote.validoAte) <= new Date()) return { ok: false, erro: 'vencido' };
  // Lote cheio: nem cria a conta (ela ficaria sem aviso nenhum).
  if (await prisma.vagaLoteEad.count({ where: { loteId, removidaEm: null } }) >= lote.vagas) return { ok: false, erro: 'esgotado' };
  const c = await contaParaPessoa(pessoa || {});
  if (!c.ok) return { ok: false, erro: 'conta', mensagem: c.erro };
  const r = await ocupar(loteId, c.usuario.id, origem === 'CONVITE' ? 'CONVITE' : 'GESTOR');
  if (!r.ok) {
    // Perdeu a corrida pela última vaga: a conta criada agora não serve para nada e ninguém foi avisado.
    if (c.nova) await prisma.usuario.delete({ where: { id: c.usuario.id } }).catch(() => {});
    return r;
  }
  await auditar(atorId, 'EAD_LOTE_VAGA_ADD', loteId, { usuarioId: c.usuario.id, origem: r.vaga.origem });
  await avisarVaga(c.usuario, lote, c.nova ? c.senhaInicial : undefined);
  return { ok: true, vaga: r.vaga, nova: c.nova, usuario: c.usuario };
}

const loteDoConvite = async (codigo) => (codigo && /^[A-Za-z0-9_-]{16,}$/.test(codigo)
  ? prisma.loteEad.findUnique({ where: { convite: codigo }, include: { escola: true, cursoOnline: { include: { curso: { select: { nome: true } } } }, vagasUsadas: { select: { removidaEm: true } } } })
  : null);

async function entrarPorConvite(codigo, usuarioId) {
  const lote = await loteDoConvite(codigo);
  if (!lote) return { ok: false, erro: 'convite' };
  const r = await ocupar(lote.id, usuarioId, 'CONVITE');
  if (!r.ok) return { ...r, lote };
  await auditar(usuarioId, 'EAD_LOTE_VAGA_ADD', lote.id, { usuarioId, origem: 'CONVITE' });
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  await avisarVaga(u, lote);
  return { ok: true, vaga: r.vaga, lote };
}

// "Começou" = qualquer registro de estudo no curso (tela vista, tentativa, cenário).
async function comecou(usuarioId, cursoOnlineId) {
  const ac = await prisma.alunoCursoEad.findUnique({ where: { usuarioId_cursoOnlineId: { usuarioId, cursoOnlineId } }, select: { _count: { select: { telasVistas: true, tentativas: true, cenarios: true } } } });
  return !!ac && (ac._count.telasVistas + ac._count.tentativas + ac._count.cenarios) > 0;
}

async function removerVaga(vagaId, atorId) {
  if (!ehId(vagaId)) return { ok: false, erro: 'nao_achou' };
  const vaga = await prisma.vagaLoteEad.findUnique({ where: { id: vagaId }, include: { lote: true } });
  if (!vaga || vaga.removidaEm) return { ok: false, erro: 'nao_achou' };
  if (await comecou(vaga.usuarioId, vaga.lote.cursoOnlineId)) return { ok: false, erro: 'comecou' };
  await prisma.vagaLoteEad.updateMany({ where: { id: vagaId, removidaEm: null }, data: { removidaEm: new Date() } });
  await auditar(atorId, 'EAD_LOTE_VAGA_REMOVE', vaga.loteId, { usuarioId: vaga.usuarioId });
  return { ok: true };
}

async function trocarConvite(loteId, atorId) {
  await prisma.loteEad.update({ where: { id: loteId }, data: { convite: novoConvite() } });
  await auditar(atorId, 'EAD_LOTE_CONVITE_TROCOU', loteId, null);
  return { ok: true };
}
async function desligarConvite(loteId, atorId) {
  await prisma.loteEad.update({ where: { id: loteId }, data: { convite: null } });
  await auditar(atorId, 'EAD_LOTE_CONVITE_DESLIGOU', loteId, null);
  return { ok: true };
}

async function adicionarGestor(escolaId, pessoa, atorId) {
  const esc = ehId(escolaId) ? await prisma.escolaEad.findUnique({ where: { id: escolaId }, include: { lotes: { select: { id: true }, take: 1 } } }) : null;
  if (!esc) return { ok: false, erro: 'Escola não encontrada.' };
  const r = await ligarGestor(esc, pessoa);
  if (r.ok) await auditar(atorId, 'EAD_LOTE_GESTOR_ADD', esc.lotes[0]?.id || null, { escolaId, usuarioId: r.usuario.id });
  return r;
}
async function removerGestor(escolaId, usuarioId, atorId) {
  // Sob a trava da escola: dois "tirar" ao mesmo tempo não deixam a escola sem gestor.
  const r = await transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'escola:' + escolaId}))`;
    const n = await tx.gestorEscolaEad.count({ where: { escolaId } });
    if (n <= 1) return { ok: false, erro: 'A escola precisa de pelo menos um gestor.' };
    await tx.gestorEscolaEad.deleteMany({ where: { escolaId, usuarioId } });
    return { ok: true };
  });
  if (!r.ok) return r;
  const l = await prisma.loteEad.findFirst({ where: { escolaId }, select: { id: true } });
  await auditar(atorId, 'EAD_LOTE_GESTOR_REMOVE', l?.id || null, { escolaId, usuarioId });
  return { ok: true };
}

async function alterarLote(loteId, campos, atorId) {
  const lote = ehId(loteId) ? await prisma.loteEad.findUnique({ where: { id: loteId } }) : null;
  if (!lote) return { ok: false, erro: 'nao_achou' };
  const dados = {};
  if (campos.recebidoEm !== undefined && recebidoNoFuturo(campos.recebidoEm)) return { ok: false, erro: MSG_RECEBIDO_FUTURO };
  if (campos.vagas !== undefined) {
    const v = Number(campos.vagas);
    if (!Number.isInteger(v) || v < 1 || v > MAX_VAGAS) return { ok: false, erro: 'vagas_invalidas' };
    dados.vagas = v;
  }
  if (campos.validoAte !== undefined) {
    const d = new Date(campos.validoAte);
    if (Number.isNaN(d.getTime())) return { ok: false, erro: 'prazo' };
    dados.validoAte = d;
  }
  if (campos.observacao !== undefined) dados.observacao = String(campos.observacao || '').trim() || null;
  if (campos.recebidoEm !== undefined) dados.recebidoEm = campos.recebidoEm ? new Date(campos.recebidoEm) : null;
  // Sob a trava do lote (a mesma de ocupar): reduzir vagas e um cadastro ao mesmo tempo não deixam o lote com
  // menos vagas do que as usadas.
  const r = await transacao(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'lote:' + loteId}))`;
    if (dados.vagas !== undefined && dados.vagas < await tx.vagaLoteEad.count({ where: { loteId, removidaEm: null } })) return { ok: false, erro: 'vagas' };
    await tx.loteEad.update({ where: { id: loteId }, data: dados });
    return { ok: true };
  });
  if (!r.ok) return r;
  if (campos.recebidoEm !== undefined) await auditar(atorId, 'EAD_LOTE_RECEBIDO', loteId, { recebidoEm: dados.recebidoEm });
  else await auditar(atorId, 'EAD_LOTE_ALTEROU', loteId, { ...dados });
  return { ok: true };
}

async function apagarLote(loteId, atorId) {
  if (!ehId(loteId)) return { ok: false, erro: 'Lote não encontrado.' };
  if (await prisma.vagaLoteEad.count({ where: { loteId } })) return { ok: false, erro: 'Este lote já teve funcionários: não pode ser apagado.' };
  await prisma.loteEad.delete({ where: { id: loteId } });
  await auditar(atorId, 'EAD_LOTE_APAGOU', loteId, null);
  return { ok: true };
}

const INCLUDE_LOTE = { cursoOnline: { select: { id: true, cursoId: true, curso: { select: { nome: true, cargaHoraria: true } } } }, vagasUsadas: { select: { removidaEm: true } } };

async function escolasDoGestor(usuarioId) {
  if (!ehId(usuarioId)) return [];
  const ligacoes = await prisma.gestorEscolaEad.findMany({
    where: { usuarioId },
    include: { escola: { include: { lotes: { include: INCLUDE_LOTE, orderBy: { criadoEm: 'desc' } } } } },
    orderBy: { criadoEm: 'asc' },
  });
  return ligacoes.map((g) => ({ escola: g.escola, lotes: g.escola.lotes.map((l) => ({ ...l, curso: l.cursoOnline.curso, situacao: situacaoDoLote(l) })) }));
}

const ehGestorDoLote = async (usuarioId, loteId) => !!(ehId(usuarioId) && ehId(loteId)
  && await prisma.loteEad.count({ where: { id: loteId, escola: { gestores: { some: { usuarioId } } } } }));

// Funcionários do lote com o progresso de cada um (o mesmo cálculo da tela de alunos do painel).
async function funcionariosDoLote(loteId, agora = new Date()) {
  const { estadoDoCurso } = require('./ead-progresso');
  const { carregarCursoParaAluno } = require('./ead-progresso-db');
  const { INCLUDE_PROGRESSO, progressoDe, ultimoAcessoDe } = require('./ead-relatorios');
  const cert = require('./certificado');
  const redacao = require('./redacao');
  const lote = await prisma.loteEad.findUnique({ where: { id: loteId }, include: { vagasUsadas: { include: { usuario: { select: { id: true, nome: true, email: true, cpfCnpj: true } } }, orderBy: { criadoEm: 'asc' } } } });
  if (!lote) return [];
  const r = await carregarCursoParaAluno(lote.cursoOnlineId);
  const acs = await prisma.alunoCursoEad.findMany({ where: { cursoOnlineId: lote.cursoOnlineId, usuarioId: { in: lote.vagasUsadas.map((v) => v.usuarioId) } }, include: INCLUDE_PROGRESSO });
  const acDe = new Map(acs.map((a) => [a.usuarioId, a]));
  const codigos = await redacao.codigosRegistrados(acs.filter((a) => a.concluidoEm).map((a) => a.id));
  const lista = [];
  for (const vaga of lote.vagasUsadas) {
    const a = acDe.get(vaga.usuarioId);
    const estado = a && r ? estadoDoCurso(r.curso, progressoDe(a, vaga.criadoEm), agora) : null;
    const n = a && a.concluidoEm ? await cert.lerNumero(a.id) : null;
    lista.push({
      vaga, usuario: vaga.usuario,
      percentual: estado ? estado.percentual : 0, ultimoAcesso: a ? ultimoAcessoDe(a) : null,
      concluidoEm: a ? a.concluidoEm : null, livro: n ? n.livro : null, registro: n ? n.registro : null,
      codigoRedacao: a && codigos[a.id] ? codigos[a.id].codigo : null,
      comecou: !!a && (a.telasVistas.length + a.tentativas.length + a.cenarios.length) > 0,
    });
  }
  return lista;
}

// Dinheiro dos lotes (Financeiro, Painel, relatório). Tolerantes a erro: sem a tabela, listas vazias.
const INCLUDE_DINHEIRO = { escola: { select: { nome: true } }, cursoOnline: { select: { curso: { select: { nome: true } } } } };
const linhaDinheiro = (l) => ({ lote: l, escola: l.escola.nome, curso: l.cursoOnline.curso.nome, valor: Number(l.valor), recebidoEm: l.recebidoEm, vagas: l.vagas });
async function lotesRecebidos({ de, ate } = {}) {
  try {
    const recebidoEm = { not: null, ...(de ? { gte: de } : {}), ...(ate ? { lt: ate } : {}) };
    return (await prisma.loteEad.findMany({ where: { recebidoEm, valor: { gt: 0 } }, include: INCLUDE_DINHEIRO, orderBy: { recebidoEm: 'desc' } })).map(linhaDinheiro);
  } catch (e) {
    console.error('[EAD] lotes recebidos:', e.message);
    return [];
  }
}
async function lotesAReceber() {
  try {
    return (await prisma.loteEad.findMany({ where: { recebidoEm: null, valor: { gt: 0 } }, include: INCLUDE_DINHEIRO, orderBy: { criadoEm: 'asc' } })).map(linhaDinheiro);
  } catch (e) {
    console.error('[EAD] lotes a receber:', e.message);
    return [];
  }
}

// Cursos que a pessoa tem por vaga de escola (Minha conta: "Curso online · Acessar").
async function vagasDoAluno(usuarioId) {
  if (!ehId(usuarioId)) return [];
  const vs = await prisma.vagaLoteEad.findMany({
    where: { usuarioId, removidaEm: null },
    include: { lote: { select: { escola: { select: { nome: true } }, cursoOnline: { select: { cursoId: true, curso: { select: { nome: true, imagemUrl: true } } } } } } },
    orderBy: { criadoEm: 'desc' },
  }).catch(() => []);
  const vistos = new Set();
  return vs.filter((v) => !vistos.has(v.lote.cursoOnline.cursoId) && vistos.add(v.lote.cursoOnline.cursoId))
    .map((v) => ({ cursoId: v.lote.cursoOnline.cursoId, curso: v.lote.cursoOnline.curso.nome, imagemUrl: v.lote.cursoOnline.curso.imagemUrl, escola: v.lote.escola.nome, desde: v.criadoEm }));
}

// Única fonte do dinheiro dos lotes para o Financeiro, o Painel e o relatório. inicioMes: começo do mês no Rio.
async function somasDosLotes({ inicioMes } = {}) {
  const [recebidos, aReceber] = await Promise.all([lotesRecebidos(), lotesAReceber()]);
  const soma = (l) => Math.round(l.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  return {
    recebidoTotal: soma(recebidos),
    recebidoMes: soma(inicioMes ? recebidos.filter((x) => new Date(x.recebidoEm) >= inicioMes) : recebidos),
    aReceberTotal: soma(aReceber),
    linhas: [
      ...recebidos.map((x) => ({ tipo: 'lote', valor: x.valor, data: x.recebidoEm, escola: x.escola, curso: x.curso, loteId: x.lote.id, rotulo: `Lote: ${x.escola} · ${x.curso} · ${x.vagas} vagas` })),
      ...aReceber.map((x) => ({ tipo: 'lote_a_receber', valor: x.valor, data: x.lote.criadoEm, escola: x.escola, curso: x.curso, loteId: x.lote.id, rotulo: `Lote: ${x.escola} (a receber)` })),
    ],
  };
}

module.exports = {
  vagasDoAluno,
  somasDosLotes,
  FORMAS, MAX_VAGAS, situacaoDoLote, criarLote, cadastrarFuncionario, entrarPorConvite, loteDoConvite, removerVaga,
  trocarConvite, desligarConvite, adicionarGestor, removerGestor, alterarLote, apagarLote, escolasDoGestor,
  ehGestorDoLote, funcionariosDoLote, vagaAtiva, lotesRecebidos, lotesAReceber, comecou, POR_ORDEM,
};
