// ============================================================
//  Planilha ao vivo (Excel → Dados → Da Web)
//
//  O Excel não faz login no painel, então ele busca os dados por um link com uma
//  chave secreta (?chave=...). A chave é gerada na aba Integração (/integracao), aparece uma vez
//  só, e no banco fica apenas o HASH dela (SHA-256), como os tokens de e-mail
//  (lib/tokens.js). Gerar outra chave desliga a anterior; "Desligar" apaga.
//
//  Quatro tabelas, cada uma num CSV (uma consulta no Excel por tabela):
//    matriculas — uma linha por matrícula: aluno, curso, turma, plano, status, valor, o que falta
//    alunos     — uma linha por aluno, com quantas matrículas tem, se o e-mail e o celular parecem válidos
//    cursos     — catálogo com preços, turmas abertas e alunos com vaga
//    turmas     — uma linha por turma: início, aulas, status e quantos alunos em cada situação
//
//  As mesmas tabelas alimentam a planilha pronta (lib/planilha-excel.js), que já vem
//  ligada a estes links. Cada coluna tem um tipo (texto, inteiro, numero, data) para o
//  Excel receber número como número e data como data.
//
//  Só o que a Secretaria já vê nas telas dela (Matrículas, Alunos, Cursos, Pendentes). Nada do
//  Financeiro: sem total recebido, sem soma do que cada aluno ou curso já pagou.
//
//  CSV no padrão do Excel em português: separador ";", vírgula nos decimais
//  (120,50) e datas aaaa-mm-dd, que o Excel reconhece como data em qualquer idioma.
// ============================================================
const crypto = require('crypto');
const prisma = require('../db');
const { faltaReceber, valorCursoSemTaxa } = require('./matricula');
const { formatar } = require('./documento');
const { verificarEmails, verificarCelular, digitosCelular } = require('./verificar-contato');

const CHAVE_CONFIG = 'planilha_chave_hash';
const TABELAS = ['matriculas', 'alunos', 'cursos', 'turmas'];

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
// No banco a turma concluída fica ENCERRADA; na tela aparece CONCLUÍDA (server.js rotuloTurma).
const ROTULO_TURMA = { ABERTA: 'Aberta', CONFIRMADA: 'Confirmada', CANCELADA: 'Cancelada', ENCERRADA: 'Concluída', CONGELADA: 'Congelada' };
const ROTULO_SITUACAO = { APROVADO: 'Aprovado', REPROVADO: 'Reprovado' };

// Situação do pagamento como na legenda do painel (legenda-status.ejs): o cartão parcelado
// aprovado (status PARCELADO) ainda tem parcelas a vencer; plano parcelado com status PAGO é
// o que a secretaria marcou como parcelas quitadas.
function situacaoPagamento(m) {
  if (m.statusPagamento === 'PAGO') return m.plano === 'PARCELADO' ? 'Pago (parcelas quitadas)' : 'Pago';
  if (m.statusPagamento === 'PARCELADO') return 'Parcelado (parcelas em andamento)';
  if (m.statusPagamento === 'ESTORNADO') return 'Estornado';
  if (m.statusPagamento === 'CANCELADO') return 'Cancelado';
  return m.taxaConfirmada ? 'Falta pagar o curso' : 'Aguardando taxa de inscrição';
}

// Fora de prazo como na tela Pendentes: pendente numa turma que não está mais ativa ou já começou
// (turma congelada fica de fora: está pausada, não vencida).
function foraDePrazo(m) {
  const t = m.turma || {};
  if (m.statusPagamento !== 'PENDENTE' || t.status === 'CONGELADA') return false;
  return !turmaAtiva(t.status) || new Date(t.inicioPrevisto) <= new Date();
}

