// lib/ia-textos.js
//
// Escrever com IA (2026-11-09): o Claude escreve a descrição, o conteúdo programático e as dúvidas frequentes do
// curso, no padrão de 3 cursos que já estão no site. O botão só preenche o formulário; nada é salvo até "Salvar".
// Spec: docs/superpowers/specs/2026-11-09-ia-textos-curso.md

const prisma = require('../db');
const E = require('./ead-ia-esquema');

let clienteFixo = null; // testes fixam um cliente falso
const definirCliente = (c) => { clienteFixo = c || null; };
const clienteDe = (o) => (o && o.cliente) || clienteFixo || require('./ead-ia').clientePadrao();

const SYSTEM = `Você escreve os textos dos cursos da Escola de Educação e Saúde da Cruz Vermelha Brasileira (Rio de Janeiro).
Siga o padrão dos cursos de exemplo: mesmo tom, tamanho e formato.
Regras:
- português do Brasil, linguagem clara e acolhedora, sem exageros de marketing;
- nunca cite preço, valores ou formas de pagamento (eles mudam e já aparecem na página);
- curso online é teórico: não prometa prática em manequim nem aula presencial;
- o certificado só sai ao concluir o curso;
- não invente leis, normas ou números que não estejam nos dados;
- dúvidas frequentes: 5 ou 6, sobre o que o aluno costuma perguntar (para quem é, pré-requisito, carga horária, como funciona, certificado), com respostas curtas e corretas para este curso.`;

// Até 3 cursos de exemplo do mesmo tipo (sem o próprio curso).
async function exemplos(tipo, excetoCursoId) {
  const faqs = { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], take: 6, select: { pergunta: true, resposta: true } };
  if (tipo === 'online') {
    const cos = await prisma.cursoOnline.findMany({
      where: { publicado: true, somenteOnline: true, ...(excetoCursoId ? { cursoId: { not: excetoCursoId } } : {}) },
      include: { curso: { select: { nome: true, descricao: true, faqs } } }, orderBy: { atualizadoEm: 'desc' }, take: 3,
    });
    return cos.map((c) => ({ nome: c.curso.nome, descricao: c.curso.descricao, faqs: c.curso.faqs }));
  }
  const cursos = await prisma.curso.findMany({
    where: { ativo: true, descricaoLonga: { not: null }, ...(excetoCursoId ? { id: { not: excetoCursoId } } : {}) },
    select: { id: true, nome: true, descricao: true, descricaoLonga: true, faqs }, orderBy: { criadoEm: 'desc' }, take: 3,
  });
  const extras = await require('./extras').lerExtras('curso', cursos.map((c) => c.id)).catch(() => ({}));
  return cursos.map((c) => ({ nome: c.nome, descricao: c.descricao, descricaoLonga: c.descricaoLonga, conteudoProgramatico: (extras[c.id] || {}).conteudoProgramatico || null, faqs: c.faqs }));
}

function blocoExemplo(e, i) {
  return [`Exemplo ${i + 1}: ${e.nome}`, e.descricao ? `Descrição: ${e.descricao}` : null, e.descricaoLonga ? `Descrição longa:\n${e.descricaoLonga}` : null,
    e.conteudoProgramatico ? `Conteúdo programático:\n${e.conteudoProgramatico}` : null,
    e.faqs && e.faqs.length ? `Dúvidas:\n${e.faqs.map((f) => `- ${f.pergunta} — ${f.resposta}`).join('\n')}` : null].filter(Boolean).join('\n');
}

// tipo 'presencial' | 'online'; dados: o que está no formulário. Devolve { textos, usage }.
async function escrever({ tipo, dados = {}, ideias = '', cursoId = null }, opts = {}) {
  const IA = require('./ead-ia');
  const ex = await exemplos(tipo, cursoId);
  const curso = [`Curso a escrever (${tipo === 'online' ? '100% online, teórico' : 'presencial, no Centro do Rio'}): ${dados.nome || '(sem nome)'}`,
    dados.cargaHoraria ? `Carga horária: ${dados.cargaHoraria} horas` : null, dados.escolaridade ? `Escolaridade mínima: ${dados.escolaridade}` : null,
    dados.categoria ? `Área: ${dados.categoria}` : null, dados.descricao ? `Descrição atual: ${dados.descricao}` : null,
    dados.descricaoLonga ? `Descrição longa atual:\n${dados.descricaoLonga}` : null, dados.conteudoProgramatico ? `Conteúdo atual:\n${dados.conteudoProgramatico}` : null,
    String(ideias || '').trim() ? `Ideias de quem pediu: ${String(ideias).trim().slice(0, 500)}` : null].filter(Boolean).join('\n');
  const pede = tipo === 'online'
    ? 'Escreva a descrição da página de venda (até 1000 caracteres, 1 a 3 parágrafos curtos) e as dúvidas frequentes.'
    : 'Escreva a descrição curta (1 ou 2 frases, até 300 caracteres), a descrição longa (parágrafos, até 3000), o conteúdo programático (um item por linha) e as dúvidas frequentes.';
  const content = [
    ...(ex.length ? [{ type: 'text', text: `Cursos de exemplo (siga este padrão):\n\n${ex.map(blocoExemplo).join('\n\n')}` }] : []),
    { type: 'text', text: `${curso}\n\n${pede}` },
  ];
  const { json, usage } = await IA.chamarClaude(clienteDe(opts), {
    system: SYSTEM, messages: [{ role: 'user', content }], schema: tipo === 'online' ? E.ESQUEMA_TEXTOS_ONLINE : E.ESQUEMA_TEXTOS_PRESENCIAL, effort: 'low',
  });
  return { textos: E.validarTextos(json, tipo), usage };
}

// Dúvidas marcadas no formulário (faqsIa[i][usar|pergunta|resposta]).
function lerFaqsDoForm(body) {
  const v = body && body.faqsIa;
  const lista = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  return E.limparFaqs(lista.filter((f) => f && String(f.usar) === '1'));
}

// Acrescenta as dúvidas ao curso, depois das que já existem, sem repetir pergunta. Devolve quantas entraram.
async function salvarFaqs(cursoId, faqs, { tx = prisma } = {}) {
  const atuais = await tx.faqCurso.findMany({ where: { cursoId }, select: { pergunta: true } });
  const vistas = new Set(atuais.map((f) => E.semAcento(f.pergunta)));
  let ordem = atuais.length; let n = 0;
  for (const f of E.limparFaqs(faqs, 50)) {
    if (vistas.has(E.semAcento(f.pergunta))) continue;
    vistas.add(E.semAcento(f.pergunta));
    await tx.faqCurso.create({ data: { cursoId, pergunta: f.pergunta, resposta: f.resposta, ordem: ordem++ } });
    n++;
  }
  return n;
}

module.exports = { SYSTEM, exemplos, escrever, lerFaqsDoForm, salvarFaqs, definirCliente };
