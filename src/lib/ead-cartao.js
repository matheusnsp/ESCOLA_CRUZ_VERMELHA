// lib/ead-cartao.js
//
// Cartão de bolso do curso online (EAD, etapa 3): PDF A6 retrato gerado a partir das telas do curso.
// Capa com o lema OLHAR · LIGAR · CUIDAR e, depois, uma página por tela que tenha revisão rápida ou
// alerta (passos numerados, foto, alerta), agrupadas por módulo. Sai sempre do conteúdo atual.
// As fotos do painel são WEBP (lib/upload.js), que o pdfkit não lê: viram JPEG com o sharp na hora.
// Spec: docs/superpowers/specs/2026-11-06-ead-certificado.md §4

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const prisma = require('../db');
const { POR_ORDEM } = require('./ead-db');
const { uploadsDir } = require('./upload');

const MM = 72 / 25.4;
const A6 = [105 * MM, 148 * MM];
const MARGEM = 10 * MM;
const VERMELHO = '#c8102e';
const TINTA = '#141414';
const CINZA = '#6b6b6b';
const PUBLIC = path.join(__dirname, '..', 'public');
const LOGO = path.join(PUBLIC, 'img', 'logo-email.png');
const LIMITE_FOTO = 3 * 1024 * 1024;

// Páginas do cartão, na ordem: capa e as telas com revisão ou alerta (sem o módulo final).
// modulos: na ordem do aluno, cada um com topicos[].telas[].
function paginasDoCartao(modulos) {
  const paginas = [{ tipo: 'capa' }];
  let numero = 0;
  for (const m of modulos) {
    if (m.final) continue;
    numero++;
    let primeira = true;
    for (const t of m.topicos) {
      for (const tela of t.telas) {
        if (!(tela.revisaoItens && tela.revisaoItens.length) && !tela.alerta) continue;
        paginas.push({ tipo: 'tela', modulo: { numero, titulo: m.titulo }, primeiraDoModulo: primeira, tela });
        primeira = false;
      }
    }
  }
  return paginas;
}

// Foto da tela como JPEG (Buffer) ou null se não der para ler. Aceita /uploads/..., /img/... e https://.
async function carregarFoto(url) {
  try {
    let buf = null;
    const u = String(url || '');
    if (u.startsWith('/uploads/')) {
      buf = await fs.promises.readFile(path.join(uploadsDir, path.basename(u)));
    } else if (u.startsWith('/img/')) {
      const alvo = path.normalize(path.join(PUBLIC, u));
      if (!alvo.startsWith(path.join(PUBLIC, 'img'))) return null;
      buf = await fs.promises.readFile(alvo);
    } else if (/^https:\/\//.test(u)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch(u, { signal: ctrl.signal });
        if (!r.ok || Number(r.headers.get('content-length') || 0) > LIMITE_FOTO) return null;
        const ab = await r.arrayBuffer();
        if (ab.byteLength > LIMITE_FOTO) return null;
        buf = Buffer.from(ab);
      } finally { clearTimeout(timer); }
    } else {
      return null;
    }
    return await sharp(buf).rotate().resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  } catch (e) {
    return null;
  }
}

// A Helvetica embutida no PDF só tem o conjunto WinAnsi (Latin-1 + aspas, travessão…). Setas e
// símbolos viram equivalentes; o resto que ela não tem (✓, emoji) sai, para não virar lixo na página.
const CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
// Letras de outros alfabetos latinos (Ł, Đ, ć…) viram a letra base em vez de sumir: um nome na
// declaração da escola não pode sair mutilado.
const LETRAS = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', ı: 'i', Ŀ: 'L', ŀ: 'l', Ŧ: 'T', ŧ: 't' };
const cabeNoWinAnsi = (c) => { const n = c.codePointAt(0); return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || c === '\n' || CP1252.includes(c); };
function paraPdf(t) {
  return String(t || '')
    .replace(/[\s\S]/gu, (c) => (cabeNoWinAnsi(c) ? c : LETRAS[c] || (c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || c)))
    .replace(/[→⇒➜➔⟶]/g, '›').replace(/≥/g, '>=').replace(/≤/g, '<=')
    .replace(/[\s\S]/gu, (c) => { const n = c.codePointAt(0); return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff) || c === '\n' || CP1252.includes(c) ? c : ''; })
    .replace(/ {2,}/g, ' ').trim();
}

const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function rodape(doc) {
  const y = A6[1] - MARGEM - 16;
  doc.save().moveTo(MARGEM, y - 4).lineTo(A6[0] - MARGEM, y - 4).lineWidth(0.5).strokeColor('#e4e1dc').stroke().restore();
  doc.font('Helvetica').fontSize(6.5).fillColor(CINZA)
    .text('Escola de Educação e Saúde · CVB-RJ', MARGEM, y, { width: A6[0] - 2 * MARGEM, lineBreak: false })
    .text('Em emergência: 192 (SAMU) · 193 (Bombeiros)', MARGEM, y + 8, { width: A6[0] - 2 * MARGEM, lineBreak: false });
}

