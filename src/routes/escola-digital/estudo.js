// routes/escola-digital/estudo.js
//
// Área de estudo da Escola Digital (spec §5.4–5.5): painel do curso, "Continuar", página do
// módulo, tela de aula, o botão "Próximo" e os testes ("Teste rápido" e "Já sei isso?"). Montado em routes/escola-digital/index.js depois da
// chave de liga/desliga. Todas as rotas exigem login e passam por `carregarInscricao` (dono,
// situação, prazo). A regra fica em lib/escola-digital/estudo.js; aqui só tela e redirecionamento.
//
// Só inscrição ATIVA grava progresso. Concluída (CONCLUIDA) só navega: revisão, sem gravar.

const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../lib/escola-digital/config');
const regras = require('../../lib/escola-digital/regras');
const estudo = require('../../lib/escola-digital/estudo');
const testes = require('../../lib/escola-digital/testes');
const prisma = require('../../db');
const { carregarInscricao, dataBR } = require('../../lib/escola-digital/acesso');
const { requireLogin } = require('../../middleware/auth');
const { precisaTrocarSenha } = require('../../lib/seguranca');

const router = express.Router();

const { urls } = estudo;
const DIA_MS = 86400000;

// Guarda de todo o estudo: login, depois dono + situação. Task 9 e 11 montam as rotas delas
// sob o mesmo prefixo (neste roteador) e herdam essa guarda.
router.use('/digital/estudo/:id', requireLogin, carregarInscricao);

// ---------- ajudas de tela ----------

const doisDigitos = (n) => String(n).padStart(2, '0');

// Só endereços do próprio site ou https; o conteúdo vem de arquivo da escola, mas a tela não confia.
const imagemSegura = (url) => (typeof url === 'string' && /^(\/(?!\/)|https:\/\/)/.test(url) ? url : null);
// Id de vídeo do YouTube: letras, números, "-" e "_" (nada que escape do endereço do vídeo).
const videoSeguro = (id) => (typeof id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null);

const paragrafos = (texto) => String(texto || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

// Prazo restante em texto; null se não há prazo.
function textoPrazo(inscricao, agora = new Date()) {
  if (inscricao.situacao === 'CONCLUIDA') {
    return inscricao.concluidaEm ? `Concluído em ${dataBR(inscricao.concluidaEm)}` : 'Concluído';
  }
  if (!inscricao.acessoAte) return null;
  const dias = Math.max(1, Math.ceil((new Date(inscricao.acessoAte) - agora) / DIA_MS));
  return dias === 1 ? 'Falta 1 dia' : `Faltam ${dias} dias`;
}

// Carimbos da lista de módulos.
const ROTULO_ESTADO = { FEITO: 'FEITO', JA_SABIA: 'JÁ SABIA', AGORA: 'AGORA', TRANCADO: 'TRANCADO' };

// Dados comuns das páginas de estudo.
async function contexto(req) {
  const [estrutura, prog] = await Promise.all([estudo.carregarEstrutura(req.inscricao.cursoId), estudo.progresso(req.inscricao.id)]);
  const estados = estudo.mapaDeEstados(estrutura, prog.concluidos);
  return { estrutura, prog, estados };
}

// Tópicos de um módulo para a lista (tela de aula e página do módulo).
function topicosDoModulo(inscricaoId, modulo, prog) {
  return modulo.topicos.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    aprovado: prog.aprovados.has(t.id),
    link: urls.teste(inscricaoId, t.id),
    telas: t.telas.map((x) => ({ id: x.id, titulo: x.titulo, vista: prog.vistas.has(x.id), link: urls.tela(inscricaoId, x.id) })),
  }));
}

const naoEncontrado = (res, titulo, mensagem, inscricaoId) => res.status(404).render('digital/erro', {
  titulo, mensagem, aba: 'cursos', voltaHref: urls.area(inscricaoId), voltaTexto: 'Voltar ao curso',
});

// ---------- painel do curso ----------

