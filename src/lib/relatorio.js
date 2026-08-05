// ============================================================
//  Geração de relatórios do painel (Excel + PDF)
//  - coletarDadosRelatorio(prisma): junta matrículas, financeiro e auditoria
//  - gerarExcel(dados): retorna um Buffer .xlsx (3 abas)
//  - gerarPdf(dados, stream): escreve o PDF direto no stream de resposta
//
//  Auditoria vai RESUMIDA de propósito (ação, quem, quando, alvo) — o campo
//  `detalhe` dos logs pode conter dado sensível de aluno (CPF/endereço), então
//  NÃO é exportado aqui.
// ============================================================
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const TAXA_MATRICULA_PADRAO = 100;
const LIMITE_AUDITORIA = 1000; // últimos N eventos, pra não estourar o arquivo

// ---------- helpers de formatação ----------
const formatBRL = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataBR = (d) =>
  d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

const dataHoraBR = (d) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

const labelPlano = (p) =>
  p === 'A_VISTA' ? 'À vista' : p === 'PRESENCIAL' ? 'Presencial' : p === 'PARCELADO' ? 'Parcelado' : (p || '—');

// ============================================================
//  COLETA DE DADOS
//  Replica as MESMAS consultas e fórmulas da rota /financeiro do admin.js,
//  pra que os números do relatório batam exatamente com os da tela.
// ============================================================
async function coletarDadosRelatorio(prisma) {
  const incAluno = { aluno: true, turma: { include: { curso: true } } };

  const [
    matriculas,
    taxaPagaLista,
    matriculaGeradaLista,
    taxaPendenteLista,
    cursoPendenteLista,
    estornos,
    reembolsosPendentesLista,
    logs,
  ] = await Promise.all([
    prisma.matricula.findMany({ orderBy: { criadoEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { taxaConfirmada: true }, orderBy: { taxaConfirmadaEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { statusPagamento: 'PAGO' }, orderBy: { confirmadaEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { taxaConfirmada: false }, orderBy: { criadoEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { taxaConfirmada: true, statusPagamento: 'PENDENTE' }, orderBy: { criadoEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { statusPagamento: 'ESTORNADO' }, orderBy: { atualizadoEm: 'desc' }, include: incAluno }),
    prisma.matricula.findMany({ where: { diferencaTransferencia: { lt: 0 } }, orderBy: { atualizadoEm: 'desc' }, include: incAluno }),
    prisma.logAuditoria.findMany({ orderBy: { criadoEm: 'desc' }, take: LIMITE_AUDITORIA }),
  ]);

  // Nome de quem agiu (atorId → nome). Só busca os IDs que aparecem nos logs.
  const atorIds = [...new Set(logs.map((l) => l.atorId).filter((x) => x && x !== 'SISTEMA' && x !== 'ANONIMO'))];
  const atores = atorIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: atorIds } }, select: { id: true, nome: true } })
    : [];
  const nomePorId = Object.fromEntries(atores.map((a) => [a.id, a.nome]));
  const nomeAtor = (id) => (id === 'SISTEMA' ? 'Sistema' : id === 'ANONIMO' ? 'Anônimo' : (nomePorId[id] || id || '—'));

  // Motivos de estorno (log mais recente de cada matrícula)
  const motivos = {};
  for (const log of logs.filter((l) => l.acao === 'ESTORNOU_PAGAMENTO')) {
    if (motivos[log.alvoId]) continue;
    try {
      const d = log.detalhe ? JSON.parse(log.detalhe) : {};
      motivos[log.alvoId] = d.motivo || 'Não informado';
    } catch {
      motivos[log.alvoId] = 'Não informado';
    }
  }

  // ── Trilha de auditoria de REEMBOLSOS (Excel/PDF) ──────────────────────────
  // Cruza cada log ESTORNOU_PAGAMENTO com a matrícula pra registrar QUEM fez,
  // QUANDO, e QUAL aluno/curso/valor foi afetado + o motivo. Identificação do
  // aluno apenas (nome, curso, código da matrícula) — sem CPF/endereço/contato,
  // pra não expor dado pessoal sensível numa trilha que o Financeiro baixa.
  const matriculaPorId = Object.fromEntries(matriculas.map((m) => [m.id, m]));
  const codigoMatricula = (id) => `MAT-${String(id).slice(0, 8).toUpperCase()}`;
  const reembolsosAuditoria = logs
    .filter((l) => l.acao === 'ESTORNOU_PAGAMENTO')
    .map((l) => {
      let d = {};
      try { d = l.detalhe ? JSON.parse(l.detalhe) : {}; } catch { d = {}; }
      const mat = matriculaPorId[l.alvoId] || null;
      return {
        quando: l.criadoEm,
        quemFez: nomeAtor(l.atorId),           // admin do Financeiro/Dev que executou
        aluno: mat?.aluno?.nome || '—',        // aluno reembolsado (identificação, sem PII sensível)
        curso: mat?.turma?.curso?.nome || '—',
        matricula: codigoMatricula(l.alvoId),
        valor: mat ? Number(mat.valorCurso) : null,
        motivo: d.motivo || 'Não informado',
        tipo: d.apenasContabil ? 'Contábil' : 'Gateway',
      };
    });

  // Pendências (taxa + curso), igual à tela
  const pendentesLista = [
    ...taxaPendenteLista.map((m) => ({
      m, tipo: 'Taxa inscrição',
      valor: Number(m.valorTaxaMatricula) || TAXA_MATRICULA_PADRAO,
      desde: m.criadoEm,
    })),
    ...cursoPendenteLista.map((m) => ({
      m,
      tipo: m.diferencaTransferencia != null ? 'Curso (diferença de transferência)' : 'Curso',
      valor: m.diferencaTransferencia != null ? Number(m.diferencaTransferencia) : Number(m.valorCurso),
      desde: m.criadoEm,
    })),
  ].sort((a, b) => b.desde - a.desde);

  // Totais (mesmas fórmulas do admin.js, incluindo a correção A4 do totalRecebido)
  const totalRecebido = matriculaGeradaLista.reduce((s, m) => {
    if (m.plano === 'A_VISTA') return s + Number(m.valorCurso);
    return s + Number(m.valorCurso) + Number(m.valorTaxaMatricula || 0);
  }, 0);
  const totalPendente = pendentesLista.reduce((s, p) => s + p.valor, 0);
  const totalEstornado = estornos.reduce((s, m) => s + Number(m.valorCurso), 0);
  const totalAReembolsar = reembolsosPendentesLista.reduce((s, m) => s + Math.abs(Number(m.diferencaTransferencia)), 0);

  const auditoria = logs.map((l) => ({
    quando: l.criadoEm,
    quem: nomeAtor(l.atorId),
    acao: l.acao,
    alvo: [l.alvoTipo, l.alvoId].filter(Boolean).join(' '),
  }));

  return {
    geradoEm: new Date(),
    matriculas,
    financeiro: {
      totais: {
        taxaPagaCount: taxaPagaLista.length,
        matriculaGeradaCount: matriculaGeradaLista.length,
        pendentesCount: pendentesLista.length,
        estornosCount: estornos.length,
        reembolsosCount: reembolsosPendentesLista.length,
        totalRecebido, totalPendente, totalEstornado, totalAReembolsar,
      },
      matriculaGeradaLista,
      pendentesLista,
      estornos,
      reembolsosPendentesLista,
      motivos,
    },
    reembolsosAuditoria,
    auditoria,
  };
}

// ============================================================
//  EXCEL (.xlsx) — 3 abas
// ============================================================
async function gerarExcel(dados) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escola CVB-RJ';
  wb.created = dados.geradoEm;

  const CABECALHO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCC0000' } };
  const CABECALHO_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
  const FMT_BRL = 'R$ #,##0.00';

  const estilizarCabecalho = (ws) => {
    ws.getRow(1).eachCell((c) => { c.fill = CABECALHO_FILL; c.font = CABECALHO_FONT; });
    ws.getRow(1).height = 20;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  // ---- Aba 1: Matrículas ----
  const wsM = wb.addWorksheet('Matrículas');
  wsM.columns = [
    { header: 'Aluno', key: 'aluno', width: 28 },
    { header: 'E-mail', key: 'email', width: 28 },
    { header: 'Curso', key: 'curso', width: 26 },
    { header: 'Plano', key: 'plano', width: 12 },
    { header: 'Forma', key: 'forma', width: 12 },
    { header: 'Status', key: 'status', width: 13 },
    { header: 'Taxa confirmada', key: 'taxa', width: 15 },
    { header: 'Valor (R$)', key: 'valor', width: 14 },
    { header: 'Taxa (R$)', key: 'valorTaxa', width: 12 },
    { header: 'Inscrito em', key: 'inscrito', width: 14 },
  ];
  for (const m of dados.matriculas) {
    wsM.addRow({
      aluno: m.aluno?.nome || '—',
      email: m.aluno?.email || '—',
      curso: m.turma?.curso?.nome || '—',
      plano: labelPlano(m.plano),
      forma: m.forma || '—',
      status: m.statusPagamento || '—',
      taxa: m.taxaConfirmada ? 'Sim' : 'Não',
      valor: Number(m.valorCurso) || 0,
      valorTaxa: Number(m.valorTaxaMatricula) || 0,
      inscrito: dataBR(m.criadoEm),
    });
  }
  wsM.getColumn('valor').numFmt = FMT_BRL;
  wsM.getColumn('valorTaxa').numFmt = FMT_BRL;
  estilizarCabecalho(wsM);

  // ---- Aba 2: Financeiro ----
  const wsF = wb.addWorksheet('Financeiro');
  const t = dados.financeiro.totais;
  wsF.addRow(['RESUMO FINANCEIRO']);
  wsF.getRow(1).font = { bold: true, size: 14 };
  wsF.addRow([]);
  const linhasResumo = [
    ['Taxa de inscrição paga (alunos)', t.taxaPagaCount],
    ['Curso pago + matrícula gerada', t.matriculaGeradaCount],
    ['Pendentes', t.pendentesCount],
    ['Total recebido', t.totalRecebido],
    ['Total pendente a receber', t.totalPendente],
    ['Estornos (qtd.)', t.estornosCount],
    ['Total estornado', t.totalEstornado],
    ['Reembolsos pendentes (qtd.)', t.reembolsosCount],
    ['Total a reembolsar', t.totalAReembolsar],
  ];
  linhasResumo.forEach(([rot, val]) => {
    const row = wsF.addRow([rot, val]);
    row.getCell(1).font = { bold: true };
    if (typeof val === 'number' && rot.toLowerCase().includes('total')) row.getCell(2).numFmt = FMT_BRL;
  });
  wsF.getColumn(1).width = 34;
  wsF.getColumn(2).width = 18;

  // Sub-tabela: Matrículas geradas (curso pago)
  const addSecao = (titulo, colunas, linhas) => {
    wsF.addRow([]);
    const tituloRow = wsF.addRow([titulo]);
    tituloRow.font = { bold: true, size: 12 };
    const head = wsF.addRow(colunas.map((c) => c.header));
    head.eachCell((c) => { c.fill = CABECALHO_FILL; c.font = CABECALHO_FONT; });
    const primeiraLinhaDados = wsF.rowCount + 1;
    linhas.forEach((vals) => wsF.addRow(vals));
    // formata colunas de valor (as que terminam com "(R$)")
    colunas.forEach((c, idx) => {
      if (c.header.includes('(R$)')) {
        for (let r = primeiraLinhaDados; r <= wsF.rowCount; r++) {
          wsF.getRow(r).getCell(idx + 1).numFmt = FMT_BRL;
        }
      }
    });
  };

  addSecao('Matrículas geradas (curso pago)',
    [{ header: 'Aluno' }, { header: 'Curso' }, { header: 'Data pag.' }, { header: 'Valor (R$)' }],
    dados.financeiro.matriculaGeradaLista.map((m) => [
      m.aluno?.nome || '—', m.turma?.curso?.nome || '—', dataBR(m.confirmadaEm), Number(m.valorCurso) || 0,
    ]));

  addSecao('Pendentes',
    [{ header: 'Aluno' }, { header: 'Curso' }, { header: 'Pendência' }, { header: 'Desde' }, { header: 'Valor (R$)' }],
    dados.financeiro.pendentesLista.map((p) => [
      p.m.aluno?.nome || '—', p.m.turma?.curso?.nome || '—', p.tipo, dataBR(p.desde), Number(p.valor) || 0,
    ]));

  addSecao('Estornos',
    [{ header: 'Aluno' }, { header: 'Curso' }, { header: 'Data' }, { header: 'Valor (R$)' }, { header: 'Motivo' }],
    dados.financeiro.estornos.map((m) => [
      m.aluno?.nome || '—', m.turma?.curso?.nome || '—', dataBR(m.atualizadoEm),
      Number(m.valorCurso) || 0, dados.financeiro.motivos[m.id] || 'Não informado',
    ]));

  addSecao('Reembolsos pendentes',
    [{ header: 'Aluno' }, { header: 'Curso' }, { header: 'Valor (R$)' }],
    dados.financeiro.reembolsosPendentesLista.map((m) => [
      m.aluno?.nome || '—', m.turma?.curso?.nome || '—', Math.abs(Number(m.diferencaTransferencia)) || 0,
    ]));

  // ---- Aba 3: Reembolsos (trilha detalhada — quem fez, aluno afetado) ----
  const wsR = wb.addWorksheet('Reembolsos');
  wsR.columns = [
    { header: 'Data/hora', key: 'quando', width: 20 },
    { header: 'Quem fez', key: 'quemFez', width: 26 },
    { header: 'Aluno reembolsado', key: 'aluno', width: 26 },
    { header: 'Curso', key: 'curso', width: 24 },
    { header: 'Matrícula', key: 'matricula', width: 16 },
    { header: 'Valor (R$)', key: 'valor', width: 14 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Motivo', key: 'motivo', width: 30 },
  ];
  for (const r of dados.reembolsosAuditoria) {
    wsR.addRow({
      quando: dataHoraBR(r.quando), quemFez: r.quemFez, aluno: r.aluno, curso: r.curso,
      matricula: r.matricula, valor: r.valor != null ? r.valor : '—', tipo: r.tipo, motivo: r.motivo,
    });
  }
  wsR.getColumn('valor').numFmt = FMT_BRL;
  estilizarCabecalho(wsR);

  // ---- Aba 4: Auditoria (resumida) ----
  const wsA = wb.addWorksheet('Auditoria');
  wsA.columns = [
    { header: 'Data/hora', key: 'quando', width: 20 },
    { header: 'Quem', key: 'quem', width: 26 },
    { header: 'Ação', key: 'acao', width: 30 },
    { header: 'Alvo', key: 'alvo', width: 32 },
  ];
  for (const a of dados.auditoria) {
    wsA.addRow({ quando: dataHoraBR(a.quando), quem: a.quem, acao: a.acao, alvo: a.alvo });
  }
  estilizarCabecalho(wsA);

  return wb.xlsx.writeBuffer();
}

// ============================================================
//  PDF — mesmas 3 seções, A4 paisagem
//  Escreve direto no stream (res). Tabelas simples com quebra de página.
// ============================================================
function gerarPdf(dados, stream) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.pipe(stream);

  const VERMELHO = '#cc0000';
  const CINZA = '#666666';
  const larguraUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const xEsq = doc.page.margins.left;
  const yRodape = doc.page.height - doc.page.margins.bottom;

  const titulo = (txt) => {
    if (doc.y > yRodape - 60) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(VERMELHO).fontSize(14).font('Helvetica-Bold').text(txt, xEsq);
    doc.fillColor('black').moveDown(0.3);
  };

  // Desenha uma tabela: colunas = [{ label, width, align }], linhas = [[...]]
  const tabela = (colunas, linhas) => {
    const somaW = colunas.reduce((s, c) => s + c.width, 0);
    const fator = larguraUtil / somaW; // normaliza pra caber na largura útil
    const cols = colunas.map((c) => ({ ...c, w: c.width * fator }));

    const desenharCabecalho = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('white');
      doc.rect(xEsq, y, larguraUtil, 16).fill(VERMELHO);
      let x = xEsq;
      cols.forEach((c) => {
        doc.fillColor('white').text(c.label, x + 3, y + 4, { width: c.w - 6, align: c.align || 'left' });
        x += c.w;
      });
      doc.fillColor('black').y = y + 16;
    };

    desenharCabecalho();
    doc.font('Helvetica').fontSize(8);

    linhas.forEach((linha, i) => {
      // altura da linha: mede a maior célula
      const alturas = cols.map((c, idx) =>
        doc.heightOfString(String(linha[idx] ?? '—'), { width: c.w - 6 }));
      const h = Math.max(14, ...alturas) + 4;

      if (doc.y + h > yRodape) {
        doc.addPage();
        desenharCabecalho();
        doc.font('Helvetica').fontSize(8);
      }

      const y = doc.y;
      if (i % 2 === 1) { doc.rect(xEsq, y, larguraUtil, h).fill('#f5f5f5'); doc.fillColor('black'); }
      let x = xEsq;
      cols.forEach((c, idx) => {
        doc.fillColor('black').text(String(linha[idx] ?? '—'), x + 3, y + 3, { width: c.w - 6, align: c.align || 'left' });
        x += c.w;
      });
      doc.y = y + h;
    });
    doc.moveDown(0.5);
  };

  // ---- Capa / cabeçalho ----
  doc.fillColor(VERMELHO).fontSize(20).font('Helvetica-Bold')
    .text('Relatório — Escola de Educação e Saúde CVB-RJ', xEsq);
  doc.fillColor(CINZA).fontSize(9).font('Helvetica')
    .text(`Gerado em ${dataHoraBR(dados.geradoEm)}`, xEsq);
  doc.fillColor('black');

  // ---- Seção 1: Resumo financeiro ----
  titulo('Resumo financeiro');
  const t = dados.financeiro.totais;
  tabela(
    [{ label: 'Indicador', width: 60 }, { label: 'Valor', width: 40, align: 'right' }],
    [
      ['Taxa de inscrição paga (alunos)', String(t.taxaPagaCount)],
      ['Curso pago + matrícula gerada', String(t.matriculaGeradaCount)],
      ['Pendentes', String(t.pendentesCount)],
      ['Total recebido', formatBRL(t.totalRecebido)],
      ['Total pendente a receber', formatBRL(t.totalPendente)],
      ['Estornos (qtd.)', String(t.estornosCount)],
      ['Total estornado', formatBRL(t.totalEstornado)],
      ['Reembolsos pendentes (qtd.)', String(t.reembolsosCount)],
      ['Total a reembolsar', formatBRL(t.totalAReembolsar)],
    ]
  );

  // ---- Seção 2: Estornos e pendências ----
  titulo('Estornos');
  if (dados.financeiro.estornos.length) {
    tabela(
      [{ label: 'Aluno', width: 30 }, { label: 'Curso', width: 30 }, { label: 'Data', width: 15 },
       { label: 'Valor', width: 15, align: 'right' }, { label: 'Motivo', width: 30 }],
      dados.financeiro.estornos.map((m) => [
        m.aluno?.nome || '—', m.turma?.curso?.nome || '—', dataBR(m.atualizadoEm),
        formatBRL(m.valorCurso), dados.financeiro.motivos[m.id] || 'Não informado',
      ])
    );
  } else { doc.font('Helvetica-Oblique').fontSize(9).fillColor(CINZA).text('Nenhum estorno registrado.').fillColor('black'); }

  titulo('Aguardando pagamento');
  if (dados.financeiro.pendentesLista.length) {
    tabela(
      [{ label: 'Aluno', width: 30 }, { label: 'Curso', width: 30 }, { label: 'Pendência', width: 25 },
       { label: 'Desde', width: 15 }, { label: 'Valor', width: 15, align: 'right' }],
      dados.financeiro.pendentesLista.map((p) => [
        p.m.aluno?.nome || '—', p.m.turma?.curso?.nome || '—', p.tipo, dataBR(p.desde), formatBRL(p.valor),
      ])
    );
  } else { doc.font('Helvetica-Oblique').fontSize(9).fillColor(CINZA).text('Nenhuma pendência.').fillColor('black'); }

  // ---- Seção 3: Matrículas ----
  doc.addPage();
  titulo('Matrículas');
  tabela(
    [{ label: 'Aluno', width: 26 }, { label: 'Curso', width: 26 }, { label: 'Plano', width: 12 },
     { label: 'Status', width: 13 }, { label: 'Taxa', width: 8 }, { label: 'Valor', width: 13, align: 'right' },
     { label: 'Inscrito', width: 13 }],
    dados.matriculas.map((m) => [
      m.aluno?.nome || '—', m.turma?.curso?.nome || '—', labelPlano(m.plano),
      m.statusPagamento || '—', m.taxaConfirmada ? 'Sim' : 'Não', formatBRL(m.valorCurso), dataBR(m.criadoEm),
    ])
  );

  // ---- Seção 4: Reembolsos (trilha detalhada) ----
  doc.addPage();
  titulo('Reembolsos — quem fez, aluno afetado e motivo');
  if (dados.reembolsosAuditoria.length) {
    tabela(
      [{ label: 'Data/hora', width: 16 }, { label: 'Quem fez', width: 20 }, { label: 'Aluno', width: 20 },
       { label: 'Curso', width: 18 }, { label: 'Matrícula', width: 12 }, { label: 'Valor', width: 11, align: 'right' },
       { label: 'Tipo', width: 9 }, { label: 'Motivo', width: 18 }],
      dados.reembolsosAuditoria.map((r) => [
        dataHoraBR(r.quando), r.quemFez, r.aluno, r.curso, r.matricula,
        r.valor != null ? formatBRL(r.valor) : '—', r.tipo, r.motivo,
      ])
    );
  } else { doc.font('Helvetica-Oblique').fontSize(9).fillColor(CINZA).text('Nenhum reembolso registrado.').fillColor('black'); }

  // ---- Seção 5: Auditoria (resumida) ----
  doc.addPage();
  titulo('Auditoria (resumida)');
  tabela(
    [{ label: 'Data/hora', width: 20 }, { label: 'Quem', width: 25 }, { label: 'Ação', width: 30 }, { label: 'Alvo', width: 30 }],
    dados.auditoria.map((a) => [dataHoraBR(a.quando), a.quem, a.acao, a.alvo])
  );

  doc.end();
}

module.exports = { coletarDadosRelatorio, gerarExcel, gerarPdf };