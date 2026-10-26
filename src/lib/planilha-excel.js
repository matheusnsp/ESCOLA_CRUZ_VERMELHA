// ============================================================
//  Planilha pronta da aba Integração (.xlsx já ligada ao sistema)
//
//  Em vez de a secretaria colar quatro links no Excel, o painel entrega um arquivo
//  que já vem com as quatro consultas (Power Query) apontando para os links da
//  planilha ao vivo (lib/planilha-ao-vivo.js), atualizando ao abrir e a cada 30 min.
//
//  Abas:
//    Início      — como usar
//    Por curso   — escolhe o curso (e, se quiser, a turma) numa lista e aparecem os
//                  alunos matriculados, com a situação do pagamento e botões de contato
//    Aluno       — escolhe o aluno numa lista e aparece a ficha dele, com as matrículas
//    Contatos    — todos os alunos, com ou sem inscrição, com WhatsApp Web e e-mail
//    Alunos, Matrículas, Cursos, Turmas — as tabelas que vêm do sistema
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

const VERMELHO = 'FFCC0000';
const CINZA = 'FFF2F2F2';
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

function dataMashup(consultas) {
  return (async () => {
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
  })();
}

// ---------- abas ----------

function cabecalho(ws, linha = 1) {
  ws.getRow(linha).eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERMELHO } };
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  ws.getRow(linha).height = 20;
}

function titulo(ws, celula, texto) {
  ws.getCell(celula).value = texto;
  ws.getCell(celula).font = { bold: true, size: 16, color: { argb: VERMELHO } };
}

function rotulo(ws, celula, texto) {
  ws.getCell(celula).value = texto;
  ws.getCell(celula).font = { bold: true };
}

function campoEscolha(ws, celula, lista) {
  const c = ws.getCell(celula);
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CC' } };
  c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  c.dataValidation = { type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`=INDIRECT("${lista}")`] };
}

// Valor de uma coluna da tabela na linha n (1 = primeira linha de dados), ou "" se não existe.
// Célula vazia referenciada pelo INDEX vira 0 no Excel: o IF devolve "" nesse caso.
const valor = (tabela, coluna, n) => `IFERROR(IF(INDEX(${tabela}[${coluna}],${n})="","",INDEX(${tabela}[${coluna}],${n})),"")`;
const linkWhats = (expr) => `IF(${expr}="","",HYPERLINK("https://web.whatsapp.com/send?phone=55"&${expr},"WhatsApp"))`;
const linkEmail = (expr) => `IF(${expr}="","",HYPERLINK("mailto:"&${expr},"Enviar e-mail"))`;

