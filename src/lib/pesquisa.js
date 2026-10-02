// lib/pesquisa.js
//
// Pesquisa de satisfação do fim do curso.
//   - O e-mail sai sozinho logo depois que a última aula da turma termina (enviarPendentes, a cada
//     15 min no server.js). Só para quem pagou; só turmas que terminaram há até 2 dias (assim a
//     primeira passada depois de publicar não manda pesquisa de turma antiga).
//   - O link (/pesquisa/<matrícula>/<token>) não pede login: o token é um HMAC da matrícula.
//   - A resposta tem nota de 0 a 5, comentário e se o aluno autoriza publicar o comentário.
//   - A secretaria vê tudo na aba Pesquisa (/pesquisa no painel) e aprova o que vai para o site;
//     a seção "O que dizem os alunos" da home só aparece quando ela liga a opção.
//
// Como lib/extras.js e lib/boas-vindas.js, nada aqui pede coluna nova no banco: tudo fica na tabela
// Configuracao.
//   pesquisa_config            { mostrarNoSite }
//   pesquisa:envio:<matrícula> data do envio (a criação da linha é a reserva: um e-mail só)
//   pesquisa:resp:<matrícula>  a resposta, em JSON

const crypto = require('crypto');
const prisma = require('../db');
const { horas } = require('./agenda');

const JANELA_MS = 2 * 24 * 3600000;   // pesquisa de turma que terminou há mais que isso não sai
const ESPERA_MS = 30 * 60000;         // espera depois do fim da última aula
const MAX_COMENTARIO = 600;
const NOTA_MAX = 5;                   // escala de 0 a 5
const ROTULOS = ['Muito ruim', 'Ruim', 'Regular', 'Bom', 'Muito bom', 'Excelente'];

// ── link ────────────────────────────────────────────────────────────────
function token(matriculaId) {
  const segredo = process.env.SESSION_SECRET || 'escola';
  return crypto.createHmac('sha256', segredo).update('pesquisa:' + matriculaId).digest('base64url').slice(0, 32);
}
function tokenValido(matriculaId, t) {
  const a = Buffer.from(token(matriculaId)), b = Buffer.from(String(t || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function link(matriculaId) {
  const base = (process.env.APP_URL || 'https://escola.cruzvermelhariodejaneiro.org').replace(/\/+$/, '');
  return `${base}/pesquisa/${matriculaId}/${token(matriculaId)}`;
}

// ── fim da turma ──────────────────────────────────────────────────────────
// Última aula + hora de término (Rio = UTC-3). Sem horário legível, 18h; sem aula cadastrada, o início.
function fimDaTurma(turma) {
  const aulas = turma.aulas || [];
  let dia, horario = '';
  if (aulas.length) {
    const ultima = aulas.reduce((m, a) => (new Date(a.data) > new Date(m.data) ? a : m));
    dia = new Date(ultima.data); horario = ultima.horario;
  } else {
    dia = new Date(turma.inicioPrevisto);
  }
  const h = horas(horario);
  const [hh, mm] = h ? h.fim : [18, 0];
  return new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), hh + 3, mm));
}

// ── configuração e respostas ────────────────────────────────────────────
const ler = (v) => { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };

async function lerConfig() {
  const c = await prisma.configuracao.findUnique({ where: { chave: 'pesquisa_config' } });
  return { mostrarNoSite: false, ...(c ? ler(c.valor) : {}) };
}
async function salvarConfig(parcial) {
  const valor = JSON.stringify({ ...(await lerConfig()), ...parcial });
  await prisma.configuracao.upsert({ where: { chave: 'pesquisa_config' }, update: { valor }, create: { chave: 'pesquisa_config', valor } });
  cacheSite = null;
}

async function lerResposta(matriculaId) {
  const c = await prisma.configuracao.findUnique({ where: { chave: 'pesquisa:resp:' + matriculaId } });
  return c ? ler(c.valor) : null;
}

// Todas as respostas, da mais nova para a mais antiga.
async function listarRespostas() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { startsWith: 'pesquisa:resp:' } } });
  return cfgs.map((c) => ({ matriculaId: c.chave.slice('pesquisa:resp:'.length), ...ler(c.valor) }))
    .sort((a, b) => String(b.respondidaEm).localeCompare(String(a.respondidaEm)));
}
async function contarEnvios() {
  return prisma.configuracao.count({ where: { chave: { startsWith: 'pesquisa:envio:' } } });
}

// "Maria Silva Souza" → "Maria S."
function nomePublico(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return 'Aluno';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return p.length > 1 ? `${cap(p[0])} ${p[p.length - 1].charAt(0).toUpperCase()}.` : cap(p[0]);
}

