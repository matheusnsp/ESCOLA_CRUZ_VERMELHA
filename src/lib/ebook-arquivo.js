// lib/ebook-arquivo.js
//
// Arquivo do e-book (Escola Digital, 2026-11-09; spec 2026-11-09-escola-digital-ebooks.md §2 e §3.2).
// O PDF nunca tem endereço público: fica no bucket PRIVADO "ebooks" do Supabase (criado na primeira vez, com a
// chave de serviço que já existe) ou, sem Supabase (ambiente local), numa pasta fora de public/. O caminho gravado
// no banco diz onde está: "supabase:<nome>" ou "local:<nome>".
// Cada download sai com "Licenciado para …" no rodapé de todas as páginas (pdf-lib); o original não muda.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { paraPdf } = require('./ead-cartao');
const { mascarar } = require('./documento');

const BUCKET = 'ebooks';
const urlBase = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const chave = () => process.env.SUPABASE_SERVICE_KEY || '';
const comSupabase = () => !!(urlBase() && chave());
const pastaLocal = () => path.resolve(process.env.EBOOKS_DIR || path.join(__dirname, '..', '..', 'data', 'ebooks'));
const NOME_OK = /^[\w-]+\.pdf$/;

// { paginas } ou Error('PDF_INVALIDO') (não é PDF, está corrompido, criptografado ou sem páginas).
async function lerPdf(buffer) {
  let paginas = 0;
  try {
    // Criptografado: o pdf-lib recusa (EncryptedPDFError) e não daria para escrever o rodapé.
    paginas = (await PDFDocument.load(buffer, { updateMetadata: false })).getPageCount();
  } catch (e) {
    throw new Error('PDF_INVALIDO');
  }
  if (!paginas) throw new Error('PDF_INVALIDO');
  return { paginas };
}

let bucketPronto = null;
function garantirBucket() {
  if (!bucketPronto) {
    bucketPronto = fetch(`${urlBase()}/storage/v1/bucket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    }).then(async (r) => {
      // 400/409 com "already exists" = o bucket já existe: tudo certo.
      if (!r.ok && !/exist/i.test(await r.text().catch(() => ''))) throw new Error(`bucket ${r.status}`);
    }).catch((e) => { bucketPronto = null; throw e; });
  }
  return bucketPronto;
}

// Guarda o PDF e devolve o caminho para gravar no banco. O nome não usa o do arquivo enviado.
async function guardar(buffer) {
  const nome = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.pdf`;
  if (comSupabase()) {
    await garantirBucket();
    const r = await fetch(`${urlBase()}/storage/v1/object/${BUCKET}/${nome}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave()}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: buffer,
    });
    if (!r.ok) throw new Error(`Falha ao guardar o PDF (${r.status}).`);
    return `supabase:${nome}`;
  }
  fs.mkdirSync(pastaLocal(), { recursive: true });
  await fs.promises.writeFile(path.join(pastaLocal(), nome), buffer);
  return `local:${nome}`;
}

function separar(caminho) {
  const m = /^(supabase|local):(.+)$/.exec(String(caminho || ''));
  return m && NOME_OK.test(m[2]) ? { onde: m[1], nome: m[2] } : null;
}

// Buffer do PDF guardado, ou null (caminho inválido ou arquivo sumido).
async function ler(caminho) {
  const c = separar(caminho);
  if (!c) return null;
  try {
    if (c.onde === 'supabase') {
      const r = await fetch(`${urlBase()}/storage/v1/object/${BUCKET}/${c.nome}`, { headers: { Authorization: `Bearer ${chave()}` } });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    }
    return await fs.promises.readFile(path.join(pastaLocal(), c.nome));
  } catch (e) {
    return null;
  }
}

async function apagar(caminho) {
  const c = separar(caminho);
  if (!c) return;
  if (c.onde === 'supabase') {
    await fetch(`${urlBase()}/storage/v1/object/${BUCKET}/${c.nome}`, { method: 'DELETE', headers: { Authorization: `Bearer ${chave()}` } }).catch(() => {});
    return;
  }
  await fs.promises.unlink(path.join(pastaLocal(), c.nome)).catch(() => {});
}

// Escreve o texto no rodapé de todas as páginas (7 pt, cinza claro, centralizado). O rodapé é o de baixo NA TELA:
// respeita o recorte da página (CropBox) e a rotação (/Rotate 90, 180, 270), senão o texto saía cortado ou de lado.
async function marcar(buffer, texto) {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const t = paraPdf(texto); // a Helvetica do PDF só tem o WinAnsi: "Ł" vira "L", emoji sai
  const largura = fonte.widthOfTextAtSize(t, 7);
  for (const pagina of doc.getPages()) {
    const { x: cx, y: cy, width: cw, height: ch } = pagina.getCropBox();
    const giro = ((pagina.getRotation().angle % 360) + 360) % 360;
    const meioL = Math.max(8, (cw - largura) / 2); // ao longo da largura
    const meioA = Math.max(8, (ch - largura) / 2); // ao longo da altura (páginas giradas de lado)
    const pos = {
      0: { x: cx + meioL, y: cy + 10 },
      90: { x: cx + cw - 10, y: cy + meioA },
      180: { x: cx + cw - meioL, y: cy + ch - 10 },
      270: { x: cx + 10, y: cy + ch - meioA },
    }[giro] || { x: cx + meioL, y: cy + 10 };
    pagina.drawText(t, { ...pos, rotate: degrees(giro), size: 7, font: fonte, color: rgb(0.6, 0.6, 0.6) });
  }
  return Buffer.from(await doc.save());
}

// As n primeiras páginas, num PDF novo (vai para o Claude escrever a descrição sem inventar).
async function primeirasPaginas(buffer, n) {
  const origem = await PDFDocument.load(buffer, { updateMetadata: false });
  const novo = await PDFDocument.create();
  const idx = origem.getPageIndices().slice(0, n);
  (await novo.copyPages(origem, idx)).forEach((p) => novo.addPage(p));
  return Buffer.from(await novo.save());
}

function textoDoRodape(usuario, data = new Date()) {
  const dia = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const doc = usuario.cpfCnpj
    ? `${String(usuario.cpfCnpj).replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF'} ${mascarar(usuario.cpfCnpj)}`
    : usuario.passaporte ? 'Passaporte ***' : '';
  return ['Licenciado para ' + String(usuario.nome || '').trim(), doc, dia].filter(Boolean).join(' · ');
}

module.exports = { lerPdf, guardar, ler, apagar, marcar, primeirasPaginas, textoDoRodape, BUCKET };
