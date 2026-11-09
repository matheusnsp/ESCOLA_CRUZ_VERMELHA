// lib/ead-medicao.js
//
// Medição do curso online (etapa 8): os dados dos eventos de Analytics (gtag) e Pixel (fbq) e o JSON-LD do curso.
// As views só escrevem o que sai daqui, sempre por jsonSeguro (um nome com "</script>" não fecha a tag).
// Os eventos ficam na fila até o aceite de cookies (partials/rastreamento.ejs), como o resto do site.
// Nunca no link de teste: o endereço tem o código secreto.
// Spec: docs/superpowers/specs/2026-11-10-ead-lancamento.md §3

const prisma = require('../db');

const JANELA_COMPRA_MS = 24 * 3600 * 1000;
const MAX_MEDIDAS = 50;
const PAGOS = ['PAGO', 'PARCELADO'];

const jsonSeguro = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');
const valorDe = (v) => Math.round(Number(v || 0) * 100) / 100;

const dadosItem = (cursoId, nome) => ({ item_id: cursoId, item_name: nome });

function eventoInicioCompra(matricula, cursoNome, cupomCodigo) {
  const value = valorDe(matricula.valorCurso);
  const cursoId = matricula.turma.cursoId;
  const ga = { currency: 'BRL', value, ...(cupomCodigo ? { coupon: cupomCodigo } : {}), items: [dadosItem(cursoId, cursoNome)] };
  return { ga: ['begin_checkout', ga], meta: ['InitiateCheckout', { currency: 'BRL', value, content_ids: [cursoId], content_type: 'product' }] };
}

// A compra concluída: na primeira página do curso pago que a pessoa abre com a matrícula paga há menos de 24 h.
// A sessão guarda as matrículas já medidas; o id da matrícula vai como transaction_id/eventID (Google e Meta não
// contam duas vezes). Quem entrou por vaga de escola não comprou: sem evento.
async function compraParaMedir(req, co, cursoNome, acesso) {
  const m = acesso && acesso.matricula;
  if (!m || acesso.vaga || !PAGOS.includes(m.statusPagamento) || !m.confirmadaEm) return null;
  if (Date.now() - new Date(m.confirmadaEm).getTime() > JANELA_COMPRA_MS) return null;
  if (!req.session) return null;
  const medidas = Array.isArray(req.session.eadMedidas) ? req.session.eadMedidas : [];
  if (medidas.includes(m.id)) return null;
  req.session.eadMedidas = [...medidas, m.id].slice(-MAX_MEDIDAS);
  const cm = await prisma.cupomMatriculaEad.findUnique({ where: { matriculaId: m.id }, include: { cupom: { select: { codigo: true } } } }).catch(() => null);
  const value = valorDe(m.valorCurso);
  const ga = { transaction_id: m.id, currency: 'BRL', value, ...(cm ? { coupon: cm.cupom.codigo } : {}), items: [dadosItem(co.cursoId, cursoNome)] };
  return { ga: ['purchase', ga], meta: ['Purchase', { currency: 'BRL', value, content_ids: [co.cursoId], content_type: 'product' }, { eventID: m.id }] };
}

// A página não chegou a escrever o evento (redirecionou): a matrícula volta a ser "não medida" nesta sessão.
function desfazerMedida(req, matriculaId) {
  if (req.session && Array.isArray(req.session.eadMedidas)) req.session.eadMedidas = req.session.eadMedidas.filter((id) => id !== matriculaId);
}

function jsonLdCurso(co, curso, urlSite) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: curso.nome,
    description: curso.descricao || `Curso online: ${curso.nome}.`,
    provider: { '@type': 'Organization', name: 'Escola de Educação e Saúde CVB-RJ', sameAs: 'https://cruzvermelhariodejaneiro.org' },
  };
  if (co.precoOnline !== null && co.precoOnline !== undefined) {
    ld.offers = { '@type': 'Offer', price: co.gratuito ? 0 : valorDe(co.precoOnline), priceCurrency: 'BRL', category: co.gratuito ? 'Free' : 'Paid', url: `${(urlSite || '').replace(/\/+$/, '')}${require('./vitrine').urlOnline(curso)}` };
  }
  return ld;
}

module.exports = { jsonSeguro, dadosItem, eventoInicioCompra, compraParaMedir, desfazerMedida, jsonLdCurso };
