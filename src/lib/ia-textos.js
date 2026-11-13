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

// 2026-11-13: modelo do texto completo dos cursos presenciais, dado pela secretaria. Todo curso novo segue esta
// estrutura de 3 parágrafos (o que o curso forma; o que o aluno aprende; onde vai poder atuar).
const MODELO_TEXTO_COMPLETO = `O Curso de Cuidador de Idosos da Cruz Vermelha forma profissionais capacitados para prestar assistência à pessoa idosa com segurança, responsabilidade, empatia e respeito, promovendo qualidade de vida e bem-estar em diferentes contextos de cuidado.

Durante a formação, o aluno desenvolve conhecimentos teóricos e práticos sobre higiene, alimentação, administração da rotina de cuidados, prevenção de acidentes, técnicas de mobilização, noções de primeiros socorros, além de compreender os aspectos físicos, emocionais e sociais do processo de envelhecimento, proporcionando um atendimento mais humanizado.

Após a conclusão, o profissional poderá atuar em residências, instituições de longa permanência para idosos (ILPIs), clínicas, hospitais, centros de convivência, serviços de atendimento domiciliar e demais ambientes voltados ao cuidado e à assistência da pessoa idosa.`;

const PEDE_TEXTO_COMPLETO = `A descrição longa (texto completo) tem SEMPRE 3 parágrafos, separados por uma linha em branco, nesta estrutura:
1º "O Curso de <nome do curso> da Cruz Vermelha forma profissionais capacitados para <o que a pessoa vai fazer>, <com que postura>, promovendo <o resultado para quem é atendido>." (ajuste o começo quando o curso não forma profissionais, ex.: "capacita pessoas para");
2º "Durante a formação, o aluno desenvolve conhecimentos teóricos e práticos sobre <os principais temas do curso>, além de <um aspecto complementar>, <o benefício disso>.";
3º "Após a conclusão, o profissional poderá atuar em <lugares e serviços onde vai trabalhar>." (ou, se não for profissionalizante, onde vai poder aplicar o que aprendeu).
Siga o mesmo tom e tamanho deste modelo (vale mais que os exemplos abaixo):

${MODELO_TEXTO_COMPLETO}`;

// Uma linha em branco entre parágrafos (o site separa os parágrafos assim).
const emParagrafos = (t) => String(t || '').replace(/\r\n/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean).join('\n\n');

// Até 3 cursos de exemplo do mesmo tipo (sem o próprio curso).
async function exemplos(tipo, excetoCursoId) {
  const faqs = { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], take: 6, select: { pergunta: true, resposta: true } };
  if (tipo === 'ebook') {
    const ebs = await prisma.ebook.findMany({
      where: { publicado: true, ...(excetoCursoId ? { cursoId: { not: excetoCursoId } } : {}) },
      include: { curso: { select: { nome: true, descricao: true, descricaoLonga: true, faqs } } }, orderBy: { atualizadoEm: 'desc' }, take: 3,
    });
    return ebs.map((e) => ({ nome: e.curso.nome, descricao: e.curso.descricao, descricaoLonga: e.curso.descricaoLonga, faqs: e.curso.faqs }));
  }
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

