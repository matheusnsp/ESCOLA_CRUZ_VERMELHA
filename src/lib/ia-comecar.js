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

module.exports = { comecarCurso, definirCliente, ESQUEMA_CURSO };