router.get('/digital/estudo/:id', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, prog, estados } = await contexto(req);

  const telaIds = new Set(estrutura.flatMap((m) => m.topicos.flatMap((t) => t.telas.map((x) => x.id))));
  const telasVistas = [...prog.vistas].filter((id) => telaIds.has(id)).length;
  const feitos = estrutura.filter((m) => Object.prototype.hasOwnProperty.call(prog.concluidos, m.id)).length;

  const modulos = estrutura.map((m) => {
    const estado = estados.get(m.id);
    const telas = m.topicos.flatMap((t) => t.telas);
    return {
      id: m.id,
      numero: doisDigitos(m.ordem),
      titulo: m.titulo,
      minutos: m.minutos,
      estado,
      rotulo: ROTULO_ESTADO[estado],
      link: estado === 'TRANCADO' ? null : urls.modulo(insc.id, m.id),
      telasVistas: telas.filter((x) => prog.vistas.has(x.id)).length,
      telasTotal: telas.length,
    };
  });

  const concluida = insc.situacao === 'CONCLUIDA';
  const primeiro = estrutura[0];
  const senhaInicial = await precisaTrocarSenha(req.session.usuarioId);

  return res.render('digital/area', {
    titulo: `${insc.curso.nome} | ${config.NOME}`,
    rastrear: false,
    aba: 'inicio',
    inscricaoId: insc.id,
    curso: { nome: insc.curso.nome, descricao: insc.curso.descricao, cargaHoraria: insc.curso.cargaHoraria },
    modulos,
    resumo: {
      telasVistas, telasTotal: telaIds.size,
      modulosFeitos: feitos, modulosTotal: estrutura.length,
      percentual: estrutura.length ? Math.round((feitos / estrutura.length) * 100) : 0,
    },
    prazo: textoPrazo(insc),
    acessoAte: !concluida && insc.acessoAte ? dataBR(insc.acessoAte) : null,
    concluida,
    // Concluído: o botão revê o curso desde o início; senão, continua de onde parou.
    botao: concluida
      ? { texto: 'Rever o curso', link: primeiro ? urls.modulo(insc.id, primeiro.id) : urls.area(insc.id) }
      : { texto: 'Continuar', link: urls.continuar(insc.id) },
    todosFeitos: feitos === estrutura.length && estrutura.length > 0,
    certificadoLink: concluida ? urls.certificado(insc.id) : null,
    cartaoLink: concluida ? urls.cartao(insc.id) : null,
    senhaInicial,
  });
}));

// ---------- continuar ----------

// Continuar também "se cura": se o módulo atual está com tudo visto e todos os testes aprovados mas
// sem a marca de conclusão (ex.: progresso gravado fora do fluxo normal), destinoContinuar chama
// concluirModuloSePronto e segue. Só com inscrição ATIVA: em revisão (CONCLUIDA) nada é gravado.
router.get('/digital/estudo/:id/continuar', asyncHandler(async (req, res) => {
  const { estrutura, prog } = await contexto(req);
  const destino = await estudo.destinoContinuar(req.inscricao.id, estrutura, prog, { gravar: !req.modoRevisao });
  return res.redirect(destino);
}));

// ---------- módulo ----------

router.get('/digital/estudo/:id/modulo/:moduloId', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, prog, estados } = await contexto(req);
  const modulo = estrutura.find((m) => m.id === req.params.moduloId);
  if (!modulo) return naoEncontrado(res, 'Módulo não encontrado', 'Este módulo não faz parte do seu curso.', insc.id);
  const estado = estados.get(modulo.id);
  if (estado === 'TRANCADO') return res.redirect(urls.area(insc.id));

  const concluido = estado === 'FEITO' || estado === 'JA_SABIA';
  const telas = modulo.topicos.flatMap((t) => t.telas);
  const passo = regras.proximoPasso(modulo.topicos, prog.vistas, prog.aprovados);
  const linkAprender = passo
    ? (passo.tipo === 'tela' ? urls.tela(insc.id, passo.id) : urls.teste(insc.id, passo.topicoId))
    : (telas[0] ? urls.tela(insc.id, telas[0].id) : null);

  return res.render('digital/modulo', {
    titulo: `${modulo.titulo} | ${insc.curso.nome} | ${config.NOME}`,
    rastrear: false,
    aba: 'inicio',
    inscricaoId: insc.id,
    areaLink: urls.area(insc.id),
    modulo: {
      id: modulo.id, numero: doisDigitos(modulo.ordem), titulo: modulo.titulo, minutos: modulo.minutos,
      paragrafos: paragrafos(modulo.abertura), imagem: imagemSegura(modulo.imagemUrl), final: modulo.final,
    },
    estado,
    rotuloEstado: ROTULO_ESTADO[estado],
    topicos: topicosDoModulo(insc.id, modulo, prog),
    // A escolha só aparece para módulo com "Já sei isso?" que ainda não foi concluído.
    escolha: modulo.temPreTeste && !concluido && !modulo.final && !req.modoRevisao,
    linkAprender,
    linkPreTeste: urls.preTeste(insc.id, modulo.id),
    cenarios: modulo.cenarios.map((c) => ({
      titulo: c.titulo, tempoSugerido: c.tempoSugerido, feito: prog.cenarios.has(c.id), link: urls.cenario(insc.id, c.id),
    })),
  });
}));