// Grava a resposta (uma por matrícula). Devolve false se já tinha resposta.
async function responder(matricula, { nota, comentario, autoriza }) {
  const n = Math.round(Number(nota));
  if (!(n >= 0 && n <= NOTA_MAX)) throw new Error('nota');
  const texto = String(comentario || '').replace(/\s+\n/g, '\n').trim().slice(0, MAX_COMENTARIO);
  const valor = JSON.stringify({
    nota: n,
    comentario: texto,
    autoriza: !!autoriza && !!texto,
    status: 'nova',               // nova → aprovada | oculta (na aba Pesquisa)
    nome: matricula.aluno.nome,
    nomePublico: nomePublico(matricula.aluno.nome),
    alunoId: matricula.alunoId,
    curso: matricula.turma.curso.nome,
    cursoId: matricula.turma.cursoId,
    turmaId: matricula.turmaId,
    inicioTurma: matricula.turma.inicioPrevisto,
    respondidaEm: new Date().toISOString(),
  });
  try {
    await prisma.configuracao.create({ data: { chave: 'pesquisa:resp:' + matricula.id, valor } });
  } catch (e) {
    if (e.code === 'P2002') return false;
    throw e;
  }
  return true;
}

// Aprovar / ocultar (aba Pesquisa). Só comentário autorizado pode ir para o site.
async function mudarStatus(matriculaId, status, quem) {
  const r = await lerResposta(matriculaId);
  if (!r) return null;
  if (status === 'aprovada' && !(r.autoriza && r.comentario)) return null;
  const valor = JSON.stringify({ ...r, status, revisadoPor: quem, revisadoEm: new Date().toISOString() });
  await prisma.configuracao.update({ where: { chave: 'pesquisa:resp:' + matriculaId }, data: { valor } });
  cacheSite = null;
  return status;
}

// Depoimentos da home: só com a seção ligada; guardados 60 s em memória.
let cacheSite = null;
async function depoimentosDoSite() {
  if (cacheSite && Date.now() - cacheSite.em < 60000) return cacheSite.lista;
  let lista = [];
  try {
    const cfg = await lerConfig();
    if (cfg.mostrarNoSite) {
      lista = (await listarRespostas())
        .filter((r) => r.status === 'aprovada' && r.autoriza && r.comentario)
        .slice(0, 6)
        .map((r) => ({ nome: r.nomePublico, curso: r.curso, nota: r.nota, comentario: r.comentario }));
    }
  } catch (e) {
    console.error('[PESQUISA] depoimentos:', e.message);
  }
  cacheSite = { em: Date.now(), lista };
  return lista;
}

// ── envio automático ───────────────────────────────────────────────────────
async function enviarPendentes({ simular = false } = {}) {
  const { enviarPesquisaSatisfacao } = require('./email');
  const enviados = [];
  try {
    const agora = Date.now();
    const turmas = await prisma.turma.findMany({
      where: { status: { not: 'CANCELADA' }, inicioPrevisto: { gte: new Date(agora - 180 * 24 * 3600000), lte: new Date(agora) } },
      include: { curso: { select: { nome: true } }, aulas: true },
    });
    const prontas = turmas.filter((t) => {
      const fim = fimDaTurma(t).getTime();
      return agora >= fim + ESPERA_MS && agora - fim <= JANELA_MS;
    });
    for (const turma of prontas) {
      const matriculas = await prisma.matricula.findMany({
        where: { turmaId: turma.id, taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO'] } },
        include: { aluno: { select: { nome: true, email: true } } },
      });
      for (const m of matriculas) {
        if (!m.aluno || !m.aluno.email) continue;
        if (simular) { enviados.push(m.id); continue; }
        const chave = 'pesquisa:envio:' + m.id;
        try {
          await prisma.configuracao.create({ data: { chave, valor: new Date().toISOString() } }); // reserva
        } catch (e) {
          if (e.code === 'P2002') continue; // já enviada (ou outro serviço enviando agora)
          throw e;
        }
        try {
          await enviarPesquisaSatisfacao(m.aluno.email, String(m.aluno.nome).split(' ')[0], { curso: turma.curso.nome, link: link(m.id) });
          enviados.push(m.id);
        } catch (e) {
          await prisma.configuracao.deleteMany({ where: { chave } }); // tenta de novo na próxima passada
          console.error('[PESQUISA] falha ao enviar', m.id, e.message);
        }
      }
    }
    if (enviados.length) console.log(`[PESQUISA] ${enviados.length} pesquisa(s) ${simular ? 'seriam enviadas' : 'enviada(s)'}.`);
  } catch (e) {
    console.error('[PESQUISA] passada falhou:', e.message);
  }
  return enviados;
}

module.exports = {
  token, tokenValido, link, fimDaTurma, lerConfig, salvarConfig, lerResposta, listarRespostas, contarEnvios,
  responder, mudarStatus, depoimentosDoSite, enviarPendentes, nomePublico, MAX_COMENTARIO, NOTA_MAX, ROTULOS,
};
