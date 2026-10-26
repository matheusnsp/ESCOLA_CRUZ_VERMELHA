// ============================================================
//  Planilha ao vivo (Excel → Dados → Da Web)
//
//  O Excel não faz login no painel, então ele busca os dados por um link com uma
//  chave secreta (?chave=...). A chave é gerada na aba Integração (/integracao), aparece uma vez
//  só, e no banco fica apenas o HASH dela (SHA-256), como os tokens de e-mail
//  (lib/tokens.js). Gerar outra chave desliga a anterior; "Desligar" apaga.
//
//  Três tabelas, cada uma num CSV (uma consulta no Excel por tabela):
//    matriculas — uma linha por matrícula: aluno, curso, turma, plano, status, valor, o que falta
//    alunos     — uma linha por aluno, com quantas matrículas tem e quantas estão pagas
//    cursos     — catálogo com preços, turmas abertas e alunos com vaga
//
//  Só o que a Secretaria já vê nas telas dela (Matrículas, Alunos, Cursos, Pendentes). Nada do
//  Financeiro: sem total recebido, sem soma do que cada aluno ou curso já pagou.
//
//  CSV no padrão do Excel em português: separador ";", vírgula nos decimais
//  (120,50) e datas aaaa-mm-dd, que o Excel reconhece como data em qualquer idioma.
// ============================================================
const crypto = require('crypto');
const prisma = require('../db');
const { faltaReceber } = require('./matricula');
const { formatar } = require('./documento');

const CHAVE_CONFIG = 'planilha_chave_hash';
const TABELAS = ['matriculas', 'alunos', 'cursos'];

const hash = (txt) => crypto.createHash('sha256').update(String(txt)).digest('hex');

// ---------- chave de acesso ----------

async function gerarChave() {
  const chave = crypto.randomBytes(32).toString('hex');
  await prisma.configuracao.upsert({
    where: { chave: CHAVE_CONFIG },
    update: { valor: hash(chave) },
    create: { chave: CHAVE_CONFIG, valor: hash(chave) },
  });
  return chave;
}

async function desligar() {
  await prisma.configuracao.deleteMany({ where: { chave: CHAVE_CONFIG } });
}

async function ligada() {
  return !!(await prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } }));
}

async function chaveValida(chave) {
  if (!chave || typeof chave !== 'string' || chave.length > 200) return false;
  const cfg = await prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } });
  if (!cfg) return false;
  const a = Buffer.from(hash(chave));
  const b = Buffer.from(cfg.valor);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- rótulos ----------

const ROTULO_PLANO = { A_VISTA: 'À vista', PARCELADO: 'Parcelado', PRESENCIAL: 'Presencial' };
const ROTULO_FORMA = { PIX: 'PIX', DEBITO: 'Débito', CREDITO: 'Crédito', DINHEIRO: 'Dinheiro' };
const ROTULO_TURMA = { ABERTA: 'Aberta', CONFIRMADA: 'Confirmada', CANCELADA: 'Cancelada', ENCERRADA: 'Encerrada', CONGELADA: 'Congelada' };
const ROTULO_SITUACAO = { APROVADO: 'Aprovado', REPROVADO: 'Reprovado' };

// Uma palavra só para a situação do pagamento, que dá para filtrar no Excel.
function situacaoPagamento(m) {
  if (m.statusPagamento === 'PAGO') return 'Pago';
  if (m.statusPagamento === 'PARCELADO') return 'Pago (cartão parcelado)';
  if (m.statusPagamento === 'ESTORNADO') return 'Estornado';
  if (m.statusPagamento === 'CANCELADO') return 'Cancelado';
  return m.taxaConfirmada ? 'Falta pagar o curso' : 'Aguardando taxa de inscrição';
}

const PAGOU_TUDO = ['PAGO', 'PARCELADO'];
const codigoMatricula = (id) => `MAT-${String(id).slice(0, 8).toUpperCase()}`;
// CPF com pontos: só dígitos, o Excel leria como número e comeria o zero da frente.
const documento = (u) => (u?.cpfCnpj ? formatar(u.cpfCnpj) : u?.passaporte || '');

// ---------- tabelas ----------

