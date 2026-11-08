// lib/ead-certificado.js
//
// Certificado do curso online (EAD, etapa 3). Mesmo modelo, mesmo Livro/Registro e mesma Redação do
// presencial (lib/certificado.js, lib/redacao.js), com o selo CURSO ONLINE, a modalidade a distância,
// a data de conclusão e a ressalva de que não inclui prática em manequim.
// Spec: docs/superpowers/specs/2026-11-06-ead-certificado.md

const QRCode = require('qrcode');
const prisma = require('../db');
const cert = require('./certificado');
const redacao = require('./redacao');
const extras = require('./extras');
const email = require('./email'); // chamado como email.x (o teste troca a função por um espião)

const MAX_NO_CERTIFICADO = cert.MAX_NO_CERTIFICADO;

// dd/mm/aaaa no fuso do Rio (a conclusão às 23h de um dia não pode virar o dia seguinte em UTC).
function dataRio(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}

// Assinaturas do curso, sem o instrutor (o online não tem turma). Sem escolha válida: a primeira da lista.
function assinaturasDoCurso(curso, ajustes) {
  const lista = [];
  for (const chave of cert.escolhaDoCurso(curso)) {
    if (chave === 'instrutor') continue;
    const a = ajustes.assinantes[Number(chave.slice(1))];
    if (a && a.nome) lista.push({ nome: a.nome, cargo: a.cargo });
  }
  if (!lista.length) {
    const primeira = ajustes.assinantes.find((a) => a && a.nome);
    if (primeira) lista.push({ nome: primeira.nome, cargo: primeira.cargo });
  }
  return lista.slice(0, MAX_NO_CERTIFICADO);
}

// Tudo o que o modelo imprime para o aluno do curso online, no formato de dadosDoCertificado + online.
// curso: o Curso com os extras anexados (nomeCertificado, certAssinaturas…); modulos: [{ titulo, final }].
function dadosCertificadoEad({ usuario, curso, modulos, numero, concluidoEm, ajustes, documentoAluno }) {
  const doc = documentoAluno(usuario);
  const concluido = dataRio(concluidoEm);
  const ordem = [...modulos.filter((m) => !m.final), ...modulos.filter((m) => m.final)];
  return {
    online: true,
    nome: String(usuario.nome || '').trim(),
    portador: cert.portador(usuario.genero),
    documento: doc ? { tipo: doc.tipo.split(' ·')[0], numero: doc.numero } : null,
    curso: (curso.nomeCertificado || curso.nome).trim(),
    cargaHoraria: `${String(curso.cargaHoraria).padStart(2, '0')} ${curso.cargaHoraria === 1 ? 'hora' : 'horas'}`,
    periodo: { frase: `concluído em ${concluido}`, curta: concluido },
    concluidoEm: concluido,
    emitidoEm: cert.emitidoEm(numero.emitidoEm || new Date()),
    assinaturas: assinaturasDoCurso(curso, ajustes),
    instrutorNome: '',
    instrutorRegistro: '',
    livro: numero.livro,
    registro: numero.registro,
    validade: (curso.certificadoValidade || '').trim(),
    conteudo: ordem.map((m) => m.titulo),
  };
}

// Emite (ou reabre) o certificado de quem concluiu o curso online. Idempotente: o número é criado uma
// vez só, a Redação só é chamada enquanto não houver código, e o e-mail sai só na primeira emissão.
// Devolve null se o curso não está concluído. documentoAluno: app.locals.documentoAluno (server.js).
async function emitirCertificadoEad(alunoCursoId, { enviarEmail = false, linkCertificado = null, documentoAluno } = {}) {
  const ac = await prisma.alunoCursoEad.findUnique({
    where: { id: alunoCursoId },
    include: { usuario: true, cursoOnline: { include: { curso: true, modulos: { select: { titulo: true, final: true, ordem: true, criadoEm: true }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] } } } },
  });
  if (!ac || !ac.concluidoEm) return null;
  const numero = await cert.numerarEad(ac.id);
  const curso = ac.cursoOnline.curso;
  await extras.anexar('curso', [curso]);
  const dados = dadosCertificadoEad({
    usuario: ac.usuario, curso, modulos: ac.cursoOnline.modulos, numero, concluidoEm: ac.concluidoEm,
    ajustes: await cert.lerAjustes(), documentoAluno: documentoAluno || (() => null),
  });

  // Redação: código e QR de conferência. Falhar aqui não impede o certificado (sai sem QR).
  let verificacao = null; let avisoRedacao = null;
  const reg = await redacao.registrarCertificados([{
    matriculaId: ac.id, turmaId: ac.cursoOnlineId, nome: dados.nome, curso: `${curso.nome} (online)`,
    cargaHoraria: curso.cargaHoraria, emitidoEm: numero.emitidoEm,
  }]).catch((e) => ({ codigos: {}, falhas: 1, erro: e.message }));
  const r = reg.codigos[ac.id];
  if (r) {
    const qr = await QRCode.toString(r.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff00' } });
    verificacao = { codigo: r.codigo, url: r.url, qr };
  } else if (reg.falhas) {
    avisoRedacao = reg.erro || 'falhou';
  }

  if (numero.novo && enviarEmail && linkCertificado) {
    try { await email.enviarCertificadoEadPronto(ac.usuario.email, ac.usuario.nome, { curso: dados.curso, link: linkCertificado }); } catch (e) {
      console.error('[EAD] e-mail do certificado:', e.message);
    }
  }
  return { dados, verificacao, avisoRedacao };
}

// Escola Digital (2026-11, vistoria T1): certificado do LINK DE TESTE. Mesmo desenho, marcado "TESTE", sem
// Livro/Registro (não reserva número da escola), sem Redação e sem e-mail.
async function previaCertificadoEad(alunoCursoId, { documentoAluno } = {}) {
  const ac = await prisma.alunoCursoEad.findUnique({
    where: { id: alunoCursoId },
    include: { usuario: true, cursoOnline: { include: { curso: true, modulos: { select: { titulo: true, final: true, ordem: true, criadoEm: true }, orderBy: [{ ordem: 'asc' }, { criadoEm: 'asc' }] } } } },
  });
  if (!ac) return null;
  const curso = ac.cursoOnline.curso;
  await extras.anexar('curso', [curso]);
  const dados = dadosCertificadoEad({
    usuario: ac.usuario, curso, modulos: ac.cursoOnline.modulos, numero: { livro: null, registro: null, emitidoEm: new Date() },
    concluidoEm: ac.concluidoEm || new Date(), ajustes: await cert.lerAjustes(), documentoAluno: documentoAluno || (() => null),
  });
  return { dados: { ...dados, teste: true }, verificacao: null };
}

module.exports = { dadosCertificadoEad, assinaturasDoCurso, dataRio, emitirCertificadoEad, previaCertificadoEad };
