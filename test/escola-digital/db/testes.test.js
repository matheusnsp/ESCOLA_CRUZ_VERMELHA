// Teste do "Teste rápido" (3 perguntas por tópico) e do "Já sei isso?" (10 perguntas por módulo),
// Task 9. A regra (sorteio, resposta, finalização) é testada direto em lib/escola-digital/testes.js;
// as rotas e seus portões, com o servidor de verdade (processo filho) e login real.
// Só roda contra banco local (localhost / 127.0.0.1):
//   DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
// Os alunos, as inscrições e as perguntas temporárias são criados aqui e apagados no fim.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ehBancoLocal } = require('../../../src/lib/escola-digital/conteudo');
const { iniciarServidor } = require('../ajuda/servidor');

delete process.env.RESEND_API_KEY;

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const DOMINIO = 'testes-ead.invalid';
const EXEC = `${process.pid}${Date.now() % 100000}`;
const DIA = 86400000;

let prisma;
let estudo;
let testes;
let servidor;
let curso;
let cursoAlheio;
let modulos;
let modulosAlheios;
let pastaTemp;
let alunoA;
let alunoB;
let inscricao;
let inscricaoB;
let clienteA;
let clienteB;
let fs; let os; let path;
const temporarias = [];          // ids de perguntas criadas pelos testes
const desativadas = new Set();   // ids de perguntas que o teste desativou (voltam a ativa no beforeEach)

function cliente() {
  let cookie = '';
  const guardar = (r) => {
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of sc) { if (c.startsWith('escola.sid=')) cookie = c.split(';')[0]; }
  };
  return {
    async get(caminho) {
      const r = await fetch(servidor.url + caminho, { redirect: 'manual', headers: cookie ? { cookie } : {} });
      guardar(r);
      return r;
    },
    async post(caminho, corpo) {
      const r = await fetch(servidor.url + caminho, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(corpo).toString(),
      });
      guardar(r);
      return r;
    },
  };
}

const lerCsrf = (html) => html.match(/name="_csrf"\s+value="([0-9a-f]+)"/)[1];

async function entrar(email) {
  const c = cliente();
  const f = await c.get('/login');
  const l = await c.post('/login', { _csrf: lerCsrf(await f.text()), identificador: email, senha: '1234' });
  assert.strictEqual(l.status, 302, 'login do teste');
  const conta = await c.get('/minha-conta?sec=seguranca');
  c.csrf = lerCsrf(await conta.text());
  return c;
}

const base = () => `/digital/estudo/${inscricao.id}`;
const mod = (ordem) => modulos.find((m) => m.ordem === ordem);
const telasDe = (m) => m.topicos.flatMap((t) => t.telas);
const lerInscricao = () => prisma.inscricaoOnline.findUnique({ where: { id: inscricao.id } });
const concluidos = () => prisma.moduloConcluido.findMany({ where: { inscricaoId: inscricao.id } });
const tentativas = () => prisma.tentativaTeste.findMany({ where: { inscricaoId: inscricao.id }, orderBy: { criadoEm: 'asc' } });

async function concluirAte(ate) {
  const data = modulos.filter((x) => x.ordem < ate).map((m) => ({ inscricaoId: inscricao.id, moduloId: m.id, como: 'TELAS' }));
  await prisma.moduloConcluido.createMany({ data, skipDuplicates: true });
}

const verTelas = async (m) => { for (const t of telasDe(m)) await estudo.marcarVista(inscricao.id, t.id); };

// Cria `n` perguntas temporárias (ativas) num tópico.
async function adicionarPerguntas(topicoId, n, extra = {}) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const p = await prisma.perguntaOnline.create({
      data: {
        topicoId, chave: `tmp-${EXEC}-${temporarias.length}`, enunciado: `Pergunta temporária ${temporarias.length}`,
        alternativas: ['Certa', 'Errada 1', 'Errada 2'], correta: 0, porque: 'Porque sim.', ...extra,
      },
    });
    temporarias.push(p.id);
    ids.push(p.id);
  }
  return ids;
}

async function desativar(ids) {
  await prisma.perguntaOnline.updateMany({ where: { id: { in: ids } }, data: { ativa: false } });
  ids.forEach((id) => desativadas.add(id));
}

// Responde as perguntas do snapshot: as primeiras `certas` com a alternativa certa, as demais erradas.
async function responderTudo(tentativa, certas) {
  const perguntas = (await prisma.tentativaTeste.findUnique({ where: { id: tentativa.id } })).perguntas;
  for (let i = 0; i < perguntas.length; i++) {
    const p = perguntas[i];
    const alt = i < certas ? p.correta : (p.correta + 1) % p.alternativas.length;
    await testes.responder(tentativa.id, p.id, alt);
  }
}

