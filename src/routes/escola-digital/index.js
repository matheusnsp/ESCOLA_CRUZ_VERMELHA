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

// Sub-roteadores: só entram depois da trava acima. O do estudo vem nas tarefas seguintes.
router.use(require('./loja'));
router.use(require('./pagamento'));

module.exports = router;
