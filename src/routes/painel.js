const express = require('express');
const prisma = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { formatBRL } = require('../lib/matricula');
const { verificarSenha } = require('../lib/password');
const { mascarar } = require('../lib/documento');
const { perfilSchema, ESCOLARIDADES, SITUACOES_ESCOLARIDADE, GENEROS, UFS } = require('../lib/validation');
const { precisaTrocarSenha } = require('../lib/seguranca');
const excluirConta = require('../lib/excluir-conta');
const comprovanteSaude = require('../lib/comprovante-saude');

const router = express.Router();

// 💡 C4 — Blindagem contra erros async: envolve automaticamente todo handler
// async registrado neste router com asyncHandler, pra qualquer exceção (ex.:
// timeout do banco) cair no middleware de erro do server em vez de derrubar o
// processo. Middlewares síncronos (rate limiters, requireLogin) passam intactos.
const asyncHandler = require('../lib/asyncHandler');
['get', 'post', 'put', 'delete', 'patch'].forEach((metodo) => {
  const original = router[metodo].bind(router);
  router[metodo] = (caminho, ...handlers) =>
    original(caminho, ...handlers.map((h) =>
      typeof h === 'function' && h.constructor.name === 'AsyncFunction' ? asyncHandler(h) : h));
});

// 💡 NOVO — Esconde da aluna matrículas "fantasma": criadas no banco mas sem
// nenhum pagamento efetivamente confirmado ainda (taxaConfirmada: false E
// statusPagamento ainda no estado inicial PENDENTE). Isso acontece quando a
// pessoa aceita o contrato e escolhe um plano, mas fecha a aba antes de
// completar (ou até tentar) qualquer pagamento — a Matricula já existe no
// banco (é necessária para o Pagamento se vincular a ela), mas não faz
// sentido mostrar como "PENDENTE" pra aluna algo que ela nunca chegou a pagar.
//
// Assim que o webhook confirma a taxa (taxaConfirmada vira true), a matrícula
// passa a aparecer normalmente como PENDENTE — que aí sim significa "só falta
// pagar o curso", e não "não paguei nada ainda".
//
// Matrículas PAGO/PARCELADO/CANCELADO/ESTORNADO sempre aparecem (são
// tentativas reais, com histórico que vale preservar) — só o caso
// PENDENTE + taxaConfirmada:false é filtrado.
const FILTRO_MATRICULA_FANTASMA = {
  NOT: { statusPagamento: 'PENDENTE', taxaConfirmada: false },
};

// ─────────────────────────────────────────────────────────────────────────
// 💡 NOVO — Ponto de retomada do pagamento.
//
// Problema que resolve: o aluno pagava a taxa de inscrição, fechava a aba, e
// não tinha por onde voltar para pagar o curso. As rotas /pagar-taxa e
// /pagar-curso (em cursos.js) JÁ aceitavam esse estado — só faltava um link
// até elas a partir de "Minha conta".
//
// Retorna null quando não há o que retomar (já pago, cancelado, estornado).
//
// Nota: hoje o FILTRO_MATRICULA_FANTASMA acima esconde tudo que é
// PENDENTE + taxaConfirmada:false, então na prática só o ramo do curso
// dispara. Os outros ramos ficam aqui pra não quebrar se o filtro mudar.
// ─────────────────────────────────────────────────────────────────────────
function calcularRetomada(m) {
  if (m.statusPagamento !== 'PENDENTE') return null;
  // Turma congelada (pausada pela secretaria): sem botão de pagar até ela ser retomada.
  if (m.turma && m.turma.status === 'CONGELADA') return null;

  if (!m.taxaConfirmada) {
    // A_VISTA cobra taxa e curso na MESMA transação, então não há etapa
    // intermediária: refaz o fluxo desde a escolha do plano.
    return m.plano === 'A_VISTA'
      ? { url: `/inscrever/${m.turmaId}`, rotulo: 'Retomar pagamento' }
      : { url: `/inscrever/${m.turmaId}/pagar-taxa`, rotulo: 'Pagar a taxa de inscrição' };
  }

  // taxaConfirmada + A_VISTA = transação única já paga; nada a retomar.
  if (m.plano === 'A_VISTA') return null;

  return { url: `/inscrever/${m.turmaId}/pagar-curso`, rotulo: 'Continuar — pagar a matrícula' };
}

