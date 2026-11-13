// lib/curso-secoes.js
//
// Telas novas de Cursos (2026-11-13; spec docs/superpowers/specs/2026-11-13-cursos-turmas-telas-design.md):
// cada seção do curso grava só os seus campos, sem tocar nos das outras. Aqui ficam as regras puras:
// quais campos são de cada seção, a leitura/validação do formulário de uma seção, o agrupamento dos campos
// que o assistente propõe e o "o que falta" dos cartões. Sem banco.

const { parseDecimal, parseInteiro } = require('./parse-form');

const ESCOLARIDADES = ['', 'Ensino Fundamental', 'Ensino Médio', 'Ensino Superior'];
const categorias = () => require('./vitrine').CATEGORIAS;

const secao = (rotulo, botao, slug, campos) => ({ rotulo, botao, caminho: (id) => `/cursos/${id}/${slug}`, campos });
const SECOES = {
  pagina: secao('Página no site', 'Salvar página', 'pagina', ['nome', 'descricao', 'descricaoLonga', 'cargaHoraria', 'escolaridadeMinima', 'categoria', 'pedido']),
  valores: secao('Valores', 'Salvar valores', 'valores', ['precoAvista', 'precoCheio', 'parcelas', 'taxaMatricula']),
  certificado: secao('Certificado', 'Salvar certificado', 'certificado', ['nomeCertificado', 'conteudoProgramatico', 'certificadoValidade']),
  publicacao: secao('Inscrição e publicação', 'Salvar', 'publicacao', ['ativo', 'exigeComprovanteSaude']),
};
const DUVIDAS = { secao: 'duvidas', rotulo: 'Dúvidas frequentes', botao: 'Adicionar as marcadas', caminho: (id) => `/cursos/${id}/duvidas` };

const texto = (v) => String(v || '').trim();
const cortado = (v, n) => texto(v).slice(0, n) || null;

// { dados (colunas do Curso), extras (lib/extras), erro } só com os campos da seção.
function lerSecao(nome, body = {}) {
  const b = body || {};
  if (nome === 'pagina') {
    const dados = {
      nome: texto(b.nome),
      descricao: texto(b.descricao) || null,
      descricaoLonga: texto(b.descricaoLonga) || null,
      cargaHoraria: parseInteiro(b.cargaHoraria, { min: 1 }),
      escolaridadeMinima: ESCOLARIDADES.includes(b.escolaridadeMinima) && b.escolaridadeMinima ? b.escolaridadeMinima : null,
    };
    const extras = { categoria: categorias().includes(b.categoria) ? b.categoria : null };
    let erro = null;
    if (!dados.nome) erro = 'Informe o nome do curso.';
    else if (Number.isNaN(dados.cargaHoraria)) erro = 'Carga horaria invalida.';
    return { dados, extras, erro };
  }
  if (nome === 'valores') {
    const dados = {
      precoAvista: parseDecimal(b.precoAvista),
      precoCheio: parseDecimal(b.precoCheio),
      parcelas: parseInteiro(b.parcelas, { min: 1 }),
      taxaMatricula: parseDecimal(b.taxaMatricula, { opcional: true }),
    };
    let erro = null;
    if (Number.isNaN(dados.precoAvista) || Number.isNaN(dados.precoCheio)) erro = 'Verifique os valores (use numeros, ex.: 150.00).';
    else if (Number.isNaN(dados.parcelas)) erro = 'Numero de parcelas invalido.';
    else if (Number.isNaN(dados.taxaMatricula)) erro = 'Taxa de inscrição inválida (deixe em branco para usar o padrão).';
    // Referência (o site calcula as parcelas na hora): parcelado ÷ parcelas, como no formulário antigo.
    if (!erro) dados.valorParcela = Math.round((Number(dados.precoCheio) / dados.parcelas) * 100) / 100;
    return { dados, extras: {}, erro };
  }
  if (nome === 'certificado') {
    return {
      dados: {},
      extras: {
        nomeCertificado: cortado(b.nomeCertificado, 120),
        conteudoProgramatico: String(b.conteudoProgramatico || '').replace(/\r\n/g, '\n').trim().slice(0, 4000) || null,
        certificadoValidade: cortado(b.certificadoValidade, 120),
      },
      erro: null,
    };
  }
  if (nome === 'publicacao') {
    return {
      dados: { ativo: b.ativo === 'on' || b.ativo === 'true' || b.ativo === true },
      extras: { exigeComprovanteSaude: b.exigeComprovanteSaude === 'on' || b.exigeComprovanteSaude === true ? true : null },
      erro: null,
    };
  }
  throw new Error(`seção desconhecida: ${nome}`);
}

// Campos propostos (assistente) -> [{ secao, rotulo, botao, campos }] na ordem das seções; dúvidas por último.
function secoesDosCampos(campos = {}) {
  const c = campos || {};
  const saida = [];
  for (const [nome, s] of Object.entries(SECOES)) {
    const daqui = Object.fromEntries(Object.entries(c).filter(([k]) => s.campos.includes(k)));
    if (Object.keys(daqui).length) saida.push({ secao: nome, rotulo: s.rotulo, botao: s.botao, campos: daqui });
  }
  if (Array.isArray(c.faqs) && c.faqs.length) saida.push({ secao: DUVIDAS.secao, rotulo: DUVIDAS.rotulo, botao: DUVIDAS.botao, campos: { faqs: c.faqs } });
  return saida;
}

// O que falta no curso (cartões do resumo e coluna "Falta" da lista).
function faltasCurso(c = {}) {
  const f = [];
  if (!c.imagemUrl) f.push('Foto');
  if (!texto(c.descricaoLonga)) f.push('Texto completo');
  if (!texto(c.conteudoProgramatico)) f.push('Conteúdo do certificado');
  if (!(Number(c.totalFaqs) > 0)) f.push('Dúvidas frequentes');
  return f;
}

// O que pede atenção na turma.
function faltasTurma(t = {}) {
  const f = [];
  if (!(Number(t.totalAulas) > 0)) f.push('Aulas');
  if (Number(t.pendentes) > 0) f.push('Pagamentos pendentes');
  const futura = t.inicioPrevisto && new Date(t.inicioPrevisto).getTime() > Date.now();
  if (futura && Number(t.minimoAlunos) > 0 && Number(t.inscritos) < Number(t.minimoAlunos)) f.push('Abaixo do mínimo');
  return f;
}

// Novo curso (3 passos + "Mais detalhes"): junta as seções num curso só. O curso nasce fora do site, a não ser que
// "Mostrar no site" venha marcado. passo = 1 (curso) ou 2 (valores) quando há erro.
function lerNovoCurso(body = {}) {
  const pag = lerSecao('pagina', body);
  const val = lerSecao('valores', body);
  const cert = lerSecao('certificado', body);
  const pub = lerSecao('publicacao', body);
  const erro = pag.erro || val.erro || null;
  return {
    dados: { ...pag.dados, ...val.dados, ...pub.dados },
    extras: { ...pag.extras, ...cert.extras, ...pub.extras },
    erro,
    passo: pag.erro ? 1 : val.erro ? 2 : null,
  };
}

module.exports = { lerNovoCurso, SECOES, DUVIDAS, ESCOLARIDADES, lerSecao, secoesDosCampos, faltasCurso, faltasTurma };
