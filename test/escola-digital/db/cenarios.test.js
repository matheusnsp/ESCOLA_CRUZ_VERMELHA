// Teste dos cenários do módulo final (Task 10): a regra de gravação (lib/escola-digital/cenarios.js)
// direto, e as rotas com o servidor de verdade (processo filho) e login real.
// Só roda contra banco local (localhost / 127.0.0.1):
//   DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
// Os alunos, as inscrições e o segundo curso são criados aqui e apagados no fim.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ehBancoLocal } = require('../../../src/lib/escola-digital/conteudo');
const { iniciarServidor } = require('../ajuda/servidor');

delete process.env.RESEND_API_KEY;

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const DOMINIO = 'cenarios-ead.invalid';
const EXEC = `${process.pid}${Date.now() % 100000}`;
const DIA = 86400000;

let prisma;
let cenarios;
let servidor;
let curso;
let cursoAlheio;
let modulos;
let final;
let cenariosFinal;      // cenários do módulo final, com decisões
let cenarioAlheio;      // cenário do módulo final do segundo curso
let pastaTemp;
let alunoA;
let alunoB;
let inscricao;
let inscricaoB;
let clienteA;
let clienteB;
let fs; let os; let path;

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

const base = (insc = inscricao) => `/digital/estudo/${insc.id}`;
const urlCenario = (c, insc = inscricao) => `${base(insc)}/cenario/${c.id}`;
const feitos = () => prisma.cenarioFeito.findMany({ where: { inscricaoId: inscricao.id }, orderBy: { cenarioId: 'asc' } });
const concluidos = () => prisma.moduloConcluido.findMany({ where: { inscricaoId: inscricao.id } });

// Abre o módulo final: módulos 1 a 7 concluídos (linhas gravadas direto).
async function liberarFinal() {
  const data = modulos.filter((m) => !m.final).map((m) => ({ inscricaoId: inscricao.id, moduloId: m.id, como: 'TELAS' }));
  await prisma.moduloConcluido.createMany({ data, skipDuplicates: true });
}

const certas = (c) => c.decisoes.map((d) => d.correta);
const erradas = (c) => c.decisoes.map((d) => (d.correta + 1) % 3);

// Passa pelo fluxo todo de um cenário pela web, com as escolhas dadas. Devolve a resposta do concluir.
async function fazerPelaWeb(cl, c, escolhas, insc = inscricao) {
  const pagina = await cl.get(urlCenario(c, insc));
  assert.strictEqual(pagina.status, 200);
  for (let i = 0; i < escolhas.length; i++) {
    const r = await cl.post(`${urlCenario(c, insc)}/decidir`, { _csrf: cl.csrf, ordem: String(i + 1), opcao: String(escolhas[i]) });
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.get('location'), `${urlCenario(c, insc)}?fb=${i + 1}`);
  }
  return cl.post(`${urlCenario(c, insc)}/concluir`, { _csrf: cl.csrf });
}

before(async () => {
  if (!local) return;
  fs = require('node:fs'); os = require('node:os'); path = require('node:path');
  prisma = require('../../../src/db');
  const { carregarCurso, resolverPasta } = require('../../../src/lib/escola-digital/conteudo');
  const { hashSenha } = require('../../../src/lib/password');
  await carregarCurso(resolverPasta('primeiros-socorros'), prisma);
  curso = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', nome: { startsWith: 'Primeiros Socorros' } } });
  modulos = await prisma.moduloOnline.findMany({ where: { cursoId: curso.id }, orderBy: { ordem: 'asc' } });
  final = modulos.find((m) => m.final);
  assert.ok(final && modulos.length >= 8);
  cenariosFinal = await prisma.cenarioOnline.findMany({
    where: { moduloId: final.id }, orderBy: { ordem: 'asc' }, include: { decisoes: { orderBy: { ordem: 'asc' } } },
  });
  assert.strictEqual(cenariosFinal.length, 5);

  // Cópia do conteúdo com outro nome: um segundo curso online, para provar o isolamento entre cursos.
  pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'cenarios-ead-')) + '/curso';
  fs.mkdirSync(pastaTemp, { recursive: true });
  const origem = resolverPasta('primeiros-socorros');
  for (const f of fs.readdirSync(origem)) {
    const dados = JSON.parse(fs.readFileSync(path.join(origem, f), 'utf8'));
    if (f === 'curso.json') dados.nome = `Curso Alheio Cenarios ${EXEC}`;
    fs.writeFileSync(path.join(pastaTemp, f), JSON.stringify(dados));
  }
  await carregarCurso(pastaTemp, prisma);
  cursoAlheio = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', nome: `Curso Alheio Cenarios ${EXEC}` } });
  const finalAlheio = await prisma.moduloOnline.findFirst({ where: { cursoId: cursoAlheio.id, final: true } });
  cenarioAlheio = await prisma.cenarioOnline.findFirst({ where: { moduloId: finalAlheio.id }, orderBy: { ordem: 'asc' } });

  const senhaHash = await hashSenha('1234');
  const criar = (n) => prisma.usuario.create({ data: { nome: `Aluno Cenarios ${n}`, email: `c${EXEC}x${n}@${DOMINIO}`, papel: 'ALUNO', senhaHash } });
  alunoA = await criar(1);
  alunoB = await criar(2);
  const nova = (aluno) => prisma.inscricaoOnline.create({
    data: { alunoId: aluno.id, cursoId: curso.id, situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA) },
  });
  inscricao = await nova(alunoA);
  inscricaoB = await nova(alunoB);

  cenarios = require('../../../src/lib/escola-digital/cenarios');
  servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
  clienteA = await entrar(alunoA.email);
  clienteB = await entrar(alunoB.email);
});

