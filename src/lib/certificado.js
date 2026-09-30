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

// Quem assina: uma lista da filial (até 6 pessoas: coordenação, presidência, voluntariado…),
// editada em /modelos. Em cada turma a secretaria marca quais aparecem (até 4, junto com o
// instrutor, se marcado). Guardado em Configuracao: 'cert_assinantes' (JSON) e 'cert_livro_atual'.
// Antes existia uma só assinatura ('cert_coordenador_nome'/'cert_coordenador_cargo'): ela vira
// a primeira da lista enquanto a lista não for salva.
const MAX_ASSINANTES = 6;
const MAX_NO_CERTIFICADO = 4;
const PADRAO_ASSINANTE = { nome: 'AMANDA FERRARI PENZA', cargo: 'Coordenadora de Cursos Livres' };
const PADROES = { livro: '1' };

async function lerAjustes() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: ['cert_assinantes', 'cert_livro_atual', 'cert_coordenador_nome', 'cert_coordenador_cargo'] } } });
  const m = Object.fromEntries(cfgs.map((c) => [c.chave, c.valor]));
  let assinantes = [];
  try { assinantes = JSON.parse(m.cert_assinantes || '[]'); } catch (e) { assinantes = []; }
  // As posições são fixas (a0…a5): as turmas e os cursos guardam a escolha pela posição, então uma
  // linha apagada fica vazia em vez de puxar as de baixo.
  assinantes = (Array.isArray(assinantes) ? assinantes : []).slice(0, MAX_ASSINANTES)
    .map((a) => ({ nome: String(a && a.nome || '').trim().slice(0, 80), cargo: String(a && a.cargo || '').trim().slice(0, 80) }));
  if (!assinantes.some((a) => a.nome)) {
    assinantes = [{ nome: (m.cert_coordenador_nome || '').trim() || PADRAO_ASSINANTE.nome, cargo: (m.cert_coordenador_cargo || '').trim() || PADRAO_ASSINANTE.cargo }];
  }
  return { assinantes, livro: Math.max(1, parseInt(m.cert_livro_atual, 10) || 1) };
}

// v.assinantes: [{ nome, cargo }] na ordem das linhas do formulário (linha sem nome fica vazia).
async function salvarAjustes(v) {
  const assinantes = (v.assinantes || []).slice(0, MAX_ASSINANTES)
    .map((a) => ({ nome: String(a && a.nome || '').trim().slice(0, 80), cargo: String(a && a.nome && a.cargo || '').trim().slice(0, 80) }));
  while (assinantes.length && !assinantes[assinantes.length - 1].nome) assinantes.pop();
  const salvar = async (chave, valor) => valor
    ? prisma.configuracao.upsert({ where: { chave }, update: { valor }, create: { chave, valor } })
    : prisma.configuracao.deleteMany({ where: { chave } });
  await salvar('cert_assinantes', assinantes.length ? JSON.stringify(assinantes) : null);
  const livro = String(Math.max(1, parseInt(v.livro, 10) || 1));
  await salvar('cert_livro_atual', livro === PADROES.livro ? null : livro);
  await prisma.configuracao.deleteMany({ where: { chave: { in: ['cert_coordenador_nome', 'cert_coordenador_cargo'] } } });
}

// Quais assinaturas saem no certificado. A escolha ('a0', 'a2', 'instrutor'…) fica no curso
// (curso.certAssinaturas) e a turma pode ter a própria (turma.certAssinaturas). Sem nenhuma: a
// primeira da lista e o instrutor.
const ESCOLHA_PADRAO = ['a0', 'instrutor'];
const limparEscolha = (e) => (Array.isArray(e) ? e.filter((x) => /^a\d$|^instrutor$/.test(x)) : []);
function escolhaDoCurso(curso) {
  const e = limparEscolha(curso && curso.certAssinaturas);
  return e.length ? e : ESCOLHA_PADRAO;
}
function escolhaDaTurma(turma) {
  const e = limparEscolha(turma.certAssinaturas);
  return e.length ? e : escolhaDoCurso(turma.curso);
}

function assinaturasDaTurma(turma, ajustes) {
  const lista = [];
  for (const chave of escolhaDaTurma(turma)) {
    if (chave === 'instrutor') {
      const reg = (turma.instrutorRegistro || '').trim();
      lista.push({ nome: (turma.instrutorNome || '').trim(), cargo: 'Instrutor' + (reg ? ' ' + reg : ''), instrutor: true });
    } else {
      const a = ajustes.assinantes[Number(chave.slice(1))];
      if (a && a.nome) lista.push({ nome: a.nome, cargo: a.cargo });
    }
  }
  return lista.slice(0, MAX_NO_CERTIFICADO);
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
    assinaturas: assinaturasDaTurma(turma, ajustes),
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
  if (escolhaDaTurma(turma).includes('instrutor') && !turma.instrutorNome) p.push({ texto: 'Nome do instrutor em branco (a assinatura sai sem nome). Preencha em "Assinaturas", abaixo.' });
  if (!turma.curso.conteudoProgramatico) p.push({ texto: 'Conteúdo programático do curso vazio (verso sem a lista).', link: `/cursos/${turma.curso.id}/editar#certificado` });
  const semDoc = alunos.filter((m) => !m.aluno.cpfCnpj && !m.aluno.passaporte);
  if (semDoc.length) p.push({ texto: `${semDoc.length} aluno(s) sem CPF ou passaporte no cadastro.` });
  return p;
}

module.exports = {
  lerAjustes, salvarAjustes, numerar, anexarCertificados, dadosDoCertificado, pendencias, PADROES,
  escolhaDaTurma, escolhaDoCurso, assinaturasDaTurma, MAX_ASSINANTES, MAX_NO_CERTIFICADO,
};
