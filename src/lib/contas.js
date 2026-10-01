// lib/contas.js
//
// Contas a pagar da escola.
//
//   Secretaria (contas:lancar)   lança as despesas da semana e os pedidos de compra ou reembolso,
//                                com nota, boleto ou recibo anexado, e envia a semana para aprovação.
//                                Vê só o que foi lançado e em que pé está: nada do caixa.
//   Diretor (contas:aprovar)     aprova ou recusa item por item (recusar pede motivo).
//   Financeiro (contas:pagar)    marca como paga: data, forma e comprovante.
//
// Situações: RASCUNHO (lançada, ainda não enviada) → AGUARDANDO (enviada) → APROVADA ou RECUSADA
//            → PAGA (só a aprovada).
//
// Guardado na tabela Configuracao, uma linha por item ("cp:item:<id>", JSON) e por envio
// ("cp:lote:<id>"), como os extras de curso e turma (lib/extras.js): nada de coluna ou tabela nova
// no banco. Toda mudança de situação grava só se a linha ainda estiver como foi lida (updateMany
// com o valor antigo): se duas pessoas agirem ao mesmo tempo, a segunda recebe "recarregue".
// Valores em centavos (inteiro), para a soma não errar.

const crypto = require('crypto');
const prisma = require('../db');

const PREFIXO_ITEM = 'cp:item:';
const PREFIXO_LOTE = 'cp:lote:';

const TIPOS = {
  DESPESA: { nome: 'Despesa', icone: 'fa-file-invoice-dollar' },
  COMPRA: { nome: 'Pedido de compra', icone: 'fa-cart-shopping' },
  REEMBOLSO: { nome: 'Reembolso', icone: 'fa-hand-holding-dollar' },
};
const CATEGORIAS = [
  'Material de curso', 'Material de escritório', 'Limpeza e higiene', 'Alimentação',
  'Manutenção', 'Transporte', 'Serviços de terceiros', 'Contas de consumo', 'Impostos e taxas', 'Outros',
];
const FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão'];
const SITUACOES = {
  RASCUNHO: { nome: 'Não enviada', badge: 'mut' },
  AGUARDANDO: { nome: 'Aguardando aprovação', badge: 'pend' },
  APROVADA: { nome: 'Aprovada', badge: 'parc' },
  RECUSADA: { nome: 'Recusada', badge: 'canc' },
  PAGA: { nome: 'Paga', badge: 'ok' },
};

class ErroContas extends Error {}
const erro = (msg) => new ErroContas(msg);
const CONFLITO = 'Alguém mudou este item agora mesmo. Recarregue a página e confira.';

const novoId = () => crypto.randomBytes(6).toString('hex');
const ler = (valor) => { try { return JSON.parse(valor); } catch (e) { return null; } };

// "1.234,56", "1234,56", "1.000", "1234.56", "R$ 80" → centavos. NaN se não for um valor válido.
function centavos(texto) {
  let t = String(texto == null ? '' : texto).replace(/R\$|\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "1.000" = mil reais
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
const reais = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Data "aaaa-mm-dd" (campo date do formulário). Devolve a mesma string ou null.
function dataValida(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  return Number.isNaN(d.getTime()) ? null : s;
}

// Segunda-feira da semana (fuso de Brasília) de uma data, em "aaaa-mm-dd".
function segundaDaSemana(quando = new Date()) {
  const hoje = new Date(new Date(quando).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dia = (hoje.getDay() + 6) % 7; // segunda = 0
  hoje.setDate(hoje.getDate() - dia);
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}
function rotuloSemana(segunda) {
  const ini = new Date(segunda + 'T12:00:00Z');
  const fim = new Date(ini.getTime() + 6 * 86400000);
  const f = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `Semana de ${f(ini)} a ${f(fim)}`;
}

// ---------- leitura ----------

async function listarItens() {
  const linhas = await prisma.configuracao.findMany({ where: { chave: { startsWith: PREFIXO_ITEM } } });
  return linhas.map((l) => ler(l.valor)).filter(Boolean)
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}
async function listarLotes() {
  const linhas = await prisma.configuracao.findMany({ where: { chave: { startsWith: PREFIXO_LOTE } } });
  return linhas.map((l) => ler(l.valor)).filter(Boolean)
    .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)));
}
async function lerItem(id) {
  if (!/^[a-f0-9]{12}$/.test(String(id))) return null;
  const l = await prisma.configuracao.findUnique({ where: { chave: PREFIXO_ITEM + id } });
  return l ? { item: ler(l.valor), bruto: l.valor } : null;
}
async function lerLote(id) {
  if (!/^[a-f0-9]{12}$/.test(String(id))) return null;
  const l = await prisma.configuracao.findUnique({ where: { chave: PREFIXO_LOTE + id } });
  return l ? ler(l.valor) : null;
}