before(async () => {
  if (!local) return;
  fs = require('node:fs'); os = require('node:os'); path = require('node:path');
  prisma = require('../../../src/db');
  const { carregarCurso, resolverPasta } = require('../../../src/lib/escola-digital/conteudo');
  const { hashSenha } = require('../../../src/lib/password');
  await carregarCurso(resolverPasta('primeiros-socorros'), prisma);
  curso = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', nome: { startsWith: 'Primeiros Socorros' } } });
  modulos = await prisma.moduloOnline.findMany({
    where: { cursoId: curso.id }, orderBy: { ordem: 'asc' },
    include: { topicos: { orderBy: { ordem: 'asc' }, include: { telas: { orderBy: { ordem: 'asc' } } } } },
  });
  assert.ok(modulos.length >= 4);

  // Cópia do conteúdo com outro nome: um segundo curso online, para provar o isolamento entre cursos.
  pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'testes-ead-')) + '/curso';
  fs.mkdirSync(pastaTemp, { recursive: true });
  const origem = resolverPasta('primeiros-socorros');
  for (const f of fs.readdirSync(origem)) {
    const dados = JSON.parse(fs.readFileSync(path.join(origem, f), 'utf8'));
    if (f === 'curso.json') dados.nome = `Curso Alheio Testes ${EXEC}`;
    fs.writeFileSync(path.join(pastaTemp, f), JSON.stringify(dados));
  }
  await carregarCurso(pastaTemp, prisma);
  cursoAlheio = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', nome: `Curso Alheio Testes ${EXEC}` } });
  modulosAlheios = await prisma.moduloOnline.findMany({
    where: { cursoId: cursoAlheio.id }, orderBy: { ordem: 'asc' },
    include: { topicos: { orderBy: { ordem: 'asc' }, include: { telas: { orderBy: { ordem: 'asc' } } } } },
  });

  const senhaHash = await hashSenha('1234');
  const criar = (n) => prisma.usuario.create({ data: { nome: `Aluno Testes ${n}`, email: `t${EXEC}x${n}@${DOMINIO}`, papel: 'ALUNO', senhaHash } });
  alunoA = await criar(1);
  alunoB = await criar(2);
  inscricao = await prisma.inscricaoOnline.create({
    data: { alunoId: alunoA.id, cursoId: curso.id, situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA) },
  });
  inscricaoB = await prisma.inscricaoOnline.create({
    data: { alunoId: alunoB.id, cursoId: curso.id, situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA) },
  });

  estudo = require('../../../src/lib/escola-digital/estudo');
  testes = require('../../../src/lib/escola-digital/testes');
  servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
  clienteA = await entrar(alunoA.email);
  clienteB = await entrar(alunoB.email);
});

async function limpar() {
  const ids = [inscricao.id, inscricaoB.id];
  await prisma.tentativaTeste.deleteMany({ where: { inscricaoId: { in: ids } } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: { in: ids } } });
  await prisma.telaVista.deleteMany({ where: { inscricaoId: { in: ids } } });
  if (temporarias.length) await prisma.perguntaOnline.deleteMany({ where: { id: { in: temporarias } } });
  temporarias.length = 0;
  if (desativadas.size) await prisma.perguntaOnline.updateMany({ where: { id: { in: [...desativadas] } }, data: { ativa: true } });
  desativadas.clear();
}

beforeEach(async () => {
  if (!local) return;
  await limpar();
  await prisma.inscricaoOnline.update({
    where: { id: inscricao.id },
    data: { situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA), concluidaEm: null },
  });
});

after(async () => {
  if (!prisma) return;
  if (servidor) await servidor.parar();
  if (inscricao) await limpar();
  const ids = [alunoA, alunoB].filter(Boolean).map((u) => u.id);
  const insc = (await prisma.inscricaoOnline.findMany({ where: { alunoId: { in: ids } }, select: { id: true } })).map((i) => i.id);
  await prisma.telaVista.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.tentativaTeste.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.pagamentoOnline.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.inscricaoOnline.deleteMany({ where: { id: { in: insc } } });
  await prisma.logAuditoria.deleteMany({ where: { atorId: { in: ids } } });
  await prisma.tokenAuth.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  if (cursoAlheio) {
    const modulo = { cursoId: cursoAlheio.id };
    await prisma.decisaoCenario.deleteMany({ where: { cenario: { modulo } } });
    await prisma.cenarioOnline.deleteMany({ where: { modulo } });
    await prisma.perguntaOnline.deleteMany({ where: { topico: { modulo } } });
    await prisma.telaOnline.deleteMany({ where: { topico: { modulo } } });
    await prisma.topicoOnline.deleteMany({ where: { modulo } });
    await prisma.moduloOnline.deleteMany({ where: modulo });
    await prisma.curso.delete({ where: { id: cursoAlheio.id } });
  }
  if (pastaTemp) fs.rmSync(path.dirname(pastaTemp), { recursive: true, force: true });
  await prisma.$disconnect();
});

// ---------- regra: teste rápido ----------

test('teste rápido 3/3 aprova e, sendo o último (único) tópico, conclui o módulo por TELAS', { skip }, async () => {
  const m1 = mod(1);
  const topico = m1.topicos[0];
  assert.strictEqual(m1.topicos.length, 1);
  await verTelas(m1);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.strictEqual(t.total, 3);
  assert.strictEqual(t.finalizada, false);
  assert.strictEqual(t.perguntas.length, 3);
  for (const p of t.perguntas) {
    assert.deepStrictEqual(Object.keys(p).sort(), ['alternativas', 'correta', 'enunciado', 'id', 'porque']);
  }
  await responderTudo(t, 3);
  const f = await testes.finalizar(t.id);
  assert.strictEqual(f.finalizada, true);
  assert.strictEqual(f.aprovado, true);
  assert.strictEqual(f.acertos, 3);
  const cs = await concluidos();
  assert.deepStrictEqual(cs.map((c) => [c.moduloId, c.como]), [[m1.id, 'TELAS']]);
});

