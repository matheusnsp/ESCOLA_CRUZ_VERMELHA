// lib/certificado.js
//
// Certificado impresso pela secretaria (A4 deitado, frente e verso), no layout do modelo em Word
// da escola. Ajustes gerais em Configuracao: nome e cargo de quem assina pela coordenação e o
// Livro em uso. Por turma (lib/extras.js): instrutor e registro profissional. Por curso (extras):
// nome no certificado, conteúdo programático e validade. Nenhuma coluna nova no banco.
//
// Livro/Registro: gerados na PRIMEIRA impressão de cada aluno (registro no LogAuditoria); reimprimir
// mantém o mesmo número. O registro é sequencial dentro do livro.

const prisma = require('../db');

const CHAVES = { coordNome: 'cert_coordenador_nome', coordCargo: 'cert_coordenador_cargo', livro: 'cert_livro_atual' };
const PADROES = { coordNome: 'AMANDA FERRARI PENZA', coordCargo: 'Coordenadora de Cursos Livres', livro: '1' };

async function lerAjustes() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: Object.values(CHAVES) } } });
  const mapa = Object.fromEntries(cfgs.map((c) => [c.chave, c.valor]));
  const a = Object.fromEntries(Object.entries(CHAVES).map(([k, chave]) => [k, (mapa[chave] || '').trim() || PADROES[k]]));
  a.livro = Math.max(1, parseInt(a.livro, 10) || 1);
  return a;
}

async function salvarAjustes(v) {
  const valores = {
    coordNome: String(v.coordNome || '').trim().slice(0, 80),
    coordCargo: String(v.coordCargo || '').trim().slice(0, 80),
    livro: String(Math.max(1, parseInt(v.livro, 10) || 1)),
  };
  for (const [k, chave] of Object.entries(CHAVES)) {
    if (!valores[k] || valores[k] === PADROES[k]) await prisma.configuracao.deleteMany({ where: { chave } });
    else await prisma.configuracao.upsert({ where: { chave }, update: { valor: valores[k] }, create: { chave, valor: valores[k] } });
  }
}

// Livro/Registro ficam no LogAuditoria (sem colunas novas no banco):
//   "certificado-<matrícula>"      → qual livro e registro a matrícula recebeu (detalhe) e quando
//   "cert-num-<livro>-<registro>"  → trava do número: o id repetido falha, então dois certificados
//                                    nunca ficam com o mesmo registro, mesmo com impressões ao mesmo tempo.
const idCert = (matriculaId) => `certificado-${matriculaId}`;
const idNumero = (livro, registro) => `cert-num-${livro}-${registro}`;

function lerDetalhe(d) {
  if (!d) return {};
  if (typeof d === 'string') { try { return JSON.parse(d); } catch (e) { return {}; } }
  return d;
}

// Põe certLivro, certRegistro e certEmitidoEm em cada matrícula (ou null).
async function anexarCertificados(matriculas) {
  const logs = matriculas.length ? await prisma.logAuditoria.findMany({ where: { id: { in: matriculas.map((m) => idCert(m.id)) } } }) : [];
  const mapa = Object.fromEntries(logs.map((l) => [l.alvoId, l]));
  for (const m of matriculas) {
    const l = mapa[m.id]; const d = lerDetalhe(l && l.detalhe);
    m.certLivro = l ? d.livro : null; m.certRegistro = l ? d.registro : null; m.certEmitidoEm = l ? l.criadoEm : null;
  }
  return matriculas;
}

async function proximoRegistro(livro) {
  const usados = await prisma.logAuditoria.findMany({ where: { id: { startsWith: `cert-num-${livro}-` } }, select: { id: true } });
  return usados.reduce((max, u) => Math.max(max, parseInt(u.id.split('-').pop(), 10) || 0), 0) + 1;
}

