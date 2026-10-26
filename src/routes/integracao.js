// Integração: links de dados que o Excel (Dados → Da Web) busca para a planilha se atualizar
// sozinha (lib/planilha-ao-vivo.js). Fica no endereço público do site, e não no painel, para o
// link funcionar de qualquer computador; o Excel não tem login, entra com a chave do link. Sem
// chave válida responde 404, como se a página não existisse. A chave é gerada na aba Integração.
const express = require('express');
const rateLimit = require('express-rate-limit');
const planilha = require('../lib/planilha-ao-vivo');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// As tabelas são as de planilha.TABELAS; só GET: a planilha lê, nunca grava.
router.get('/integracao/:tabela(matriculas|alunos|cursos|turmas).csv', limiter, async (req, res) => {
  if (!(await planilha.chaveValida(req.query.chave))) return res.status(404).type('text/plain').send('Não encontrado.');
  const csv = await planilha.gerarCsv(req.params.tabela);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.send(csv);
});

module.exports = router;