test('teste rápido aprovado de um tópico que não é o último não conclui o módulo', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  assert.ok(m4.topicos.length >= 2);
  await verTelas(m4);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: m4.topicos[0].id });
  await responderTudo(t, 3);
  assert.strictEqual((await testes.finalizar(t.id)).aprovado, true);
  assert.ok(!(await concluidos()).some((c) => c.moduloId === m4.id));
});

test('teste rápido 2/3 reprova e o novo sorteio evita as 3 perguntas anteriores quando o banco tem 6 ou mais', { skip }, async () => {
  const m1 = mod(1);
  const topico = m1.topicos[0];
  await verTelas(m1);
  await adicionarPerguntas(topico.id, 3); // banco de 6
  const a = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  await responderTudo(a, 2);
  const fa = await testes.finalizar(a.id);
  assert.strictEqual(fa.aprovado, false);
  assert.strictEqual(fa.acertos, 2);
  assert.strictEqual((await concluidos()).length, 0, 'reprovado não conclui');
  const b = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.notStrictEqual(b.id, a.id);
  const antes = new Set(a.perguntas.map((p) => p.id));
  assert.strictEqual(b.perguntas.length, 3);
  assert.ok(b.perguntas.every((p) => !antes.has(p.id)), 'nenhuma pergunta repetida');
  assert.ok(!(await estudo.progresso(inscricao.id)).aprovados.has(topico.id));
});

test('tentativa aberta do mesmo alvo é reaproveitada (também com dois pedidos ao mesmo tempo)', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const [x, y] = await Promise.all([
    testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id }),
    testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id }),
  ]);
  assert.strictEqual(x.id, y.id);
  const z = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.strictEqual(z.id, x.id);
  assert.strictEqual((await tentativas()).length, 1);
});

test('o sorteio usa o retrato das perguntas: editar o banco depois não muda a tentativa em andamento', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  const alvo = t.perguntas[0];
  const original = await prisma.perguntaOnline.findUnique({ where: { id: alvo.id } });
  try {
    await prisma.perguntaOnline.update({ where: { id: alvo.id }, data: { enunciado: 'EDITADO', correta: (original.correta + 1) % 3, ativa: false } });
    const r = await testes.responder(t.id, alvo.id, alvo.correta);
    assert.strictEqual(r.certa, true, 'vale a resposta certa de quando o teste começou');
    const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
    assert.strictEqual(lida.perguntas[0].enunciado, alvo.enunciado);
  } finally {
    await prisma.perguntaOnline.update({ where: { id: alvo.id }, data: { enunciado: original.enunciado, correta: original.correta, ativa: original.ativa } });
  }
});

test('banco menor que o sorteio: total 2 e 2/2 aprova; perguntas inativas nunca são sorteadas', { skip }, async () => {
  const m1 = mod(1);
  const topico = m1.topicos[0];
  await verTelas(m1);
  const todas = await prisma.perguntaOnline.findMany({ where: { topicoId: topico.id }, orderBy: { chave: 'asc' } });
  assert.strictEqual(todas.length, 3);
  await desativar([todas[0].id]);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.strictEqual(t.total, 2);
  assert.ok(!t.perguntas.some((p) => p.id === todas[0].id), 'inativa fora do sorteio');
  await responderTudo(t, 2);
  const f = await testes.finalizar(t.id);
  assert.strictEqual(f.aprovado, true);
  assert.strictEqual(f.acertos, 2);
  assert.strictEqual((await concluidos()).length, 1);
});

test('várias rodadas com perguntas inativas no banco: nenhuma inativa aparece', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const novas = await adicionarPerguntas(topico.id, 4);
  await desativar(novas.slice(0, 2));
  for (let i = 0; i < 6; i++) {
    const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
    assert.ok(t.perguntas.every((p) => !novas.slice(0, 2).includes(p.id)));
    await responderTudo(t, 0);
    await testes.finalizar(t.id);
  }
});

test('tópico sem nenhuma pergunta ativa: não cria tentativa (teste indisponível)', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const todas = await prisma.perguntaOnline.findMany({ where: { topicoId: topico.id } });
  await desativar(todas.map((p) => p.id));
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.strictEqual(t, null);
  assert.strictEqual((await tentativas()).length, 0);
});

