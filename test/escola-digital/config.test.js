const { test } = require('node:test'); const assert = require('node:assert');
const cfg = () => { delete require.cache[require.resolve('../../src/lib/escola-digital/config')]; return require('../../src/lib/escola-digital/config'); };
test('desligada por padrão', () => { delete process.env.ESCOLA_DIGITAL; assert.equal(cfg().ligada(), false); });
test('liga só com 1', () => { process.env.ESCOLA_DIGITAL = '1'; assert.equal(cfg().ligada(), true); process.env.ESCOLA_DIGITAL = 'true'; assert.equal(cfg().ligada(), false); });
test('simulado nunca em produção', () => { process.env.ESCOLA_DIGITAL_PAGAMENTO_SIMULADO = '1'; process.env.NODE_ENV = 'production'; assert.equal(cfg().pagamentoSimulado(), false); process.env.NODE_ENV = 'development'; assert.equal(cfg().pagamentoSimulado(), true); });
