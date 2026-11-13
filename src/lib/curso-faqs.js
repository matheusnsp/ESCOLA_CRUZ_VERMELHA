// lib/curso-faqs.js — editar e mudar a ordem das dúvidas frequentes do curso (telas novas, 2026-11-13).
// A ordem do site é FaqCurso.ordem (desempate por criadoEm). Dúvidas antigas podem ter ordens repetidas:
// antes de mover, a lista é renumerada 0..n-1 na ordem em que aparece hoje.
const prisma = require('../db');

const ORDEM = [{ ordem: 'asc' }, { criadoEm: 'asc' }];

async function moverFaq(cursoId, faqId, direcao) {
  if (direcao !== 'subir' && direcao !== 'descer') return false;
  return prisma.$transaction(async (tx) => {
    const lista = await tx.faqCurso.findMany({ where: { cursoId }, orderBy: ORDEM, select: { id: true, ordem: true } });
    const i = lista.findIndex((f) => f.id === faqId);
    const j = direcao === 'subir' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= lista.length) return false;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    for (let k = 0; k < lista.length; k++) {
      if (lista[k].ordem !== k) await tx.faqCurso.update({ where: { id: lista[k].id }, data: { ordem: k } });
    }
    return true;
  });
}

async function editarFaq(cursoId, faqId, { pergunta, resposta } = {}) {
  const p = String(pergunta || '').trim().slice(0, 200);
  const r = String(resposta || '').trim().slice(0, 1000);
  if (!p || !r) return { ok: false, erro: 'Preencha a pergunta e a resposta.' };
  const faq = await prisma.faqCurso.findUnique({ where: { id: String(faqId || '') } }).catch(() => null);
  if (!faq || faq.cursoId !== cursoId) return { ok: false, erro: 'Dúvida não encontrada.' };
  await prisma.faqCurso.update({ where: { id: faq.id }, data: { pergunta: p, resposta: r } });
  return { ok: true };
}

module.exports = { moverFaq, editarFaq, ORDEM };
