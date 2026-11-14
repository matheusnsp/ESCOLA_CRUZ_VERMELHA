// lib/ia-comecar.js
//
// "Começar com a IA" (telas novas de Cursos e Turmas, 2026-11-13; spec docs/superpowers/specs/2026-11-13-cursos-turmas-
// telas-design.md): a pessoa escreve do jeito dela o que sabe do curso (ou da turma) e a IA propõe os campos do
// formulário. Nada é salvo: a página só preenche os campos. Tudo passa pelas mesmas validações do assistente
// (validarCurso/validarTurma); campo inválido ou que a pessoa não disse fica em branco.

const IA = require('./ead-ia');

let clienteFixo = null; // testes fixam um cliente falso
const definirCliente = (c) => { clienteFixo = c || null; };
const clienteDe = (o) => (o && o.cliente) || clienteFixo || IA.clientePadrao();

const objeto = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const texto = { type: ['string', 'null'] };
const numero = { type: ['number', 'null'] };

const SYSTEM = `Você ajuda a secretaria da Escola de Educação e Saúde da Cruz Vermelha (Rio de Janeiro) a preencher o painel.
Leia o texto da pessoa e devolva só o que ela disse. Campo que ela não disse: null. Nunca invente preço, carga horária,
datas, vagas, nomes ou registros. Valores em reais como número (900, não "R$ 900").`;

// Tira nulos e vazios antes de validar (String(null) viraria "null").
const semVazios = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));

const ESQUEMA_CURSO = objeto({
  nome: texto, cargaHoraria: numero, escolaridadeMinima: texto, categoria: texto,
  precoAvista: numero, precoCheio: numero, parcelas: numero, taxaMatricula: numero,
});

// { campos, textos, usage: [usage, usage] } — campos já validados (valores no formato do formulário).
async function comecarCurso(textoPessoa, opts = {}) {
  const t = String(textoPessoa || '').trim().slice(0, 3000);
  if (!t) throw new Error('Escreva o que você sabe do curso.');
  const { validarCurso, } = require('./assistente-ferramentas');
  const { CATEGORIAS } = require('./vitrine');
  const pede = `Áreas possíveis: ${CATEGORIAS.join('; ')}. Escolaridade: Ensino Fundamental, Ensino Médio ou Ensino Superior.\n\nTexto da pessoa:\n${t}`;
  const { json, usage } = await IA.chamarClaude(clienteDe(opts), { system: SYSTEM, messages: [{ role: 'user', content: pede }], schema: ESQUEMA_CURSO, effort: 'low' });
  const { ok } = validarCurso(semVazios(json));
  const txt = require('./ia-textos');
  const dados = { nome: ok.nome || '(sem nome)', cargaHoraria: ok.cargaHoraria || null, escolaridade: ok.escolaridadeMinima || null, categoria: ok.categoria || null };
  const r = await txt.escrever({ tipo: 'presencial', dados, ideias: t }, opts.cliente ? { cliente: opts.cliente } : {});
  return { campos: ok, textos: r.textos, usage: [usage, r.usage] };
}

const ESQUEMA_TURMA = objeto({
  cursoNome: texto, inicioPrevisto: texto,
  aulas: { type: 'array', items: objeto({ data: { type: 'string' }, horario: { type: 'string' } }) },
  vagas: numero, minimoAlunos: numero, instrutorNome: texto, instrutorRegistro: texto,
});

// Curso pelo nome: igual (sem acento) ganha; senão o de maior nota (>= 0.8). Empate na melhor nota: em branco,
// para não escolher o curso errado sem a pessoa perceber.
function escolherCurso(cursos, nome) {
  const F = require('./assistente-ferramentas');
  const alvo = F.normalizar(nome);
  if (!alvo) return null;
  const iguais = cursos.filter((c) => F.normalizar(c.nome) === alvo);
  if (iguais.length) return iguais.length === 1 ? iguais[0] : null;
  const notas = cursos.map((c) => ({ c, n: F.pontuarNome(alvo, c.nome) })).filter((x) => x.n >= 0.8).sort((a, b) => b.n - a.n);
  if (!notas.length || (notas[1] && notas[1].n === notas[0].n)) return null;
  return notas[0].c;
}

const dataOk = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return false; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCMonth() === +m[2] - 1; };

// { campos, usage } — campos da Nova turma já validados; o curso é achado pelo nome entre os presenciais.
async function comecarTurma(textoPessoa, opts = {}) {
  const t = String(textoPessoa || '').trim().slice(0, 3000);
  if (!t) throw new Error('Escreva como é a turma.');
  const prisma = require('../db');
  const { semSoOnline } = require('./ead-curso-online');
  const F = require('./assistente-ferramentas');
  const cursos = await semSoOnline(await prisma.curso.findMany({ where: { ebook: null, webinario: null }, select: { id: true, nome: true } }));
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const pede = `Hoje é ${hoje}. Datas no formato AAAA-MM-DD; horário "HH:MM – HH:MM". Para "toda terça e quinta de dezembro", liste cada aula.\n`
    + `Cursos que existem: ${cursos.map((c) => c.nome).join('; ')}.\n\nTexto da pessoa:\n${t}`;
  const { json, usage } = await IA.chamarClaude(clienteDe(opts), { system: SYSTEM, messages: [{ role: 'user', content: pede }], schema: ESQUEMA_TURMA, effort: 'low' });
  const j = json || {};
  // Curso: igual ao nome (sem acento) ou muito parecido.
  const curso = escolherCurso(cursos, j.cursoNome);
  const { normalizarHorario } = require('../public/js/gerar-aulas');
  const aulas = (Array.isArray(j.aulas) ? j.aulas : []).slice(0, 60)
    .map((a) => ({ data: a && a.data, horario: normalizarHorario(a && a.horario) }))
    .filter((a) => dataOk(a.data) && a.horario);
  const base = semVazios({ cursoId: curso ? curso.id : null, inicioPrevisto: dataOk(j.inicioPrevisto) ? j.inicioPrevisto : null, vagas: j.vagas, minimoAlunos: j.minimoAlunos, instrutorNome: j.instrutorNome, instrutorRegistro: j.instrutorRegistro });
  const { ok } = await F.validarTurma(base);
  delete ok.cursoNome;
  if (aulas.length) ok.aulas = aulas;
  return { campos: ok, usage };
}

module.exports = { escolherCurso, comecarCurso, comecarTurma, definirCliente, ESQUEMA_CURSO, ESQUEMA_TURMA };