// tipo 'presencial' | 'online' | 'ebook'; dados: o que está no formulário. pdf (só e-book): Buffer com as primeiras
// páginas, mandado ao Claude como documento para ele não inventar o conteúdo. Devolve { textos, usage }.
async function escrever({ tipo, dados = {}, ideias = '', cursoId = null, pdf = null }, opts = {}) {
  const IA = require('./ead-ia');
  const ex = await exemplos(tipo, cursoId);
  const qual = tipo === 'ebook' ? 'E-book (PDF) a descrever' : `Curso a escrever (${tipo === 'online' ? '100% online, teórico' : 'presencial, no Centro do Rio'})`;
  const curso = [`${qual}: ${dados.nome || '(sem nome)'}`,
    dados.cargaHoraria ? `Carga horária: ${dados.cargaHoraria} horas` : null, dados.escolaridade ? `Escolaridade mínima: ${dados.escolaridade}` : null,
    dados.categoria ? `Área: ${dados.categoria}` : null, dados.descricao ? `Descrição atual: ${dados.descricao}` : null,
    dados.descricaoLonga ? `Descrição longa atual:\n${dados.descricaoLonga}` : null, dados.conteudoProgramatico ? `Conteúdo atual:\n${dados.conteudoProgramatico}` : null,
    Array.isArray(dados.faqsAtuais) && dados.faqsAtuais.length ? `Dúvidas que o curso já tem (não repita):\n${dados.faqsAtuais.map((f) => `- ${f.pergunta}`).join('\n')}` : null,
    String(ideias || '').trim() ? `Ideias de quem pediu: ${String(ideias).trim().slice(0, 1500)}` : null].filter(Boolean).join('\n');
  const pede = tipo === 'ebook'
    ? `Escreva a descrição curta (1 ou 2 frases, até 300 caracteres), o texto da página de venda (até 3000, parágrafos curtos: o que a pessoa vai encontrar, para quem é) e 5 ou 6 dúvidas frequentes sobre o e-book (para quem é, como recebe, se tem certificado: não tem). ${pdf ? 'Baseie-se SÓ no conteúdo do PDF anexado (as primeiras páginas).' : 'Sem o PDF, não invente o conteúdo: fale do tema de forma geral.'}`
    : tipo === 'online'
    ? 'Escreva a descrição da página de venda (até 1000 caracteres, 1 a 3 parágrafos curtos) e as dúvidas frequentes.'
    : `Escreva a descrição curta (1 ou 2 frases, até 300 caracteres), a descrição longa (até 3000), o conteúdo programático (um item por linha) e as dúvidas frequentes.\n\n${PEDE_TEXTO_COMPLETO}`;
  const content = [
    ...(pdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } }] : []),
    ...(ex.length ? [{ type: 'text', text: `${tipo === 'ebook' ? 'E-books' : 'Cursos'} de exemplo (siga este padrão):\n\n${ex.map(blocoExemplo).join('\n\n')}` }] : []),
    { type: 'text', text: `${curso}\n\n${pede}` },
  ];
  const { json, usage } = await IA.chamarClaude(clienteDe(opts), {
    system: SYSTEM, messages: [{ role: 'user', content }], schema: tipo === 'ebook' ? E.ESQUEMA_TEXTOS_EBOOK : tipo === 'online' ? E.ESQUEMA_TEXTOS_ONLINE : E.ESQUEMA_TEXTOS_PRESENCIAL, effort: 'low',
  });
  const textos = E.validarTextos(json, tipo);
  if (tipo === 'presencial' && textos.descricaoLonga) textos.descricaoLonga = emParagrafos(textos.descricaoLonga);
  return { textos, usage };
}

// "Escrever dúvidas com IA" na seção de dúvidas (curso já criado): os dados vêm do banco, com as dúvidas atuais.
async function dadosDoCurso(cursoId) {
  const c = await prisma.curso.findUnique({ where: { id: cursoId }, include: { faqs: { orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }], select: { pergunta: true } } } });
  if (!c) return null;
  const ex = await require('./extras').lerExtra('curso', c.id).catch(() => ({}));
  return { nome: c.nome, cargaHoraria: c.cargaHoraria, escolaridade: c.escolaridadeMinima, categoria: (ex && ex.categoria) || null, descricao: c.descricao, descricaoLonga: c.descricaoLonga, faqsAtuais: c.faqs };
}

// As linhas de dúvidas que vieram no formulário (marcadas ou não), para mostrar de novo depois de um erro.
function faqsDoCorpo(body) {
  const v = body && body.faqsIa;
  return (v && typeof v === 'object' ? Object.values(v) : []).slice(0, 6)
    .map((f) => ({ pergunta: String((f && f.pergunta) || '').slice(0, 200), resposta: String((f && f.resposta) || '').slice(0, 600), usar: f && String(f.usar) === '1' ? '1' : '0' }))
    .filter((f) => f.pergunta || f.resposta);
}

// Dúvidas marcadas no formulário (faqsIa[i][usar|pergunta|resposta]).
function lerFaqsDoForm(body) {
  const v = body && body.faqsIa;
  // Revisão I3: sempre Object.values (um índice gigante, faqsIa[4000000000], vira vetor esparso enorme e travaria).
  const lista = v && typeof v === 'object' ? Object.values(v) : [];
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

module.exports = { SYSTEM, MODELO_TEXTO_COMPLETO, exemplos, escrever, lerFaqsDoForm, faqsDoCorpo, dadosDoCurso, salvarFaqs, definirCliente };
