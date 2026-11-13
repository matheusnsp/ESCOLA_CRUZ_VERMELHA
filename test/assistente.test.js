// 2026-11-13: assistente — laço com o Claude (cliente falso), eventos e regras (spec §1, §4, §6).
require('dotenv').config();
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const assistente = require('../src/lib/assistente');
const uso = require('../src/lib/assistente-uso');
const ia = require('../src/lib/ead-ia');
const ferr = require('../src/lib/assistente-ferramentas');

// Cliente falso: cada chamada devolve a próxima resposta da fila (textos em pedaços + mensagem final).
function clienteFalso(respostas) {
  const chamadas = [];
  return {
    chamadas,
    beta: { messages: { stream(params) {
      chamadas.push(JSON.parse(JSON.stringify(params)));
      const r = respostas.shift();
      const ouvintes = [];
      return {
        on(ev, cb) { if (ev === 'text') ouvintes.push(cb); return this; },
        async finalMessage() {
          if (r instanceof Error) throw r;
          for (const t of r.pedacos || []) ouvintes.forEach((cb) => cb(t));
          return { content: r.content, stop_reason: r.stop_reason, usage: r.usage || { input_tokens: 100, output_tokens: 20 } };
        },
      };
    } } },
  };
}
const texto = (t) => ({ pedacos: [t.slice(0, 5), t.slice(5)], content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });

let orig;
beforeEach(() => {
  orig = { podeEnviar: uso.podeEnviar, registrarUso: uso.registrarUso, teto: ia.dentroDoTeto, somar: ia.somarCustoAvulso, chave: ia.ehChaveConfigurada, consulta: ferr.executarConsulta };
  uso.podeEnviar = async () => ({ ok: true });
  uso.registrarUso = async (...a) => { registros.push(a); };
  ia.dentroDoTeto = async () => ({ ok: true });
  ia.somarCustoAvulso = async () => {};
  ia.ehChaveConfigurada = () => true;
  registros = [];
});
afterEach(() => { Object.assign(uso, { podeEnviar: orig.podeEnviar, registrarUso: orig.registrarUso }); Object.assign(ia, { dentroDoTeto: orig.teto, somarCustoAvulso: orig.somar, ehChaveConfigurada: orig.chave }); ferr.executarConsulta = orig.consulta; });
let registros = [];

const base = (extra) => ({ mensagens: [{ papel: 'pessoa', texto: 'oi' }], pagina: { caminho: '/pendentes', busca: '' }, usuarioId: 'u1', pode: () => true, papel: 'SECRETARIA', ...extra });
async function rodar(cliente, extra) { const ev = []; await assistente.responder({ ...base(extra), cliente, emitir: (e) => ev.push(e) }); return ev; }

test('resposta simples: texto aos poucos, resposta final filtrada, fim; uso registrado', async () => {
  const c = clienteFalso([texto('Abra [Pendentes](/pendentes?aba=com-taxa) ou [isto](https://x.com).')]);
  const ev = await rodar(c);
  assert.deepEqual(ev.filter((e) => e.tipo === 'texto').map((e) => e.texto), ['Abra ', '[Pendentes](/pendentes?aba=com-taxa) ou [isto](https://x.com).']);
  assert.equal(ev.find((e) => e.tipo === 'resposta').texto, 'Abra [Pendentes](/pendentes?aba=com-taxa) ou isto.');
  assert.equal(ev[ev.length - 1].tipo, 'fim');
  assert.equal(registros.length, 1);
  assert.equal(registros[0][0], 'u1');
  const p = c.chamadas[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.deepEqual(p.output_config, { effort: 'low' });
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.system[0].cache_control.type, 'ephemeral');
  assert.equal(p.temperature, undefined);
  const ultima = p.messages[p.messages.length - 1];
  assert.equal(ultima.role, 'system');
  assert.match(ultima.content, /Página atual: Alunos › Pendentes/);
});

test('ferramenta: executa, devolve todos os resultados numa mensagem e continua', async () => {
  ferr.executarConsulta = async (nome, entrada) => ({ ok: nome, entrada });
  const c = clienteFalso([
    { content: [{ type: 'tool_use', id: 't1', name: 'buscar_alunos', input: { termo: 'maria' } }, { type: 'tool_use', id: 't2', name: 'listar_turmas', input: {} }], stop_reason: 'tool_use' },
    texto('Achei.'),
  ]);
  const ev = await rodar(c);
  assert.deepEqual(ev.filter((e) => e.tipo === 'ferramenta').map((e) => e.nome), ['buscar_alunos', 'listar_turmas']);
  const segunda = c.chamadas[1].messages;
  const resultados = segunda[segunda.length - 1];
  assert.equal(resultados.role, 'user');
  assert.deepEqual(resultados.content.map((b) => [b.type, b.tool_use_id]), [['tool_result', 't1'], ['tool_result', 't2']]);
  assert.deepEqual(JSON.parse(resultados.content[0].content), { ok: 'buscar_alunos', entrada: { termo: 'maria' } });
  assert.deepEqual(registros[0][2], ['buscar_alunos', 'listar_turmas']);
});