test('iniciarTeste com argumentos inválidos lança erro e não grava', { skip }, async () => {
  await assert.rejects(() => testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO' }), /topicoId/);
  await assert.rejects(() => testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE' }), /moduloId/);
  await assert.rejects(() => testes.iniciarTeste(inscricao.id, { tipo: 'OUTRO', topicoId: 'x' }), /tipo/);
  assert.strictEqual((await tentativas()).length, 0);
});

// ---------- regra: responder e finalizar ----------

test('responder: pergunta que não está na tentativa e alternativa inválida dão erro; nada é gravado', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  const outras = await adicionarPerguntas(topico.id, 1);
  await assert.rejects(() => testes.responder(t.id, outras[0], 0), /não faz parte/);
  await assert.rejects(() => testes.responder(t.id, 'id-que-nao-existe', 0), /não faz parte/);
  const p = t.perguntas[0];
  for (const ruim of [-1, p.alternativas.length, 1.5, NaN, '0', null, undefined]) {
    await assert.rejects(() => testes.responder(t.id, p.id, ruim), /alternativa/, String(ruim));
  }
  await assert.rejects(() => testes.responder('tentativa-que-nao-existe', p.id, 0), /não encontrada/);
  const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
  assert.deepStrictEqual(lida.respostas, []);
  assert.strictEqual(lida.acertos, 0);
});

test('responder: o teste rápido devolve o porquê; a resposta repetida não conta duas vezes e devolve a primeira', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  const p = t.perguntas[0];
  const errada = (p.correta + 1) % p.alternativas.length;
  const r1 = await testes.responder(t.id, p.id, errada);
  assert.strictEqual(r1.certa, false);
  assert.strictEqual(r1.porque, p.porque);
  const r2 = await testes.responder(t.id, p.id, p.correta);
  assert.strictEqual(r2.certa, false, 'ignora a segunda resposta e devolve a primeira');
  const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
  assert.strictEqual(lida.respostas.length, 1);
  assert.deepStrictEqual(lida.respostas[0], { perguntaId: p.id, alternativa: errada, certa: false });
  assert.strictEqual(lida.acertos, 0);
  // Resposta certa repetida: conta uma vez só.
  const q = t.perguntas[1];
  await testes.responder(t.id, q.id, q.correta);
  await testes.responder(t.id, q.id, q.correta);
  assert.strictEqual((await prisma.tentativaTeste.findUnique({ where: { id: t.id } })).acertos, 1);
});

test('responder: dois envios ao mesmo tempo da mesma pergunta contam uma vez só', { skip }, async () => {
  const topico = mod(1).topicos[0];
  for (let rodada = 0; rodada < 5; rodada++) {
    const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
    const p = t.perguntas[0];
    const rs = await Promise.all([
      testes.responder(t.id, p.id, p.correta),
      testes.responder(t.id, p.id, p.correta),
      testes.responder(t.id, p.id, p.correta),
    ]);
    assert.ok(rs.every((r) => r.certa === true));
    const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
    assert.strictEqual(lida.respostas.length, 1, `rodada ${rodada}`);
    assert.strictEqual(lida.acertos, 1, `rodada ${rodada}`);
    await prisma.tentativaTeste.delete({ where: { id: t.id } });
  }
});

test('responder: respostas simultâneas a perguntas diferentes não se perdem', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  await Promise.all(t.perguntas.map((p) => testes.responder(t.id, p.id, p.correta)));
  const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
  assert.strictEqual(lida.respostas.length, 3);
  assert.strictEqual(lida.acertos, 3);
});

test('finalizar antes de responder tudo dá erro; depois é idempotente', { skip }, async () => {
  const m1 = mod(1);
  await verTelas(m1);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: m1.topicos[0].id });
  await assert.rejects(() => testes.finalizar(t.id), /perguntas/);
  await testes.responder(t.id, t.perguntas[0].id, t.perguntas[0].correta);
  await assert.rejects(() => testes.finalizar(t.id), /perguntas/);
  assert.strictEqual((await prisma.tentativaTeste.findUnique({ where: { id: t.id } })).finalizada, false);
  for (const p of t.perguntas.slice(1)) await testes.responder(t.id, p.id, p.correta);
  const f1 = await testes.finalizar(t.id);
  const f2 = await testes.finalizar(t.id);
  assert.strictEqual(f1.aprovado, true);
  assert.deepStrictEqual([f2.id, f2.aprovado, f2.acertos], [f1.id, true, 3]);
  assert.strictEqual((await concluidos()).length, 1);
  // Depois de finalizada, responder de novo só devolve a primeira resposta (nada muda).
  assert.strictEqual((await testes.responder(t.id, t.perguntas[0].id, 2)).certa, true);
  assert.strictEqual((await prisma.tentativaTeste.findUnique({ where: { id: t.id } })).acertos, 3);
  await assert.rejects(() => testes.finalizar('tentativa-que-nao-existe'), /não encontrada/);
});

test('finalizar com dois pedidos ao mesmo tempo: uma conclusão só', { skip }, async () => {
  const m1 = mod(1);
  await verTelas(m1);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: m1.topicos[0].id });
  await responderTudo(t, 3);
  const [a, b] = await Promise.all([testes.finalizar(t.id), testes.finalizar(t.id)]);
  assert.strictEqual(a.aprovado, true);
  assert.strictEqual(b.aprovado, true);
  assert.strictEqual((await concluidos()).length, 1);
});

// ---------- regra: Já sei isso? ----------

async function prepararPreTeste() {
  await concluirAte(4);
  const m4 = mod(4);
  await adicionarPerguntas(m4.topicos[0].id, 3); // 9 + 3 = 12 perguntas no módulo
  return m4;
}

