// Envolve um handler async para que qualquer exceção (ex.: timeout do banco)
// seja encaminhada ao middleware de erro do Express em vez de virar uma
// "unhandled rejection" — que, no Node moderno, derruba o processo inteiro.
//
// Uso nas rotas:
//   const asyncHandler = require('../lib/asyncHandler');
//   router.get('/rota', asyncHandler(async (req, res) => { ... }));
//
// Assim um erro numa rota vira uma página de erro amigável, não a queda do site.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
