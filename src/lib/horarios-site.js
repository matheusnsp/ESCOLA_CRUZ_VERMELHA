// lib/horarios-site.js
//
// Dias e horários dos alunos, respondidos no site (cruzvermelhariodejaneiro.org) depois de pagar
// a inscrição. As respostas moram no banco do site; a aba "Horários" do painel lê de lá, servidor
// a servidor, pelo endereço api/escola-horarios.php do site, com a chave ESCOLA_HORARIOS_TOKEN
// (o mesmo nome e o mesmo valor do api/config-escola.php do site; SITE_HORARIOS_TOKEN, o nome
// antigo, ainda vale). Nada disso grava no banco da escola.
//
// O site nunca manda CPF. Cada resposta traz o curso pelo id da escola (curso_id = Curso.id),
// o que deixa cruzar com as turmas daqui.

const URL_PADRAO = 'https://cruzvermelhariodejaneiro.org/matricula-cursos-presenciais/api/escola-horarios.php';
const TEMPO_LIMITE_MS = 10000;
const CACHE_MS = 60 * 1000;

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const PERIODOS = ['manha', 'tarde', 'noite'];
const SLOTS = DIAS.flatMap((d) => PERIODOS.map((p) => `${d}-${p}`));

// Rótulos de reserva, iguais aos do site, para a tela não quebrar se a resposta vier sem eles.
const ROTULOS_PADRAO = {
  dias: { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado' },
  dias_curtos: { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb' },
  periodos: { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' },
  horas: { manha: '8h às 12h', tarde: '13h às 17h', noite: '18h às 22h' },
  inicio: { proxima: 'Já na próxima turma', '1mes': 'Daqui a cerca de 1 mês', '2meses': 'Daqui a 2 meses ou mais' },
  turma: { sim: 'Sim, a data funciona', nao: 'Não, preciso de outra data' },
};

// A chave, sem aspas nem espaços colados sem querer no painel do Render.
function chave() {
  const bruta = process.env.ESCOLA_HORARIOS_TOKEN || process.env.SITE_HORARIOS_TOKEN || '';
  return String(bruta).trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

function configurado() {
  return chave().length >= 32;
}

// Os 4 últimos caracteres da chave, para a tela de erro: dá para comparar com a do site sem mostrá-la.
function finalDaChave() {
  const c = chave();
  return c.length >= 32 ? c.slice(-4) : null;
}

let cache = null; // { em, dados }

// Busca no site. Devolve { ok: true, dados } ou { ok: false, erro } com uma frase para a secretaria.
// Guarda por 1 minuto: abrir e filtrar a tela não gera uma chamada ao site a cada clique.
async function buscar({ forcar = false } = {}) {
  if (!configurado()) {
    return { ok: false, erro: 'nao_configurado' };
  }
  if (!forcar && cache && Date.now() - cache.em < CACHE_MS) {
    return { ok: true, dados: cache.dados };
  }
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resp = await fetch(process.env.SITE_HORARIOS_URL || URL_PADRAO, {
      headers: { Authorization: `Bearer ${chave()}`, Accept: 'application/json' },
      signal: controle.signal,
    });
    if (!resp.ok) {
      console.error(`[horarios-site] o site respondeu HTTP ${resp.status}`);
      return { ok: false, erro: resp.status === 401 || resp.status === 404 ? 'chave' : 'site' };
    }
    const dados = normalizar(await resp.json());
    cache = { em: Date.now(), dados };
    return { ok: true, dados };
  } catch (err) {
    console.error('[horarios-site] falha ao ler o site:', err.name === 'AbortError' ? 'tempo esgotado' : err.message);
    return { ok: false, erro: 'site' };
  } finally {
    clearTimeout(timer);
  }
}

const texto = (v) => (typeof v === 'string' ? v : '');
const textoOuNull = (v) => (typeof v === 'string' && v !== '' ? v : null);

// Confere o formato do que veio do site: só campos e valores conhecidos seguem para a tela.
function normalizar(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const rotulos = { ...ROTULOS_PADRAO };
  for (const chave of Object.keys(ROTULOS_PADRAO)) {
    if (b.rotulos && b.rotulos[chave] && typeof b.rotulos[chave] === 'object') rotulos[chave] = { ...ROTULOS_PADRAO[chave], ...b.rotulos[chave] };
  }
  const aluno = (l) => ({
    inscricaoId: Number(l.inscricao_id) || 0,
    cursoId: textoOuNull(l.curso_id),
    cursoSlug: texto(l.curso_slug),
    cursoNome: texto(l.curso_nome),
    nome: texto(l.nome),
    email: texto(l.email),
    telefone: texto(l.telefone).replace(/\D/g, ''),
    pagoEm: textoOuNull(l.pago_em),
    matriculaId: textoOuNull(l.matricula_id),
    turmaInicio: /^\d{4}-\d{2}-\d{2}$/.test(texto(l.turma_inicio)) ? l.turma_inicio : null,
  });
  const lista = (v) => (Array.isArray(v) ? v.filter((l) => l && typeof l === 'object') : []);
  return {
    geradoEm: textoOuNull(b.gerado_em),
    rotulos,
    respostas: lista(b.respostas).map((l) => ({
      ...aluno(l),
      horarios: SLOTS.filter((s) => Array.isArray(l.horarios) && l.horarios.includes(s)),
      inicio: rotulos.inicio[l.inicio] ? l.inicio : null,
      turmaServe: l.turma_serve === 'sim' || l.turma_serve === 'nao' ? l.turma_serve : null,
      observacao: textoOuNull(l.observacao),
      vezes: Number(l.vezes) || 1,
      respondidoEm: textoOuNull(l.respondido_em),
    })),
    semResposta: lista(b.sem_resposta).map(aluno),
  };
}

// Cursos que aparecem nas respostas ou em quem falta, com a contagem de cada lado.
function cursos(dados) {
  const mapa = new Map();
  const somar = (l, campo) => {
    const chave = l.cursoId || l.cursoSlug;
    if (!chave) return;
    if (!mapa.has(chave)) mapa.set(chave, { chave, cursoId: l.cursoId, nome: l.cursoNome || l.cursoSlug, respostas: 0, faltam: 0 });
    mapa.get(chave)[campo]++;
  };
  dados.respostas.forEach((l) => somar(l, 'respostas'));
  dados.semResposta.forEach((l) => somar(l, 'faltam'));
  return [...mapa.values()].sort((a, b) => b.respostas - a.respostas || a.nome.localeCompare(b.nome, 'pt-BR'));
}

const doCurso = (chave) => (l) => !chave || l.cursoId === chave || (!l.cursoId && l.cursoSlug === chave);

// Mapa de disponibilidade: para cada período e dia, quantos marcaram aquele horário; mais o começo,
// "a data serve" e os horários mais pedidos. Mesma conta do portal do site (mcp_horarios_mapa).
function mapa(respostas) {
  const grade = Object.fromEntries(PERIODOS.map((p) => [p, Object.fromEntries(DIAS.map((d) => [d, 0]))]));
  const inicio = { proxima: 0, '1mes': 0, '2meses': 0 };
  const turma = { sim: 0, nao: 0 };
  for (const l of respostas) {
    for (const s of l.horarios) {
      const [d, p] = s.split('-');
      grade[p][d]++;
    }
    if (l.inicio && inicio[l.inicio] !== undefined) inicio[l.inicio]++;
    if (l.turmaServe) turma[l.turmaServe]++;
  }
  const contagens = SLOTS.map((s) => {
    const [d, p] = s.split('-');
    return { slot: s, n: grade[p][d] };
  });
  const maximo = Math.max(0, ...contagens.map((c) => c.n));
  const top = contagens.filter((c) => c.n > 0).sort((a, b) => b.n - a.n || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot)).slice(0, 3);
  return { grade, maximo, inicio, turma, top, total: respostas.length };
}

// "Seg à noite; Sáb de manhã".
function slotTexto(slot, rotulos) {
  const [d, p] = slot.split('-');
  const frase = { manha: 'de manhã', tarde: 'à tarde', noite: 'à noite' }[p] || '';
  return `${rotulos.dias_curtos[d] || d} ${frase}`.trim();
}
function horariosTexto(slots, rotulos) {
  return slots.map((s) => slotTexto(s, rotulos)).join('; ');
}

// Célula de planilha sem fórmula: texto que começa com = + - @ vira texto puro.
function celula(v) {
  const t = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
}

// CSV com ; e BOM (abre direto no Excel e no Google Planilhas): resumo e uma coluna por horário, com x.
function csv(respostas, rotulos) {
  const colunasSlots = SLOTS.map((s) => {
    const [d, p] = s.split('-');
    return `${rotulos.dias_curtos[d]} ${String(rotulos.periodos[p]).toLowerCase()}`;
  });
  const cab = ['Respondido em (Brasília)', 'Nome', 'E-mail', 'Telefone', 'Curso', 'Turma', 'Horários', 'Começo', 'A data da turma serve?', 'Recado', ...colunasSlots];
  const linhas = respostas.map((l) => [
    dataHoraBrt(l.respondidoEm), l.nome, l.email, telefoneBonito(l.telefone), l.cursoNome,
    l.turmaInicio ? dataBr(l.turmaInicio) : 'sem turma ainda',
    horariosTexto(l.horarios, rotulos), rotulos.inicio[l.inicio] || '', l.turmaServe ? rotulos.turma[l.turmaServe] : '', l.observacao || '',
    ...SLOTS.map((s) => (l.horarios.includes(s) ? 'x' : '')),
  ]);
  const aspas = (v) => {
    const t = celula(v);
    return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + [cab, ...linhas].map((l) => l.map(aspas).join(';')).join('\r\n') + '\r\n';
}

function dataBr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function dataHoraBrt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}
function telefoneBonito(dig) {
  const d = String(dig || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

module.exports = {
  buscar, configurado, finalDaChave, normalizar, cursos, doCurso, mapa, csv, celula,
  slotTexto, horariosTexto, dataBr, dataHoraBrt, telefoneBonito,
  DIAS, PERIODOS, SLOTS, ROTULOS_PADRAO,
  _limparCache: () => { cache = null; },
};