function desenharCapa(doc, nomeCurso) {
  const L = A6[0] - 2 * MARGEM;
  doc.rect(0, 0, A6[0], 16 * MM).fill(VERMELHO);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#ffffff')
    .text('CRUZ VERMELHA BRASILEIRA · RIO DE JANEIRO', MARGEM, 6.5 * MM, { width: L, align: 'center', characterSpacing: 0.6 });
  try { doc.image(LOGO, A6[0] / 2 - 18 * MM, 22 * MM, { fit: [36 * MM, 14 * MM], align: 'center' }); } catch (e) { /* sem logo, segue */ }
  doc.font('Helvetica-Bold').fontSize(8).fillColor(VERMELHO).text('CARTÃO DE BOLSO', MARGEM, 42 * MM, { width: L, align: 'center', characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA).text(paraPdf(nomeCurso), MARGEM, 48 * MM, { width: L, align: 'center', height: 24 * MM, ellipsis: true });
  const lema = [['OLHAR', 'a cena e a pessoa'], ['LIGAR', '192 · 193'], ['CUIDAR', 'até o socorro chegar']];
  const w = (L - 2 * 2 * MM) / 3;
  lema.forEach(([t, s], i) => {
    const x = MARGEM + i * (w + 2 * MM); const y = 80 * MM;
    doc.roundedRect(x, y, w, 20 * MM, 2 * MM).fill(VERMELHO);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(t, x, y + 5 * MM, { width: w, align: 'center' });
    doc.font('Helvetica').fontSize(6).fillColor('#ffffff').text(s, x + 1 * MM, y + 11 * MM, { width: w - 2 * MM, align: 'center' });
  });
  doc.font('Helvetica').fontSize(7.5).fillColor(CINZA)
    .text('Os passos de cada tela do curso, para guardar no celular ou imprimir. Não substitui o treinamento prático.', MARGEM, 106 * MM, { width: L, align: 'center' });
  rodape(doc);
}

function desenharTela(doc, pag, foto) {
  const L = A6[0] - 2 * MARGEM;
  const limite = A6[1] - MARGEM - 24; // acima do rodapé
  let y = MARGEM;
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(VERMELHO)
    .text(paraPdf(`MÓDULO ${pag.modulo.numero} · ${pag.modulo.titulo.toUpperCase()}`), MARGEM, y, { width: L, characterSpacing: 0.5, lineBreak: false, ellipsis: true });
  y += 11;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(TINTA);
  const titulo = paraPdf(pag.tela.titulo);
  const hT = Math.min(doc.heightOfString(titulo, { width: L }), 34);
  doc.text(titulo, MARGEM, y, { width: L, height: hT, ellipsis: true });
  y += hT + 5;
  if (foto) {
    const h = 35 * MM;
    doc.save().roundedRect(MARGEM, y, L, h, 2 * MM).clip().image(foto, MARGEM, y, { cover: [L, h], align: 'center', valign: 'center' }).restore();
    y += h + 6;
  }
  const itens = (pag.tela.revisaoItens || []).map(paraPdf);
  const alerta = pag.tela.alerta ? paraPdf(pag.tela.alerta) : '';
  if (pag.tela.revisaoTitulo && itens.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1a365d').text(paraPdf(pag.tela.revisaoTitulo), MARGEM, y, { width: L, lineBreak: false, ellipsis: true });
    y += 11;
  }
  const alturaAlerta = alerta ? Math.min(doc.font('Helvetica').fontSize(8).heightOfString(alerta, { width: L - 12 }) + 22, 70) : 0;
  itens.forEach((item, i) => {
    if (y > limite - alturaAlerta - 14) return;
    doc.circle(MARGEM + 6, y + 6, 6).fill(VERMELHO);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff').text(String(i + 1), MARGEM, y + 2.6, { width: 12, align: 'center' });
    doc.font('Helvetica').fontSize(9.5).fillColor(TINTA);
    const h = Math.min(doc.heightOfString(item, { width: L - 18 }), limite - alturaAlerta - y);
    doc.text(item, MARGEM + 18, y + 1, { width: L - 18, height: h, ellipsis: true });
    y += Math.max(h, 12) + 5;
  });
  if (alerta) {
    const yA = Math.min(y + 2, limite - alturaAlerta);
    doc.roundedRect(MARGEM, yA, L, alturaAlerta, 2 * MM).lineWidth(1.2).strokeColor(VERMELHO).stroke();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(VERMELHO).text('ALERTA', MARGEM + 6, yA + 6, { width: L - 12, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(8).fillColor(TINTA).text(alerta, MARGEM + 6, yA + 15, { width: L - 12, height: alturaAlerta - 19, ellipsis: true });
  }
  rodape(doc);
}

async function gerarCartao(cursoOnlineId) {
  const co = await prisma.cursoOnline.findUnique({
    where: { id: cursoOnlineId },
    include: { curso: { select: { nome: true } }, modulos: { orderBy: POR_ORDEM, include: { topicos: { orderBy: POR_ORDEM, include: { telas: { orderBy: POR_ORDEM } } } } } },
  });
  if (!co) return null;
  const modulos = [...co.modulos.filter((m) => !m.final), ...co.modulos.filter((m) => m.final)];
  const paginas = paginasDoCartao(modulos);
  const fotos = await Promise.all(paginas.map((p) => (p.tipo === 'tela' && p.tela.fotoUrl ? carregarFoto(p.tela.fotoUrl) : null)));

  const doc = new PDFDocument({ size: A6, margin: MARGEM, autoFirstPage: false, info: { Title: `Cartão de bolso — ${co.curso.nome}`, Author: 'Cruz Vermelha Brasileira — Rio de Janeiro' } });
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fim = new Promise((r) => doc.on('end', r));
  paginas.forEach((p, i) => {
    doc.addPage({ size: A6, margin: MARGEM });
    if (p.tipo === 'capa') desenharCapa(doc, co.curso.nome);
    else desenharTela(doc, p, fotos[i]);
  });
  doc.end();
  await fim;
  return { buffer: Buffer.concat(partes), nomeArquivo: `cartao-de-bolso-${slug(co.curso.nome)}.pdf` };
}

module.exports = { paginasDoCartao, carregarFoto, gerarCartao, paraPdf };
