// routes/escola-digital/index.js
//
// Roteador da Escola Digital (cursos online) no site do aluno. Com a chave desligada
// (lib/escola-digital/config.js), passa adiante todas as requisições e o 404 do site responde.

const express = require('express');
const config = require('../../lib/escola-digital/config');

const router = express.Router();

router.use((req, res, next) => {
  if (!config.ligada()) return next('router');
  return next();
});

// Aqui entrarão os roteadores da loja e do estudo (tarefas seguintes).
router.get('/digital', (req, res) => res.send('ok'));

module.exports = router;
