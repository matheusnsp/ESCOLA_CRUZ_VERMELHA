// routes/contas.js — Contas a pagar (regras em lib/contas.js).
//
// Montado dentro do painel (routes/admin.js), depois do login. Quem lança (contas:lancar) não vê
// o caixa: as telas daqui só mostram os itens lançados e o andamento de cada um.

const express = require('express');
const prisma = require('../db');
const contas = require('../lib/contas');
const anexos = require('../lib/contas-anexos');
const { enviarAvisoContas } = require('../lib/email');
const { temPermissao, PAPEIS_EDITAVEIS } = require('../lib/permissoes');

const QUALQUER = ['contas:lancar', 'contas:aprovar', 'contas:pagar'];

module.exports = function rotasContas({ requirePermissao, auditar, ADMIN_URL }) {
  const router = express.Router();
  const ator = (req) => ({ id: req.session.usuarioId || 'SISTEMA', nome: req.session.nome || 'Secretaria' });
  const pode = (req, perm) => temPermissao(req.session.papel, perm);
  const voltar = (res, url, tipo, msg) => res.redirect(url + (url.includes('?') ? '&' : '?') + tipo + '=' + encodeURIComponent(msg));

  // Avisos por e-mail: nunca atrasam nem derrubam a tela.
  function avisar(emails, dados) {
    Promise.all(emails.map((u) => enviarAvisoContas(u.email, u.nome, dados)))
      .catch((e) => console.error('[contas] e-mail:', e.message));
  }
  async function pessoasCom(perm) {
    const papeis = PAPEIS_EDITAVEIS.filter((p) => temPermissao(p, perm));
    if (!papeis.length) return [];
    return prisma.usuario.findMany({ where: { papel: { in: papeis } }, select: { email: true, nome: true } });
  }

  // Quando o diretor termina um envio, quem enviou recebe o resumo, uma vez só (id fixo no log).
  async function avisarSeRevisado(req, loteId) {
    if (!loteId) return;
    const r = await contas.envioRevisado(loteId);
    if (!r) return;
    try {
      await prisma.logAuditoria.create({ data: { id: `contas-revisado-${loteId}`, atorId: ator(req).id, acao: 'CONTAS_ENVIO_REVISADO', alvoTipo: 'ContasLote', alvoId: loteId } });
    } catch (e) {
      if (e.code === 'P2002') return; // já avisado
      throw e;
    }
    const aprovadas = r.itens.filter((i) => i.situacao === 'APROVADA' || i.situacao === 'PAGA').length;
    const recusadas = r.itens.filter((i) => i.situacao === 'RECUSADA').length;
    const quem = await prisma.usuario.findUnique({ where: { id: r.lote.enviadoPor }, select: { email: true, nome: true } });
    if (quem) {
      avisar([quem], {
        assunto: `Despesas revisadas: ${aprovadas} aprovada${aprovadas === 1 ? '' : 's'}${recusadas ? `, ${recusadas} recusada${recusadas === 1 ? '' : 's'}` : ''}`,
        texto: `O envio de ${new Date(r.lote.enviadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} foi revisado. ${recusadas ? 'Veja o motivo das recusadas no sistema.' : 'Tudo aprovado.'}`,
        link: `${ADMIN_URL}/contas?aba=enviadas`, botao: 'Ver as despesas',
      });
    }
  }

  // ---------- lista ----------

  router.get('/contas', requirePermissao(...QUALQUER), async (req, res) => {
    const [itens, lotes] = await Promise.all([contas.listarItens(), contas.listarLotes()]);
    const abas = [];
    if (pode(req, 'contas:lancar')) abas.push('semana', 'enviadas');
    if (pode(req, 'contas:aprovar')) abas.push('aprovar');
    if (pode(req, 'contas:pagar')) abas.push('pagar');
    abas.push('historico');
    const padrao = pode(req, 'contas:aprovar') ? 'aprovar' : pode(req, 'contas:pagar') ? 'pagar' : 'semana';
    const aba = abas.includes(req.query.aba) ? req.query.aba : padrao;
    const por = (s) => itens.filter((i) => i.situacao === s);
    res.render('admin/contas', {
      aba, abas, itens, lotes: Object.fromEntries(lotes.map((l) => [l.id, l])),
      rascunhos: por('RASCUNHO'),
      aguardando: por('AGUARDANDO'),
      aPagar: por('APROVADA').sort((a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999'))),
      enviadas: itens.filter((i) => i.situacao !== 'RASCUNHO'),
      contas, semanaAtual: contas.rotuloSemana(contas.segundaDaSemana()),
      ok: req.query.ok || null, erro: req.query.erro || null,
    });
  });

  // ---------- lançar ----------

  router.get('/contas/nova', requirePermissao('contas:lancar'), (req, res) => {
    const tipo = contas.TIPOS[req.query.tipo] ? req.query.tipo : 'DESPESA';
    res.render('admin/conta-form', { item: { tipo, anexos: [] }, novo: true, contas, erro: null });
  });

  router.post('/contas', requirePermissao('contas:lancar'), anexos.receber('anexos'), async (req, res) => {
    const { dados, erro } = contas.lerFormulario(req.body);
    const falha = req.uploadErro || erro;
    if (falha) return res.status(400).render('admin/conta-form', { item: { ...dados, valorTexto: req.body.valor, anexos: [] }, novo: true, contas, erro: falha });
    let salvos = [];
    try {
      salvos = await anexos.guardar(req.arquivos, contas.segundaDaSemana());
      const item = await contas.criar(dados, salvos, ator(req));
      await auditar(req, 'CONTAS_LANCOU', 'Conta', item.id, { tipo: item.tipo, valor: item.valor, anexos: salvos.length });
      voltar(res, '/contas?aba=semana', 'ok', `Lançado: ${item.descricao}. Envie para aprovação quando fechar a semana.`);
    } catch (e) {
      await anexos.apagar(salvos);
      console.error('[contas] lançar:', e.message);
      res.status(500).render('admin/conta-form', { item: { ...dados, valorTexto: req.body.valor, anexos: [] }, novo: true, contas, erro: 'Não foi possível salvar. ' + (e instanceof contas.ErroContas ? e.message : 'Tente de novo.') });
    }
  });

  // Enviar a semana (todos os não enviados) ou os marcados.
  router.post('/contas/enviar', requirePermissao('contas:lancar'), async (req, res) => {
    const ids = req.body.todos
      ? (await contas.listarItens()).filter((i) => i.situacao === 'RASCUNHO').map((i) => i.id)
      : [].concat(req.body.ids || []).map(String);
    try {
      const { lote, itens } = await contas.enviar(ids, ator(req));
      await auditar(req, 'CONTAS_ENVIOU', 'ContasLote', lote.id, { itens: itens.length, total: lote.total });
      avisar(await pessoasCom('contas:aprovar'), {
        assunto: `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} para aprovar (${contas.reais(lote.total)})`,
        texto: `${lote.enviadoPorNome} enviou para aprovação: ${contas.rotuloSemana(lote.semana).toLowerCase()}, ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}, total de ${contas.reais(lote.total)}.`,
        link: `${ADMIN_URL}/contas?aba=aprovar`, botao: 'Revisar e aprovar',
      });
      voltar(res, '/contas?aba=enviadas', 'ok', `Enviado para aprovação: ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}, ${contas.reais(lote.total)}.`);
    } catch (e) {
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, '/contas?aba=semana', 'erro', e.message);
    }
  });

  // Aprovar todos os que ainda aguardam num envio.
  router.post('/contas/lote/:loteId/aprovar', requirePermissao('contas:aprovar'), async (req, res) => {
    const lote = await contas.lerLote(req.params.loteId);
    if (!lote) return voltar(res, '/contas?aba=aprovar', 'erro', 'Envio não encontrado.');
    let n = 0;
    for (const id of lote.itens) {
      try {
        await contas.decidir(id, true, null, ator(req));
        n++;
      } catch (e) {
        if (!(e instanceof contas.ErroContas)) throw e;
      }
    }
    await auditar(req, 'CONTAS_APROVOU_ENVIO', 'ContasLote', lote.id, { aprovados: n });
    await avisarSeRevisado(req, lote.id);
    voltar(res, '/contas?aba=aprovar', 'ok', n ? `${n} ${n === 1 ? 'item aprovado' : 'itens aprovados'}.` : 'Nada mais aguardando neste envio.');
  });

  // ---------- um item ----------

  async function carregar(req, res) {
    const lido = await contas.lerItem(req.params.id);
    if (!lido) {
      res.status(404).render('admin/erro', { mensagem: 'Item não encontrado.' });
      return null;
    }
    return lido.item;
  }

  router.get('/contas/:id', requirePermissao(...QUALQUER), async (req, res) => {
    const item = await carregar(req, res);
    if (!item) return;
    const lote = item.loteId ? await contas.lerLote(item.loteId) : null;
    res.render('admin/conta', { item, lote, contas, hoje: new Date().toISOString().slice(0, 10), ok: req.query.ok || null, erro: req.query.erro || null });
  });

  router.get('/contas/:id/editar', requirePermissao('contas:lancar'), async (req, res) => {
    const item = await carregar(req, res);
    if (!item) return;
    if (item.situacao !== 'RASCUNHO') return voltar(res, `/contas/${item.id}`, 'erro', 'Depois de enviado, o item não pode mais ser editado.');
    res.render('admin/conta-form', { item, novo: false, contas, erro: null });
  });

  router.post('/contas/:id', requirePermissao('contas:lancar'), anexos.receber('anexos'), async (req, res) => {
    const item = await carregar(req, res);
    if (!item) return;
    const { dados, erro } = contas.lerFormulario(req.body);
    const falha = req.uploadErro || erro
      || (item.anexos.length - [].concat(req.body.removerAnexo || []).length + req.arquivos.length > 10 ? 'No máximo 10 anexos por item.' : null);
    if (falha) return res.status(400).render('admin/conta-form', { item: { ...item, ...dados, valorTexto: req.body.valor }, novo: false, contas, erro: falha });
    let salvos = [];
    try {
      salvos = await anexos.guardar(req.arquivos, contas.segundaDaSemana());
      const { saem } = await contas.editar(item.id, dados, salvos, [].concat(req.body.removerAnexo || []), ator(req));
      await anexos.apagar(saem);
      await auditar(req, 'CONTAS_EDITOU', 'Conta', item.id, { valor: dados.valor });
      voltar(res, '/contas?aba=semana', 'ok', 'Alterações salvas.');
    } catch (e) {
      await anexos.apagar(salvos);
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, `/contas/${item.id}`, 'erro', e.message);
    }
  });

  router.post('/contas/:id/excluir', requirePermissao('contas:lancar'), async (req, res) => {
    try {
      const item = await contas.excluir(req.params.id);
      await anexos.apagar(item.anexos);
      await auditar(req, 'CONTAS_EXCLUIU', 'Conta', item.id, { descricao: item.descricao, valor: item.valor });
      voltar(res, '/contas?aba=semana', 'ok', 'Item excluído.');
    } catch (e) {
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, '/contas?aba=semana', 'erro', e.message);
    }
  });

  // Enviar um item sozinho, sem esperar a semana (pedido de compra ou reembolso urgente).
  router.post('/contas/:id/enviar', requirePermissao('contas:lancar'), async (req, res) => {
    try {
      const { lote, itens } = await contas.enviar([req.params.id], ator(req));
      const i = itens[0];
      await auditar(req, 'CONTAS_ENVIOU', 'ContasLote', lote.id, { itens: 1, total: lote.total });
      avisar(await pessoasCom('contas:aprovar'), {
        assunto: `${contas.TIPOS[i.tipo].nome} para aprovar (${contas.reais(i.valor)})`,
        texto: `${lote.enviadoPorNome} enviou para aprovação: ${i.descricao} (${i.favorecido}), ${contas.reais(i.valor)}.`,
        link: `${ADMIN_URL}/contas/${i.id}`, botao: 'Revisar e aprovar',
      });
      voltar(res, '/contas?aba=enviadas', 'ok', 'Enviado para aprovação.');
    } catch (e) {
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, `/contas/${req.params.id}`, 'erro', e.message);
    }
  });

  router.post('/contas/:id/aprovar', requirePermissao('contas:aprovar'), async (req, res) => {
    const volta = req.body.voltar === 'item' ? `/contas/${req.params.id}` : '/contas?aba=aprovar';
    try {
      const item = await contas.decidir(req.params.id, true, null, ator(req));
      await auditar(req, 'CONTAS_APROVOU', 'Conta', item.id, { valor: item.valor });
      await avisarSeRevisado(req, item.loteId);
      voltar(res, volta, 'ok', `Aprovado: ${item.descricao}.`);
    } catch (e) {
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, volta, 'erro', e.message);
    }
  });

  router.post('/contas/:id/recusar', requirePermissao('contas:aprovar'), async (req, res) => {
    const volta = req.body.voltar === 'item' ? `/contas/${req.params.id}` : '/contas?aba=aprovar';
    try {
      const item = await contas.decidir(req.params.id, false, req.body.motivo, ator(req));
      await auditar(req, 'CONTAS_RECUSOU', 'Conta', item.id, { valor: item.valor, motivo: item.decisao.motivo });
      await avisarSeRevisado(req, item.loteId);
      voltar(res, volta, 'ok', `Recusado: ${item.descricao}.`);
    } catch (e) {
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, volta, 'erro', e.message);
    }
  });

  router.post('/contas/:id/pagar', requirePermissao('contas:pagar'), anexos.receber('comprovantes'), async (req, res) => {
    const volta = `/contas/${req.params.id}`;
    if (req.uploadErro) return voltar(res, volta, 'erro', req.uploadErro);
    let salvos = [];
    try {
      salvos = await anexos.guardar(req.arquivos, 'pagos');
      const item = await contas.marcarPaga(req.params.id, { data: req.body.pagoEm, forma: req.body.forma, observacao: req.body.observacao }, salvos, ator(req));
      await auditar(req, 'CONTAS_PAGOU', 'Conta', item.id, { valor: item.valor, forma: item.pagamento.forma, pagoEm: item.pagamento.pagoEm });
      voltar(res, req.body.voltar === 'lista' ? '/contas?aba=pagar' : volta, 'ok', `Marcado como pago: ${item.descricao}.`);
    } catch (e) {
      await anexos.apagar(salvos);
      if (!(e instanceof contas.ErroContas)) throw e;
      voltar(res, volta, 'erro', e.message);
    }
  });

  // Abre um anexo (nota/boleto/recibo) ou comprovante de pagamento, só para quem está logado com
  // alguma permissão das Contas a pagar.
  router.get('/contas/:id/:qual(anexos|comprovantes)/:n', requirePermissao(...QUALQUER), async (req, res) => {
    const item = await carregar(req, res);
    if (!item) return;
    const lista = req.params.qual === 'anexos' ? item.anexos : (item.pagamento && item.pagamento.comprovantes) || [];
    const anexo = lista[Number(req.params.n)];
    if (!anexo) return res.status(404).render('admin/erro', { mensagem: 'Arquivo não encontrado.' });
    try {
      const { tipo, buffer } = await anexos.abrir(anexo);
      res.set({
        'Content-Type': tipo,
        'Content-Disposition': `${req.query.baixar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(anexo.nome)}`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; plugin-types application/pdf",
      });
      res.send(buffer);
    } catch (e) {
      console.error('[contas] abrir anexo:', e.message);
      res.status(502).render('admin/erro', { mensagem: 'Não foi possível abrir o arquivo agora. Tente de novo.' });
    }
  });

  return router;
};

