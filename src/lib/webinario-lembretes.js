// lib/webinario-lembretes.js
//
// Webinários (2026-11-13; spec §5): lembretes por e-mail 24 h e 1 h antes do início. Job a cada 10 min (server.js).
// Marca lembrete24hEm/lembrete1hEm para não repetir; quem se inscreveu a menos de 24 h (ou 1 h) do início não recebe
// aquele lembrete. O acesso é conferido na hora de enviar (estornado não recebe). Nunca leva o link da transmissão.

const prisma = require('../db');
const wb = require('./webinario');

const H = 3600 * 1000;

async function processarLembretesWebinario(agora = new Date()) {
  const r = { enviados24h: 0, enviados1h: 0 };
  const lista = await prisma.webinario.findMany({
    // Sem filtro de publicado: despublicar é como a secretaria fecha as inscrições, e quem já está inscrito continua
    // recebendo os lembretes (o acesso de cada um é conferido no envio).
    where: { inicioEm: { gt: agora, lte: new Date(agora.getTime() + 24 * H) } }, include: wb.INCLUIR,
  });
  const email = require('./email');
  for (const w of lista) {
    const ini = new Date(w.inicioEm).getTime();
    const falta = ini - agora.getTime();
    const qual = falta <= H ? '1h' : '24h';
    const campo = qual === '1h' ? 'lembrete1hEm' : 'lembrete24hEm';
    const limite = new Date(ini - (qual === '1h' ? H : 24 * H)); // inscrito antes disso
    const inscricoes = await prisma.inscricaoWebinario.findMany({
      where: { webinarioId: w.id, [campo]: null, criadoEm: { lt: limite } }, include: { usuario: { select: { nome: true, email: true } } },
    });
    for (const i of inscricoes) {
      if (!wb.temAcesso(await wb.acesso(i.usuarioId, w))) continue;
      // Marca antes de enviar: dois processos ao mesmo tempo não mandam em dobro.
      const marcado = await prisma.inscricaoWebinario.updateMany({ where: { id: i.id, [campo]: null }, data: { [campo]: agora } });
      if (!marcado.count) continue;
      try {
        await email.enviarWebinarLembrete(i.usuario.email, String(i.usuario.nome || '').split(' ')[0], {
          webinario: w.curso.nome, quando: wb.quandoTexto(w.inicioEm), link: wb.linkPagina(w), falta: qual,
        });
        if (qual === '1h') r.enviados1h++; else r.enviados24h++;
      } catch (e) { console.error('[WEBINARIO] lembrete:', e.message); }
    }
  }
  return r;
}

function agendarLembretesWebinario(minutos = 10) {
  return setInterval(() => processarLembretesWebinario(new Date()).catch((e) => console.error('[WEBINARIO] lembretes:', e.message)), minutos * 60 * 1000).unref();
}

module.exports = { processarLembretesWebinario, agendarLembretesWebinario };