async function tabelaMatriculas() {
  const matriculas = await prisma.matricula.findMany({
    orderBy: { criadoEm: 'desc' },
    include: {
      aluno: true,
      turma: { include: { curso: { select: { nome: true } } } },
      pagamentos: { select: { tipo: true, status: true } },
    },
  });
  return {
    colunas: [
      'Código', 'Aluno', 'Documento', 'E-mail', 'Celular', 'Curso', 'Início da turma', 'Status da turma',
      'Plano', 'Forma de pagamento', 'Situação do pagamento', 'Taxa de inscrição paga',
      'Valor da taxa (R$)', 'Valor da matrícula (R$)', 'Falta pagar (R$)', 'Prazo para pagar o curso',
      'Alimento entregue', 'Nota', 'Situação acadêmica', 'Inscrito em', 'Pagamento confirmado em',
    ],
    linhas: matriculas.map((m) => [
      codigoMatricula(m.id),
      m.aluno?.nome,
      documento(m.aluno),
      m.aluno?.email,
      m.aluno?.celular,
      m.turma?.curso?.nome,
      data(m.turma?.inicioPrevisto, 'UTC'),
      ROTULO_TURMA[m.turma?.status] || m.turma?.status,
      ROTULO_PLANO[m.plano] || m.plano,
      ROTULO_FORMA[m.forma] || m.forma,
      situacaoPagamento(m),
      m.taxaConfirmada ? 'Sim' : 'Não',
      num(m.valorTaxaMatricula),
      num(m.valorCurso),
      num(faltaReceber(m)),
      data(m.prazoPagamentoCurso),
      m.alimentoEntregue ? 'Sim' : 'Não',
      m.nota == null ? '' : num(m.nota),
      ROTULO_SITUACAO[m.situacao] || '',
      data(m.criadoEm),
      data(m.confirmadaEm),
    ]),
  };
}

async function tabelaAlunos() {
  const alunos = await prisma.usuario.findMany({
    where: { papel: 'ALUNO' },
    orderBy: { criadoEm: 'desc' },
    include: {
      matriculas: {
        select: {
          statusPagamento: true,
          turma: { select: { curso: { select: { nome: true } } } },
        },
      },
    },
  });
  return {
    colunas: [
      'Nome', 'Documento', 'E-mail', 'Celular', 'Gênero', 'Escolaridade', 'Bairro', 'Cidade', 'UF',
      'Matrículas', 'Matrículas pagas', 'Cursos', 'E-mail verificado', 'Cadastrado em', 'Último acesso',
    ],
    linhas: alunos.map((a) => [
      a.nome,
      documento(a),
      a.email,
      a.celular,
      a.genero,
      [a.escolaridade, a.escolaridadeSituacao].filter(Boolean).join(' — '),
      a.bairro,
      a.cidade,
      a.uf,
      a.matriculas.length,
      a.matriculas.filter((m) => PAGOU_TUDO.includes(m.statusPagamento)).length,
      [...new Set(a.matriculas.map((m) => m.turma?.curso?.nome).filter(Boolean))].join(', '),
      a.emailVerificado ? 'Sim' : 'Não',
      data(a.criadoEm),
      data(a.ultimoLogin),
    ]),
  };
}

async function tabelaCursos() {
  const cursos = await prisma.curso.findMany({
    orderBy: { nome: 'asc' },
    include: {
      turmas: {
        select: {
          status: true,
          matriculas: { select: { statusPagamento: true, taxaConfirmada: true } },
        },
      },
    },
  });
  return {
    colunas: [
      'Curso', 'Ativo', 'Carga horária (h)', 'Preço à vista (R$)', 'Preço cheio (R$)', 'Parcelas', 'Valor da parcela (R$)',
      'Taxa de inscrição (R$)', 'Turmas', 'Turmas abertas', 'Alunos com vaga', 'Alunos que pagaram tudo',
    ],
    linhas: cursos.map((c) => {
      const mats = c.turmas.flatMap((t) => t.matriculas);
      return [
        c.nome,
        c.ativo ? 'Sim' : 'Não',
        c.cargaHoraria,
        num(c.precoAvista),
        num(c.precoCheio),
        c.parcelas,
        num(c.valorParcela),
        c.taxaMatricula == null ? '' : num(c.taxaMatricula),
        c.turmas.length,
        c.turmas.filter((t) => ['ABERTA', 'CONFIRMADA'].includes(t.status)).length,
        // Ocupa vaga: pagou ao menos a taxa e não foi cancelado/estornado (FILTRO_VAGA do admin.js).
        mats.filter((m) => m.taxaConfirmada && [...PAGOU_TUDO, 'PENDENTE'].includes(m.statusPagamento)).length,
        mats.filter((m) => PAGOU_TUDO.includes(m.statusPagamento)).length,
      ];
    }),
  };
}

const GERADORES = { matriculas: tabelaMatriculas, alunos: tabelaAlunos, cursos: tabelaCursos };

// ---------- CSV ----------

// Número com vírgula decimal e sem separador de milhar: 1234,5 → "1234,50".
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

// Data aaaa-mm-dd no fuso de Brasília. O início da turma é guardado como dia em UTC (como no Painel).
function data(d, timeZone = 'America/Sao_Paulo') {
  if (!d) return '';
  return new Date(d).toLocaleDateString('sv-SE', { timeZone });
}

function celula(v) {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function gerarCsv(tabela) {
  const { colunas, linhas } = await GERADORES[tabela]();
  return '﻿' + [colunas, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

module.exports = { TABELAS, gerarChave, desligar, ligada, chaveValida, gerarCsv };