// Boas-vindas liberadas pela secretaria (lib/boas-vindas.js): o mesmo texto do e-mail aparece aqui
// para quem está com o pagamento em dia, até a turma terminar.
async function avisosDeBoasVindas(matriculas) {
  // Nunca derruba "Minha conta": se algo falhar aqui, a tela abre sem o aviso.
  try {
    const boasVindas = require('../lib/boas-vindas');
    const extras = require('../lib/extras');
    const pagas = matriculas.filter((m) => m.taxaConfirmada && ['PAGO', 'PARCELADO'].includes(m.statusPagamento));
    if (!pagas.length) return [];
    const liberadas = await extras.lerExtras('turma', pagas.map((m) => m.turmaId));
    const ids = Object.keys(liberadas).filter((id) => liberadas[id].boasVindasEnviadaEm);
    if (!ids.length) return [];
    const turmas = await prisma.turma.findMany({ where: { id: { in: ids } }, include: { curso: true, aulas: true } });
    await extras.anexar('turma', turmas);
    const modelo = await boasVindas.lerModelo();
    return turmas.filter(boasVindas.turmaEmCurso).map((t) => ({
      curso: t.curso.nome,
      html: boasVindas.textoParaHtml(boasVindas.montarTexto(t, modelo)),
    }));
  } catch (e) {
    console.error('[BOAS-VINDAS] aviso em Minha conta:', e.message);
    return [];
  }
}

// Comprovante da área da saúde (lib/comprovante-saude.js) em Minha conta: aparece quando o aluno
// tem inscrição em andamento num curso que exige. Cobre quem se inscreveu antes da exigência e
// quem veio pela matrícula rápida.
async function saudeDaConta(alunoId, matriculas, query = {}) {
  const ativas = matriculas.filter((m) => !['ESTORNADO', 'CANCELADO'].includes(m.statusPagamento) && m.turma.status !== 'CANCELADA');
  const exigem = await comprovanteSaude.cursosQueExigem(ativas.map((m) => m.turma.cursoId));
  const cursos = [...new Set(ativas.filter((m) => exigem[m.turma.cursoId]).map((m) => m.turma.curso.nome))];
  const comprovante = cursos.length || query.comprovante ? await comprovanteSaude.daPessoa(alunoId) : null;
  return {
    cursos,
    exigeCurso: exigem,
    comprovante,
    liberado: comprovanteSaude.liberado(comprovante),
    acabouDeEnviar: query.comprovante === 'enviado',
    erro: query.erroComprovante ? (query.erroComprovante === 'vazio' ? 'Escolha o arquivo do comprovante antes de enviar.' : String(query.erroComprovante).slice(0, 120)) : null,
  };
}

// Envio (ou troca) do comprovante pela Minha conta. Multipart: CSRF na query.
router.post('/conta/comprovante-saude', requireLogin, comprovanteSaude.receber('comprovante'), async (req, res) => {
  const volta = (q) => res.redirect(`/minha-conta?sec=inscricoes&${q}#comprovante`);
  if (req.uploadErro) return volta('erroComprovante=' + encodeURIComponent(req.uploadErro));
  if (!req.arquivos || !req.arquivos.length) return volta('erroComprovante=vazio');
  try {
    await comprovanteSaude.enviar(req.session.usuarioId, req.arquivos[0]);
  } catch (e) {
    console.error('[COMPROVANTE] envio em Minha conta:', e.message);
    return volta('erroComprovante=' + encodeURIComponent('Não foi possível guardar o comprovante agora. Tente de novo.'));
  }
  return volta('comprovante=enviado');
});

// Área do aluno — painel único com seções (inscricoes | dados | seguranca | excluir).
router.get('/minha-conta', requireLogin, async (req, res) => {
  const secValidas = ['inscricoes', 'dados', 'seguranca', 'excluir'];
  const sec = secValidas.includes(req.query.sec) ? req.query.sec : 'inscricoes';

  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
    prisma.matricula.findMany({
      where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA },
      orderBy: { criadoEm: 'desc' },
      include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
    }),
    excluirConta.contarEmAndamento(usuario.id),
    precisaTrocarSenha(usuario.id),
  ]);

  // 💡 NOVO — anexa o ponto de retomada em cada matrícula (null quando não há).
  const matriculasComRetomada = matriculas.map((m) => ({ ...m, retomada: calcularRetomada(m) }));

  res.render('minha-conta', {
    usuario,
    sec,
    matriculas: matriculasComRetomada,
    saude: await saudeDaConta(usuario.id, matriculas, req.query),
    avisosTurma: await avisosDeBoasVindas(matriculas),
    matriculasAtivas,
    docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
    formatBRL,
    inscrito: !!req.query.inscrito,
    escolaridades: ESCOLARIDADES,
    situacoes: SITUACOES_ESCOLARIDADE,
    generos: GENEROS,
    ufs: UFS,
    salvo: !!req.query.salvo,
    erro: null,
    senhaPrecisaTrocar,
    erroSenha: req.query.erroSenha || null,
    senhaAlterada: !!req.query.senhaAlterada,
  });
});