// ---------- tela de aula ----------

router.get('/digital/estudo/:id/tela/:telaId', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, prog, estados } = await contexto(req);
  const achada = estudo.localizarTela(estrutura, req.params.telaId);
  if (!achada) return naoEncontrado(res, 'Tela não encontrada', 'Esta tela não faz parte do seu curso.', insc.id);
  const { modulo, tela } = achada;
  if (estados.get(modulo.id) === 'TRANCADO') return res.redirect(urls.area(insc.id));

  const revisao = Array.isArray(tela.revisao)
    ? tela.revisao.filter((s) => typeof s === 'string' && s.trim()).slice(0, 4)
    : [];

  // O que o "Próximo" fará: o teste do tópico, mais uma tela ou o fim do módulo.
  const vistasComEsta = new Set([...prog.vistas, tela.id]);
  const passo = regras.proximoPasso(modulo.topicos, vistasComEsta, prog.aprovados);
  const revisando = Boolean(prog.concluidos[modulo.id]) || req.modoRevisao;
  let rotuloProximo = 'Próximo';
  if (!revisando) {
    if (!passo) rotuloProximo = 'Concluir módulo';
    else if (passo.tipo === 'teste') rotuloProximo = 'Próximo: teste rápido';
  }

  return res.render('digital/tela', {
    titulo: `${tela.titulo} | ${modulo.titulo} | ${config.NOME}`,
    rastrear: false,
    aba: 'inicio',
    corpoClasse: 'ed-corpo-tela',
    semAbas: true,
    inscricaoId: insc.id,
    areaLink: urls.area(insc.id),
    moduloLink: urls.modulo(insc.id, modulo.id),
    modulo: { numero: doisDigitos(modulo.ordem), titulo: modulo.titulo, minutos: modulo.minutos },
    posicao: achada.posicao,
    totalTelas: achada.telasDoModulo.length,
    topicoTitulo: achada.topico.titulo,
    tela: {
      id: tela.id,
      titulo: tela.titulo,
      ancora: tela.ancora,
      imagem: imagemSegura(tela.imagemUrl),
      imagemAlt: tela.imagemAlt || '',
      videoId: videoSeguro(tela.videoId),
      videoTitulo: tela.videoTitulo || tela.titulo,
      revisao,
      alerta: tela.alerta,
      dica: tela.dica,
    },
    topicos: topicosDoModulo(insc.id, modulo, prog),
    telaAtualId: tela.id,
    proximoAction: urls.proximo(insc.id, tela.id),
    rotuloProximo,
  });
}));

router.post('/digital/estudo/:id/tela/:telaId/proximo', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, estados, prog: antes } = await contexto(req);
  const achada = estudo.localizarTela(estrutura, req.params.telaId);
  if (!achada) return naoEncontrado(res, 'Tela não encontrada', 'Esta tela não faz parte do seu curso.', insc.id);
  const { modulo, tela } = achada;
  if (estados.get(modulo.id) === 'TRANCADO') return res.redirect(urls.area(insc.id));

  let prog = antes;
  const gravar = !req.modoRevisao; // só ATIVA grava; concluída só navega
  const jaConcluido = Boolean(antes.concluidos[modulo.id]);
  if (gravar) {
    await estudo.marcarVista(insc.id, tela.id);
    await estudo.concluirModuloSePronto(insc.id, modulo.id);
    prog = await estudo.progresso(insc.id);
  }
  const destino = await estudo.destinoAposTela(insc.id, estrutura, prog, achada, { jaConcluido: jaConcluido || !gravar, gravar });
  return res.redirect(destino);
}));

