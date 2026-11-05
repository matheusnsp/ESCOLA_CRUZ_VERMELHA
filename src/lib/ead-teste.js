// lib/ead-teste.js
//
// Link secreto de teste do curso online (site do aluno: /ead-teste/<código>). O curso ainda não
// aparece no site; quem tem o link vê as telas como o aluno verá. O código fica na Configuracao,
// chave "ead:teste:<cursoOnlineId>" (sem coluna nova). Trocar gera outro e o antigo para de abrir.

const crypto = require('crypto');
const prisma = require('../db');

const PREFIXO = 'ead:teste:';
const FORMATO = /^[A-Za-z0-9_-]{43}$/; // 32 bytes em base64url

async function codigoDoCurso(cursoOnlineId) {
  const c = await prisma.configuracao.findUnique({ where: { chave: PREFIXO + cursoOnlineId } });
  return c ? c.valor : null;
}

async function gerarCodigo(cursoOnlineId) {
  const valor = crypto.randomBytes(32).toString('base64url');
  const chave = PREFIXO + cursoOnlineId;
  await prisma.configuracao.upsert({ where: { chave }, update: { valor }, create: { chave, valor } });
  return valor;
}

async function desligar(cursoOnlineId) {
  await prisma.configuracao.deleteMany({ where: { chave: PREFIXO + cursoOnlineId } });
}

// cursoOnlineId do código, ou null. Código fora do formato nem vai ao banco.
async function cursoDoCodigo(codigo) {
  if (!FORMATO.test(String(codigo || ''))) return null;
  const c = await prisma.configuracao.findFirst({ where: { chave: { startsWith: PREFIXO }, valor: codigo } });
  return c ? c.chave.slice(PREFIXO.length) : null;
}

// O que a tela do aluno precisa saber: onde está (tópico, número do módulo) e para onde ir
// (anterior e próxima dentro do módulo, pulando tópicos sem tela). Sem banco.
// modulo = árvore de lib/ead-db.js carregarModulo; urlTela(id) monta o link de cada tela.
function contextoDaTela(modulo, moduloNumero, telaId, urlTela) {
  const seq = [];
  modulo.topicos.forEach((t, ti) => t.telas.forEach((tela) => seq.push({ tela, ti })));
  const i = seq.findIndex((x) => x.tela.id === telaId);
  if (i < 0) return null;
  const prox = seq[i + 1];
  return {
    cursoNome: modulo.cursoOnline.curso.nome, moduloNumero, modulo, topicos: modulo.topicos,
    tela: seq[i].tela, topicoIndex: seq[i].ti, urlTela,
    anterior: i > 0 ? urlTela(seq[i - 1].tela.id) : null,
    proxima: prox ? { titulo: prox.tela.titulo, url: urlTela(prox.tela.id) } : null,
  };
}

module.exports = { codigoDoCurso, gerarCodigo, desligar, cursoDoCodigo, contextoDaTela };