// Atualizar dados do perfil (escolaridade, situação, gênero). E-mail, nome e
// documento não mudam aqui. Endereço vai só como hidden (ver minha-conta.ejs).
router.post('/conta/dados', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const resultado = perfilSchema.safeParse(req.body);
  if (!resultado.success) {
    const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
      prisma.matricula.findMany({ where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA }, orderBy: { criadoEm: 'desc' }, include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } } }),
      excluirConta.contarEmAndamento(usuario.id),
      precisaTrocarSenha(usuario.id),
    ]);
    // Tela de erro de validação: o botão de retomada não é o foco aqui, mas
    // anexamos mesmo assim pra manter a lista consistente entre as telas.
    const matriculasComRetomada = matriculas.map((m) => ({ ...m, retomada: calcularRetomada(m) }));
    return res.status(400).render('minha-conta', {
      usuario: { ...usuario, escolaridade: req.body.escolaridade || '', escolaridadeSituacao: req.body.escolaridadeSituacao || '', genero: req.body.genero || '',
        cep: req.body.cep || '', logradouro: req.body.logradouro || '', numero: req.body.numero || '',
        complemento: req.body.complemento || '', bairro: req.body.bairro || '', cidade: req.body.cidade || '', uf: req.body.uf || '' },
      sec: 'dados', matriculas: matriculasComRetomada, matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
      formatBRL, inscrito: false, escolaridades: ESCOLARIDADES, situacoes: SITUACOES_ESCOLARIDADE, generos: GENEROS, ufs: UFS, salvo: false,
      erro: null, erroDados: resultado.error.issues.map((i) => i.message).join(' '),
      senhaPrecisaTrocar, erroSenha: null, senhaAlterada: false,
    });
  }

  // 💡 FIX — este bloco estava faltando: quando a validação passava, o
  // handler não gravava nada no banco nem respondia, deixando a requisição
  // pendurada pra sempre (mesmo bug que já existia em /completar-dados).
  const { escolaridade, escolaridadeSituacao, genero, cep, logradouro, numero, complemento, bairro, cidade, uf } = resultado.data;
  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      escolaridade, escolaridadeSituacao, genero: genero || null,
      cep: cep || null, logradouro: logradouro || null, numero: numero || null,
      complemento: complemento || null, bairro: bairro || null, cidade: cidade || null, uf: uf || null,
    },
  });
  return res.redirect('/minha-conta?sec=dados&salvo=1');
});

// Compatibilidade: /conta agora é a seção "dados" do painel.
router.get('/conta', requireLogin, (req, res) => res.redirect('/minha-conta?sec=dados'));

// Excluir conta — exige senha; bloqueia se houver inscrição em andamento.
router.post('/conta/excluir', requireLogin, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.session.usuarioId } });
  if (!usuario) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }

  const reRender = async (erro) => {
    const [matriculas, matriculasAtivas, senhaPrecisaTrocar] = await Promise.all([
      prisma.matricula.findMany({
        where: { alunoId: usuario.id, ...FILTRO_MATRICULA_FANTASMA },
        orderBy: { criadoEm: 'desc' },
        include: { turma: { include: { curso: true, aulas: { orderBy: { data: 'asc' }, take: 1 } } } },
      }),
      excluirConta.contarEmAndamento(usuario.id),
      precisaTrocarSenha(usuario.id),
    ]);
    const matriculasComRetomada = matriculas.map((m) => ({ ...m, retomada: calcularRetomada(m) }));
    return res.status(400).render('minha-conta', {
      usuario,
      sec: 'excluir',
      matriculas: matriculasComRetomada,
      matriculasAtivas,
      docMascarado: usuario.cpfCnpj ? mascarar(usuario.cpfCnpj) : usuario.passaporte ? usuario.passaporte : '—',
      formatBRL,
      inscrito: false,
      erro,
      senhaPrecisaTrocar, erroSenha: null, senhaAlterada: false,
    });
  };

  // Confirma identidade pela senha.
  const senhaOk = await verificarSenha(usuario.senhaHash, req.body.senha || '');
  if (!senhaOk) {
    return reRender('Senha incorreta. A conta não foi excluída.');
  }

  // Bloqueia só com inscrição em andamento (lib/excluir-conta.js): curso concluído, cancelado ou
  // estornado não impede.
  const ativas = await excluirConta.contarEmAndamento(usuario.id);
  if (ativas > 0) {
    return reRender('Você tem inscrições em andamento. Fale com a secretaria antes de excluir a conta.');
  }

  try {
    // Apaga a conta; se houver pagamento a guardar por lei, anonimiza (ver lib/excluir-conta.js).
    const resultado = await excluirConta.excluir(usuario);

    return req.session.destroy(() => {
      res.clearCookie('escola.sid');
      res.render('conta-excluida', { anonimizada: resultado === 'anonimizada' });
    });
  } catch (err) {
    console.error('Erro ao excluir conta:', err);
    return reRender('Não foi possível excluir a conta agora. Tente novamente.');
  }
});

// Política de Privacidade (pública): o que este site faz com os dados + o Termo de LGPD da
// instituição (o mesmo texto de /arquivo/privacidade.pdf).
router.get('/privacidade', (req, res) => res.render('privacidade'));

module.exports = router;