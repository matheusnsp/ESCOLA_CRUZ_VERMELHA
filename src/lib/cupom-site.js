// lib/cupom-site.js
//
// Faixa do cupom no site (2026-11-17; spec docs/superpowers/specs/2026-11-17-cupom-valor-final-design.md).
// Os cupons marcados "Mostrar no site" aparecem nos cards, em "Próximas turmas" e nas turmas do curso, e entram
// sozinhos na inscrição. Vários no mesmo curso: o que deixa mais barato. Nunca vai para o cache do catálogo:
// o "restam" muda a cada inscrição.

const prisma = require('../db');
const cupons = require('./ead-cupom');
const { taxaExibicao } = require('./matricula');
const { reais } = require('./vitrine');

function textoFaixa({ codigo, total, restam = null, validoAte = null }) {
  const preco = Number(total) > 0 ? `${reais(total)} com tudo incluso` : 'grátis, com tudo incluso';
  let fim = '';
  if (restam !== null && restam !== undefined) fim = restam === 1 ? ' · só resta 1 cupom' : restam <= 5 ? ` · só restam ${restam} cupons` : ` · restam ${restam} cupons`;
  else if (validoAte) fim = ` · até ${new Date(validoAte).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })}`;
  return `Com o cupom ${codigo}: ${preco}${fim}`;
}

// cursos: com id, precoAvista e taxaMatricula. Devolve Map cursoId → { codigo, total, restam, validoAte, texto }.
async function cuponsDoSite(cursos, cfgMap, agora = new Date()) {
  const mapa = new Map();
  if (!cursos || !cursos.length) return mapa;
  const lista = (await prisma.cupomEad.findMany({ where: { ativo: true, noSite: true }, orderBy: { criadoEm: 'asc' } }))
    .filter((c) => !c.validoAte || cupons.fimDoDiaRio(c.validoAte) >= agora);
  if (!lista.length) return mapa;
  const comLimite = lista.filter((c) => c.limiteUsos !== null);
  const usos = comLimite.length ? await cupons.contarParaLimite(comLimite.map((c) => c.id)) : new Map();
  const disponiveis = lista
    .map((c) => ({ c, q: cupons.restamDoCupom(c, usos.get(c.id) || 0) }))
    .filter(({ q }) => !q || q.restam > 0);
  for (const curso of cursos) {
    const preco = Number(curso.precoAvista) || 0;
    const taxa = Number(taxaExibicao(curso, cfgMap)) || 0;
    let melhor = null;
    for (const { c, q } of disponiveis) {
      if (!cupons.valeNoPresencial(c, curso)) continue;
      const final = cupons.calcularDesconto(c, preco).precoFinal;
      const taxaC = c.tipo === 'FINAL' && c.taxaFinal !== null ? Math.min(Number(c.taxaFinal), taxa) : taxa;
      const total = Math.round((final + taxaC) * 100) / 100;
      if (total >= preco + taxa) continue; // não deixa mais barato
      if (!melhor || total < melhor.total) melhor = { codigo: c.codigo, total, restam: q ? q.restam : null, validoAte: c.validoAte };
    }
    if (melhor) mapa.set(curso.id, { ...melhor, texto: textoFaixa(melhor) });
  }
  return mapa;
}

// O cupom do site de um curso (para aplicar sozinho na inscrição), ou null.
async function cupomDoSiteDoCurso(curso) {
  const cfgMap = await require('./matricula').lerConfigMatricula();
  return (await cuponsDoSite([curso], cfgMap)).get(curso.id) || null;
}

module.exports = { textoFaixa, cuponsDoSite, cupomDoSiteDoCurso };
