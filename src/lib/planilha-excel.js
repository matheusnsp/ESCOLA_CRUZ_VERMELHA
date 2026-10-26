// ============================================================
//  Planilha pronta da aba Integração (.xlsx já ligada ao sistema)
//
//  Em vez de a secretaria colar quatro links no Excel, o painel entrega um arquivo
//  que já vem com as quatro consultas (Power Query) apontando para os links da
//  planilha ao vivo (lib/planilha-ao-vivo.js), atualizando ao abrir e a cada 30 min.
//
//  Abas:
//    Início      — como usar
//    Turma       — escolhe a turma (curso + data) numa lista e aparecem os alunos dela,
//                  com a situação do pagamento colorida e botões de contato
//    Aluno       — escolhe o aluno numa lista e aparece a ficha dele, com as matrículas
//    Contatos    — todos os alunos, com ou sem inscrição, com WhatsApp Web e e-mail
//    Alunos, Matrículas, Cursos, Turmas — as tabelas que vêm do sistema. As colunas
//                  que menos se usam ficam escondidas num grupo (o "+" acima da tabela)
//    calc        — escondida: colunas auxiliares das listas
//
//  Como o arquivo é montado: o ExcelJS escreve as abas, as tabelas (com os dados de
//  agora, para a planilha não abrir vazia) e as fórmulas. Depois, o .xlsx (que é um
//  zip) ganha as partes que o Excel usa para o Power Query: xl/connections.xml, um
//  xl/queryTables/*.xml por tabela, as tabelas marcadas como tableType="queryTable" e
//  o customXml/item1.xml ("DataMashup") com as consultas em linguagem M. O formato
//  do DataMashup é o mesmo que a biblioteca @microsoft/connected-workbooks gera:
//  versão + pacote zip (Section1.m) + permissões + metadados + vínculos.
//
//  As fórmulas das listas usam só funções antigas (INDEX, SMALL, COUNTIF, HYPERLINK):
//  funcionam em qualquer Excel de 2010 em diante e no LibreOffice. Nada de FILTER.
// ============================================================
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const LINHAS_LISTA = 2000; // quantas linhas as listas por fórmula conseguem mostrar

// Nome da tabela (e da consulta) no Excel. Sem acento: entra nas fórmulas.
const TABELA = { matriculas: 'Matriculas', alunos: 'Alunos', cursos: 'Cursos', turmas: 'Turmas' };
const ABA = { matriculas: 'Matrículas', alunos: 'Alunos', cursos: 'Cursos', turmas: 'Turmas' };
const ORDEM = ['matriculas', 'alunos', 'cursos', 'turmas'];

// Colunas que ficam à vista em cada tabela; as outras vão para o grupo escondido (o "+").
const PRINCIPAIS = {
  matriculas: ['Aluno', 'Turma', 'Situação do pagamento', 'Falta pagar (R$)', 'Celular', 'E-mail', 'Inscrito em'],
  alunos: ['Nome', 'E-mail', 'Celular', 'Tem inscrição', 'Matrículas', 'Cursos', 'E-mail válido', 'Celular válido'],
  cursos: ['Curso', 'Ativo', 'Preço à vista (R$)', 'Parcelas', 'Valor da parcela (R$)', 'Turmas abertas', 'Próxima turma', 'Alunos com vaga'],
  turmas: ['Turma', 'Status', 'Início', 'Vagas', 'Alunos com vaga', 'Vagas restantes', 'Pagaram tudo', 'Falta pagar o curso', 'Aguardando taxa', 'Datas e horários'],
};
const LARGURA = {
  Aluno: 34, Nome: 34, Turma: 44, Curso: 34, Cursos: 40, 'Situação do pagamento': 30, 'E-mail': 32, Celular: 14,
  'Datas e horários': 48, Documento: 18, Escolaridade: 28, Status: 12, 'Tem inscrição': 12,
};

const VERMELHO = 'FFCC0000';
const AZUL_LINK = 'FF0563C1';
const FMT_BRL = '#,##0.00';
const FMT_DATA = 'dd/mm/yyyy';

