// routes/escola-digital/estudo.js
//
// Área de estudo da Escola Digital (spec §5.4–5.5): painel do curso, "Continuar", página do
// módulo, tela de aula e o botão "Próximo". Montado em routes/escola-digital/index.js depois da
// chave de liga/desliga. Todas as rotas exigem login e passam por `carregarInscricao` (dono,
// situação, prazo). A regra fica em lib/escola-digital/estudo.js; aqui só tela e redirecionamento.
//
// Só inscrição ATIVA grava progresso. Concluída (CONCLUIDA) só navega: revisão, sem gravar.

const express = require('express');
const asyncHandler = require('../../lib/asyncHandler');
const config = require('../../lib/escola-digital/config');
const regras = require('../../lib/escola-digital/regras');
const estudo = require('../../lib/escola-digital/estudo');
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

module.exports = router;