// Taxa de inscrição e matrícula (curso) separadas, cada uma com Pago / Pendente / Não pago,
// para a planilha colorir: verde, amarelo, vermelho. Cancelado e estornado ficam cinza.
function situacaoTaxa(m) {
  if (m.statusPagamento === 'ESTORNADO') return 'Estornado';
  if (m.statusPagamento === 'CANCELADO') return 'Cancelado';
  if (m.taxaConfirmada) return 'Pago';
  return foraDePrazo(m) ? 'Não pago (fora de prazo)' : 'Pendente';
}
function situacaoCurso(m) {
  if (m.statusPagamento === 'ESTORNADO') return 'Estornado';
  if (m.statusPagamento === 'CANCELADO') return 'Cancelado';
  if (m.statusPagamento === 'PAGO') return m.plano === 'PARCELADO' ? 'Pago (parcelas quitadas)' : 'Pago';
  if (m.statusPagamento === 'PARCELADO') return 'Pago (parcelas em andamento)';
  return foraDePrazo(m) ? 'Não pago (fora de prazo)' : 'Pendente';
}

const PAGOU_TUDO = ['PAGO', 'PARCELADO'];
// Ocupa vaga: pagou ao menos a taxa e não foi cancelado/estornado (FILTRO_VAGA do admin.js).
const ocupaVaga = (m) => m.taxaConfirmada && [...PAGOU_TUDO, 'PENDENTE'].includes(m.statusPagamento);
// Pagou tudo, como o painel conta (pagamentosPorTurma: ocupa vaga e não está pendente).
const pagouTudo = (m) => ocupaVaga(m) && m.statusPagamento !== 'PENDENTE';

// A tela de Turmas marca como concluída a turma confirmada cuja última aula (ou o início, sem
// aulas) já passou (lib/concluir-turmas.js), mas só quando alguém abre a tela. Aqui a planilha
// mostra o mesmo sem gravar nada: calcula a situação na hora.
function statusTurma(t, ultimaAula) {
  if (t.status === 'CONFIRMADA') {
    const fim = data(ultimaAula.get(t.id) || t.inicioPrevisto, 'UTC');
    if (fim && fim < data(new Date())) return 'ENCERRADA';
  }
  return t.status;
}
const turmaAtiva = (s) => ['ABERTA', 'CONFIRMADA'].includes(s);

// turmaId → data da última aula.
async function ultimaAulaPorTurma() {
  const grupos = await prisma.aulaData.groupBy({ by: ['turmaId'], _max: { data: true } });
  return new Map(grupos.map((g) => [g.turmaId, g._max.data]));
}
const codigoMatricula = (id) => `MAT-${String(id).slice(0, 8).toUpperCase()}`;
const codigoTurma = (id) => `TUR-${String(id).slice(0, 8).toUpperCase()}`;
// Nome da turma para a pessoa escolher numa lista: "Curso — dd/mm/aaaa".
const dataBR = (d, tz) => data(d, tz).split('-').reverse().join('/');
const nomeTurma = (t) => `${t?.curso?.nome || '—'} — ${dataBR(t?.inicioPrevisto, 'UTC')}`;
// CPF com pontos: só dígitos, o Excel leria como número e comeria o zero da frente.
const documento = (u) => (u?.cpfCnpj ? formatar(u.cpfCnpj) : u?.passaporte || '');

// Colunas: { nome, tipo }. tipo: texto | inteiro | numero | data.
const col = (nome, tipo = 'texto') => ({ nome, tipo });

// ---------- tabelas ----------