// Grava o item só se ninguém mudou a linha depois da leitura.
async function regravar(bruto, item) {
  const r = await prisma.configuracao.updateMany({
    where: { chave: PREFIXO_ITEM + item.id, valor: bruto },
    data: { valor: JSON.stringify(item) },
  });
  if (!r.count) throw erro(CONFLITO);
  return item;
}

const evento = (acao, ator, extra = {}) => ({ acao, por: ator.id, porNome: ator.nome, em: new Date().toISOString(), ...extra });

// ---------- lançamento (secretaria) ----------

// Campos do formulário → dados do item. Devolve { dados, erro }.
function lerFormulario(body) {
  const tipo = TIPOS[body.tipo] ? body.tipo : 'DESPESA';
  const dados = {
    tipo,
    descricao: String(body.descricao || '').trim().slice(0, 200),
    favorecido: String(body.favorecido || '').trim().slice(0, 120),
    categoria: CATEGORIAS.includes(body.categoria) ? body.categoria : 'Outros',
    valor: centavos(body.valor),
    vencimento: dataValida(body.vencimento),
    comoPagar: String(body.comoPagar || '').trim().slice(0, 300),
    observacao: String(body.observacao || '').trim().slice(0, 1000),
  };
  let msg = null;
  if (dados.descricao.length < 3) msg = 'Descreva a despesa (o que é).';
  else if (!dados.favorecido) msg = tipo === 'REEMBOLSO' ? 'Informe quem deve ser reembolsado.' : 'Informe o fornecedor ou a quem pagar.';
  else if (!Number.isFinite(dados.valor) || dados.valor <= 0) msg = 'Informe o valor (ex.: 150,00).';
  else if (dados.valor > 100000000) msg = 'Valor alto demais. Confira o número.';
  else if (body.vencimento && !dados.vencimento) msg = 'Data de vencimento inválida.';
  return { dados, erro: msg };
}

async function criar(dados, anexos, ator) {
  const agora = new Date().toISOString();
  const item = {
    id: novoId(), ...dados, anexos: anexos || [], situacao: 'RASCUNHO',
    criadoPor: ator.id, criadoPorNome: ator.nome, criadoEm: agora,
    historico: [evento('LANCOU', ator)],
  };
  await prisma.configuracao.create({ data: { chave: PREFIXO_ITEM + item.id, valor: JSON.stringify(item) } });
  return item;
}

// Só antes de enviar. anexosNovos são somados aos que já tinha; removerAnexos são índices.
async function editar(id, dados, anexosNovos, removerAnexos, ator) {
  const lido = await lerItem(id);
  if (!lido) throw erro('Item não encontrado.');
  const { item, bruto } = lido;
  if (item.situacao !== 'RASCUNHO') throw erro('Depois de enviado, o item não pode mais ser editado.');
  const remover = new Set((removerAnexos || []).map(Number));
  const saem = item.anexos.filter((a, i) => remover.has(i));
  const novo = {
    ...item, ...dados,
    anexos: item.anexos.filter((a, i) => !remover.has(i)).concat(anexosNovos || []),
    historico: item.historico.concat(evento('EDITOU', ator)),
  };
  await regravar(bruto, novo);
  return { item: novo, saem };
}

async function excluir(id) {
  const lido = await lerItem(id);
  if (!lido) throw erro('Item não encontrado.');
  if (lido.item.situacao !== 'RASCUNHO') throw erro('Depois de enviado, o item não pode ser excluído.');
  const r = await prisma.configuracao.deleteMany({ where: { chave: PREFIXO_ITEM + id, valor: lido.bruto } });
  if (!r.count) throw erro(CONFLITO);
  return lido.item;
}