// O andamento dos cenários mora na sessão (guardada no banco): cada teste começa sem ele.
async function limparSessoes() {
  await prisma.$executeRaw`UPDATE "session" SET sess = (sess::jsonb - 'cenarios' - 'resultadosCenario')::json WHERE sess->>'usuarioId' IN (${alunoA.id}, ${alunoB.id})`;
}

async function limpar() {
  const ids = [inscricao.id, inscricaoB.id];
  await limparSessoes();
  await prisma.cenarioFeito.deleteMany({ where: { inscricaoId: { in: ids } } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: { in: ids } } });
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
  await prisma.cenarioFeito.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: { in: insc } } });
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

// ---------- regra: registrarCenario ----------

test('os 5 cenários feitos concluem o módulo final por CENARIOS (só o último conclui)', { skip }, async () => {
  for (let i = 0; i < cenariosFinal.length; i++) {
    const c = cenariosFinal[i];
    const r = await cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: 100 });
    assert.strictEqual(r.novo, true);
    assert.strictEqual(r.cenarioFeito.acertos, 3);
    assert.strictEqual(r.moduloConcluido, i === cenariosFinal.length - 1, `cenário ${i + 1}`);
    if (i < cenariosFinal.length - 1) assert.deepStrictEqual(await concluidos(), []);
  }
  const cs = await concluidos();
  assert.deepStrictEqual(cs.map((c) => [c.moduloId, c.como]), [[final.id, 'CENARIOS']]);
  assert.strictEqual((await feitos()).length, 5);
});

test('quantidade de escolhas diferente do número de decisões dá erro e não grava', { skip }, async () => {
  const c = cenariosFinal[0];
  for (const escolhas of [[], [0, 1], [0, 1, 2, 0], undefined, 'abc']) {
    await assert.rejects(() => cenarios.registrarCenario(inscricao.id, c.id, { escolhas, segundos: 10 }), cenarios.ErroCenario);
  }
  assert.deepStrictEqual(await feitos(), []);
});

test('escolha que não é um índice de opção válido dá erro', { skip }, async () => {
  const c = cenariosFinal[0];
  for (const ruim of [-1, 3, 1.5, NaN, '1', null, undefined]) {
    await assert.rejects(() => cenarios.registrarCenario(inscricao.id, c.id, { escolhas: [0, 1, ruim], segundos: 10 }), cenarios.ErroCenario, `escolha ${String(ruim)}`);
  }
  for (const ruim of [NaN, '30', null, Infinity]) {
    await assert.rejects(() => cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: ruim }), cenarios.ErroCenario, `segundos ${String(ruim)}`);
  }
  assert.deepStrictEqual(await feitos(), []);
});