async function tabelaMatriculas() {
  const [matriculas, ultimaAula] = await Promise.all([
    prisma.matricula.findMany({
      // Agrupado por turma (as mais novas primeiro) e, dentro dela, por nome: a lista por turma
      // da planilha sai em ordem alfabética.
      orderBy: [{ turma: { inicioPrevisto: 'desc' } }, { aluno: { nome: 'asc' } }],
      include: {
        aluno: true,
        turma: { include: { curso: { select: { nome: true } } } },
        pagamentos: { select: { tipo: true, status: true } },
      },
    }),
    ultimaAulaPorTurma(),
  ]);
  return {
    colunas: [
      col('Código'), col('Aluno'), col('Documento'), col('E-mail'), col('Celular'), col('Curso'), col('Turma'),
      col('Código da turma'), col('Início da turma', 'data'), col('Status da turma'), col('Plano'), col('Forma de pagamento'),
      col('Taxa de inscrição'), col('Valor da taxa (R$)', 'numero'), col('Matrícula (curso)'), col('Valor do curso (R$)', 'numero'),
      col('Situação do pagamento'), col('Valor total (R$)', 'numero'), col('Falta pagar (R$)', 'numero'), col('Prazo para pagar o curso', 'data'),
      col('Alimento entregue'), col('Nota', 'numero'), col('Situação acadêmica'), col('Inscrito em', 'data'),
      col('Pagamento confirmado em', 'data'),
    ],
    linhas: matriculas.map((m) => [
      codigoMatricula(m.id),
      m.aluno?.nome,
      documento(m.aluno),
      m.aluno?.email,
      digitosCelular(m.aluno?.celular),
      m.turma?.curso?.nome,
      nomeTurma(m.turma),
      codigoTurma(m.turmaId),
      data(m.turma?.inicioPrevisto, 'UTC'),
      ROTULO_TURMA[statusTurma(m.turma, ultimaAula)],
      ROTULO_PLANO[m.plano] || m.plano,
      ROTULO_FORMA[m.forma] || m.forma,
      situacaoTaxa(m),
      num(m.valorTaxaMatricula),
      situacaoCurso(m),
      num(valorCursoSemTaxa(m)),
      situacaoPagamento(m),
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
    orderBy: { nome: 'asc' },
    include: {
      matriculas: {
        select: {
          statusPagamento: true,
          turma: { select: { curso: { select: { nome: true } } } },
        },
      },
    },
  });
  const emailsValidos = await verificarEmails(alunos.map((a) => a.email));
  return {
    // Só identificação e contato: nada de endereço, gênero ou escolaridade.
    colunas: [
      col('Nome'), col('Documento'), col('E-mail'), col('Celular'), col('Tem inscrição'), col('Matrículas', 'inteiro'),
      col('Matrículas pagas', 'inteiro'), col('Cursos'), col('E-mail válido'), col('Celular válido'), col('Cadastrado em', 'data'),
    ],
    linhas: alunos.map((a, i) => [
      a.nome,
      documento(a),
      a.email,
      digitosCelular(a.celular),
      a.matriculas.length ? 'Sim' : 'Não',
      a.matriculas.length,
      a.matriculas.filter((m) => PAGOU_TUDO.includes(m.statusPagamento)).length,
      [...new Set(a.matriculas.map((m) => m.turma?.curso?.nome).filter(Boolean))].join(', '),
      emailsValidos[i],
      verificarCelular(a.celular),
      data(a.criadoEm),
    ]),
  };
}

async function tabelaCursos() {
  const [cursos, ultimaAula] = await Promise.all([
    prisma.curso.findMany({
      orderBy: { nome: 'asc' },
      include: {
        turmas: {
          select: {
            id: true, status: true, inicioPrevisto: true,
            matriculas: { select: { statusPagamento: true, taxaConfirmada: true } },
          },
        },
      },
    }),
    ultimaAulaPorTurma(),
  ]);
  return {
    colunas: [
      col('Curso'), col('Ativo'), col('Carga horária (h)', 'inteiro'), col('Preço à vista (R$)', 'numero'),
      col('Preço cheio (R$)', 'numero'), col('Parcelas', 'inteiro'), col('Valor da parcela (R$)', 'numero'),
      col('Taxa de inscrição (R$)', 'numero'), col('Turmas', 'inteiro'), col('Turmas abertas', 'inteiro'),
      col('Próxima turma', 'data'), col('Alunos com vaga', 'inteiro'), col('Alunos que pagaram tudo', 'inteiro'),
    ],
    linhas: cursos.map((c) => {
      const mats = c.turmas.flatMap((t) => t.matriculas);
      const abertas = c.turmas.filter((t) => turmaAtiva(statusTurma(t, ultimaAula)));
      const proxima = abertas.map((t) => t.inicioPrevisto).sort((a, b) => a - b)[0];
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
        abertas.length,
        data(proxima, 'UTC'),
        mats.filter(ocupaVaga).length,
        mats.filter(pagouTudo).length,
      ];
    }),
  };
}