// Dá Livro/Registro a quem ainda não tem (em ordem alfabética). Devolve quantos foram numerados.
async function numerar(matriculaIds, atorId = 'SISTEMA') {
  const { livro } = await lerAjustes();
  const matriculas = await prisma.matricula.findMany({ where: { id: { in: matriculaIds } }, include: { aluno: { select: { nome: true } } } });
  await anexarCertificados(matriculas);
  const faltam = matriculas.filter((m) => !m.certRegistro).sort((a, b) => a.aluno.nome.localeCompare(b.aluno.nome, 'pt-BR'));
  let feitos = 0;
  for (const m of faltam) {
    for (let tentativa = 0; tentativa < 20; tentativa++) {
      const registro = await proximoRegistro(livro);
      try {
        await prisma.$transaction([
          prisma.logAuditoria.create({ data: { id: idNumero(livro, registro), atorId, acao: 'CERTIFICADO_NUMERO', alvoTipo: 'Matricula', alvoId: m.id } }),
          prisma.logAuditoria.create({ data: { id: idCert(m.id), atorId, acao: 'CERTIFICADO_EMITIDO', alvoTipo: 'Matricula', alvoId: m.id, detalhe: { livro, registro } } }),
        ]);
        feitos++;
        break;
      } catch (e) {
        if (e.code !== 'P2002') throw e;
        // Número pego por outra impressão agora, ou a matrícula acabou de ser numerada: confere e tenta de novo.
        const ja = await prisma.logAuditoria.findUnique({ where: { id: idCert(m.id) } });
        if (ja) break;
      }
    }
  }
  return feitos;
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const p2 = (n) => String(n).padStart(2, '0');
const dataBr = (d) => { const x = new Date(d); return `${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`; };

// Datas das aulas: uma só → "na data de 06/03/2026"; várias → "no período de 01/10/2026 a 05/10/2026".
function periodo(turma) {
  const datas = (turma.aulas || []).map((a) => new Date(a.data)).sort((a, b) => a - b);
  if (!datas.length) return { frase: `na data de ${dataBr(turma.inicioPrevisto)}`, curta: dataBr(turma.inicioPrevisto) };
  const ini = dataBr(datas[0]); const fim = dataBr(datas[datas.length - 1]);
  return ini === fim ? { frase: `na data de ${ini}`, curta: ini } : { frase: `no período de ${ini} a ${fim}`, curta: `${ini} a ${fim}` };
}

function emitidoEm(d = new Date()) {
  const x = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `Rio de Janeiro, ${p2(x.getDate())} de ${MESES[x.getMonth()]} de ${x.getFullYear()}.`;
}

function portador(genero) {
  if (genero === 'Feminino') return 'Portadora';
  if (genero === 'Masculino') return 'Portador';
  return 'Portador(a)';
}

// Tudo o que o modelo imprime, já formatado. m: matrícula com aluno e turma (curso, aulas).
function dadosDoCertificado(m, ajustes, documentoAluno) {
  const turma = m.turma; const curso = turma.curso;
  const doc = documentoAluno(m.aluno);
  const horas = String(curso.cargaHoraria).padStart(2, '0');
  return {
    nome: m.aluno.nome.trim(),
    portador: portador(m.aluno.genero),
    documento: doc ? { tipo: doc.tipo.split(' ·')[0], numero: doc.numero } : null,
    curso: (curso.nomeCertificado || curso.nome).trim(),
    cargaHoraria: `${horas} ${curso.cargaHoraria === 1 ? 'hora' : 'horas'}`,
    periodo: periodo(turma),
    emitidoEm: emitidoEm(m.certEmitidoEm || new Date()),
    coordNome: ajustes.coordNome,
    coordCargo: ajustes.coordCargo,
    instrutorNome: (turma.instrutorNome || '').trim(),
    instrutorRegistro: (turma.instrutorRegistro || '').trim(),
    livro: m.certLivro,
    registro: m.certRegistro,
    validade: (curso.certificadoValidade || '').trim(),
    conteudo: String(curso.conteudoProgramatico || '').split(/\r?\n/).map((l) => l.trim().replace(/^[-•*]\s*/, '')).filter(Boolean),
  };
}

// O que falta para o certificado sair completo (mostrado antes de imprimir).
function pendencias(turma, alunos = []) {
  const p = [];
  if (!turma.instrutorNome) p.push({ texto: 'Instrutor da turma não informado (vai em branco na assinatura).', link: `/turmas/${turma.id}/editar#certificado` });
  if (!turma.curso.conteudoProgramatico) p.push({ texto: 'Conteúdo programático do curso vazio (verso sem a lista).', link: `/cursos/${turma.curso.id}/editar#certificado` });
  const semDoc = alunos.filter((m) => !m.aluno.cpfCnpj && !m.aluno.passaporte);
  if (semDoc.length) p.push({ texto: `${semDoc.length} aluno(s) sem CPF ou passaporte no cadastro.` });
  return p;
}

module.exports = { lerAjustes, salvarAjustes, numerar, anexarCertificados, dadosDoCertificado, pendencias, PADROES };
