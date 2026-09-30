// lib/redacao.js
//
// Registro dos certificados da escola na Redação (o sistema da filial): a Redação grava o
// certificado na tabela dela, gera o código XXXX-XXXX (o mesmo formato dos certificados do
// voluntariado), registra na trilha de auditoria e publica a conferência em
// <REDACAO_URL>/certificado/<código>. É para lá que o QR code do certificado impresso leva.
//
// Configuração (Render, nos serviços da escola/secretaria):
//   REDACAO_URL              ex.: https://redacao.cruzvermelhariodejaneiro.org
//   REDACAO_ESCOLA_TOKEN     mesmo valor de ESCOLA_CERTIFICADOS_TOKEN na Vercel da Redação
// Sem as duas, o certificado sai sem QR e a tela avisa.
//
// O código devolvido fica no LogAuditoria da escola, com id fixo por matrícula
// ("cert-redacao-<matrícula>"): reimprimir não pede outro código.

const fetch = require('node-fetch');
const prisma = require('../db');

const TEMPO_LIMITE_MS = 12000;

function base() {
  return String(process.env.REDACAO_URL || '').trim().replace(/\/+$/, '');
}
function token() {
  return String(process.env.REDACAO_ESCOLA_TOKEN || '').trim().replace(/^(['"])(.*)\1$/, '$2');
}
function configurado() {
  // Fora de produção aceita http://localhost para o teste local com uma Redação falsa.
  const url = /^https:\/\//.test(base()) || (process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base()));
  return url && token().length >= 32;
}
const urlDoCertificado = (codigo) => `${base()}/certificado/${codigo}`;
const idRegistro = (matriculaId) => `cert-redacao-${matriculaId}`;
const CODIGO = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

function lerDetalhe(d) {
  if (!d) return {};
  if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
  return d;
}

// { matriculaId: { codigo, url } } dos que já foram registrados.
async function codigosRegistrados(matriculaIds) {
  if (!matriculaIds.length) return {};
  const logs = await prisma.logAuditoria.findMany({ where: { id: { in: matriculaIds.map(idRegistro) } } });
  const r = {};
  for (const l of logs) {
    const d = lerDetalhe(l.detalhe);
    if (CODIGO.test(d.codigo || '')) r[l.alvoId] = { codigo: d.codigo, url: d.url || urlDoCertificado(d.codigo) };
  }
  return r;
}

// Pede o registro de um certificado. A Redação é idempotente pela matrícula: pedir de novo devolve
// o mesmo código. Devolve { codigo, url } ou lança erro com uma frase para a tela.
async function registrar(dados) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resp = await fetch(`${base()}/api/escola/certificados`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(dados),
      signal: controle.signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok || !CODIGO.test(json.codigo || '')) {
      throw new Error(resp.status === 401 ? 'a Redação recusou a chave' : (json.erro || `a Redação respondeu ${resp.status}`));
    }
    return { codigo: json.codigo, url: json.url || urlDoCertificado(json.codigo) };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'a Redação não respondeu a tempo' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Registra na Redação quem ainda não tem código. itens: [{ matriculaId, nome, curso, cargaHoraria,
// emitidoEm, turmaId }]. Devolve { codigos: {matriculaId: {codigo,url}}, falhas: N, erro }.
async function registrarCertificados(itens, atorId = 'SISTEMA') {
  const codigos = await codigosRegistrados(itens.map((i) => i.matriculaId));
  if (!configurado()) return { codigos, falhas: itens.filter((i) => !codigos[i.matriculaId]).length, erro: 'nao_configurado' };
  let falhas = 0; let erro = null;
  for (const i of itens.filter((x) => !codigos[x.matriculaId])) {
    try {
      const r = await registrar({
        matricula_id: i.matriculaId,
        turma_id: i.turmaId,
        nome: i.nome,
        curso: i.curso,
        carga_horaria: i.cargaHoraria,
        emitido_em: i.emitidoEm ? new Date(i.emitidoEm).toISOString() : new Date().toISOString(),
      });
      await prisma.logAuditoria.create({
        data: { id: idRegistro(i.matriculaId), atorId, acao: 'CERTIFICADO_REDACAO', alvoTipo: 'Matricula', alvoId: i.matriculaId, detalhe: r },
      }).catch((e) => { if (e.code !== 'P2002') throw e; });
      codigos[i.matriculaId] = r;
    } catch (e) {
      falhas++; erro = e.message;
      console.error('[REDACAO] certificado', i.matriculaId, e.message);
    }
  }
  return { codigos, falhas, erro };
}

module.exports = { configurado, registrarCertificados, codigosRegistrados, urlDoCertificado };
