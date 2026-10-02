// lib/visitas.js
//
// Visitantes do site do aluno sem login (quem tem login já aparece em "online agora" e "entraram
// hoje" no Painel). Conta sem cookie e sem guardar IP: cada visitante vira um código (hash do IP +
// navegador com um sal sorteado por dia, só em memória), que não dá para voltar ao IP e muda
// todo dia. Robôs e buscadores ficam de fora.
//
// O número do dia vai para Configuracao 'visitas:<AAAA-MM-DD>' a cada minuto
// ({ unicos, paginas, agora, agoraEm }), o que deixa o Painel ler mesmo que o painel e o site
// rodem em serviços diferentes. Depois de reiniciar o servidor, quem volta no mesmo dia pode
// contar de novo: o número é aproximado.

const crypto = require('crypto');
const prisma = require('../db');

const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|monitor|uptime|pingdom|curl|wget|python|axios|node-fetch|go-http|java\/|headless|lighthouse|scrapy|semrush|ahrefs/i;
const AGORA_MS = 5 * 60 * 1000;
const CHAVE = (dia) => 'visitas:' + dia;

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

let dia = hojeSP();
let sal = crypto.randomBytes(16);
let unicos = new Set();
let paginas = 0;
let base = null;   // o que já estava gravado do dia quando este servidor começou a contar
let mudou = false;
const vistos = new Map(); // código -> último acesso (ms), para o "agora"

function virarDia() {
  const hoje = hojeSP();
  if (hoje === dia) return;
  if (base !== null) gravar().catch(() => {}); // fecha o dia anterior com o que tinha
  dia = hoje; sal = crypto.randomBytes(16); unicos = new Set(); paginas = 0; base = { unicos: 0, paginas: 0 };
  vistos.clear();
}

function agoraN() {
  const limite = Date.now() - AGORA_MS;
  for (const [k, em] of vistos) if (em < limite) vistos.delete(k);
  return vistos.size;
}

// Middleware do site do aluno: conta páginas abertas (GET de HTML que deu certo) de quem não está logado.
function registrar(req, res, next) {
  if (req.method !== 'GET' || (req.session && req.session.usuarioId)) return next();
  const aceita = String(req.headers.accept || '');
  const ua = String(req.headers['user-agent'] || '');
  if (!aceita.includes('text/html') || !ua || BOTS.test(ua) || req.headers.purpose === 'prefetch') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    virarDia();
    const ip = String(req.headers['cf-connecting-ip'] || req.ip || '');
    const codigo = crypto.createHash('sha256').update(sal).update(ip).update('|').update(ua).digest('base64').slice(0, 16);
    unicos.add(codigo);
    vistos.set(codigo, Date.now());
    paginas++;
    mudou = true;
    if (unicos.size > 200000) unicos.clear(); // trava de memória (nunca deve chegar perto)
  });
  return next();
}

async function gravar() {
  if (base === null) {
    const cfg = await prisma.configuracao.findUnique({ where: { chave: CHAVE(dia) } });
    let v = {};
    try { v = cfg ? JSON.parse(cfg.valor) : {}; } catch (e) { v = {}; }
    base = { unicos: Number(v.unicos) || 0, paginas: Number(v.paginas) || 0 };
  }
  const n = agoraN();
  if (!mudou && !n) return;
  const valor = JSON.stringify({ unicos: base.unicos + unicos.size, paginas: base.paginas + paginas, agora: n, agoraEm: new Date().toISOString() });
  await prisma.configuracao.upsert({ where: { chave: CHAVE(dia) }, update: { valor }, create: { chave: CHAVE(dia), valor } });
  mudou = false;
}

let timer = null;
function iniciar() {
  if (timer) return;
  timer = setInterval(() => { virarDia(); gravar().catch((e) => console.warn('[visitas] gravar:', e.message)); }, 60 * 1000);
  if (timer.unref) timer.unref();
}

// Para o Painel: hoje, agora e os últimos 7 dias (do mais antigo para hoje).
async function resumo() {
  const dias = [];
  const hoje = new Date(hojeSP() + 'T12:00:00-03:00');
  for (let i = 6; i >= 0; i--) dias.push(new Date(hoje.getTime() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: dias.map(CHAVE) } } });
  const porDia = Object.fromEntries(cfgs.map((c) => { try { return [c.chave.slice(8), JSON.parse(c.valor)]; } catch (e) { return [c.chave.slice(8), {}]; } }));
  const lista = dias.map((d) => ({ dia: d, unicos: Number((porDia[d] || {}).unicos) || 0, paginas: Number((porDia[d] || {}).paginas) || 0 }));
  const h = porDia[dias[6]] || {};
  const recente = h.agoraEm && Date.now() - new Date(h.agoraEm).getTime() < 3 * 60 * 1000;
  return {
    hoje: lista[6].unicos,
    paginasHoje: lista[6].paginas,
    agora: recente ? Number(h.agora) || 0 : 0,
    semana: lista.reduce((t, d) => t + d.unicos, 0),
    dias: lista,
  };
}

module.exports = { registrar, iniciar, resumo, _gravar: gravar };
