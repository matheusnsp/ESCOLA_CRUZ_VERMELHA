// lib/ead-lote-declaracao.js
//
// Etapa 6: o que a escola baixa para comprovar a capacitação (Lei 13.722/2018, Lei Lucas).
//   gerarDeclaracao: PDF A4 da Escola da Cruz Vermelha com quem concluiu (CPF mascarado, Livro/Registro,
//                    código de verificação) e as assinaturas do certificado do curso;
//   gerarPlanilhaLote: Excel com toda a equipe do lote, inclusive quem foi retirado.

const PDFDocument = require('pdfkit');
const prisma = require('../db');
const { funcionariosDoLote } = require('./ead-lote');
const { mascararCpf } = require('./ead-lote-texto');
const { paraPdf } = require('./ead-cartao');
const { assinaturasDoCurso, dataRio } = require('./ead-certificado');
const cert = require('./certificado');
const extras = require('./extras');
const { formatar } = require('./documento');

const VERMELHO = '#d9081f'; const TINTA = '#141414'; const CINZA = '#5f5f5f';
const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function carregar(loteId) {
  const lote = await prisma.loteEad.findUnique({ where: { id: loteId }, include: { escola: true, cursoOnline: { include: { curso: true } } } });
  if (!lote) return null;
  return { lote, funcionarios: await funcionariosDoLote(loteId) };
}