test('acertos vêm de DecisaoCenario.correta e os segundos são limitados a 0–7200', { skip }, async () => {
  const [c1, c2, c3] = cenariosFinal;
  const a = await cenarios.registrarCenario(inscricao.id, c1.id, { escolhas: erradas(c1), segundos: -30 });
  assert.strictEqual(a.cenarioFeito.acertos, 0);
  assert.strictEqual(a.cenarioFeito.segundos, 0);
  const misto = certas(c2);
  misto[1] = (misto[1] + 1) % 3;
  const b = await cenarios.registrarCenario(inscricao.id, c2.id, { escolhas: misto, segundos: 12.6 });
  assert.strictEqual(b.cenarioFeito.acertos, 2);
  assert.strictEqual(b.cenarioFeito.segundos, 13);
  assert.deepStrictEqual(b.cenarioFeito.escolhas, misto);
  const c = await cenarios.registrarCenario(inscricao.id, c3.id, { escolhas: certas(c3), segundos: 99999 });
  assert.strictEqual(c.cenarioFeito.segundos, 7200);
});

test('tempo acima do sugerido é gravado e não impede a conclusão do módulo', { skip }, async () => {
  let ultimo;
  for (const c of cenariosFinal) {
    ultimo = await cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: c.tempoSugerido * 10 });
    assert.ok(ultimo.cenarioFeito.segundos > c.tempoSugerido);
  }
  assert.strictEqual(ultimo.moduloConcluido, true);
  assert.strictEqual((await concluidos()).length, 1);
});

test('a segunda conclusão não muda o que foi gravado e devolve a linha existente', { skip }, async () => {
  const c = cenariosFinal[0];
  const primeira = await cenarios.registrarCenario(inscricao.id, c.id, { escolhas: erradas(c), segundos: 200 });
  const segunda = await cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: 5 });
  assert.strictEqual(segunda.novo, false);
  assert.strictEqual(segunda.cenarioFeito.acertos, 0);
  assert.strictEqual(segunda.cenarioFeito.segundos, 200);
  assert.deepStrictEqual(segunda.cenarioFeito.em, primeira.cenarioFeito.em);
  const linhas = await feitos();
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].acertos, 0);
  assert.strictEqual(linhas[0].segundos, 200);
  assert.deepStrictEqual(linhas[0].escolhas, erradas(c));
});

test('conclusões simultâneas do mesmo cenário gravam uma linha só', { skip }, async () => {
  const c = cenariosFinal[1];
  const rs = await Promise.all([1, 2, 3, 4].map((n) => cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: n })));
  assert.strictEqual(rs.filter((r) => r.novo).length, 1);
  assert.strictEqual((await feitos()).length, 1);
});

test('cenário de outro curso ou inexistente dá erro na lib', { skip }, async () => {
  await assert.rejects(() => cenarios.registrarCenario(inscricao.id, cenarioAlheio.id, { escolhas: [0, 0, 0], segundos: 10 }), cenarios.ErroCenario);
  await assert.rejects(() => cenarios.registrarCenario(inscricao.id, 'nao-existe', { escolhas: [0, 0, 0], segundos: 10 }), cenarios.ErroCenario);
  await assert.rejects(() => cenarios.registrarCenario('nao-existe', cenariosFinal[0].id, { escolhas: [0, 0, 0], segundos: 10 }), cenarios.ErroCenario);
  assert.deepStrictEqual(await feitos(), []);
});

// ---------- rotas ----------

test('com o módulo final TRANCADO, o cenário (GET e POST) redireciona para o painel', { skip }, async () => {
  const c = cenariosFinal[0];
  const g = await clienteA.get(urlCenario(c));
  assert.strictEqual(g.status, 302);
  assert.strictEqual(g.headers.get('location'), base());
  const p = await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '1', opcao: '0' });
  assert.strictEqual(p.status, 302);
  assert.strictEqual(p.headers.get('location'), base());
  const k = await clienteA.post(`${urlCenario(c)}/concluir`, { _csrf: clienteA.csrf });
  assert.strictEqual(k.status, 302);
  assert.strictEqual(k.headers.get('location'), base());
  assert.deepStrictEqual(await feitos(), []);
});