test('pré-teste 8/10 conclui o módulo como PRE_TESTE (JÁ SABIA no painel) e sorteia 10 de todo o módulo', { skip }, async () => {
  const m4 = await prepararPreTeste();
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m4.id });
  assert.strictEqual(t.total, 10);
  assert.strictEqual(t.topicoId, null);
  assert.strictEqual(new Set(t.perguntas.map((p) => p.id)).size, 10);
  const doModulo = new Set((await prisma.perguntaOnline.findMany({ where: { topico: { moduloId: m4.id } } })).map((p) => p.id));
  assert.ok(t.perguntas.every((p) => doModulo.has(p.id)));
  // Sem feedback por pergunta: responder() não devolve o porquê.
  const primeira = t.perguntas[0];
  const r = await testes.responder(t.id, primeira.id, primeira.correta);
  assert.deepStrictEqual(r, { certa: true });
  for (const p of t.perguntas.slice(1)) {
    const idx = t.perguntas.indexOf(p);
    await testes.responder(t.id, p.id, idx < 8 ? p.correta : (p.correta + 1) % 3);
  }
  const f = await testes.finalizar(t.id);
  assert.strictEqual(f.aprovado, true);
  assert.strictEqual(f.acertos, 8);
  const cs = await concluidos();
  assert.ok(cs.some((c) => c.moduloId === m4.id && c.como === 'PRE_TESTE'));
  const prog = await estudo.progresso(inscricao.id);
  assert.strictEqual(estudo.mapaDeEstados(await estudo.carregarEstrutura(curso.id), prog.concluidos).get(m4.id), 'JA_SABIA');
  const painel = await (await clienteA.get(base())).text();
  assert.ok(painel.includes('JÁ SABIA'));
});

test('pré-teste 7/10 não conclui; o módulo segue AGORA e dá para tentar de novo', { skip }, async () => {
  const m4 = await prepararPreTeste();
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m4.id });
  await responderTudo(t, 7);
  const f = await testes.finalizar(t.id);
  assert.strictEqual(f.aprovado, false);
  assert.strictEqual(f.acertos, 7);
  assert.ok(!(await concluidos()).some((c) => c.moduloId === m4.id));
  const prog = await estudo.progresso(inscricao.id);
  assert.strictEqual(estudo.mapaDeEstados(await estudo.carregarEstrutura(curso.id), prog.concluidos).get(m4.id), 'AGORA');
  // Novo sorteio: evita as 10 de antes enquanto houver outras (12 no banco: só 2 são novas, as demais completam).
  const t2 = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m4.id });
  assert.notStrictEqual(t2.id, t.id);
  const antes = new Set(t.perguntas.map((p) => p.id));
  const novas = t2.perguntas.filter((p) => !antes.has(p.id)).length;
  assert.strictEqual(novas, 2, 'usa as 2 perguntas inéditas antes de repetir');
});

test('pré-teste aprovado nunca sobrescreve uma conclusão por TELAS que já existe', { skip }, async () => {
  const m4 = await prepararPreTeste();
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: m4.id, como: 'TELAS' } });
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m4.id });
  await responderTudo(t, 10);
  assert.strictEqual((await testes.finalizar(t.id)).aprovado, true);
  const linhas = (await concluidos()).filter((c) => c.moduloId === m4.id);
  assert.deepStrictEqual(linhas.map((c) => c.como), ['TELAS']);
});

test('pré-teste: com menos de 10 perguntas sorteia todas; 3 de 3 aprova e 2 de 3 não', { skip }, async () => {
  await concluirAte(2);
  const m2 = mod(2);
  const banco = await prisma.perguntaOnline.count({ where: { topico: { moduloId: m2.id }, ativa: true } });
  assert.ok(banco < 10);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m2.id });
  assert.strictEqual(t.total, banco);
  await responderTudo(t, banco - 1);
  assert.strictEqual((await testes.finalizar(t.id)).aprovado, false, `${banco - 1}/${banco}`);
  const t2 = await testes.iniciarTeste(inscricao.id, { tipo: 'PRE_TESTE', moduloId: m2.id });
  await responderTudo(t2, banco);
  assert.strictEqual((await testes.finalizar(t2.id)).aprovado, true);
});

// ---------- rotas ----------

const perguntaDaPagina = (html) => ({
  perguntaId: (html.match(/name="perguntaId"\s+value="([^"]+)"/) || [])[1],
  alternativas: [...html.matchAll(/name="alternativa"\s+value="(\d+)"/g)].map((m) => Number(m[1])),
});