function abaInicio(wb, base) {
  const ws = wb.addWorksheet('Início', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 110;
  titulo(ws, 'B2', 'Escola CVB-RJ — planilha ao vivo');
  const linhas = [
    'Esta planilha está ligada ao sistema da escola. Os dados entram sozinhos ao abrir o arquivo e a cada 30 minutos.',
    'Para atualizar agora: Dados → Atualizar tudo.',
    '',
    'Na primeira vez que abrir, o Excel pode pedir: "Habilitar edição" e depois "Habilitar conteúdo". Clique nos dois.',
    'Se perguntar como acessar o endereço do site, escolha "Anônimo" e clique em "Conectar".',
    '',
    'Abas:',
    '  • Por curso — escolha o curso na célula amarela (e a turma, se quiser) e veja os alunos matriculados, a situação do pagamento e os botões de contato.',
    '  • Aluno — escolha o aluno na célula amarela e veja a ficha dele com todas as matrículas.',
    '  • Contatos — todos os alunos cadastrados, com ou sem inscrição, com WhatsApp Web e e-mail.',
    '  • Alunos, Matrículas, Cursos e Turmas — as tabelas que vêm do sistema. Use os filtros do cabeçalho à vontade.',
    '',
    'Não digite dentro das tabelas que vêm do sistema: a atualização sobrescreve. Fórmulas e gráficos em outras abas continuam funcionando.',
    'Esta planilha traz só o que a Secretaria já vê no painel. Valores recebidos e totais do Financeiro não entram.',
    '',
    `Os dados vêm de ${base}. Se o link for desligado ou trocado na aba Integração do painel, baixe a planilha de novo.`,
    'Quem tiver este arquivo vê os dados dos alunos (nome, documento, e-mail, celular). Não mande por e-mail nem WhatsApp.',
  ];
  linhas.forEach((t, i) => { ws.getCell(4 + i, 2).value = t; ws.getCell(4 + i, 2).alignment = { wrapText: true }; });
}

function abaPorCurso(wb, escolhas) {
  const ws = wb.addWorksheet('Por curso', { views: [{ showGridLines: false, state: 'frozen', ySplit: 7 }] });
  titulo(ws, 'A1', 'Alunos por curso');
  rotulo(ws, 'A2', 'Curso');
  campoEscolha(ws, 'B2', 'Cursos[Curso]');
  if (escolhas.curso) ws.getCell('B2').value = escolhas.curso;
  rotulo(ws, 'A3', 'Turma (início)');
  campoEscolha(ws, 'B3', 'Turmas[Início]');
  ws.getCell('B3').numFmt = FMT_DATA;
  ws.getCell('C3').value = 'opcional: deixe em branco para ver todas as turmas do curso';
  ws.getCell('C3').font = { italic: true, color: { argb: 'FF666666' } };

  // Contadores como no painel: "com vaga" = pagou ao menos a taxa e não foi cancelado/estornado.
  const sit = `calc!$B$2:$B$${LINHAS_LISTA + 1}`;
  const conta = (...textos) => textos.map((t) => `COUNTIF(${sit},"${t}")`).join('+');
  const contadores = [
    ['Com vaga', conta('Pago*', 'Parcelado*', 'Falta pagar o curso')],
    ['Pagaram tudo', conta('Pago*', 'Parcelado*')],
    ['Falta pagar o curso', conta('Falta pagar o curso')],
    ['Aguardando taxa', conta('Aguardando taxa de inscrição')],
    ['Cancelados ou estornados', conta('Cancelado', 'Estornado')],
  ];
  contadores.forEach(([nome, f], i) => {
    rotulo(ws, `${letra(i * 2 + 1)}5`, nome);
    ws.getCell(`${letra(i * 2 + 2)}5`).value = { formula: f };
  });

  const colunas = [
    ['Aluno', 'Aluno', 30], ['Situação do pagamento', 'Situação do pagamento', 26], ['Início da turma', 'Início da turma', 14],
    ['Valor da matrícula (R$)', 'Valor da matrícula (R$)', 14], ['Falta pagar (R$)', 'Falta pagar (R$)', 14],
    ['Celular', 'Celular', 14], ['WhatsApp', null, 12], ['E-mail', 'E-mail', 30], ['Enviar e-mail', null, 14],
    ['Alimento entregue', 'Alimento entregue', 12], ['Nota', 'Nota', 8], ['Código', 'Código', 14],
  ];
  colunas.forEach(([nome, , largura], i) => { ws.getCell(7, i + 1).value = nome; ws.getColumn(i + 1).width = largura; });
  cabecalho(ws, 7);
  for (let k = 1; k <= LINHAS_LISTA; k++) {
    const r = 7 + k;
    const n = `SMALL(calc!$A$2:$A$${LINHAS_LISTA + 1},${k})`;
    const v = (coluna) => valor('Matriculas', coluna, n);
    colunas.forEach(([nome, coluna], i) => {
      const c = ws.getCell(r, i + 1);
      if (nome === 'WhatsApp') c.value = { formula: linkWhats(v('Celular')) };
      else if (nome === 'Enviar e-mail') c.value = { formula: linkEmail(v('E-mail')) };
      else c.value = { formula: v(coluna) };
      if (nome === 'WhatsApp' || nome === 'Enviar e-mail') c.font = { color: { argb: 'FF0563C1' }, underline: true };
      if (nome.includes('(R$)')) c.numFmt = FMT_BRL;
      if (nome === 'Início da turma') c.numFmt = FMT_DATA;
    });
  }
}

function abaAluno(wb, escolhas) {
  const ws = wb.addWorksheet('Aluno', { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 40; ws.getColumn(3).width = 18; ws.getColumn(4).width = 26;
  titulo(ws, 'A1', 'Ficha do aluno');
  rotulo(ws, 'A2', 'Aluno');
  campoEscolha(ws, 'B2', 'Alunos[Nome]');
  if (escolhas.aluno) ws.getCell('B2').value = escolhas.aluno;
  // Dois alunos com o mesmo nome: a ficha mostra o primeiro; avisa para conferir pelo documento.
  ws.getCell('C2').value = { formula: 'IF(COUNTIF(Alunos[Nome],$B$2)>1,"Atenção: há mais de um aluno com este nome. A ficha mostra o primeiro; confira pelo documento na aba Alunos.","")' };
  ws.getCell('C2').font = { color: { argb: VERMELHO }, bold: true };
  const campo = (coluna) => `IF($B$2="","",${valor('Alunos', coluna, 'MATCH($B$2,Alunos[Nome],0)')})`;
  const campos = [
    ['Documento', 'Documento'], ['E-mail', 'E-mail'], ['E-mail válido', 'E-mail válido'], ['Celular', 'Celular'],
    ['Celular válido', 'Celular válido'], ['Tem inscrição', 'Tem inscrição'], ['Matrículas', 'Matrículas'],
    ['Matrículas pagas', 'Matrículas pagas'], ['Cursos', 'Cursos'], ['Gênero', 'Gênero'], ['Escolaridade', 'Escolaridade'],
    ['Bairro', 'Bairro'], ['Cidade', 'Cidade'], ['UF', 'UF'], ['Cadastrado em', 'Cadastrado em'], ['Último acesso', 'Último acesso'],
  ];
  campos.forEach(([nome, coluna], i) => {
    rotulo(ws, `A${4 + i}`, nome);
    const c = ws.getCell(`B${4 + i}`);
    c.value = { formula: campo(coluna) };
    if (nome.endsWith(' em') || nome === 'Último acesso') c.numFmt = FMT_DATA;
  });
  rotulo(ws, 'D4', 'Contato');
  ws.getCell('D5').value = { formula: linkWhats(campo('Celular')) };
  ws.getCell('D6').value = { formula: linkEmail(campo('E-mail')) };
  ws.getCell('D5').font = ws.getCell('D6').font = { color: { argb: 'FF0563C1' }, underline: true };

  const inicio = 4 + campos.length + 2;
  titulo(ws, `A${inicio}`, 'Matrículas deste aluno');
  const colunas = [
    ['Curso', 'Curso', 26], ['Início da turma', 'Início da turma', 14], ['Status da turma', 'Status da turma', 14],
    ['Situação do pagamento', 'Situação do pagamento', 26], ['Plano', 'Plano', 12], ['Valor da matrícula (R$)', 'Valor da matrícula (R$)', 14],
    ['Falta pagar (R$)', 'Falta pagar (R$)', 14], ['Nota', 'Nota', 8], ['Situação acadêmica', 'Situação acadêmica', 14],
    ['Inscrito em', 'Inscrito em', 12], ['Código', 'Código', 14],
  ];
  const cab = inicio + 1;
  colunas.forEach(([nome, , largura], i) => { ws.getCell(cab, i + 1).value = nome; if (i > 3) ws.getColumn(i + 1).width = largura; });
  cabecalho(ws, cab);
  for (let k = 1; k <= 60; k++) {
    const n = `SMALL(calc!$C$2:$C$${LINHAS_LISTA + 1},${k})`;
    colunas.forEach(([nome, coluna], i) => {
      const c = ws.getCell(cab + k, i + 1);
      c.value = { formula: valor('Matriculas', coluna, n) };
      if (nome.includes('(R$)')) c.numFmt = FMT_BRL;
      if (nome === 'Início da turma' || nome === 'Inscrito em') c.numFmt = FMT_DATA;
    });
  }
}

function abaContatos(wb) {
  const ws = wb.addWorksheet('Contatos', { views: [{ state: 'frozen', ySplit: 1 }] });
  const colunas = [
    ['Nome', 'Nome', 30], ['Celular', 'Celular', 14], ['WhatsApp', null, 12], ['E-mail', 'E-mail', 32], ['Enviar e-mail', null, 14],
    ['Tem inscrição', 'Tem inscrição', 12], ['Cursos', 'Cursos', 36], ['E-mail válido', 'E-mail válido', 24],
    ['Celular válido', 'Celular válido', 18], ['Cidade', 'Cidade', 18], ['Cadastrado em', 'Cadastrado em', 13],
  ];
  colunas.forEach(([nome, , largura], i) => { ws.getCell(1, i + 1).value = nome; ws.getColumn(i + 1).width = largura; });
  cabecalho(ws);
  ws.autoFilter = { from: 'A1', to: letra(colunas.length) + '1' };
  for (let n = 1; n <= LINHAS_LISTA; n++) {
    colunas.forEach(([nome, coluna], i) => {
      const c = ws.getCell(1 + n, i + 1);
      if (nome === 'WhatsApp') c.value = { formula: linkWhats(valor('Alunos', 'Celular', n)) };
      else if (nome === 'Enviar e-mail') c.value = { formula: linkEmail(valor('Alunos', 'E-mail', n)) };
      else c.value = { formula: valor('Alunos', coluna, n) };
      if (nome === 'WhatsApp' || nome === 'Enviar e-mail') c.font = { color: { argb: 'FF0563C1' }, underline: true };
      if (nome === 'Cadastrado em') c.numFmt = FMT_DATA;
    });
  }
}

function abaCalc(wb) {
  const ws = wb.addWorksheet('calc');
  ws.state = 'hidden';
  ws.getCell('A1').value = 'Por curso: nº da matrícula';
  ws.getCell('B1').value = 'Por curso: situação';
  ws.getCell('C1').value = 'Aluno: nº da matrícula';
  for (let n = 1; n <= LINHAS_LISTA; n++) {
    const r = n + 1;
    ws.getCell(`A${r}`).value = { formula: `IFERROR(IF(AND(INDEX(Matriculas[Curso],${n})='Por curso'!$B$2,OR('Por curso'!$B$3="",INDEX(Matriculas[Início da turma],${n})='Por curso'!$B$3)),${n},""),"")` };
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
  colunas.forEach((c, i) => {
    const coluna = ws.getColumn(i + 1);
    coluna.width = Math.min(40, Math.max(12, c.nome.length + 4));
    if (c.tipo === 'numero') coluna.numFmt = FMT_BRL;
    if (c.tipo === 'data') coluna.numFmt = FMT_DATA;
  });
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
  zip.file('customXml/itemProps1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<ds:datastoreItem ds:itemID="{${uuid()}}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.microsoft.com/DataMashup"/></ds:schemaRefs></ds:datastoreItem>`);
  zip.file('customXml/_rels/item1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>`);

  // Workbook: nome escondido ExternalData_N por tabela (como o Excel faz) e relações novas.
  let wbXml = await ler('xl/workbook.xml');
  const abas = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  // Replace com função: o texto tem "$A$1", que numa string de substituição viraria grupo da regex.
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

function uuid() {
  return require('crypto').randomUUID().toUpperCase();
}

// base: endereço público dos links (…/integracao); chave: a chave dos links; tabelas: gerarTabelas().
// escolhas: o que já vem escolhido nas células amarelas ao abrir (curso da aba Por curso, aluno da ficha).
async function gerar({ base, chave, tabelas, escolhas = {} }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escola CVB-RJ';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  abaInicio(wb, base);
  abaPorCurso(wb, escolhas);
  abaAluno(wb, escolhas);
  abaContatos(wb);
  for (const t of ORDEM) abaTabela(wb, t, tabelas[t]);
  abaCalc(wb);

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
