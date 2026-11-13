// lib/webinario-certificado.js
//
// Certificado de participação do webinário (2026-11-13; spec §4). Mesmo modelo do curso online
// (admin/certificado-imprimir.ejs), com o selo WEBINÁRIO, o texto "participou do webinário" e sem conteúdo programático.
// Número (livro/registro): da PresencaWebinario, reservado uma vez só. Redação: código e QR (falhar não impede).

const QRCode = require('qrcode');
const prisma = require('../db');
const cert = require('./certificado');
const redacao = require('./redacao');
const extras = require('./extras');
const email = require('./email'); // chamado como email.x (os testes trocam por espião)
const wb = require('./webinario');
const { assinaturasDoCurso, dataRio } = require('./ead-certificado');

async function numerar(presencaId) {
  const ja = await cert.lerNumero(presencaId);
  if (ja) return { ...ja, novo: false };
  const { livro } = await cert.lerAjustes();
  const r = await cert.reservarNumero(presencaId, 'PresencaWebinario', livro);
  return { ...(await cert.lerNumero(presencaId)), novo: !!r };
}

function dadosCertificadoWebinario({ usuario, curso, w, numero, ajustes, documentoAluno, realizadoEm }) {
  const doc = documentoAluno(usuario);
  const horas = wb.cargaHorasDe(w.duracaoMin);
  const quando = realizadoEm || w.inicioEm; // a data de quando a presença foi confirmada vale (remarcar depois não muda)
  const data = quando ? dataRio(quando) : null;
  return {
    online: false,
    webinario: { titulo: (curso.nomeCertificado || curso.nome).trim(), apresentador: w.apresentador || '', data, gravado: !quando },
    nome: String(usuario.nome || '').trim(),
    portador: cert.portador(usuario.genero),
    documento: doc ? { tipo: doc.tipo.split(' ·')[0], numero: doc.numero } : null,
    curso: (curso.nomeCertificado || curso.nome).trim(),
    cargaHoraria: `${String(horas).padStart(2, '0')} ${horas === 1 ? 'hora' : 'horas'}`,
    periodo: { frase: data ? `realizado em ${data}` : 'na modalidade gravada', curta: data || 'Gravado' },
    emitidoEm: cert.emitidoEm(numero.emitidoEm || new Date()),
    assinaturas: assinaturasDoCurso(curso, ajustes),
    assinaturaOnline: ajustes.assinaturaOnline === 'sem' ? 'sem' : 'com',
    instrutorNome: '', instrutorRegistro: '',
    livro: numero.livro, registro: numero.registro,
    validade: '', conteudo: [],
  };
}

// Emite (ou reabre) o certificado de uma presença. null se a presença não existe.
async function emitirCertificadoWebinario(presencaId, { enviarEmail = false, linkCertificado = null, documentoAluno } = {}) {
  const p = await prisma.presencaWebinario.findUnique({ where: { id: presencaId }, include: { usuario: true, webinario: { include: { curso: true } } } });
  if (!p) return null;
  const numero = await numerar(p.id);
  const curso = p.webinario.curso;
  await extras.anexar('curso', [curso]);
  const dados = dadosCertificadoWebinario({ usuario: p.usuario, curso, w: p.webinario, numero, realizadoEm: p.realizadoEm, ajustes: await cert.lerAjustes(), documentoAluno: documentoAluno || (() => null) });

  let verificacao = null; let avisoRedacao = null;
  const reg = await redacao.registrarCertificados([{
    matriculaId: p.id, turmaId: p.webinarioId, nome: dados.nome, curso: `${curso.nome} (webinário)`,
    cargaHoraria: wb.cargaHorasDe(p.webinario.duracaoMin), emitidoEm: numero.emitidoEm,
  }]).catch((e) => ({ codigos: {}, falhas: 1, erro: e.message }));
  const r = reg.codigos && reg.codigos[p.id];
  if (r) {
    const qr = await QRCode.toString(r.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff00' } });
    verificacao = { codigo: r.codigo, url: r.url, qr };
  } else if (reg.falhas) avisoRedacao = reg.erro || 'falhou';

  if (numero.novo && enviarEmail && linkCertificado) {
    try { await email.enviarCertificadoWebinarPronto(p.usuario.email, String(p.usuario.nome || '').split(' ')[0], { webinario: dados.curso, link: linkCertificado }); } catch (e) {
      console.error('[WEBINARIO] e-mail do certificado:', e.message);
    }
  }
  return { dados, verificacao, avisoRedacao };
}

// Primeira presença (routes/webinarios.js): emite já (número, Redação) e manda o e-mail com o link.
async function aoConfirmar(w, usuarioId, req) {
  const p = await prisma.presencaWebinario.findUnique({ where: { webinarioId_usuarioId: { webinarioId: w.id, usuarioId } } });
  if (!p) return null;
  return emitirCertificadoWebinario(p.id, { enviarEmail: true, linkCertificado: `${wb.linkPagina(w)}/certificado`, documentoAluno: req && req.app && req.app.locals.documentoAluno });
}

module.exports = { emitirCertificadoWebinario, aoConfirmar, dadosCertificadoWebinario };