test('a página do cenário mostra a cena, o relógio, os 3 botões OLHAR/LIGAR/CUIDAR e esconde a resposta', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0]; // "Pânico na hora do lanche", 4:00
  const r = await clienteA.get(urlCenario(c));
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(c.titulo));
  assert.ok(html.includes('Creche municipal, 15h.'));
  assert.ok(/data-inicio="\d{13}"/.test(html), 'relógio com data-inicio em milissegundos');
  assert.ok(html.includes(`data-sugerido="${c.tempoSugerido}"`));
  assert.ok(html.includes('04:00'), 'tempo sugerido em mm:ss');
  assert.ok(html.includes('DECISÃO 1 DE 3'), 'decisão k de n');
  assert.ok(html.includes(c.decisoes[0].pergunta));
  for (const rot of ['OLHAR', 'LIGAR', 'CUIDAR']) {
    assert.ok(new RegExp(`<button[^>]*name="opcao"[^>]*>[\\s\\S]*?${rot}[\\s\\S]*?</button>`).test(html), `botão ${rot}`);
  }
  assert.ok(html.includes('name="_csrf"'));
  assert.ok(html.includes('name="ordem" value="1"'));
  assert.ok(!html.includes(c.decisoes[0].fala), 'a fala do instrutor só aparece depois de escolher');
  assert.ok(!html.includes(c.decisoes[1].pergunta), 'uma decisão por vez');
  assert.ok(!/<style|style=|<script(?![^>]*\ssrc=)|\sonclick=/i.test(html), 'sem estilo nem script embutido');
  assert.ok(html.includes('/js/escola-digital.js'));
  assert.deepStrictEqual(await feitos(), []);
});

test('fluxo pela web: feedback de cada decisão, concluir grava no servidor e ignora o que o cliente manda', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0];
  const escolhas = certas(c);
  escolhas[1] = (escolhas[1] + 1) % 3; // erra a segunda
  await clienteA.get(urlCenario(c));

  // 1ª decisão (certa): feedback com a fala e "Próxima decisão"
  let r = await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '1', opcao: String(escolhas[0]) });
  assert.strictEqual(r.headers.get('location'), `${urlCenario(c)}?fb=1`);
  let html = await (await clienteA.get(`${urlCenario(c)}?fb=1`)).text();
  assert.ok(html.includes(c.decisoes[0].fala));
  assert.ok(html.includes('Próxima decisão'));
  assert.ok(html.includes('ESPERADA'));
  assert.ok(!html.includes(c.decisoes[1].pergunta));
  // o GET sem ?fb mostra a próxima decisão
  html = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(html.includes(c.decisoes[1].pergunta));
  assert.ok(html.includes('DECISÃO 2 DE 3'));

  // 2ª decisão (errada): diz qual era a esperada
  await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '2', opcao: String(escolhas[1]) });
  html = await (await clienteA.get(`${urlCenario(c)}?fb=2`)).text();
  assert.ok(html.includes(c.decisoes[1].fala));
  assert.ok(html.includes('NÃO ERA A ESPERADA'));
  assert.ok(html.includes(c.decisoes[1].opcoes[c.decisoes[1].correta]));

  // 3ª decisão: o feedback final leva a "Concluir"; antes disso o concluir não grava
  const cedo = await clienteA.post(`${urlCenario(c)}/concluir`, { _csrf: clienteA.csrf });
  assert.strictEqual(cedo.status, 302);
  assert.strictEqual(cedo.headers.get('location'), urlCenario(c));
  assert.deepStrictEqual(await feitos(), []);

  await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '3', opcao: String(escolhas[2]) });
  html = await (await clienteA.get(`${urlCenario(c)}?fb=3`)).text();
  assert.ok(html.includes(c.decisoes[2].fala));
  assert.ok(!html.includes('Próxima decisão'));
  assert.ok(html.includes(`${urlCenario(c)}/concluir`));

  // o cliente tenta impor acertos e segundos: nada disso é lido
  const k = await clienteA.post(`${urlCenario(c)}/concluir`, { _csrf: clienteA.csrf, acertos: '3', segundos: '1', escolhas: '[0,0,0]' });
  assert.strictEqual(k.status, 302);
  assert.strictEqual(k.headers.get('location'), `${urlCenario(c)}/resultado`);
  const linhas = await feitos();
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].cenarioId, c.id);
  assert.strictEqual(linhas[0].acertos, 2);
  assert.deepStrictEqual(linhas[0].escolhas, escolhas);
  assert.ok(linhas[0].segundos >= 0 && linhas[0].segundos < 60, `segundos medidos no servidor (${linhas[0].segundos})`);
  assert.ok(!(await concluidos()).some((x) => x.moduloId === final.id), 'só 1 de 5 cenários');

  // resultado: acertos/total, tempo x sugerido, sem reprovação, próximo cenário
  html = await (await clienteA.get(`${urlCenario(c)}/resultado`)).text();
  assert.ok(/<b>2<\/b>\/3/.test(html));
  assert.ok(html.includes('sugerido 4:00'));
  assert.ok(html.includes('Próximo cenário'));
  assert.ok(!/reprovad|reprovou|falhou/i.test(html));
  assert.ok(html.includes(urlCenario(cenariosFinal[1])), 'o próximo cenário é o da ordem seguinte');
});