test('preencher: evento vai para o navegador', async () => {
  const c = clienteFalso([
    { content: [{ type: 'tool_use', id: 't1', name: 'preencher_curso', input: { campos: { nome: 'Curso X', cargaHoraria: 8 } } }], stop_reason: 'tool_use' },
    texto('Preparei.'),
  ]);
  const ev = await rodar(c, { pode: (p) => p === 'cursos:criar' });
  const pre = ev.find((e) => e.tipo === 'preencher');
  assert.deepEqual(pre, { tipo: 'preencher', formulario: 'curso', campos: { nome: 'Curso X', cargaHoraria: '8' } });
});

test('no máximo 6 rodadas de ferramentas', async () => {
  ferr.executarConsulta = async () => ({});
  const sempre = () => ({ content: [{ type: 'tool_use', id: 't' + Math.random(), name: 'listar_turmas', input: {} }], stop_reason: 'tool_use' });
  const c = clienteFalso(Array.from({ length: 10 }, sempre));
  const ev = await rodar(c);
  assert.equal(c.chamadas.length, 6);
  assert.match(ev.find((e) => e.tipo === 'resposta').texto, /não consegui terminar/i);
});

test('recusa, erro da API, chave, teto, limite e mensagem longa viram mensagens amigáveis', async () => {
  let ev = await rodar(clienteFalso([{ content: [], stop_reason: 'refusal' }]));
  assert.match(ev.find((e) => e.tipo === 'erro').mensagem, /Não posso ajudar com esse pedido/);
  ev = await rodar(clienteFalso([new Error('socket hang up')]));
  assert.equal(ev.find((e) => e.tipo === 'erro').mensagem, 'O assistente está fora do ar agora. Tente de novo em instantes.');
  ia.ehChaveConfigurada = () => false;
  ev = []; await assistente.responder({ ...base(), emitir: (e) => ev.push(e) });
  assert.equal(ev[0].mensagem, 'O assistente ainda não está ligado (falta a chave da API no servidor).');
  ia.ehChaveConfigurada = () => true;
  ia.dentroDoTeto = async () => ({ ok: false, erro: 'x' });
  ev = await rodar(clienteFalso([texto('nunca')]));
  assert.equal(ev[0].mensagem, 'O limite de uso de IA deste mês foi atingido. Fale com o dev.');
  ia.dentroDoTeto = async () => ({ ok: true });
  uso.podeEnviar = async () => ({ ok: false, erro: 'Você usou muito o assistente agora; tente de novo em alguns minutos.' });
  ev = await rodar(clienteFalso([texto('nunca')]));
  assert.equal(ev[0].mensagem, 'Você usou muito o assistente agora; tente de novo em alguns minutos.');
  uso.podeEnviar = async () => ({ ok: true });
  ev = await rodar(clienteFalso([texto('nunca')]), { mensagens: [{ papel: 'pessoa', texto: 'x'.repeat(2001) }] });
  assert.equal(ev[0].mensagem, 'A mensagem passou de 2.000 caracteres. Resuma um pouco e envie de novo.');
});

test('só as últimas 20 mensagens de texto vão para a API, alternando pessoa/assistente', async () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({ papel: i % 2 ? 'assistente' : 'pessoa', texto: `m${i}` })).concat([{ papel: 'pessoa', texto: 'última' }]);
  const c = clienteFalso([texto('ok')]);
  await rodar(c, { mensagens: msgs });
  const conv = c.chamadas[0].messages.filter((m) => m.role !== 'system');
  assert.ok(conv.length <= 20);
  assert.equal(conv[0].role, 'user');
  assert.equal(conv[conv.length - 1].content, 'última');
});

test('rota POST /assistente/mensagem: painel logado, NDJSON sem compressão', () => {
  const a = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  const i = a.indexOf("router.post('/assistente/mensagem'");
  assert.ok(i > a.indexOf('router.use(requireAdmin);'));
  const corpo = a.slice(i, i + 1500);
  assert.match(corpo, /application\/x-ndjson/);
  assert.match(corpo, /no-transform/);
  assert.match(corpo, /assistente\.responder\(/);
  assert.match(corpo, /documentoAluno: req\.app\.locals\.documentoAluno/);
});