test('rotas: fluxo completo do teste rápido (uma pergunta por página, porquê depois de responder, resultado, Continuar)', { skip }, async () => {
  const m4 = (await concluirAte(4), mod(4));
  await verTelas(m4);
  const topico = m4.topicos[0];
  await adicionarPerguntas(topico.id, 1, { enunciado: 'Qual <b>destes</b> é certo?', porque: 'Porque <i>sim</i> & pronto.' });

  let r = await clienteA.get(`${base()}/teste/${topico.id}`);
  assert.strictEqual(r.status, 302);
  const paginaUm = r.headers.get('location');
  assert.match(paginaUm, new RegExp(`^${base()}/tentativa/[0-9a-f-]+$`));
  const tentativaId = paginaUm.split('/').pop();
  r = await clienteA.get(paginaUm);
  assert.strictEqual(r.status, 200);
  let html = await r.text();
  assert.match(html, /PERGUNTA 1\/3/);
  assert.ok(!html.includes('Porque sim'), 'o porquê só depois de responder');
  assert.ok(!/ed-opcao-certa|"correta"/.test(html), 'a resposta certa não vai na página antes de responder');
  assert.ok(!html.includes('<style') && !/<script[^>]*>[^<]/.test(html), 'sem estilo nem script embutido');
  assert.strictEqual(lerCsrf(html), clienteA.csrf);
  assert.match(html, new RegExp(`action="${base()}/tentativa/${tentativaId}/responder"`));

  const tentativa = await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } });
  assert.strictEqual(tentativa.perguntas.length, 3);
  // Sem alternativa escolhida: volta para a mesma pergunta, sem gravar.
  const { perguntaId } = perguntaDaPagina(html);
  r = await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId });
  assert.strictEqual(r.status, 302);
  assert.strictEqual((await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } })).respostas.length, 0);

  // Responde as 3 pelas rotas, errando a primeira.
  for (let i = 0; i < 3; i++) {
    html = await (await clienteA.get(paginaUm)).text();
    assert.match(html, new RegExp(`PERGUNTA ${i + 1}/3`));
    const { perguntaId: pid } = perguntaDaPagina(html);
    const snap = tentativa.perguntas.find((p) => p.id === pid);
    assert.ok(snap, 'a pergunta mostrada é do sorteio');
    const alt = i === 0 ? (snap.correta + 1) % 3 : snap.correta;
    r = await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId: pid, alternativa: String(alt) });
    assert.strictEqual(r.status, 302);
    const volta = await clienteA.get(new URL(r.headers.get('location'), servidor.url).pathname + new URL(r.headers.get('location'), servidor.url).search);
    const fb = await volta.text();
    assert.ok(fb.includes(i === 0 ? 'RESPOSTA ERRADA' : 'RESPOSTA CERTA'), 'mostra se acertou');
    assert.ok(!fb.includes(i === 0 ? 'RESPOSTA CERTA' : 'RESPOSTA ERRADA'));
    assert.ok(fb.includes(snap.porque.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;')), 'mostra o porquê (escapado)');
    assert.ok(!fb.includes('<i>sim</i>') && !fb.includes('<b>destes</b>'), 'HTML do conteúdo escapado');
    assert.ok(fb.includes(i < 2 ? 'Próxima pergunta' : 'Ver resultado'));
  }
  // Perguntas respondidas todas: a tela inicial leva ao fim; finaliza e vê o resultado.
  r = await clienteA.post(`${base()}/tentativa/${tentativaId}/finalizar`, { _csrf: clienteA.csrf });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/tentativa/${tentativaId}/resultado`);
  html = await (await clienteA.get(r.headers.get('location'))).text();
  assert.match(html, /2 de 3/);
  assert.ok(html.includes('Refazer com outras perguntas'));
  assert.ok(html.includes('Rever as telas'));
  assert.ok(!html.includes('>Continuar'));
  assert.ok(html.includes(`href="${base()}/teste/${topico.id}"`));
  // Tentativa finalizada: a página da pergunta leva ao resultado.
  r = await clienteA.get(paginaUm);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/tentativa/${tentativaId}/resultado`);
});

test('rotas: teste rápido aprovado mostra "Continuar" para o próximo passo; o último tópico abre o módulo seguinte', { skip }, async () => {
  const m1 = mod(1);
  await verTelas(m1);
  const topico = m1.topicos[0];
  const r = await clienteA.get(`${base()}/teste/${topico.id}`);
  const pag = r.headers.get('location');
  const tentativaId = pag.split('/').pop();
  const t = await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } });
  for (const p of t.perguntas) {
    await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId: p.id, alternativa: String(p.correta) });
  }
  const fin = await clienteA.post(`${base()}/tentativa/${tentativaId}/finalizar`, { _csrf: clienteA.csrf });
  const html = await (await clienteA.get(fin.headers.get('location'))).text();
  assert.ok(html.includes('3 de 3'));
  assert.ok(html.includes('Continuar'));
  assert.match(html, /módulo concluído/i);
  // O módulo 2 tem "Já sei isso?" e nada visto: Continuar leva para a abertura dele.
  assert.ok(html.includes(`href="${base()}/modulo/${mod(2).id}"`));
  assert.strictEqual((await concluidos()).length, 1);
});

test('rotas: fluxo do pré-teste (sem feedback por pergunta, resultado só no fim, aprovado conclui)', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  await adicionarPerguntas(m4.topicos[0].id, 3);
  let r = await clienteA.get(`${base()}/pre-teste/${m4.id}`);
  assert.strictEqual(r.status, 302);
  const pag = r.headers.get('location');
  const tentativaId = pag.split('/').pop();
  const t = await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } });
  assert.strictEqual(t.tipo, 'PRE_TESTE');
  assert.strictEqual(t.perguntas.length, 10);
  for (let i = 0; i < 10; i++) {
    const html = await (await clienteA.get(pag)).text();
    assert.match(html, new RegExp(`PERGUNTA ${i + 1}/10`));
    const { perguntaId } = perguntaDaPagina(html);
    const snap = t.perguntas.find((p) => p.id === perguntaId);
    r = await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId, alternativa: String(snap.correta) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), pag, 'vai direto para a próxima, sem feedback');
  }
  // Todas respondidas: a página oferece o resultado (e não mostra porquê nenhum).
  let html = await (await clienteA.get(pag)).text();
  assert.ok(html.includes('Ver resultado'));
  assert.ok(!html.includes('Porque sim'));
  r = await clienteA.post(`${base()}/tentativa/${tentativaId}/finalizar`, { _csrf: clienteA.csrf });
  html = await (await clienteA.get(r.headers.get('location'))).text();
  assert.ok(html.includes('10 de 10'));
  assert.ok(html.includes('você já sabia'));
  assert.ok(html.includes('Continuar'));
  assert.ok((await concluidos()).some((c) => c.moduloId === m4.id && c.como === 'PRE_TESTE'));
});