// ---------- testes: teste rápido (tópico) e "Já sei isso?" (módulo) ----------
//
// Uma pergunta por página, sem JavaScript. O teste de tópico mostra certa/errada e o porquê logo
// depois de cada resposta; o "Já sei isso?" só mostra o resultado no fim. A regra fica em
// lib/escola-digital/testes.js. Em revisão (inscrição CONCLUIDA) nada começa nem grava: volta
// para a página do módulo. Os ids de tópico, módulo e tentativa só valem dentro do curso da
// inscrição (carregarEstrutura) e da própria inscrição; o resto é 404.

const acharTopico = (estrutura, topicoId) => {
  for (const modulo of estrutura) {
    const topico = modulo.topicos.find((t) => t.id === topicoId);
    if (topico) return { modulo, topico };
  }
  return null;
};

const erroDeTeste = (res, status, mensagem, inscricaoId) => res.status(status).render('digital/erro', {
  titulo: 'Não foi possível registrar', mensagem, aba: 'cursos', voltaHref: urls.area(inscricaoId), voltaTexto: 'Voltar ao curso',
});

router.get('/digital/estudo/:id/teste/:topicoId', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, prog, estados } = await contexto(req);
  const achado = acharTopico(estrutura, req.params.topicoId);
  if (!achado) return naoEncontrado(res, 'Teste não encontrado', 'Este teste não faz parte do seu curso.', insc.id);
  const { modulo, topico } = achado;
  if (req.modoRevisao || modulo.final) return res.redirect(urls.modulo(insc.id, modulo.id));
  if (estados.get(modulo.id) === 'TRANCADO') return res.redirect(urls.area(insc.id));
  // O teste vem depois das telas do tópico: se falta alguma, o aluno vai para ela.
  const faltando = topico.telas.find((x) => !prog.vistas.has(x.id));
  if (faltando) return res.redirect(urls.tela(insc.id, faltando.id));

  const tentativa = await testes.iniciarTeste(insc.id, { tipo: 'TOPICO', topicoId: topico.id });
  if (!tentativa) {
    return res.status(200).render('digital/erro', {
      titulo: 'Teste indisponível', mensagem: 'Este teste ainda não tem perguntas. Volte ao módulo e siga em frente por enquanto.',
      aba: 'cursos', voltaHref: urls.modulo(insc.id, modulo.id), voltaTexto: 'Voltar ao módulo',
    });
  }
  return res.redirect(urls.tentativa(insc.id, tentativa.id));
}));

router.get('/digital/estudo/:id/pre-teste/:moduloId', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { estrutura, estados } = await contexto(req);
  const modulo = estrutura.find((m) => m.id === req.params.moduloId);
  if (!modulo) return naoEncontrado(res, 'Teste não encontrado', 'Este teste não faz parte do seu curso.', insc.id);
  if (req.modoRevisao || modulo.final || !modulo.temPreTeste) return res.redirect(urls.modulo(insc.id, modulo.id));
  const estado = estados.get(modulo.id);
  if (estado === 'TRANCADO') return res.redirect(urls.area(insc.id));
  if (estado !== 'AGORA') return res.redirect(urls.modulo(insc.id, modulo.id)); // já concluído

  const tentativa = await testes.iniciarTeste(insc.id, { tipo: 'PRE_TESTE', moduloId: modulo.id });
  if (!tentativa) {
    return res.status(200).render('digital/erro', {
      titulo: 'Teste indisponível', mensagem: 'Este módulo ainda não tem perguntas para o "Já sei isso?". Comece pelas telas.',
      aba: 'cursos', voltaHref: urls.modulo(insc.id, modulo.id), voltaTexto: 'Voltar ao módulo',
    });
  }
  return res.redirect(urls.tentativa(insc.id, tentativa.id));
}));