// Envia para aprovação. ids = itens escolhidos (todos os não enviados, no "Enviar a semana").
// Cria um envio (lote) com o resumo; cada item passa para AGUARDANDO.
async function enviar(ids, ator) {
  const itens = [];
  for (const id of [...new Set(ids)]) {
    const lido = await lerItem(id);
    if (lido && lido.item.situacao === 'RASCUNHO') itens.push(lido);
  }
  if (!itens.length) throw erro('Não há nada para enviar.');
  const agora = new Date();
  const lote = {
    id: novoId(),
    semana: segundaDaSemana(agora),
    enviadoEm: agora.toISOString(), enviadoPor: ator.id, enviadoPorNome: ator.nome,
    itens: [], total: 0,
  };
  const enviados = [];
  for (const { item, bruto } of itens) {
    const novo = { ...item, situacao: 'AGUARDANDO', loteId: lote.id, enviadoEm: lote.enviadoEm, historico: item.historico.concat(evento('ENVIOU', ator)) };
    try {
      await regravar(bruto, novo);
      enviados.push(novo);
    } catch (e) {
      if (!(e instanceof ErroContas)) throw e; // mudou no meio: fica de fora deste envio
    }
  }
  if (!enviados.length) throw erro(CONFLITO);
  lote.itens = enviados.map((i) => i.id);
  lote.total = enviados.reduce((t, i) => t + i.valor, 0);
  await prisma.configuracao.create({ data: { chave: PREFIXO_LOTE + lote.id, valor: JSON.stringify(lote) } });
  return { lote, itens: enviados };
}

// ---------- aprovação (diretor) ----------

async function decidir(id, aprovar, motivo, ator) {
  const lido = await lerItem(id);
  if (!lido) throw erro('Item não encontrado.');
  const { item, bruto } = lido;
  if (item.situacao !== 'AGUARDANDO') throw erro(`Este item já está como "${SITUACOES[item.situacao].nome}".`);
  const texto = String(motivo || '').trim().slice(0, 300);
  if (!aprovar && !texto) throw erro('Escreva o motivo da recusa.');
  const decisao = { aprovada: !!aprovar, motivo: texto || null, por: ator.id, porNome: ator.nome, em: new Date().toISOString() };
  const novo = {
    ...item, situacao: aprovar ? 'APROVADA' : 'RECUSADA', decisao,
    historico: item.historico.concat(evento(aprovar ? 'APROVOU' : 'RECUSOU', ator, texto ? { motivo: texto } : {})),
  };
  return regravar(bruto, novo);
}

// ---------- pagamento (financeiro) ----------

async function marcarPaga(id, { data, forma, observacao }, comprovantes, ator) {
  const lido = await lerItem(id);
  if (!lido) throw erro('Item não encontrado.');
  const { item, bruto } = lido;
  if (item.situacao !== 'APROVADA') throw erro('Só dá para marcar como paga uma despesa aprovada.');
  const pagoEm = dataValida(data);
  if (!pagoEm) throw erro('Informe a data do pagamento.');
  if (!FORMAS_PAGAMENTO.includes(forma)) throw erro('Escolha a forma de pagamento.');
  const pagamento = {
    pagoEm, forma, observacao: String(observacao || '').trim().slice(0, 300) || null,
    comprovantes: comprovantes || [], por: ator.id, porNome: ator.nome, em: new Date().toISOString(),
  };
  const novo = { ...item, situacao: 'PAGA', pagamento, historico: item.historico.concat(evento('PAGOU', ator)) };
  return regravar(bruto, novo);
}

// ---------- resumo ----------

// Um envio está revisado quando nenhum item dele está mais aguardando.
async function envioRevisado(loteId) {
  const lote = await lerLote(loteId);
  if (!lote) return null;
  const itens = [];
  for (const id of lote.itens) {
    const l = await lerItem(id);
    if (l) itens.push(l.item);
  }
  if (itens.some((i) => i.situacao === 'AGUARDANDO')) return null;
  return { lote, itens };
}

module.exports = {
  TIPOS, CATEGORIAS, FORMAS_PAGAMENTO, SITUACOES, ErroContas,
  centavos, reais, dataValida, segundaDaSemana, rotuloSemana,
  listarItens, listarLotes, lerItem, lerLote, lerFormulario,
  criar, editar, excluir, enviar, decidir, marcarPaga, envioRevisado,
};
