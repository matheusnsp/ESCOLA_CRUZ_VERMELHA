// lib/escola-digital-vitrine.js
//
// Vitrine estilo Netflix da Escola Digital (fase 1, 2026-11-09): o destaque do topo, a linha "Continue de onde
// parou" (só aluno com curso em andamento), os cursos e os gratuitos. A lista pública vem do cache do catálogo;
// o que depende de quem está vendo ("Você já tem", "Continue") é calculado aqui, por pessoa.
// Spec: docs/superpowers/specs/2026-11-09-escola-digital-vitrine.md §1

const escolaDigital = require('./escola-digital');
const { meusCursosOnline } = require('./ead-meus-cursos');

const SITUACOES_CONTINUAR = ['novo', 'andamento'];

// "Descrição longa..." → até `max` caracteres, cortada no espaço, com reticências.
function resumo(texto, max = 160) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max + 1).lastIndexOf(' ');
  return `${t.slice(0, corte > max * 0.6 ? corte : max).replace(/[\s,.;:!?—-]+$/, '')}…`;
}

// cursos: lista pública (cursosDaEscolaDigital); usuario: { id, papel } ou null.
async function montarVitrine(cursos, usuario) {
  let meus = [];
  if (usuario && usuario.id && usuario.papel === 'ALUNO') {
    meus = await meusCursosOnline(usuario.id).catch((e) => { console.error('[ESCOLA DIGITAL] vitrine, meus cursos:', e.message); return []; });
  }
  const liberados = new Set(meus.filter((m) => !['pendente', 'cancelado'].includes(m.situacao)).map((m) => m.cursoId));
  const lista = cursos.map((c) => ({ ...c, jaTem: liberados.has(c.id), resumo: resumo(c.descricao) }));
  const idDestaque = await escolaDigital.lerDestaque();
  const destaque = lista.find((c) => c.online && c.online.cursoOnlineId === idDestaque) || lista[0] || null;
  const continuar = meus.filter((m) => SITUACOES_CONTINUAR.includes(m.situacao));
  return { destaque, continuar, cursos: lista, gratuitos: lista.filter((c) => c.online && c.online.gratis) };
}

module.exports = { montarVitrine, resumo };