// Tudo sob /tentativa/:tentativaId: a tentativa tem de ser da inscrição da URL e de um tópico ou
// módulo do curso dela.
router.use('/digital/estudo/:id/tentativa/:tentativaId', asyncHandler(async (req, res, next) => {
  const insc = req.inscricao;
  const tentativa = await prisma.tentativaTeste.findUnique({ where: { id: String(req.params.tentativaId) } });
  if (!tentativa || tentativa.inscricaoId !== insc.id) {
    return naoEncontrado(res, 'Teste não encontrado', 'Não encontramos este teste na sua inscrição.', insc.id);
  }
  const estrutura = await estudo.carregarEstrutura(insc.cursoId);
  let modulo = null;
  let topico = null;
  if (tentativa.tipo === 'TOPICO') {
    const achado = tentativa.topicoId ? acharTopico(estrutura, tentativa.topicoId) : null;
    if (achado) ({ modulo, topico } = achado);
  } else {
    modulo = estrutura.find((m) => m.id === tentativa.moduloId) || null;
  }
  if (!modulo) return naoEncontrado(res, 'Teste não encontrado', 'Não encontramos este teste na sua inscrição.', insc.id);
  req.tentativa = tentativa;
  req.estruturaCurso = estrutura;
  req.alvoTeste = { modulo, topico };
  return next();
}));

const listaDe = (valor) => (Array.isArray(valor) ? valor : []);

// Página da pergunta (ou do certa/errada + porquê, no teste de tópico).
router.get('/digital/estudo/:id/tentativa/:tentativaId', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { tentativa, alvoTeste } = req;
  if (tentativa.finalizada) return res.redirect(urls.resultado(insc.id, tentativa.id));
  if (req.modoRevisao) return res.redirect(urls.modulo(insc.id, alvoTeste.modulo.id));

  const perguntas = listaDe(tentativa.perguntas);
  const respostas = listaDe(tentativa.respostas);
  const respostaDe = (p) => respostas.find((r) => r.perguntaId === p.id);
  const total = perguntas.length;
  const primeiraSemResposta = perguntas.findIndex((p) => !respostaDe(p));
  const ehTopico = tentativa.tipo === 'TOPICO';

  // Qual pergunta mostrar: no teste de tópico, a que acabou de ser respondida (?n=) ou, com todas
  // respondidas, a última; senão, a primeira sem resposta.
  let indice = primeiraSemResposta;
  const pedido = Number.parseInt(req.query.n, 10);
  if (ehTopico && pedido >= 1 && pedido <= total && respostaDe(perguntas[pedido - 1])) indice = pedido - 1;
  else if (ehTopico && primeiraSemResposta === -1) indice = total - 1;

  const nomeTeste = ehTopico ? 'TESTE RÁPIDO' : 'JÁ SEI ISSO?';
  const dados = {
    titulo: `${ehTopico ? 'Teste rápido' : 'Já sei isso?'} | ${alvoTeste.modulo.titulo} | ${config.NOME}`,
    rastrear: false,
    aba: 'inicio',
    semAbas: true,
    corpoClasse: 'ed-corpo-teste',
    inscricaoId: insc.id,
    ehTopico,
    nomeTeste,
    assunto: ehTopico ? alvoTeste.topico.titulo : alvoTeste.modulo.titulo,
    modulo: { numero: doisDigitos(alvoTeste.modulo.ordem), titulo: alvoTeste.modulo.titulo },
    moduloLink: urls.modulo(insc.id, alvoTeste.modulo.id),
    total,
    respondidas: respostas.length,
    responderAction: urls.responder(insc.id, tentativa.id),
    finalizarAction: urls.finalizar(insc.id, tentativa.id),
    proximaLink: urls.tentativa(insc.id, tentativa.id),
  };

  if (indice === -1) {
    // "Já sei isso?" com todas respondidas: só falta ver o resultado.
    return res.render('digital/teste', { ...dados, etapa: 'FIM', n: total, pergunta: null, feedback: null });
  }

  const pergunta = perguntas[indice];
  const resposta = respostaDe(pergunta);
  const alternativas = listaDe(pergunta.alternativas).map((texto, i) => ({
    indice: i,
    texto,
    certa: Boolean(resposta) && i === pergunta.correta,
    escolhida: Boolean(resposta) && i === resposta.alternativa,
  }));
  return res.render('digital/teste', {
    ...dados,
    etapa: resposta ? 'FEEDBACK' : 'PERGUNTA',
    n: indice + 1,
    pergunta: { id: pergunta.id, enunciado: pergunta.enunciado, alternativas },
    feedback: resposta ? { certa: Boolean(resposta.certa), porque: pergunta.porque } : null,
    ultima: indice === total - 1,
  });
}));

