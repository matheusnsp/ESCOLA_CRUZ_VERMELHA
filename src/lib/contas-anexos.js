// lib/contas-anexos.js
//
// Notas, boletos, recibos e comprovantes das Contas a pagar. Ficam PRIVADOS: não vão para o bucket
// das fotos dos cursos (que é público), e sim para um bucket privado do Supabase Storage
// (SUPABASE_BUCKET_PRIVADO, padrão "escola-privado", criado sozinho no primeiro envio). Só a
// secretaria logada abre, pela rota /contas/:id/anexos/:n, que confere a permissão e repassa o
// arquivo. Sem o Supabase configurado (desenvolvimento), grava numa pasta fora de src/public.
//
// Aceita PDF, JPG, PNG e WEBP até 10 MB; o tipo é conferido pelos primeiros bytes do arquivo,
// não pelo que o navegador diz.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET_PRIVADO || 'escola-privado';
const PASTA_LOCAL = path.join(__dirname, '..', '..', 'privado', 'contas');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ARQUIVOS = 5;
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const remoto = () => !!(URL_BASE && SERVICE_KEY);

function tipoReal(buf) {
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Middleware: lê até 5 arquivos do campo `campo` para a memória. Erro vai em req.uploadErro.
function receber(campo) {
  const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: MAX_ARQUIVOS } }).array(campo, MAX_ARQUIVOS);
  return (req, res, next) => up(req, res, (err) => {
    if (err) {
      req.uploadErro = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais (máximo 10 MB cada).'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `No máximo ${MAX_ARQUIVOS} arquivos por vez.`
          : 'Não foi possível receber o arquivo.';
    }
    const arquivos = (req.files || []).filter((f) => f.size > 0);
    if (!req.uploadErro && arquivos.some((f) => !tipoReal(f.buffer))) req.uploadErro = 'Envie PDF ou foto (JPG, PNG ou WEBP).';
    req.arquivos = req.uploadErro ? [] : arquivos;
    next();
  });
}

async function chamar(metodo, caminho, corpo, cabecalhos = {}) {
  return fetch(`${URL_BASE}/storage/v1/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, ...cabecalhos },
    body: corpo,
  });
}

let bucketPronto = false;
async function garantirBucket() {
  if (bucketPronto) return;
  const r = await chamar('GET', `bucket/${BUCKET}`);
  if (r.ok) {
    const b = await r.json().catch(() => ({}));
    if (b.public) throw new Error(`O bucket "${BUCKET}" está público; os anexos precisam de um bucket privado.`);
    bucketPronto = true;
    return;
  }
  const c = await chamar('POST', 'bucket', JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_BYTES }), { 'Content-Type': 'application/json' });
  if (!c.ok && c.status !== 409) throw new Error(`Não consegui criar o bucket privado (${c.status}).`);
  bucketPronto = true;
}

// Guarda os arquivos recebidos e devolve [{ nome, caminho, tipo, tamanho }] para o item.
async function guardar(arquivos, prefixo) {
  const salvos = [];
  for (const f of arquivos) {
    const tipo = tipoReal(f.buffer);
    const caminho = `contas/${prefixo}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${EXT[tipo]}`;
    if (remoto()) {
      await garantirBucket();
      const r = await chamar('POST', `object/${BUCKET}/${caminho}`, f.buffer, { 'Content-Type': tipo, 'x-upsert': 'false' });
      if (!r.ok) throw new Error(`Falha ao guardar o anexo (${r.status}).`);
    } else {
      const destino = path.join(PASTA_LOCAL, caminho.replace(/^contas\//, ''));
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, f.buffer);
    }
    const nome = String(f.originalname || 'arquivo').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(-80) || `arquivo.${EXT[tipo]}`;
    salvos.push({ nome, caminho, tipo, tamanho: f.size });
  }
  return salvos;
}

// Devolve { tipo, buffer } do anexo.
async function abrir(anexo) {
  if (!anexo || !/^contas\/[\w-]+\/\d+-[a-f0-9]{16}\.(pdf|jpg|png|webp)$/.test(anexo.caminho)) throw new Error('Anexo inválido.');
  if (remoto()) {
    const r = await chamar('GET', `object/authenticated/${BUCKET}/${anexo.caminho}`);
    if (!r.ok) throw new Error(`Anexo indisponível (${r.status}).`);
    return { tipo: anexo.tipo, buffer: Buffer.from(await r.arrayBuffer()) };
  }
  return { tipo: anexo.tipo, buffer: fs.readFileSync(path.join(PASTA_LOCAL, anexo.caminho.replace(/^contas\//, ''))) };
}

// Apaga (anexo removido antes do envio, ou item excluído). Falha aqui não atrapalha a tela.
async function apagar(anexos) {
  for (const a of anexos || []) {
    try {
      if (!/^contas\//.test(a.caminho)) continue;
      if (remoto()) await chamar('DELETE', `object/${BUCKET}/${a.caminho}`);
      else fs.rmSync(path.join(PASTA_LOCAL, a.caminho.replace(/^contas\//, '')), { force: true });
    } catch (e) {
      console.error('[contas] apagar anexo:', e.message);
    }
  }
}

module.exports = { receber, guardar, abrir, apagar, MAX_ARQUIVOS };