async function gerarDeclaracao(loteId, { compress = true } = {}) {
  const d = await carregar(loteId);
  if (!d) return null;
  const { lote } = d;
  const curso = lote.cursoOnline.curso;
  await extras.anexar('curso', [curso]);
  const assinaturas = assinaturasDoCurso(curso, await cert.lerAjustes());
  const concluintes = d.funcionarios.filter((f) => !f.vaga.removidaEm && f.concluidoEm)
    .sort((a, b) => a.usuario.nome.localeCompare(b.usuario.nome, 'pt-BR'));

  const doc = new PDFDocument({ size: 'A4', margin: 56, compress, info: { Title: paraPdf(`Declaração de capacitação — ${lote.escola.nome}`), Author: 'Escola de Educação e Saúde CVB-RJ' } });
  const partes = []; doc.on('data', (b) => partes.push(b));
  const fim = new Promise((r) => doc.on('end', r));
  const L = doc.page.width - 112;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(VERMELHO).text(paraPdf('CRUZ VERMELHA BRASILEIRA – RIO DE JANEIRO'), { align: 'center', characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text(paraPdf('Escola de Educação e Saúde CVB-RJ'), { align: 'center' });
  doc.moveDown(1.6);
  doc.font('Helvetica-Bold').fontSize(18).fillColor(TINTA).text(paraPdf('DECLARAÇÃO DE CAPACITAÇÃO'), { align: 'center' });
  doc.moveDown(1.2);
  const cnpj = lote.escola.cnpj ? ` (CNPJ ${formatar(lote.escola.cnpj)})` : '';
  doc.font('Helvetica').fontSize(11).fillColor(TINTA).text(paraPdf(
    `Declaramos que os profissionais abaixo, da ${lote.escola.nome}${cnpj}, concluíram o curso online ${curso.nome} `
    + `(${curso.cargaHoraria} horas), capacitação teórica em primeiros socorros, em atendimento à Lei 13.722/2018.`,
  ), { align: 'left', lineGap: 3 });
  doc.moveDown(1.2);

  if (!concluintes.length) {
    doc.font('Helvetica-Oblique').fontSize(11).fillColor(CINZA).text(paraPdf('Nenhum funcionário concluiu o curso até esta data.'));
  } else {
    const cols = [{ t: 'Nome', w: 0.36 }, { t: 'CPF', w: 0.17 }, { t: 'Conclusão', w: 0.14 }, { t: 'Livro / Registro', w: 0.16 }, { t: 'Código', w: 0.17 }];
    const linha = (vals, negrito) => {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const y = doc.y; let x = 56; let alt = 0;
      doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(negrito ? 8.5 : 9).fillColor(negrito ? CINZA : TINTA);
      vals.forEach((v, i) => {
        const w = cols[i].w * L;
        doc.text(paraPdf(v), x, y, { width: w - 6 });
        alt = Math.max(alt, doc.heightOfString(paraPdf(v), { width: w - 6 }));
        x += w;
      });
      doc.y = y + alt + 5;
      doc.moveTo(56, doc.y - 2).lineTo(56 + L, doc.y - 2).lineWidth(0.4).strokeColor('#dddddd').stroke();
      doc.x = 56;
    };
    linha(cols.map((c) => c.t), true);
    for (const f of concluintes) {
      linha([f.usuario.nome, mascararCpf(f.usuario.cpfCnpj) || '—', dataRio(f.concluidoEm), f.livro ? `${f.livro} / ${f.registro}` : '—', f.codigoRedacao || '—'], false);
    }
    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(paraPdf('Cada certificado pode ser conferido pelo código de verificação no site da Escola.'), 56, doc.y, { width: L });
  }

  doc.moveDown(1.4);
  doc.font('Helvetica').fontSize(10.5).fillColor(TINTA).text(paraPdf(`Rio de Janeiro, ${dataRio(new Date())}.`), 56, doc.y, { width: L });
  if (doc.y > doc.page.height - 170) doc.addPage();
  doc.moveDown(3);
  const yAss = doc.y; const n = Math.max(1, assinaturas.length); const wAss = L / n;
  assinaturas.forEach((a, i) => {
    const x = 56 + i * wAss;
    doc.moveTo(x + 14, yAss).lineTo(x + wAss - 14, yAss).lineWidth(0.6).strokeColor(TINTA).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TINTA).text(paraPdf(a.nome), x, yAss + 5, { width: wAss, align: 'center' });
    if (a.cargo) doc.font('Helvetica').fontSize(8.5).fillColor(CINZA).text(paraPdf(a.cargo), x, doc.y, { width: wAss, align: 'center' });
  });
  doc.y = yAss + 50; doc.x = 56;
  doc.moveDown(1);
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(CINZA).text(paraPdf('Capacitação teórica, sem prática em manequim.'), 56, doc.y, { width: L });
  doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(paraPdf('Escola de Educação e Saúde da Cruz Vermelha Brasileira – RJ · Praça da Cruz Vermelha, 10 · Centro · Rio de Janeiro'), 56, doc.page.height - 70, { width: L, align: 'center' });
  doc.end();
  await fim;
  return { buffer: Buffer.concat(partes), nomeArquivo: `declaracao-${slug(lote.escola.nome) || 'escola'}.pdf` };
}

async function gerarPlanilhaLote(loteId) {
  const ExcelJS = require('exceljs');
  const d = await carregar(loteId);
  if (!d) return null;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escola CVB-RJ';
  const ws = wb.addWorksheet('Funcionários');
  const DATA = 'dd/mm/yyyy';
  ws.columns = [
    { header: 'Nome', width: 34 }, { header: 'E-mail', width: 34 }, { header: 'CPF', width: 16 },
    { header: 'Entrou em', width: 12, style: { numFmt: DATA } }, { header: 'Como', width: 22 }, { header: '% concluído', width: 12 },
    { header: 'Concluiu em', width: 12, style: { numFmt: DATA } }, { header: 'Livro', width: 8 }, { header: 'Registro', width: 10 }, { header: 'Código', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const COMO = { GESTOR: 'Cadastrado pela escola', CONVITE: 'Pelo convite' };
  for (const f of d.funcionarios) {
    const como = (COMO[f.vaga.origem] || f.vaga.origem) + (f.vaga.removidaEm ? ' (retirado)' : '');
    ws.addRow([f.usuario.nome, f.usuario.email, mascararCpf(f.usuario.cpfCnpj), f.vaga.criadoEm, como, f.vaga.removidaEm ? null : f.percentual, f.concluidoEm, f.livro, f.registro, f.codigoRedacao || '']);
  }
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), nomeArquivo: `equipe-${slug(d.lote.escola.nome) || 'escola'}.xlsx` };
}

module.exports = { gerarDeclaracao, gerarPlanilhaLote };