router.post('/digital/estudo/:id/tentativa/:tentativaId/responder', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { tentativa, alvoTeste } = req;
  if (req.modoRevisao) return res.redirect(urls.modulo(insc.id, alvoTeste.modulo.id));
  if (tentativa.finalizada) return res.redirect(urls.resultado(insc.id, tentativa.id));

  const perguntas = listaDe(tentativa.perguntas);
  const perguntaId = String(req.body.perguntaId || '');
  const indice = perguntas.findIndex((p) => p.id === perguntaId);
  if (indice === -1) return erroDeTeste(res, 400, 'Esta pergunta não faz parte do seu teste.', insc.id);
  const bruto = req.body.alternativa;
  // Nenhuma alternativa marcada: volta para a mesma pergunta, sem gravar.
  if (bruto === undefined || bruto === '') return res.redirect(urls.tentativa(insc.id, tentativa.id));
  const alternativa = /^\d{1,3}$/.test(String(bruto)) ? Number(bruto) : NaN;

  try {
    await testes.responder(tentativa.id, perguntaId, alternativa);
  } catch (e) {
    if (e instanceof testes.ErroTeste) return erroDeTeste(res, 400, 'Não foi possível registrar esta resposta.', insc.id);
    throw e;
  }
  // Teste de tópico: mostra o certa/errada e o porquê; "Já sei isso?": segue direto.
  return res.redirect(tentativa.tipo === 'TOPICO' ? urls.tentativa(insc.id, tentativa.id, indice + 1) : urls.tentativa(insc.id, tentativa.id));
}));

router.post('/digital/estudo/:id/tentativa/:tentativaId/finalizar', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { tentativa, alvoTeste } = req;
  if (req.modoRevisao) return res.redirect(urls.modulo(insc.id, alvoTeste.modulo.id));
  try {
    await testes.finalizar(tentativa.id);
  } catch (e) {
    // Faltam perguntas: volta para a que falta.
    if (e instanceof testes.ErroTeste && e.codigo === 'INCOMPLETA') return res.redirect(urls.tentativa(insc.id, tentativa.id));
    throw e;
  }
  return res.redirect(urls.resultado(insc.id, tentativa.id));
}));

router.get('/digital/estudo/:id/tentativa/:tentativaId/resultado', asyncHandler(async (req, res) => {
  const insc = req.inscricao;
  const { tentativa, alvoTeste, estruturaCurso } = req;
  if (!tentativa.finalizada) return res.redirect(urls.tentativa(insc.id, tentativa.id));

  const { modulo, topico } = alvoTeste;
  const ehTopico = tentativa.tipo === 'TOPICO';
  const prog = await estudo.progresso(insc.id);
  const telasDoAlvo = (ehTopico ? topico.telas : modulo.topicos.flatMap((t) => t.telas));
  const aprovado = Boolean(tentativa.aprovado);

  return res.render('digital/teste-resultado', {
    titulo: `Resultado | ${modulo.titulo} | ${config.NOME}`,
    rastrear: false,
    aba: 'inicio',
    semAbas: true,
    corpoClasse: 'ed-corpo-teste',
    inscricaoId: insc.id,
    ehTopico,
    nomeTeste: ehTopico ? 'TESTE RÁPIDO' : 'JÁ SEI ISSO?',
    assunto: ehTopico ? topico.titulo : modulo.titulo,
    modulo: { numero: doisDigitos(modulo.ordem), titulo: modulo.titulo },
    acertos: tentativa.acertos,
    total: tentativa.total,
    percentual: tentativa.total ? Math.round((tentativa.acertos / tentativa.total) * 100) : 0,
    aprovado,
    moduloConcluido: Boolean(prog.concluidos[modulo.id]),
    // Aprovado: segue o mesmo caminho do "Continuar" (próxima tela/teste ou abertura do módulo seguinte).
    continuarLink: aprovado ? await estudo.destinoContinuar(insc.id, estruturaCurso, prog, { gravar: false }) : null,
    refazerLink: ehTopico ? urls.teste(insc.id, topico.id) : null,
    telasLink: telasDoAlvo[0] ? urls.tela(insc.id, telasDoAlvo[0].id) : urls.modulo(insc.id, modulo.id),
    moduloLink: urls.modulo(insc.id, modulo.id),
  });
}));

module.exports = router;
