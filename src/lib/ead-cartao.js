// lib/ead-cartao.js
//
// Cartão de bolso do curso online: PDF A6 retrato gerado a partir do conteúdo atual do curso.
// 2026-11-09 (padrão do site): capa com a marca da Escola e o lema OLHAR · LIGAR · CUIDAR e, depois,
// UMA página por módulo (o final, de cenários, fica fora): foto do módulo, os passos principais (o 1º item
// da revisão rápida de cada tela, no máximo 6) e o 1º alerta do módulo. Cores e fonte (Inter) do site.
// As fotos do painel são WEBP (lib/upload.js), que o pdfkit não lê: viram JPEG com o sharp na hora.
// Specs: docs/superpowers/specs/2026-11-06-ead-certificado.md §4 e 2026-11-09-padrao-visual-escola-digital.md §1

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
const VERMELHO = '#d9081f';
const VERMELHO2 = '#b80016';
const ROSA = '#fff1f2';
const LINHA = '#e4e1dc';
const MAX_PASSOS = 6;
const TINTA = '#141414';
const CINZA = '#6b6b6b';
const PUBLIC = path.join(__dirname, '..', 'public');
const LOGO = path.join(PUBLIC, 'img', 'logo-cvb-rj.webp');
const FONTES_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LIMITE_FOTO = 3 * 1024 * 1024;

// Páginas do cartão, na ordem: capa e 1 por módulo (sem o módulo final). modulos: na ordem do aluno,
// cada um com topicos[].telas[]. Módulo sem revisão nem alerta continua com página (a numeração bate).
function paginasDoCartao(modulos) {
  const paginas = [{ tipo: 'capa' }];
  let numero = 0;
  for (const m of modulos) {
    if (m.final) continue;
    numero++;
    const passos = []; let alerta = null;
    for (const t of m.topicos || []) {
      for (const tela of t.telas || []) {
        const item = (tela.revisaoItens || []).map((x) => String(x || '').trim()).find(Boolean);
        if (item && passos.length < MAX_PASSOS) passos.push(item);
        if (!alerta && tela.alerta && String(tela.alerta).trim()) alerta = String(tela.alerta).trim();
      }
    }
    paginas.push({ tipo: 'modulo', numero, titulo: m.titulo, fotoUrl: m.fotoIntroUrl || null, passos, alerta });
  }
  return paginas;
}

// Fonte do site (Inter) quando os arquivos existem; senão a Helvetica embutida no pdfkit.
function registrarFontes(doc, dir = FONTES_DIR) {
  const arq = { R: 'Inter-Regular.ttf', B: 'Inter-Bold.ttf', K: 'Inter-Black.ttf' };
  // registerFont só guarda o caminho (o erro viria no 1º uso): confere os arquivos antes.
  if (!Object.values(arq).every((f) => fs.existsSync(path.join(dir, f)))) return { R: 'Helvetica', B: 'Helvetica-Bold', K: 'Helvetica-Bold' };
  for (const [nome, f] of Object.entries(arq)) doc.registerFont('Inter' + nome, path.join(dir, f));
  return { R: 'InterR', B: 'InterB', K: 'InterK' };
}