test('depois do último cenário o resultado oferece "Voltar ao curso" e o módulo final conclui', { skip }, async () => {
  await liberarFinal();
  // 4 cenários direto pela lib; o último pela web
  for (const c of cenariosFinal.slice(0, 4)) await cenarios.registrarCenario(inscricao.id, c.id, { escolhas: certas(c), segundos: 50 });
  assert.ok(!(await concluidos()).some((x) => x.moduloId === final.id));
  const ultimo = cenariosFinal[4];
  const k = await fazerPelaWeb(clienteA, ultimo, certas(ultimo));
  assert.strictEqual(k.headers.get('location'), `${urlCenario(ultimo)}/resultado`);
  const html = await (await clienteA.get(`${urlCenario(ultimo)}/resultado`)).text();
  assert.ok(html.includes('Voltar ao curso'));
  assert.ok(!html.includes('Próximo cenário'));
  assert.deepStrictEqual((await concluidos()).filter((x) => x.moduloId === final.id).map((x) => [x.moduloId, x.como]), [[final.id, 'CENARIOS']]);
});

test('refazer um cenário feito é treino: a linha guardada não muda', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0];
  await fazerPelaWeb(clienteA, c, erradas(c));
  const antes = (await feitos())[0];
  assert.strictEqual(antes.acertos, 0);
  const pagina = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(/treino/i.test(pagina), 'avisa que refazer é treino');
  await fazerPelaWeb(clienteA, c, certas(c));
  const html = await (await clienteA.get(`${urlCenario(c)}/resultado`)).text();
  assert.ok(/<b>3<\/b>\/3/.test(html), 'o resultado mostrado é o desta rodada');
  const depois = await feitos();
  assert.strictEqual(depois.length, 1);
  assert.strictEqual(depois[0].acertos, 0);
  assert.deepStrictEqual(depois[0].escolhas, erradas(c));
  assert.deepStrictEqual(depois[0].em, antes.em);
});

test('decisão fora de ordem é ignorada; opção inválida também', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0];
  await clienteA.get(urlCenario(c));
  for (const corpo of [{ ordem: '2', opcao: '0' }, { ordem: '3', opcao: '0' }, { ordem: '0', opcao: '0' }, { ordem: 'x', opcao: '0' }, { ordem: '1', opcao: '3' }, { ordem: '1', opcao: '-1' }, { ordem: '1', opcao: '' }, { ordem: '1' }]) {
    const r = await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ...corpo });
    assert.strictEqual(r.status, 302, JSON.stringify(corpo));
    assert.strictEqual(r.headers.get('location'), urlCenario(c), JSON.stringify(corpo));
  }
  let html = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(html.includes('DECISÃO 1 DE 3'), 'continua na primeira decisão');
  // depois de decidir a 1ª, repetir a ordem 1 não muda nada
  await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '1', opcao: '0' });
  await clienteA.post(`${urlCenario(c)}/decidir`, { _csrf: clienteA.csrf, ordem: '1', opcao: '2' });
  html = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(html.includes('DECISÃO 2 DE 3'));
  const fb = await (await clienteA.get(`${urlCenario(c)}?fb=1`)).text();
  assert.ok(fb.includes(c.decisoes[0].opcoes[0]), 'a primeira escolha ficou');
  // feedback de decisão ainda não respondida volta para a decisão atual
  const adiante = await clienteA.get(`${urlCenario(c)}?fb=3`);
  assert.strictEqual(adiante.status, 302);
  assert.strictEqual(adiante.headers.get('location'), urlCenario(c));
  assert.deepStrictEqual(await feitos(), []);
});

test('POST sem token CSRF é barrado', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0];
  await clienteA.get(urlCenario(c));
  const r = await clienteA.post(`${urlCenario(c)}/decidir`, { ordem: '1', opcao: '0' });
  assert.strictEqual(r.status, 403);
  const k = await clienteA.post(`${urlCenario(c)}/concluir`, {});
  assert.strictEqual(k.status, 403);
});