test('rotas: pré-teste reprovado leva "Vamos às telas" para a primeira tela, sem concluir', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  await adicionarPerguntas(m4.topicos[0].id, 3);
  const r = await clienteA.get(`${base()}/pre-teste/${m4.id}`);
  const tentativaId = r.headers.get('location').split('/').pop();
  const t = await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } });
  for (const p of t.perguntas) {
    await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId: p.id, alternativa: String((p.correta + 1) % 3) });
  }
  const fin = await clienteA.post(`${base()}/tentativa/${tentativaId}/finalizar`, { _csrf: clienteA.csrf });
  const html = await (await clienteA.get(fin.headers.get('location'))).text();
  assert.ok(html.includes('0 de 10'));
  assert.ok(html.includes('Vamos às telas'));
  assert.ok(html.includes(`href="${base()}/tela/${telasDe(m4)[0].id}"`));
  assert.ok(html.includes('sem penalidade') || html.includes('Sem penalidade'));
  assert.strictEqual((await concluidos()).length, 3);
});

test('rotas: pergunta que não é do sorteio dá 400 e não grava; sem token CSRF dá 403', { skip }, async () => {
  const topico = mod(1).topicos[0];
  await verTelas(mod(1));
  const r0 = await clienteA.get(`${base()}/teste/${topico.id}`);
  const tentativaId = r0.headers.get('location').split('/').pop();
  const outra = (await adicionarPerguntas(topico.id, 1))[0];
  let r = await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { _csrf: clienteA.csrf, perguntaId: outra, alternativa: '0' });
  assert.strictEqual(r.status, 400);
  r = await clienteA.post(`${base()}/tentativa/${tentativaId}/responder`, { perguntaId: outra, alternativa: '0' });
  assert.strictEqual(r.status, 403);
  // Finalizar sem responder tudo: volta para a pergunta, sem finalizar.
  r = await clienteA.post(`${base()}/tentativa/${tentativaId}/finalizar`, { _csrf: clienteA.csrf });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/tentativa/${tentativaId}`);
  const t = await prisma.tentativaTeste.findUnique({ where: { id: tentativaId } });
  assert.strictEqual(t.finalizada, false);
  assert.deepStrictEqual(t.respostas, []);
  // O resultado de uma tentativa em aberto não existe: volta à pergunta.
  r = await clienteA.get(`${base()}/tentativa/${tentativaId}/resultado`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/tentativa/${tentativaId}`);
});

test('rotas: tentativa de outro aluno dá 404 em todas as rotas, com a inscrição dele ou a dela', { skip }, async () => {
  const topico = mod(1).topicos[0];
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  const alheia = `${base()}/tentativa/${t.id}`;
  const comInscricaoB = `/digital/estudo/${inscricaoB.id}/tentativa/${t.id}`;
  for (const caminho of [alheia, `${alheia}/resultado`, comInscricaoB, `${comInscricaoB}/resultado`]) {
    assert.strictEqual((await clienteB.get(caminho)).status, 404, caminho);
  }
  for (const caminho of [`${alheia}/responder`, `${alheia}/finalizar`, `${comInscricaoB}/responder`, `${comInscricaoB}/finalizar`]) {
    const r = await clienteB.post(caminho, { _csrf: clienteB.csrf, perguntaId: t.perguntas[0].id, alternativa: '0' });
    assert.strictEqual(r.status, 404, caminho);
  }
  // O dono, com a inscrição de outro aluno... também não: a tentativa tem de ser da inscrição da URL.
  assert.strictEqual((await clienteA.get(`/digital/estudo/${inscricaoB.id}/tentativa/${t.id}`)).status, 404);
  // Id que não existe.
  assert.strictEqual((await clienteA.get(`${base()}/tentativa/id-que-nao-existe`)).status, 404);
  assert.strictEqual((await prisma.tentativaTeste.findUnique({ where: { id: t.id } })).respostas.length, 0);
  // E a tentativa do outro aluno (B) não aparece para A.
  const tb = await testes.iniciarTeste(inscricaoB.id, { tipo: 'TOPICO', topicoId: topico.id });
  assert.strictEqual((await clienteA.get(`${base()}/tentativa/${tb.id}`)).status, 404);
});

