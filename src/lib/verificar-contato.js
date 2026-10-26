// ============================================================
//  Verificação simples de contato (planilha da aba Integração)
//
//  E-mail: confere o formato e se o domínio (gmail.com, hotmail.com…) existe e
//  recebe e-mail (registro MX no DNS). Não dá para saber se a caixa existe sem
//  mandar mensagem. Celular: DDD válido e 9 dígitos. Não dá para saber se o
//  número tem WhatsApp: o WhatsApp não oferece essa consulta.
//
//  O DNS pode estar bloqueado no servidor. Antes de dizer que um domínio não
//  existe, confere com um domínio que com certeza existe (gmail.com); se nem
//  esse responde, tudo fica como "Não verificado" em vez de "Não".
// ============================================================
const dns = require('dns').promises;

const REGEX_EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]{2,})$/;
const CACHE_MS = 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 3000;
const DOMINIO_CONTROLE = 'gmail.com';

// DDDs em uso no Brasil (Anatel).
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const cacheDominios = new Map(); // domínio → { recebe: true | false | null, em }
let controle = { ok: null, em: 0 };

function comTempoLimite(promessa) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), TEMPO_LIMITE_MS)),
  ]);
}

// true: recebe e-mail; false: o domínio não existe ou não recebe; null: não deu para verificar.
async function consultarMx(dominio) {
  try {
    const mx = await comTempoLimite(dns.resolveMx(dominio));
    return mx.length > 0;
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return false;
    return null;
  }
}

async function dnsFunciona() {
  if (controle.ok !== null && Date.now() - controle.em < 60 * 60 * 1000) return controle.ok;
  controle = { ok: (await consultarMx(DOMINIO_CONTROLE)) === true, em: Date.now() };
  return controle.ok;
}

async function dominioRecebeEmail(dominio) {
  const d = dominio.toLowerCase();
  const guardado = cacheDominios.get(d);
  if (guardado && Date.now() - guardado.em < CACHE_MS && guardado.recebe !== null) return guardado.recebe;
  if (!(await dnsFunciona())) return null;
  const recebe = await consultarMx(d);
  cacheDominios.set(d, { recebe, em: Date.now() });
  if (cacheDominios.size > 5000) cacheDominios.clear();
  return recebe;
}

// 'Sim' | 'Não (formato)' | 'Não (domínio não recebe e-mail)' | 'Não verificado' | '' (sem e-mail)
async function verificarEmail(email) {
  const e = String(email || '').trim();
  if (!e) return '';
  const m = REGEX_EMAIL.exec(e);
  if (!m) return 'Não (formato)';
  const recebe = await dominioRecebeEmail(m[1]);
  if (recebe === null) return 'Não verificado';
  return recebe ? 'Sim' : 'Não (domínio não recebe e-mail)';
}

// Verifica vários de uma vez: um domínio só é consultado uma vez por lote.
async function verificarEmails(emails) {
  const dominios = [...new Set(emails.map((e) => REGEX_EMAIL.exec(String(e || '').trim())?.[1]?.toLowerCase()).filter(Boolean))];
  await Promise.all(dominios.map((d) => dominioRecebeEmail(d)));
  return Promise.all(emails.map(verificarEmail));
}

// Só os dígitos, sem o 55 do país: é o que entra no link do WhatsApp.
function digitosCelular(celular) {
  let d = String(celular || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  return d;
}

// 'Sim' | 'Não (DDD)' | 'Não (faltam dígitos)' | '' (sem celular)
function verificarCelular(celular) {
  const d = digitosCelular(celular);
  if (!d) return '';
  if (d.length !== 11 || d[2] !== '9') return 'Não (faltam dígitos)';
  if (!DDDS.has(Number(d.slice(0, 2)))) return 'Não (DDD)';
  return 'Sim';
}

module.exports = { verificarEmail, verificarEmails, verificarCelular, digitosCelular };
