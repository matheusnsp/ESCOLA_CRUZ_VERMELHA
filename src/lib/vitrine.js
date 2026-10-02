// lib/vitrine.js
//
// Regras de exibição do catálogo no site do aluno (home e /cursos), usadas pelas views.
//
// Categoria do curso: escolhida pela secretaria no formulário do curso e guardada nos extras
// (lib/extras.js, chave "categoria"), sem coluna nova no banco. Os botões de filtro só aparecem
// quando há cursos em pelo menos duas categorias.

const { formatBRL } = require('./matricula');

const CATEGORIAS = [
  'Emergência e primeiros socorros',
  'Formação profissional',
  'Saúde',
  'Estética',
];

// Ícone de cada área (Font Awesome 6), nos filtros e nos cards do catálogo.
const ICONES = {
  'Emergência e primeiros socorros': 'fa-heart-pulse',
  'Formação profissional': 'fa-briefcase',
  'Saúde': 'fa-stethoscope',
  'Estética': 'fa-spa',
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "R$ 180" em vez de "R$ 180,00" quando não há centavos (o card fica mais limpo).
function reais(valor) {
  return formatBRL(valor).replace(/,00$/, '');
}

function icone(categoria) {
  return ICONES[categoria] || 'fa-kit-medical';
}

// Dia, mês e ano da data no fuso de Brasília.
function partes(d) {
  return Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(d)).map((x) => [x.type, x.value]));
}

// Data da turma no fuso de Brasília: { dia: '21', mes: 'outubro', curta: '21/10' }.
function dataTurma(d) {
  const p = partes(d);
  return { dia: p.day, mes: MESES[Number(p.month) - 1], curta: `${p.day}/${p.month}` };
}

// Quanto falta para a turma começar, em dias de calendário de Brasília:
// { rotulo: 'Começa em', valor: '6 dias' }, 'amanhã' ou 'hoje'.
function quando(d) {
  const dia = (x) => { const p = partes(x); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
  const n = Math.round((dia(d) - dia(new Date())) / 86400000);
  if (n <= 0) return { rotulo: 'Começa', valor: 'hoje' };
  if (n === 1) return { rotulo: 'Começa', valor: 'amanhã' };
  return { rotulo: 'Começa em', valor: `${n} dias` };
}

// Turmas abertas de todos os cursos, da mais próxima para a mais distante: [{ curso, turma }].
function agenda(cursos, max = 8) {
  const r = [];
  for (const c of cursos) for (const t of c.turmas || []) r.push({ curso: c, turma: t });
  r.sort((a, b) => new Date(a.turma.inicioPrevisto) - new Date(b.turma.inicioPrevisto));
  return r.slice(0, max);
}

// Cursos com turma aberta primeiro (a mais próxima antes), depois os outros por nome.
function ordenar(cursos) {
  const prox = (c) => (c.turmas && c.turmas[0] ? new Date(c.turmas[0].inicioPrevisto).getTime() : Infinity);
  return [...cursos].sort((a, b) => prox(a) - prox(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Largura de cada card na grade de 12 colunas. Com destaque, o primeiro card é largo (8) ao
// lado de um normal (4); depois linhas de 3. Linha final com 2 cards → 6 + 6; com 1 → 12.
function larguras(n, destaque) {
  const r = [];
  let i = 0;
  if (destaque && n >= 2) { r.push(8, 4); i = 2; } else if (destaque && n === 1) { r.push(12); i = 1; }
  while (i < n) {
    const resta = n - i;
    if (resta >= 3 || resta === 0) { r.push(4, 4, 4); i += 3; } else if (resta === 2) { r.push(6, 6); i += 2; } else { r.push(12); i += 1; }
  }
  return r.slice(0, n);
}

// Categorias em uso, na ordem da lista acima (as desconhecidas vão no fim), com a contagem.
function categoriasEmUso(cursos) {
  const conta = new Map();
  for (const c of cursos) if (c.categoria) conta.set(c.categoria, (conta.get(c.categoria) || 0) + 1);
  const ordem = [...CATEGORIAS, ...[...conta.keys()].filter((k) => !CATEGORIAS.includes(k)).sort()];
  return ordem.filter((k) => conta.has(k)).map((k) => ({ nome: k, n: conta.get(k) }));
}

// Endereço do curso pelo nome: "Cuidador de Idosos (Curso Livre)" → /cursos/cuidador-de-idosos-curso-livre.
// O link antigo com o id (/cursos/<uuid>) continua valendo: redireciona para este (routes/cursos.js).
function slugCurso(nome) {
  return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'curso';
}
const urlCurso = (curso) => '/cursos/' + slugCurso(curso && curso.nome);

module.exports = { CATEGORIAS, icone, reais, dataTurma, quando, agenda, ordenar, larguras, categoriasEmUso, slugCurso, urlCurso };