test('cenário de outro aluno, de outro curso ou inexistente dá 404', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0];
  // aluno B na inscrição do aluno A
  for (const caminho of [urlCenario(c), `${urlCenario(c)}/resultado`]) {
    assert.strictEqual((await clienteB.get(caminho)).status, 404, caminho);
  }
  assert.strictEqual((await clienteB.post(`${urlCenario(c)}/decidir`, { _csrf: clienteB.csrf, ordem: '1', opcao: '0' })).status, 404);
  assert.strictEqual((await clienteB.post(`${urlCenario(c)}/concluir`, { _csrf: clienteB.csrf })).status, 404);
  // cenário de outro curso, na própria inscrição
  for (const alvo of [cenarioAlheio.id, 'nao-existe']) {
    assert.strictEqual((await clienteA.get(`${base()}/cenario/${alvo}`)).status, 404, alvo);
    assert.strictEqual((await clienteA.post(`${base()}/cenario/${alvo}/decidir`, { _csrf: clienteA.csrf, ordem: '1', opcao: '0' })).status, 404);
    assert.strictEqual((await clienteA.post(`${base()}/cenario/${alvo}/concluir`, { _csrf: clienteA.csrf })).status, 404);
  }
  assert.deepStrictEqual(await feitos(), []);
  assert.strictEqual(await prisma.cenarioFeito.count({ where: { inscricaoId: inscricaoB.id } }), 0);
});

test('inscrição CONCLUIDA: dá para refazer como treino, mas nada é gravado', { skip }, async () => {
  const todos = modulos.map((m) => ({ inscricaoId: inscricao.id, moduloId: m.id, como: m.final ? 'CENARIOS' : 'TELAS' }));
  await prisma.moduloConcluido.createMany({ data: todos });
  await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao: 'CONCLUIDA', concluidaEm: new Date() } });
  const c = cenariosFinal[0];
  const k = await fazerPelaWeb(clienteA, c, certas(c));
  assert.strictEqual(k.headers.get('location'), `${urlCenario(c)}/resultado`);
  const html = await (await clienteA.get(`${urlCenario(c)}/resultado`)).text();
  assert.ok(/<b>3<\/b>\/3/.test(html));
  assert.deepStrictEqual(await feitos(), []);
  assert.strictEqual((await concluidos()).length, modulos.length);
  assert.strictEqual((await prisma.inscricaoOnline.findUnique({ where: { id: inscricao.id } })).situacao, 'CONCLUIDA');
});

test('resultado sem ter feito o cenário volta para o cenário', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[1];
  const r = await clienteA.get(`${urlCenario(c)}/resultado`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), urlCenario(c));
});

test('passar do tempo sugerido muda só o aviso da página: o cenário conclui e o tempo longo é gravado', { skip }, async () => {
  await liberarFinal();
  const c = cenariosFinal[0]; // sugerido 240 s
  let html = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(html.includes('data-ed-relogio-aviso hidden'), 'dentro do tempo: aviso escondido');
  assert.ok(!html.includes('ed-relogio-passou'));
  // Recua o começo guardado na sessão em 10 minutos (o navegador não tem como fazer isso).
  const inicio = Date.now() - 10 * 60 * 1000;
  await prisma.$executeRaw`UPDATE "session" SET sess = jsonb_set(sess::jsonb, ARRAY['cenarios', ${c.id}, 'inicio'], to_jsonb(${inicio}::bigint))::json WHERE sess->>'usuarioId' = ${alunoA.id}`;
  html = await (await clienteA.get(urlCenario(c))).text();
  assert.ok(html.includes('ed-relogio-passou'));
  assert.ok(!html.includes('data-ed-relogio-aviso hidden'), 'passou: aviso visível');
  assert.ok(html.includes('data-ed-relogio-aviso>'));
  const k = await fazerPelaWeb(clienteA, c, certas(c));
  assert.strictEqual(k.headers.get('location'), `${urlCenario(c)}/resultado`);
  const linha = (await feitos())[0];
  assert.ok(linha.segundos >= 600 && linha.segundos < 660, `segundos = ${linha.segundos}`);
  assert.strictEqual(linha.acertos, 3);
  const res = await (await clienteA.get(`${urlCenario(c)}/resultado`)).text();
  assert.ok(res.includes('Você levou <b>10:0'), 'tempo gasto no resultado');
  assert.ok(res.includes('sugerido 4:00'));
  assert.ok(!/reprovad|reprovou|falhou/i.test(res));
});