let logoPng = null;
function carregarLogo() {
  if (!logoPng) logoPng = sharp(LOGO).resize({ height: 160 }).png().toBuffer().catch(() => null);
  return logoPng;
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

function rodape(doc, F) {
  const y = A6[1] - MARGEM - 16;
  doc.save().moveTo(MARGEM, y - 5).lineTo(A6[0] - MARGEM, y - 5).lineWidth(0.5).strokeColor(LINHA).stroke().restore();
  doc.font(F.B).fontSize(6.5).fillColor(TINTA)
    .text('Escola de Educação e Saúde CVB-RJ', MARGEM, y, { width: A6[0] - 2 * MARGEM, lineBreak: false });
  doc.font(F.R).fontSize(6.5).fillColor(CINZA)
    .text('Em emergência: 192 (SAMU) · 193 (Bombeiros)', MARGEM, y + 8.5, { width: A6[0] - 2 * MARGEM, lineBreak: false });
}

// Rótulo como os do site: traço vermelho + texto em caixa alta espaçado.
function rotulo(doc, F, texto, x, y, cor = VERMELHO) {
  doc.save().moveTo(x, y + 3.2).lineTo(x + 14, y + 3.2).lineWidth(1.4).strokeColor(cor).stroke().restore();
  doc.font(F.B).fontSize(6.5).fillColor(cor).text(paraPdf(texto).toUpperCase(), x + 20, y, { characterSpacing: 1, lineBreak: false });
}

function desenharCapa(doc, F, nomeCurso, logo) {
  const L = A6[0] - 2 * MARGEM;
  doc.rect(0, 0, A6[0], 11 * MM).fill(VERMELHO);
  doc.font(F.B).fontSize(6).fillColor('#ffffff')
    .text('CRUZ VERMELHA BRASILEIRA · RIO DE JANEIRO', MARGEM, 4.3 * MM, { width: L, align: 'center', characterSpacing: 0.8, lineBreak: false });
  // Marca como no header do site: logo | ESCOLA DE EDUCAÇÃO / E SAÚDE CVB-RJ
  const yM = 20 * MM; const hLogo = 11 * MM; const wLogo = hLogo * 2.2;
  const wTexto = doc.font(F.K).fontSize(9.5).widthOfString('ESCOLA DE EDUCAÇÃO');
  const x0 = (A6[0] - (wLogo + 14 + wTexto)) / 2;
  if (logo) { try { doc.image(logo, x0, yM, { fit: [wLogo, hLogo], valign: 'center' }); } catch (e) { /* sem logo, segue */ } }
  const xT = x0 + wLogo + 14;
  doc.save().moveTo(xT - 7, yM + 1).lineTo(xT - 7, yM + hLogo - 1).lineWidth(0.6).strokeColor(LINHA).stroke().restore();
  doc.font(F.K).fontSize(9.5).fillColor(TINTA).text('ESCOLA DE EDUCAÇÃO', xT, yM + 7, { lineBreak: false });
  doc.font(F.B).fontSize(6).fillColor(VERMELHO).text('E SAÚDE CVB-RJ', xT, yM + 19, { characterSpacing: 1, lineBreak: false });

  rotulo(doc, F, 'Cartão de bolso', MARGEM, 40 * MM);
  doc.font(F.K).fontSize(17).fillColor(TINTA).text(paraPdf(nomeCurso), MARGEM, 45 * MM, { width: L, height: 30 * MM, ellipsis: true, lineGap: -2 });

  const lema = [['OLHAR', 'a cena e a pessoa'], ['LIGAR', '192 · 193'], ['CUIDAR', 'até o socorro chegar']];
  const w = (L - 2 * 2 * MM) / 3; const yL = 76 * MM;
  lema.forEach(([t, sub], i) => {
    const x = MARGEM + i * (w + 2 * MM);
    doc.roundedRect(x, yL, w, 19 * MM, 3 * MM).fill(VERMELHO);
    doc.font(F.K).fontSize(10).fillColor('#ffffff').text(t, x, yL + 5 * MM, { width: w, align: 'center', lineBreak: false });
    doc.font(F.R).fontSize(6).fillColor('#ffffff').text(sub, x + 1 * MM, yL + 11 * MM, { width: w - 2 * MM, align: 'center' });
  });
  doc.font(F.R).fontSize(7.5).fillColor(CINZA)
    .text('Os passos principais de cada módulo do curso, para guardar no celular ou imprimir. Não substitui o treinamento prático.', MARGEM, 101 * MM, { width: L, align: 'left', lineGap: 1 });
  rodape(doc, F);
}

function desenharModulo(doc, F, pag, foto) {
  const L = A6[0] - 2 * MARGEM;
  const limite = A6[1] - MARGEM - 24; // acima do rodapé
  let y = MARGEM;
  // Número grande vermelho + "MÓDULO N" + título (como nos cartões de módulo do curso)
  const num = String(pag.numero).padStart(2, '0');
  doc.font(F.K).fontSize(30).fillColor(VERMELHO).text(num, MARGEM - 1, y - 4, { lineBreak: false, characterSpacing: -1.5 });
  const xT = MARGEM + doc.widthOfString(num) + 8; const wT = A6[0] - MARGEM - xT;
  doc.font(F.B).fontSize(6.5).fillColor(CINZA).text(`MÓDULO ${pag.numero}`, xT, y + 1, { characterSpacing: 1, lineBreak: false });
  doc.font(F.K).fontSize(12).fillColor(TINTA);
  const titulo = paraPdf(pag.titulo);
  const hT = Math.min(doc.heightOfString(titulo, { width: wT }), 44);
  doc.text(titulo, xT, y + 10, { width: wT, height: hT, ellipsis: true, lineGap: -1 });
  y = Math.max(y + 34, y + 10 + hT + 6);
  if (foto) {
    const h = 26 * MM;
    doc.save().roundedRect(MARGEM, y, L, h, 3 * MM).clip().image(foto, MARGEM, y, { cover: [L, h], align: 'center', valign: 'center' }).restore();
    y += h + 9;
  }
  const alerta = pag.alerta ? paraPdf(pag.alerta) : '';
  const alturaAlerta = alerta ? Math.min(doc.font(F.R).fontSize(8).heightOfString(alerta, { width: L - 16 }) + 23, 66) : 0;
  const fimPassos = limite - (alerta ? alturaAlerta + 8 : 0);
  if (pag.passos.length) {
    rotulo(doc, F, 'Passos principais', MARGEM, y);
    y += 13;
  }
  pag.passos.forEach((p, i) => {
    if (y > fimPassos - 13) return;
    const item = paraPdf(p);
    doc.circle(MARGEM + 6.5, y + 6, 6.5).fill(VERMELHO);
    doc.font(F.B).fontSize(7).fillColor('#ffffff').text(String(i + 1), MARGEM, y + 3, { width: 13, align: 'center', lineBreak: false });
    doc.font(F.R).fontSize(9).fillColor(TINTA);
    const h = Math.min(doc.heightOfString(item, { width: L - 20 }), 24, fimPassos - y);
    doc.text(item, MARGEM + 20, y + 1.5, { width: L - 20, height: h, ellipsis: true });
    y += Math.max(h, 13) + 5;
  });
  if (alerta) {
    const yA = Math.min(y + 3, limite - alturaAlerta);
    doc.roundedRect(MARGEM, yA, L, alturaAlerta, 2.5 * MM).fill(ROSA);
    doc.save().roundedRect(MARGEM, yA, 3, alturaAlerta, 1.5).fill(VERMELHO).restore();
    doc.font(F.B).fontSize(6.5).fillColor(VERMELHO2).text('ALERTA', MARGEM + 10, yA + 7, { characterSpacing: 1, lineBreak: false });
    doc.font(F.R).fontSize(8).fillColor(TINTA).text(alerta, MARGEM + 10, yA + 16, { width: L - 16, height: alturaAlerta - 20, ellipsis: true });
  }
  rodape(doc, F);
}

async function gerarCartao(cursoOnlineId) {
  const co = await prisma.cursoOnline.findUnique({
    where: { id: cursoOnlineId },
    include: { curso: { select: { nome: true } }, modulos: { orderBy: POR_ORDEM, include: { topicos: { orderBy: POR_ORDEM, include: { telas: { orderBy: POR_ORDEM } } } } } },
  });
  if (!co) return null;
  const modulos = [...co.modulos.filter((m) => !m.final), ...co.modulos.filter((m) => m.final)];
  const paginas = paginasDoCartao(modulos);
  const [fotos, logo] = await Promise.all([
    Promise.all(paginas.map((p) => (p.tipo === 'modulo' && p.fotoUrl ? carregarFoto(p.fotoUrl) : null))),
    carregarLogo(),
  ]);

  const doc = new PDFDocument({ size: A6, margin: MARGEM, autoFirstPage: false, info: { Title: `Cartão de bolso — ${co.curso.nome}`, Author: 'Escola de Educação e Saúde CVB-RJ' } });
  const F = registrarFontes(doc);
  const partes = [];
  doc.on('data', (c) => partes.push(c));
  const fim = new Promise((r) => doc.on('end', r));
  paginas.forEach((p, i) => {
    doc.addPage({ size: A6, margins: { top: MARGEM, left: MARGEM, right: MARGEM, bottom: 0 } }); // bottom 0: nada empurra para uma página nova
    if (p.tipo === 'capa') desenharCapa(doc, F, co.curso.nome, logo);
    else desenharModulo(doc, F, p, fotos[i]);
  });
  doc.end();
  await fim;
  return { buffer: Buffer.concat(partes), nomeArquivo: `cartao-de-bolso-${slug(co.curso.nome)}.pdf` };
}

module.exports = { paginasDoCartao, carregarFoto, gerarCartao, paraPdf, registrarFontes };