// ---------- partes fixas do DataMashup (iguais às da connected-workbooks) ----------
const DM = {
  versao: Buffer.from('AAAAAA==', 'base64'),
  packageXml: '﻿<?xml version="1.0" encoding="utf-8"?><Package xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Version>2.99.202.0</Version><MinVersion>2.21.0.0</MinVersion><Culture>pt-BR</Culture></Package>',
  contentTypes: '﻿<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="text/xml" /><Default Extension="m" ContentType="application/x-ms-m" /></Types>',
  permissoes: '﻿<?xml version="1.0" encoding="utf-8"?><PermissionList xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><CanEvaluateFuturePackages>false</CanEvaluateFuturePackages><FirewallEnabled>true</FirewallEnabled></PermissionList>',
  metaVersao: Buffer.from('AAAAAA==', 'base64'),
  metaRodape: Buffer.from('FgAAAFBLBQYAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'),
  bindings: Buffer.from('AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAAbOqSUq78gUaJQ0xHGPW6/gAAAAACAAAAAAADZgAAwAAAABAAAADNgAaq5FB1iyI7rZsE/GksAAAAAASAAACgAAAAEAAAAAfvuKZNnN/J5fgfAkNcUPJQAAAAg04IFU13XHotXQOEKUthDN4/cw8bi0Tsz3BflZQ90zh7nHVIpZ31RohYEY+qA6YWrRE8HMIJD/sVweE4sW2Lw6fdMp+2oxRW1QR+NbMSvhMUAAAA51MD4/KGQznLGggJWdgpaPFUDJs=', 'base64'),
};

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mStr = (s) => `"${String(s).replace(/"/g, '""')}"`;
const int32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const letra = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// ---------- consulta M de uma tabela ----------
function consultaM(url, colunas) {
  const tipoM = { texto: 'type text', inteiro: 'Int64.Type', numero: 'type number', data: 'type date' };
  const tipos = colunas.map((c) => `{${mStr(c.nome)}, ${tipoM[c.tipo] || 'type text'}}`).join(', ');
  return [
    'let',
    `    Fonte = Csv.Document(Web.Contents(${mStr(url)}), [Delimiter=";", Columns=${colunas.length}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
    '    Cabecalho = Table.PromoteHeaders(Fonte, [PromoteAllScalars=true]),',
    `    Tipos = Table.TransformColumnTypes(Cabecalho, {${tipos}}, "pt-BR")`,
    'in',
    '    Tipos',
  ].join('\n');
}

async function dataMashup(consultas) {
  const section = 'section Section1;\n\n' + consultas.map((q) => `shared ${q.nome} = \n${q.m};\n`).join('\n');
  const pacote = new JSZip();
  pacote.file('Config/Package.xml', DM.packageXml);
  pacote.file('[Content_Types].xml', DM.contentTypes);
  pacote.file('Formulas/Section1.m', section);
  const pacoteBuf = await pacote.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const agora = new Date().toISOString().replace('Z', '0000Z');
  const itens = consultas.map((q) => {
    const nomes = JSON.stringify(q.colunas.map((c) => c.nome));
    const entradas = [
      ['IsPrivate', 'l0'], ['FillEnabled', 'l1'], ['FillObjectType', 'sTable'], ['FillToDataModelEnabled', 'l0'],
      ['BufferNextRefresh', 'l1'], ['ResultType', 'sTable'], ['NameUpdatedAfterFill', 'l0'],
      ['FillTarget', 's' + q.nome], ['FilledCompleteResultToWorksheet', 'l1'], ['AddedToDataModel', 'l0'],
      ['FillCount', 'l1'], ['FillErrorCode', 'sUnknown'], ['FillErrorCount', 'l0'], ['FillLastUpdated', 'd' + agora],
      ['FillColumnNames', 's' + nomes], ['FillStatus', 'sComplete'],
    ].map(([t, v]) => `<Entry Type="${t}" Value="${xmlEsc(v)}"/>`).join('');
    return `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/${q.nome}</ItemPath></ItemLocation><StableEntries>${entradas}</StableEntries></Item>`
      + `<Item><ItemLocation><ItemType>Formula</ItemType><ItemPath>Section1/${q.nome}/Fonte</ItemPath></ItemLocation><StableEntries/></Item>`;
  }).join('');
  const metaXml = Buffer.from(`<?xml version="1.0" encoding="utf-8"?><LocalPackageMetadataFile xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Items><Item><ItemLocation><ItemType>AllFormulas</ItemType><ItemPath/></ItemLocation><StableEntries/></Item>${itens}</Items></LocalPackageMetadataFile>`, 'utf8');
  const meta = Buffer.concat([DM.metaVersao, int32(metaXml.length), metaXml, DM.metaRodape]);
  const perm = Buffer.from(DM.permissoes, 'utf8');
  const tudo = Buffer.concat([DM.versao, int32(pacoteBuf.length), pacoteBuf, int32(perm.length), perm, int32(meta.length), meta, int32(DM.bindings.length), DM.bindings]);
  const xml = `<?xml version="1.0" encoding="utf-16"?><DataMashup xmlns="http://schemas.microsoft.com/DataMashup">${tudo.toString('base64')}</DataMashup>`;
  return Buffer.from('﻿' + xml, 'utf16le');
}

// ---------- pedaços de aba ----------

function cabecalho(ws, linha = 1) {
  ws.getRow(linha).eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO } };
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { vertical: 'middle' };
  });
  ws.getRow(linha).height = 22;
}

function titulo(ws, celula, texto) {
  ws.getCell(celula).value = texto;
  ws.getCell(celula).font = { bold: true, size: 16, color: { argb: VERMELHO } };
}

function rotulo(ws, celula, texto) {
  ws.getCell(celula).value = texto;
  ws.getCell(celula).font = { bold: true, color: { argb: 'FF444444' } };
}

function dica(ws, celula, texto) {
  ws.getCell(celula).value = texto;
  ws.getCell(celula).font = { italic: true, color: { argb: 'FF777777' }, size: 10 };
}

// A célula amarela com a lista: a pessoa escolhe ali.
function campoEscolha(ws, celula, lista) {
  const c = ws.getCell(celula);
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2B3' } };
  c.font = { bold: true, size: 12 };
  c.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };
  c.dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`=INDIRECT("${lista}")`] };
}

// Cor por situação do pagamento, como os selos do painel.
function corPorSituacao(ws, ref) {
  const regra = (texto, fundo, fonte) => ({
    type: 'containsText', operator: 'containsText', text: texto,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fundo } }, font: { color: { argb: fonte } } },
  });
  ws.addConditionalFormatting({
    ref,
    rules: [
      regra('Pago', 'FFC6EFCE', 'FF006100'),
      regra('Parcelado', 'FFDDEBF7', 'FF1F4E79'),
      regra('Falta pagar', 'FFFFEB9C', 'FF9C5700'),
      regra('Aguardando', 'FFFCE4D6', 'FF833C0B'),
      regra('Cancelado', 'FFE7E6E6', 'FF595959'),
      regra('Estornado', 'FFE7E6E6', 'FF595959'),
    ],
  });
}

// Valor de uma coluna da tabela na linha n (1 = primeira linha de dados), ou "" se não existe.
// Célula vazia referenciada pelo INDEX vira 0 no Excel: o IF devolve "" nesse caso.
const valor = (tabela, coluna, n) => `IFERROR(IF(INDEX(${tabela}[${coluna}],${n})="","",INDEX(${tabela}[${coluna}],${n})),"")`;
const linkWhats = (expr) => `IF(${expr}="","",HYPERLINK("https://web.whatsapp.com/send?phone=55"&${expr},"WhatsApp"))`;
const linkEmail = (expr) => `IF(${expr}="","",HYPERLINK("mailto:"&${expr},"Enviar e-mail"))`;
const estiloLink = { color: { argb: AZUL_LINK }, underline: true };

// Escreve uma lista por fórmula: colunas = [nome, coluna da tabela | função(n) → fórmula, largura].
function listaPorFormula(ws, { linhaCabecalho, tabela, indice, quantidade, colunas, larguras = true }) {
  colunas.forEach(([nome, , largura], i) => {
    ws.getCell(linhaCabecalho, i + 1).value = nome;
    if (larguras && largura) ws.getColumn(i + 1).width = largura;
  });
  cabecalho(ws, linhaCabecalho);
  for (let k = 1; k <= quantidade; k++) {
    const n = indice(k);
    colunas.forEach(([nome, coluna], i) => {
      const c = ws.getCell(linhaCabecalho + k, i + 1);
      c.value = { formula: typeof coluna === 'function' ? coluna(n) : valor(tabela, coluna, n) };
      if (nome === 'WhatsApp' || nome === 'Enviar e-mail') c.font = estiloLink;
      if (nome.includes('(R$)')) c.numFmt = FMT_BRL;
      if (/^(Início|Inscrito em|Cadastrado em|Último acesso)/.test(nome)) c.numFmt = FMT_DATA;
    });
  }
}

// ---------- abas ----------

function abaInicio(wb, base) {
  const ws = wb.addWorksheet('Início', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 90;
  titulo(ws, 'B2', 'Escola CVB-RJ — planilha ao vivo');
  ws.getCell('B3').value = 'Ligada ao sistema da escola: os dados chegam sozinhos ao abrir e a cada 30 minutos. Para atualizar agora: Dados → Atualizar tudo.';
  ws.getCell('B3').font = { color: { argb: 'FF555555' } };
  const abas = [
    ['Turma', 'Escolha a turma na célula amarela e veja os alunos dela, a situação do pagamento e os botões de WhatsApp e e-mail.'],
    ['Aluno', 'Escolha o aluno na célula amarela e veja a ficha dele com todas as matrículas.'],
    ['Contatos', 'Todos os alunos cadastrados, com ou sem inscrição, com WhatsApp Web e e-mail.'],
    ['Alunos, Matrículas, Cursos, Turmas', 'As tabelas completas que vêm do sistema. Use os filtros do cabeçalho. As colunas que menos se usam ficam escondidas: clique no "+" acima da tabela para ver todas.'],
  ];
  rotulo(ws, 'B5', 'Abas');
  abas.forEach(([nome, texto], i) => {
    ws.getCell(6 + i, 2).value = nome;
    ws.getCell(6 + i, 2).font = { bold: true };
    ws.getCell(6 + i, 3).value = texto;
    ws.getCell(6 + i, 3).alignment = { wrapText: true, vertical: 'top' };
    ws.getCell(6 + i, 2).alignment = { vertical: 'top' };
  });
  rotulo(ws, 'B11', 'Primeira vez');
  ws.getCell('C11').value = 'Se aparecer uma faixa amarela, clique em "Habilitar edição" e depois em "Habilitar conteúdo". Se perguntar como acessar o site, escolha "Anônimo" e "Conectar".';
  rotulo(ws, 'B12', 'Cuidados');
  ws.getCell('C12').value = 'Não digite dentro das tabelas que vêm do sistema: a atualização sobrescreve. Quem tiver este arquivo vê os dados dos alunos; não mande por e-mail nem WhatsApp.';
  rotulo(ws, 'B13', 'Origem');
  ws.getCell('C13').value = `${base}. Se o link for desligado ou trocado na aba Integração do painel, baixe a planilha de novo.`;
  ['C11', 'C12', 'C13'].forEach((c) => { ws.getCell(c).alignment = { wrapText: true, vertical: 'top' }; });
}

function abaTurma(wb, escolhas) {
  const ws = wb.addWorksheet('Turma', { views: [{ showGridLines: false, state: 'frozen', ySplit: 8 }] });
  titulo(ws, 'A1', 'Alunos da turma');
  rotulo(ws, 'A2', 'Turma');
  ws.mergeCells('B2:D2');
  campoEscolha(ws, 'B2', 'Turmas[Turma]');
  if (escolhas.turma) ws.getCell('B2').value = escolhas.turma;
  dica(ws, 'E2', '← clique na célula amarela e escolha a turma (curso e data)');

  // Dados da turma escolhida, vindos da tabela Turmas.
  const daTurma = (coluna) => `IF($B$2="","",${valor('Turmas', coluna, 'MATCH($B$2,Turmas[Turma],0)')})`;
  rotulo(ws, 'A3', 'Status');
  ws.getCell('B3').value = { formula: daTurma('Status') };
  rotulo(ws, 'A4', 'Aulas');
  ws.mergeCells('B4:F4');
  ws.getCell('B4').value = { formula: daTurma('Datas e horários') };
  ws.getCell('B4').alignment = { wrapText: true, vertical: 'top' };

  // Contadores como no painel, numa linha só: "Com vaga: 12 de 30 · Pagaram tudo: 9 · …".
  // "Com vaga" = pagou ao menos a taxa e não foi cancelado/estornado.
  const sit = `calc!$B$2:$B$${LINHAS_LISTA + 1}`;
  const conta = (...textos) => textos.map((t) => `COUNTIF(${sit},"${t}")`).join('+');
  const partes = [
    `"Com vaga: "&(${conta('Pago*', 'Parcelado*', 'Falta pagar o curso')})&" de "&${daTurma('Vagas')}`,
    `"Pagaram tudo: "&(${conta('Pago*', 'Parcelado*')})`,
    `"Falta pagar o curso: "&(${conta('Falta pagar o curso')})`,
    `"Aguardando taxa: "&(${conta('Aguardando taxa de inscrição')})`,
    `"Cancelados ou estornados: "&(${conta('Cancelado', 'Estornado')})`,
  ];
  ws.mergeCells('A6:G6');
  ws.getCell('A6').value = { formula: `IF($B$2="","",${partes.join('&"   ·   "&')})` };
  ws.getCell('A6').font = { bold: true, size: 12 };
  ws.getCell('A6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  ws.getRow(6).height = 24;

  listaPorFormula(ws, {
    linhaCabecalho: 8,
    tabela: 'Matriculas',
    indice: (k) => `SMALL(calc!$A$2:$A$${LINHAS_LISTA + 1},${k})`,
    quantidade: LINHAS_LISTA,
    colunas: [
      ['Aluno', 'Aluno', 36],
      ['Situação do pagamento', 'Situação do pagamento', 32],
      ['Falta pagar (R$)', 'Falta pagar (R$)', 16],
      ['WhatsApp', (n) => linkWhats(valor('Matriculas', 'Celular', n)), 12],
      ['Enviar e-mail', (n) => linkEmail(valor('Matriculas', 'E-mail', n)), 14],
      ['Celular', 'Celular', 14],
      ['E-mail', 'E-mail', 32],
    ],
  });
  corPorSituacao(ws, `B9:B${8 + LINHAS_LISTA}`);
  ws.getColumn(3).width = 16; ws.getColumn(4).width = 12; ws.getColumn(5).width = 24; ws.getColumn(6).width = 14;
}

function abaAluno(wb, escolhas) {
  const ws = wb.addWorksheet('Aluno', { views: [{ showGridLines: false }] });
  [26, 40, 4, 22, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  titulo(ws, 'A1', 'Ficha do aluno');
  rotulo(ws, 'A2', 'Aluno');
  campoEscolha(ws, 'B2', 'Alunos[Nome]');
  if (escolhas.aluno) ws.getCell('B2').value = escolhas.aluno;
  dica(ws, 'D2', '← clique na célula amarela e escolha o aluno');
  // Dois alunos com o mesmo nome: a ficha mostra o primeiro; avisa para conferir pelo documento.
  ws.getCell('A3').value = { formula: 'IF(COUNTIF(Alunos[Nome],$B$2)>1,"Atenção: há mais de um aluno com este nome. A ficha mostra o primeiro; confira pelo documento na aba Alunos.","")' };
  ws.getCell('A3').font = { color: { argb: VERMELHO }, bold: true };

  const campo = (coluna) => `IF($B$2="","",${valor('Alunos', coluna, 'MATCH($B$2,Alunos[Nome],0)')})`;
  const esquerda = [['Documento', 'Documento'], ['E-mail', 'E-mail'], ['Celular', 'Celular'], ['Tem inscrição', 'Tem inscrição'], ['Matrículas', 'Matrículas'], ['Cursos', 'Cursos']];
  const direita = [['E-mail válido', 'E-mail válido'], ['Celular válido', 'Celular válido'], ['Cidade', 'Cidade'], ['Escolaridade', 'Escolaridade'], ['Cadastrado em', 'Cadastrado em'], ['Último acesso', 'Último acesso']];
  esquerda.forEach(([nome, coluna], i) => {
    rotulo(ws, `A${5 + i}`, nome);
    ws.getCell(`B${5 + i}`).value = { formula: campo(coluna) };
  });
  direita.forEach(([nome, coluna], i) => {
    rotulo(ws, `D${5 + i}`, nome);
    const c = ws.getCell(`E${5 + i}`);
    c.value = { formula: campo(coluna) };
    if (nome.endsWith(' em') || nome === 'Último acesso') c.numFmt = FMT_DATA;
  });
  rotulo(ws, 'A12', 'Contato');
  ws.getCell('B12').value = { formula: linkWhats(campo('Celular')) };
  ws.getCell('B13').value = { formula: linkEmail(campo('E-mail')) };
  ws.getCell('B12').font = ws.getCell('B13').font = estiloLink;

  titulo(ws, 'A15', 'Matrículas deste aluno');
  listaPorFormula(ws, {
    linhaCabecalho: 16,
    tabela: 'Matriculas',
    indice: (k) => `SMALL(calc!$C$2:$C$${LINHAS_LISTA + 1},${k})`,
    quantidade: 60,
    larguras: false,
    colunas: [
      ['Turma', 'Turma'], ['Situação do pagamento', 'Situação do pagamento'], ['Falta pagar (R$)', 'Falta pagar (R$)'],
      ['Plano', 'Plano'], ['Nota', 'Nota'],
    ],
  });
  corPorSituacao(ws, 'B17:B76');
}

function abaContatos(wb) {
  const ws = wb.addWorksheet('Contatos', { views: [{ state: 'frozen', ySplit: 1 }] });
  const ev = (n) => valor('Alunos', 'E-mail válido', n);
  const cv = (n) => valor('Alunos', 'Celular válido', n);
  // Só aparece quando algo está errado no contato; "Sim", "Não verificado" e vazio ficam em branco.
  const atencao = (n) => `TRIM(IF(OR(${ev(n)}="",${ev(n)}="Sim",${ev(n)}="Não verificado"),"","E-mail: "&${ev(n)}&"  ")&IF(OR(${cv(n)}="",${cv(n)}="Sim"),"","Celular: "&${cv(n)}))`;
  listaPorFormula(ws, {
    linhaCabecalho: 1,
    tabela: 'Alunos',
    indice: (k) => k,
    quantidade: LINHAS_LISTA,
    colunas: [
      ['Nome', 'Nome', 34], ['Tem inscrição', 'Tem inscrição', 13], ['Cursos', 'Cursos', 40],
      ['WhatsApp', (n) => linkWhats(valor('Alunos', 'Celular', n)), 12],
      ['Enviar e-mail', (n) => linkEmail(valor('Alunos', 'E-mail', n)), 14],
      ['Celular', 'Celular', 14], ['E-mail', 'E-mail', 32],
      ['Atenção no contato', atencao, 44],
    ],
  });
  ws.autoFilter = { from: 'A1', to: 'H1' };
}

function abaCalc(wb) {
  const ws = wb.addWorksheet('calc');
  ws.state = 'hidden';
  ws.getCell('A1').value = 'Turma: nº da matrícula';
  ws.getCell('B1').value = 'Turma: situação';
  ws.getCell('C1').value = 'Aluno: nº da matrícula';
  for (let n = 1; n <= LINHAS_LISTA; n++) {
    const r = n + 1;
    ws.getCell(`A${r}`).value = { formula: `IFERROR(IF(Turma!$B$2<>"",IF(INDEX(Matriculas[Turma],${n})=Turma!$B$2,${n},""),""),"")` };
    ws.getCell(`B${r}`).value = { formula: `IF(A${r}="","",INDEX(Matriculas[Situação do pagamento],A${r}))` };
    ws.getCell(`C${r}`).value = { formula: `IFERROR(IF(Aluno!$B$2<>"",IF(INDEX(Matriculas[Aluno],${n})=Aluno!$B$2,${n},""),""),"")` };
  }
}

// Aba com a tabela que vem do sistema, já com os dados de agora.
function abaTabela(wb, chave, { colunas, linhas }) {
  const ws = wb.addWorksheet(ABA[chave], { views: [{ state: 'frozen', ySplit: 1 }] });
  const converter = (v, tipo) => {
    if (v == null || v === '') return null;
    if (tipo === 'data') return new Date(`${v}T00:00:00Z`);
    if (tipo === 'numero' || tipo === 'inteiro') return Number(v);
    return String(v);
  };
  ws.addTable({
    name: TABELA[chave],
    ref: 'A1',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: colunas.map((c) => ({ name: c.nome, filterButton: true })),
    rows: linhas.length ? linhas.map((l) => l.map((v, i) => converter(v, colunas[i].tipo))) : [colunas.map(() => null)],
  });
  const principais = PRINCIPAIS[chave] || [];
  colunas.forEach((c, i) => {
    const coluna = ws.getColumn(i + 1);
    coluna.width = LARGURA[c.nome] || Math.min(30, Math.max(12, c.nome.length + 3));
    if (c.tipo === 'numero') coluna.numFmt = FMT_BRL;
    if (c.tipo === 'data') coluna.numFmt = FMT_DATA;
    // As colunas secundárias ficam num grupo fechado: o "+" acima da tabela abre todas.
    if (principais.length && !principais.includes(c.nome)) { coluna.outlineLevel = 1; coluna.hidden = true; }
  });
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
  const iSit = colunas.findIndex((c) => c.nome === 'Situação do pagamento');
  if (iSit >= 0) corPorSituacao(ws, `${letra(iSit + 1)}2:${letra(iSit + 1)}${LINHAS_LISTA + 1}`);
  cabecalho(ws);
  return ws;
}

// ---------- montagem ----------

// Remonta o zip do .xlsx com as partes do Power Query.
async function ligarConsultas(buffer, consultas) {
  const zip = await JSZip.loadAsync(buffer);
  const ler = (p) => zip.file(p).async('string');

  // Tabelas: acha cada xl/tables/tableN.xml pelo displayName e marca como tabela de consulta.
  const tabelasXml = Object.keys(zip.files).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p));
  for (const q of consultas) {
    let caminho = null;
    for (const p of tabelasXml) if ((await ler(p)).includes(`displayName="${q.nome}"`)) { caminho = p; break; }
    if (!caminho) throw new Error(`Tabela ${q.nome} não encontrada no arquivo`);
    const n = Number(caminho.match(/table(\d+)\.xml/)[1]);
    let xml = await ler(caminho);
    xml = xml.replace(/<table /, '<table tableType="queryTable" ').replace(/totalsRowShown="1"/, 'totalsRowShown="0"');
    xml = xml.replace(/<tableColumn id="(\d+)"([^>]*?)\/>/g, (m, id, resto) => {
      const limpo = resto.replace(/\s+totalsRow(Label|Function)="[^"]*"/g, '');
      return `<tableColumn id="${id}"${limpo} uniqueName="${id}" queryTableFieldId="${id}"/>`;
    });
    q.ref = xml.match(/ ref="([^"]+)"/)[1];
    zip.file(caminho, xml);
    zip.file(`xl/tables/_rels/table${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable${q.id}.xml"/></Relationships>`);
    const campos = q.colunas.map((c, i) => `<queryTableField id="${i + 1}" name="${xmlEsc(c.nome)}" tableColumnId="${i + 1}"/>`).join('');
    zip.file(`xl/queryTables/queryTable${q.id}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<queryTable xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="ExternalData_${q.id}" connectionId="${q.id}" autoFormatId="16" applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="0" refreshOnLoad="1"><queryTableRefresh nextId="${q.colunas.length + 1}"><queryTableFields count="${q.colunas.length}">${campos}</queryTableFields></queryTableRefresh></queryTable>`);
  }

  // Conexões: uma por consulta, atualizando ao abrir e a cada 30 minutos.
  const conexoes = consultas.map((q) => `<connection id="${q.id}" keepAlive="1" name="Consulta - ${q.nome}" description="Conexão com a consulta '${q.nome}' na pasta de trabalho." type="5" refreshedVersion="7" background="1" saveData="1" interval="30"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=${q.nome};" command="SELECT * FROM [${q.nome}]" refreshOnLoad="1"/></connection>`).join('');
  zip.file('xl/connections.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${conexoes}</connections>`);

  // Consultas (DataMashup).
  zip.file('customXml/item1.xml', await dataMashup(consultas));
  zip.file('customXml/itemProps1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="{${require('crypto').randomUUID().toUpperCase()}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>`);
  zip.file('customXml/_rels/item1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`);

  // Workbook: nome escondido ExternalData_N por tabela (como o Excel faz) e relações novas.
  // Replace com função: o texto tem "$A$1", que numa string de substituição viraria grupo da regex.
  let wbXml = await ler('xl/workbook.xml');
  const abas = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  const absoluto = (ref) => ref.replace(/([A-Z]+)(\d+)/g, (m, c, l) => `$${c}$${l}`);
  const nomes = consultas.map((q) => `<definedName name="ExternalData_${q.id}" localSheetId="${abas.indexOf(ABA[q.chave])}" hidden="1">'${ABA[q.chave]}'!${absoluto(q.ref)}</definedName>`).join('');
  wbXml = wbXml.includes('<definedNames>')
    ? wbXml.replace('<definedNames>', () => '<definedNames>' + nomes)
    : wbXml.replace('</sheets>', () => `</sheets><definedNames>${nomes}</definedNames>`);
  zip.file('xl/workbook.xml', wbXml);

  let rels = await ler('xl/_rels/workbook.xml.rels');
  rels = rels.replace('</Relationships>', '<Relationship Id="rIdConexoes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/><Relationship Id="rIdConsultas" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>');
  zip.file('xl/_rels/workbook.xml.rels', rels);

  let tipos = await ler('[Content_Types].xml');
  if (!/Extension="xml"/.test(tipos)) tipos = tipos.replace('<Default ', '<Default Extension="xml" ContentType="application/xml"/><Default ');
  const extras = '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>'
    + consultas.map((q) => `<Override PartName="/xl/queryTables/queryTable${q.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"/>`).join('')
    + '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/>';
  zip.file('[Content_Types].xml', tipos.replace('</Types>', extras + '</Types>'));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// base: endereço público dos links (…/integracao); chave: a chave dos links; tabelas: gerarTabelas().
// escolhas: o que já vem escolhido nas células amarelas ao abrir (turma da aba Turma, aluno da ficha).
async function gerar({ base, chave, tabelas, escolhas = {} }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escola CVB-RJ';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  abaInicio(wb, base);
  abaTurma(wb, escolhas);
  abaAluno(wb, escolhas);
  abaContatos(wb);
  for (const t of ORDEM) abaTabela(wb, t, tabelas[t]);
  abaCalc(wb);
  // Abre direto na aba Turma.
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];

  const consultas = ORDEM.map((t, i) => ({
    id: i + 1,
    chave: t,
    nome: TABELA[t],
    colunas: tabelas[t].colunas,
    m: consultaM(`${base}/${t}.csv?chave=${chave}`, tabelas[t].colunas),
  }));
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return ligarConsultas(buffer, consultas);
}

module.exports = { gerar, LINHAS_LISTA };