async function tabelaTurmas() {
  const [turmas, ultimaAula] = await Promise.all([
    prisma.turma.findMany({
      orderBy: { inicioPrevisto: 'desc' },
      include: {
        curso: { select: { nome: true } },
        aulas: { orderBy: { data: 'asc' } },
        matriculas: { select: { statusPagamento: true, taxaConfirmada: true } },
      },
    }),
    ultimaAulaPorTurma(),
  ]);
  const aulaBR = (a) => `${data(a.data, 'UTC').split('-').reverse().join('/')} ${a.horario || ''}`.trim();
  return {
    colunas: [
      col('Turma'), col('Código'), col('Curso'), col('Início', 'data'), col('Status'), col('Vagas', 'inteiro'),
      col('Mínimo de alunos', 'inteiro'), col('Aulas', 'inteiro'), col('Datas e horários'),
      col('Alunos com vaga', 'inteiro'), col('Vagas restantes', 'inteiro'), col('Pagaram tudo', 'inteiro'),
      col('Falta pagar o curso', 'inteiro'), col('Aguardando taxa', 'inteiro'), col('Criada em', 'data'),
    ],
    linhas: turmas.map((t) => {
      const comVaga = t.matriculas.filter(ocupaVaga).length;
      return [
        nomeTurma(t),
        codigoTurma(t.id),
        t.curso?.nome,
        data(t.inicioPrevisto, 'UTC'),
        ROTULO_TURMA[statusTurma(t, ultimaAula)],
        t.vagas,
        t.minimoAlunos,
        t.aulas.length,
        t.aulas.map(aulaBR).join('; '),
        comVaga,
        Math.max(0, (t.vagas || 0) - comVaga),
        t.matriculas.filter(pagouTudo).length,
        t.matriculas.filter((m) => m.taxaConfirmada && m.statusPagamento === 'PENDENTE').length,
        t.matriculas.filter((m) => !m.taxaConfirmada && m.statusPagamento === 'PENDENTE').length,
        data(t.criadoEm),
      ];
    }),
  };
}

const GERADORES = { matriculas: tabelaMatriculas, alunos: tabelaAlunos, cursos: tabelaCursos, turmas: tabelaTurmas };

// As quatro tabelas de uma vez (planilha pronta).
async function gerarTabelas() {
  const listas = await Promise.all(TABELAS.map((t) => GERADORES[t]()));
  return Object.fromEntries(TABELAS.map((t, i) => [t, listas[i]]));
}

// ---------- valores ----------

// Número (JS) ou '' quando não há valor. O CSV e a planilha formatam cada um do seu jeito.
function num(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : '';
}

// Data aaaa-mm-dd no fuso de Brasília. O início da turma é guardado como dia em UTC (como no Painel).
function data(d, timeZone = 'America/Sao_Paulo') {
  if (!d) return '';
  return new Date(d).toLocaleDateString('sv-SE', { timeZone });
}

// ---------- CSV ----------

function celula(v, tipo) {
  if (v == null || v === '') return '';
  if (tipo === 'numero') return Number(v).toFixed(2).replace('.', ',');
  if (tipo === 'inteiro') return String(v);
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function paraCsv({ colunas, linhas }) {
  const cab = colunas.map((c) => celula(c.nome, 'texto')).join(';');
  const corpo = linhas.map((l) => l.map((v, i) => celula(v, colunas[i].tipo)).join(';'));
  return '﻿' + [cab, ...corpo].join('\r\n') + '\r\n';
}

async function gerarCsv(tabela) {
  return paraCsv(await GERADORES[tabela]());
}

module.exports = { TABELAS, gerarChave, desligar, ligada, chaveValida, gerarCsv, gerarTabelas };
