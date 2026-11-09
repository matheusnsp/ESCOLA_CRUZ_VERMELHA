// lib/ead-publicacao.js
//
// Publicação do curso online no site (etapa 4). O interruptor "Publicar no site" começa desligado e só
// liga sem pendências: preço definido, ao menos um módulo, todos validados. Depois de publicado, uma
// correção que devolve um módulo a rascunho não tira o curso do ar (o aluno já pagou); o painel avisa.

const prisma = require('../db');

// À venda: preço maior que zero, ou gratuito (Escola Digital, vitrine 2026-11-09: o grátis fica com preço 0).
const temPreco = (co) => co.gratuito === true || (co.precoOnline !== null && co.precoOnline !== undefined && Number(co.precoOnline) > 0);

// Pendências para ligar (lista vazia = pode publicar). co: { precoOnline, gratuito, modulos: [{ titulo, status }] }
function podePublicar(co) {
  const pend = [];
  if (!temPreco(co)) pend.push('Defina o preço do curso online (ou marque Gratuito).');
  const modulos = co.modulos || [];
  if (!modulos.length) pend.push('O curso não tem módulos.');
  for (const m of modulos) if (m.status !== 'VALIDADO') pend.push(`Módulo "${m.titulo}" em rascunho.`);
  return pend;
}

// Aviso do painel para o curso publicado com módulo de volta a rascunho (null se não há).
function avisoPublicado(co) {
  if (!co.publicado || !(co.modulos || []).some((m) => m.status !== 'VALIDADO')) return null;
  return 'Curso publicado com módulo em rascunho: o aluno já vê a versão nova. Revise e valide de novo.';
}

// "49,90", "49.90", "R$ 1.234,56" → número com 2 casas; null se não for um valor positivo até 99.999,99.
function lerPreco(texto) {
  let t = String(texto || '').replace(/R\$|\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(t)) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "1.234" = mil duzentos e trinta e quatro
  const v = Math.round(Number(t) * 100) / 100;
  return v > 0 && v <= 99999.99 ? v : null;
}

// Map cursoId → { preco, gratis } dos cursos online publicados, para o catálogo e a página do curso. Consulta à
// parte e sem derrubar a página: se falhar (ex.: banco sem a migração), o site sai sem o selo.
async function cursosOnlinePublicados() {
  try {
    const lista = await prisma.cursoOnline.findMany({ where: { publicado: true }, select: { cursoId: true, precoOnline: true, gratuito: true } });
    return new Map(lista.filter(temPreco).map((c) => [c.cursoId, { preco: c.gratuito ? 0 : Number(c.precoOnline), gratis: c.gratuito }]));
  } catch (e) {
    console.error('[EAD] cursos online publicados:', e.message);
    return new Map();
  }
}

// Põe curso.online = { preco, gratis } (ou null) em cada curso da lista.
async function anexarOnline(cursos) {
  const mapa = await cursosOnlinePublicados();
  for (const c of cursos) if (c) c.online = mapa.has(c.id) ? { ...mapa.get(c.id) } : null;
  return cursos;
}

module.exports = { temPreco, podePublicar, avisoPublicado, lerPreco, cursosOnlinePublicados, anexarOnline };