test('rotas: ids de tópico e módulo de outro curso ou inexistentes dão 404 e não criam tentativa', { skip }, async () => {
  const topicoAlheio = modulosAlheios[0].topicos[0];
  const moduloAlheio = modulosAlheios[0];
  for (const caminho of [
    `${base()}/teste/${topicoAlheio.id}`, `${base()}/pre-teste/${moduloAlheio.id}`,
    `${base()}/teste/id-que-nao-existe`, `${base()}/pre-teste/id-que-nao-existe`,
  ]) {
    assert.strictEqual((await clienteA.get(caminho)).status, 404, caminho);
  }
  assert.strictEqual((await tentativas()).length, 0);
  // Tentativa gravada para um alvo de outro curso (dado inconsistente): também 404.
  const estranha = await prisma.tentativaTeste.create({
    data: { inscricaoId: inscricao.id, tipo: 'TOPICO', topicoId: topicoAlheio.id, perguntas: [], total: 0 },
  });
  assert.strictEqual((await clienteA.get(`${base()}/tentativa/${estranha.id}`)).status, 404);
});

test('rotas: teste de tópico com telas por ver manda para a tela que falta; sem o teste criado', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  const [t1, t2] = m4.topicos;
  let r = await clienteA.get(`${base()}/teste/${t1.id}`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/tela/${t1.telas[0].id}`);
  await estudo.marcarVista(inscricao.id, t1.telas[0].id);
  // Tópico 1 com a tela vista abre o teste; o tópico 2 (tela por ver) ainda manda para a tela dele.
  r = await clienteA.get(`${base()}/teste/${t2.id}`);
  assert.strictEqual(r.headers.get('location'), `${base()}/tela/${t2.telas[0].id}`);
  assert.strictEqual((await tentativas()).length, 0);
  r = await clienteA.get(`${base()}/teste/${t1.id}`);
  assert.match(r.headers.get('location'), /\/tentativa\//);
  assert.strictEqual((await tentativas()).length, 1);
});

test('rotas: módulo trancado, módulo final e módulo já concluído não abrem pré-teste nem teste novo', { skip }, async () => {
  // Módulo 2 trancado (o 1 não foi concluído).
  const m2 = mod(2);
  let r = await clienteA.get(`${base()}/pre-teste/${m2.id}`);
  assert.strictEqual(r.headers.get('location'), base());
  r = await clienteA.get(`${base()}/teste/${m2.topicos[0].id}`);
  assert.strictEqual(r.headers.get('location'), base());
  // Módulo final: não tem pré-teste.
  const final = modulos.find((m) => m.final);
  await concluirAte(final.ordem);
  r = await clienteA.get(`${base()}/pre-teste/${final.id}`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${final.id}`);
  // Módulo já concluído: pré-teste volta para a página do módulo.
  const m1 = mod(1);
  r = await clienteA.get(`${base()}/pre-teste/${m1.id}`);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  // Módulo cujo anterior não foi concluído continua trancado.
  assert.strictEqual((await tentativas()).length, 0);
});

test('rotas: inscrição CONCLUIDA (revisão) não começa testes: volta para o módulo, sem criar tentativa', { skip }, async () => {
  await prisma.inscricaoOnline.update({
    where: { id: inscricao.id },
    data: { situacao: 'CONCLUIDA', concluidaEm: new Date(), acessoAte: new Date(Date.now() - DIA) },
  });
  const m1 = mod(1);
  const topico = m1.topicos[0];
  await verTelas(m1);
  let r = await clienteA.get(`${base()}/teste/${topico.id}`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  r = await clienteA.get(`${base()}/pre-teste/${m1.id}`);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  assert.strictEqual((await tentativas()).length, 0);
  assert.strictEqual((await concluidos()).length, 0);
});

test('rotas: em revisão, responder e finalizar de uma tentativa em aberto não gravam', { skip }, async () => {
  const m1 = mod(1);
  const topico = m1.topicos[0];
  await verTelas(m1);
  const t = await testes.iniciarTeste(inscricao.id, { tipo: 'TOPICO', topicoId: topico.id });
  await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao: 'CONCLUIDA', concluidaEm: new Date() } });
  let r = await clienteA.post(`${base()}/tentativa/${t.id}/responder`, { _csrf: clienteA.csrf, perguntaId: t.perguntas[0].id, alternativa: '0' });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  r = await clienteA.post(`${base()}/tentativa/${t.id}/finalizar`, { _csrf: clienteA.csrf });
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  r = await clienteA.get(`${base()}/tentativa/${t.id}`);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${m1.id}`);
  const lida = await prisma.tentativaTeste.findUnique({ where: { id: t.id } });
  assert.deepStrictEqual([lida.respostas, lida.finalizada], [[], false]);
});

test('rotas: tópico sem pergunta ativa mostra "Teste indisponível" e não cria tentativa', { skip }, async () => {
  const m1 = mod(1);
  const topico = m1.topicos[0];
  await verTelas(m1);
  const todas = await prisma.perguntaOnline.findMany({ where: { topicoId: topico.id } });
  await desativar(todas.map((p) => p.id));
  const r = await clienteA.get(`${base()}/teste/${topico.id}`);
  assert.strictEqual(r.status, 200);
  assert.ok((await r.text()).includes('Teste indisponível'));
  assert.strictEqual((await tentativas()).length, 0);
  assert.strictEqual((await concluidos()).length, 0);
});
