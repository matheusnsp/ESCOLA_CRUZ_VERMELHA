// Teste da área de estudo da Escola Digital (Task 8): painel do curso, módulo, tela, progresso e
// controle de acesso, com o servidor de verdade (processo filho) e o banco local.
// Só roda contra banco local (localhost / 127.0.0.1):
//   DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
// O curso de exemplo (conteudo/primeiros-socorros) é carregado no início (idempotente). Os alunos e
// as inscrições são criados direto no banco, o login é feito de verdade em /login (senha inicial
// "1234") e tudo é apagado no fim. Cada teste recomeça a inscrição do aluno do zero.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ehBancoLocal } = require('../../../src/lib/escola-digital/conteudo');
const { iniciarServidor } = require('../ajuda/servidor');

delete process.env.RESEND_API_KEY;

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

const DOMINIO = 'estudo-teste.invalid';
const EXEC = `${process.pid}${Date.now() % 100000}`;
const DIA = 86400000;

let prisma;
let estudo;      // lib/escola-digital/estudo.js
let servidor;
let curso;
let modulos;     // [{ id, ordem, final, temPreTeste, topicos: [{ id, telas: [{ id }] }] }]
let alunoA;      // dono da inscrição
let alunoB;      // outro aluno
let inscricao;   // inscrição do alunoA (recomeçada a cada teste)
let clienteA;
let clienteB;
const telasAlteradas = new Map(); // id -> dados originais (para restaurar)

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
  // Token CSRF da sessão (o mesmo vale para qualquer POST dela): lido da tela de segurança da conta.
  const conta = await c.get('/minha-conta?sec=seguranca');
  c.csrf = lerCsrf(await conta.text());
  return c;
}

// POST de "Próximo" como o botão da tela faz: pega o token CSRF da própria página da tela.
async function proximo(c, inscricaoId, telaId) {
  const pagina = await c.get(`/digital/estudo/${inscricaoId}/tela/${telaId}`);
  assert.strictEqual(pagina.status, 200, 'abrir a tela antes do Próximo');
  assert.strictEqual(lerCsrf(await pagina.text()), c.csrf, 'o botão leva o token da sessão');
  return c.post(`/digital/estudo/${inscricaoId}/tela/${telaId}/proximo`, { _csrf: c.csrf });
}

const base = () => `/digital/estudo/${inscricao.id}`;
const mod = (ordem) => modulos.find((m) => m.ordem === ordem);
const telasDe = (m) => m.topicos.flatMap((t) => t.telas);
const lerInscricao = () => prisma.inscricaoOnline.findUnique({ where: { id: inscricao.id } });
const vistas = () => prisma.telaVista.findMany({ where: { inscricaoId: inscricao.id } });
const concluidos = () => prisma.moduloConcluido.findMany({ where: { inscricaoId: inscricao.id } });

// Dá por concluídos os módulos de ordem menor que `ate` (como TELAS), abrindo o módulo `ate`.
async function concluirAte(ate) {
  const data = modulos.filter((x) => x.ordem < ate).map((m) => ({ inscricaoId: inscricao.id, moduloId: m.id, como: 'TELAS' }));
  await prisma.moduloConcluido.createMany({ data, skipDuplicates: true });
}

// Aprovação do teste rápido de um tópico, gravada direto (o teste de verdade é da Task 9).
const aprovarTopico = (topicoId) => prisma.tentativaTeste.create({
  data: { inscricaoId: inscricao.id, tipo: 'TOPICO', topicoId, perguntas: [], respostas: [], acertos: 3, total: 3, aprovado: true, finalizada: true },
});

async function limparProgresso() {
  await prisma.tentativaTeste.deleteMany({ where: { inscricaoId: inscricao.id } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: inscricao.id } });
  await prisma.telaVista.deleteMany({ where: { inscricaoId: inscricao.id } });
  await prisma.cenarioFeito.deleteMany({ where: { inscricaoId: inscricao.id } });
}

before(async () => {
  if (!local) return;
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

  const senhaHash = await hashSenha('1234');
  const criar = (n) => prisma.usuario.create({ data: { nome: `Aluno Estudo ${n}`, email: `e${EXEC}x${n}@${DOMINIO}`, papel: 'ALUNO', senhaHash } });
  alunoA = await criar(1);
  alunoB = await criar(2);
  inscricao = await prisma.inscricaoOnline.create({
    data: { alunoId: alunoA.id, cursoId: curso.id, situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA) },
  });
  // O alunoB também está matriculado (outra inscrição, sem relação com a do A).
  await prisma.inscricaoOnline.create({
    data: { alunoId: alunoB.id, cursoId: curso.id, situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA) },
  });

  estudo = require('../../../src/lib/escola-digital/estudo');
  servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
  clienteA = await entrar(alunoA.email);
  clienteB = await entrar(alunoB.email);
});

beforeEach(async () => {
  if (!local) return;
  await limparProgresso();
  await prisma.inscricaoOnline.update({
    where: { id: inscricao.id },
    data: { situacao: 'ATIVA', ativadaEm: new Date(), acessoAte: new Date(Date.now() + 10 * DIA), concluidaEm: null },
  });
});

after(async () => {
  if (!prisma) return;
  for (const [id, original] of telasAlteradas) await prisma.telaOnline.update({ where: { id }, data: original });
  if (servidor) await servidor.parar();
  const ids = [alunoA, alunoB].filter(Boolean).map((u) => u.id);
  const insc = (await prisma.inscricaoOnline.findMany({ where: { alunoId: { in: ids } }, select: { id: true } })).map((i) => i.id);
  await prisma.telaVista.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.moduloConcluido.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.tentativaTeste.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.cenarioFeito.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.pagamentoOnline.deleteMany({ where: { inscricaoId: { in: insc } } });
  await prisma.inscricaoOnline.deleteMany({ where: { id: { in: insc } } });
  await prisma.logAuditoria.deleteMany({ where: { atorId: { in: ids } } });
  await prisma.tokenAuth.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ---------- acesso ----------

test('(a) inscrição de outro aluno e id inexistente: o mesmo 404, em todas as rotas', { skip }, async () => {
  const tela = telasDe(mod(1))[0];
  const caminhos = [base(), `${base()}/continuar`, `${base()}/modulo/${mod(1).id}`, `${base()}/tela/${tela.id}`];
  const inexistente = await clienteB.get('/digital/estudo/00000000-0000-0000-0000-000000000000');
  assert.strictEqual(inexistente.status, 404);
  // O layout repete o endereço pedido no <link rel="canonical"> e no og:url: fora isso, o corpo é igual.
  const semEndereco = (html) => html.replace(/<link rel="canonical"[^>]*>|<meta property="og:url"[^>]*>/g, '');
  const corpoInexistente = semEndereco(await inexistente.text());
  for (const c of caminhos) {
    const r = await clienteB.get(c);
    assert.strictEqual(r.status, 404, c);
    assert.strictEqual(semEndereco(await r.text()), corpoInexistente, 'não revela se o id existe');
  }
  assert.ok(corpoInexistente.includes('class="ed-erro"'), 'erro no layout da Escola Digital');
  // O POST de outro aluno também não grava nada.
  const r = await clienteB.post(`${base()}/tela/${tela.id}/proximo`, { _csrf: clienteB.csrf });
  assert.strictEqual(r.status, 404);
  assert.strictEqual((await vistas()).length, 0);
});

test('sem login: vai para o login e guarda o destino', { skip }, async () => {
  const anon = cliente();
  const r = await anon.get(base());
  assert.strictEqual(r.status, 302);
  assert.match(r.headers.get('location'), /\/login/);
});

test('AGUARDANDO_PAGAMENTO vai para o pagamento', { skip }, async () => {
  await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao: 'AGUARDANDO_PAGAMENTO', acessoAte: null, ativadaEm: null } });
  const tela = telasDe(mod(1))[0];
  for (const c of [base(), `${base()}/continuar`, `${base()}/tela/${tela.id}`]) {
    const r = await clienteA.get(c);
    assert.strictEqual(r.status, 302, c);
    assert.strictEqual(r.headers.get('location'), `/digital/pagamento/${inscricao.id}`);
  }
});

test('(b) ATIVA com acesso vencido: página "encerrado" e situação gravada como EXPIRADA', { skip }, async () => {
  await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { acessoAte: new Date(Date.now() - DIA) } });
  const tela = telasDe(mod(1))[0];
  const r = await clienteA.get(`${base()}/tela/${tela.id}`);
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('class="ed-encerrado-pag"'));
  assert.ok(html.includes('Acesso encerrado'));
  assert.ok(!html.includes('ed-tela-pagina'));
  assert.strictEqual((await lerInscricao()).situacao, 'EXPIRADA');
  // E o POST também não grava nada.
  const p = await clienteA.post(`${base()}/tela/${tela.id}/proximo`, { _csrf: clienteA.csrf });
  assert.strictEqual(p.status, 200);
  assert.strictEqual((await vistas()).length, 0);
});

test('EXPIRADA e CANCELADA mostram "encerrado"', { skip }, async () => {
  for (const situacao of ['EXPIRADA', 'CANCELADA']) {
    await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao } });
    const r = await clienteA.get(base());
    assert.strictEqual(r.status, 200, situacao);
    const html = await r.text();
    assert.ok(html.includes('class="ed-encerrado-pag"'), situacao);
    assert.ok(!html.includes('Continuar'), situacao);
    assert.strictEqual((await lerInscricao()).situacao, situacao);
  }
});

test('(c) CONCLUIDA vencida continua abrindo tudo, mas o Próximo não grava', { skip }, async () => {
  await prisma.inscricaoOnline.update({
    where: { id: inscricao.id },
    data: { situacao: 'CONCLUIDA', concluidaEm: new Date(Date.now() - 5 * DIA), acessoAte: new Date(Date.now() - DIA) },
  });
  const telas = telasDe(mod(1));
  let r = await clienteA.get(base());
  assert.strictEqual(r.status, 200);
  const painel = await r.text();
  assert.ok(painel.includes('Concluído em'));
  r = await clienteA.get(`${base()}/tela/${telas[0].id}`);
  assert.strictEqual(r.status, 200, 'revisa a tela mesmo depois do prazo');
  const html = await r.text();
  assert.ok(html.includes('ed-tela-pagina'));
  const p = await clienteA.post(`${base()}/tela/${telas[0].id}/proximo`, { _csrf: clienteA.csrf });
  assert.strictEqual(p.status, 302);
  assert.strictEqual((await vistas()).length, 0, 'revisão não grava TelaVista');
  assert.strictEqual((await concluidos()).length, 0);
  assert.strictEqual((await lerInscricao()).situacao, 'CONCLUIDA');
});

// ---------- ordem dos módulos ----------

test('(d) tela e módulo trancados voltam para a área do curso', { skip }, async () => {
  const trancado = mod(2);
  let r = await clienteA.get(`${base()}/tela/${telasDe(trancado)[0].id}`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), base());
  r = await clienteA.get(`${base()}/modulo/${trancado.id}`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), base());
  const p = await clienteA.post(`${base()}/tela/${telasDe(trancado)[0].id}/proximo`, { _csrf: clienteA.csrf });
  assert.strictEqual(p.status, 302);
  assert.strictEqual(p.headers.get('location'), base());
  assert.strictEqual((await vistas()).length, 0, 'tela trancada não grava');
});

test('tela ou módulo de outro curso (id que não é do curso da inscrição) dá 404', { skip }, async () => {
  assert.strictEqual((await clienteA.get(`${base()}/tela/id-que-nao-existe`)).status, 404);
  assert.strictEqual((await clienteA.get(`${base()}/modulo/id-que-nao-existe`)).status, 404);
});

// ---------- Próximo e progresso ----------

test('(e) Próximo grava TelaVista uma vez e segue para o teste do tópico (proximoPasso)', { skip }, async () => {
  const m1 = mod(1);
  const tela = telasDe(m1)[0];
  const topico = m1.topicos[0];
  let r = await proximo(clienteA, inscricao.id, tela.id);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/teste/${topico.id}`);
  assert.strictEqual((await vistas()).length, 1);
  // De novo: o mesmo destino e continua uma linha só.
  r = await proximo(clienteA, inscricao.id, tela.id);
  assert.strictEqual(r.headers.get('location'), `${base()}/teste/${topico.id}`);
  const lidas = await vistas();
  assert.strictEqual(lidas.length, 1);
  assert.strictEqual(lidas[0].telaId, tela.id);
});

test('Próximo no meio do módulo vai para a próxima tela não vista', { skip }, async () => {
  const m4 = mod(4);
  await concluirAte(4);
  const telas = telasDe(m4);
  assert.ok(telas.length >= 2);
  const r = await proximo(clienteA, inscricao.id, telas[0].id);
  // Fim do tópico 1 → teste dele (a próxima tela só vem depois do teste), senão a tela 2.
  const t1 = m4.topicos[0];
  const esperado = t1.telas.length === 1 ? `${base()}/teste/${t1.id}` : `${base()}/tela/${t1.telas[1].id}`;
  assert.strictEqual(r.headers.get('location'), esperado);
});

test('ver todas as telas do tópico sem teste aprovado NÃO conclui o módulo; com o teste aprovado, conclui (TELAS)', { skip }, async () => {
  const m1 = mod(1);
  for (const t of telasDe(m1)) await proximo(clienteA, inscricao.id, t.id);
  assert.strictEqual((await vistas()).length, telasDe(m1).length);
  assert.strictEqual((await concluidos()).length, 0, 'sem teste aprovado, não conclui');
  assert.deepStrictEqual(await estudo.concluirModuloSePronto(inscricao.id, m1.id), { concluido: false });

  // Teste rápido reprovado ou em andamento não conta.
  await prisma.tentativaTeste.create({
    data: { inscricaoId: inscricao.id, tipo: 'TOPICO', topicoId: m1.topicos[0].id, perguntas: [], respostas: [], acertos: 1, total: 3, aprovado: false, finalizada: true },
  });
  assert.deepStrictEqual(await estudo.concluirModuloSePronto(inscricao.id, m1.id), { concluido: false });

  await aprovarTopico(m1.topicos[0].id);
  const prog = await estudo.progresso(inscricao.id);
  assert.ok(prog.aprovados.has(m1.topicos[0].id));
  assert.deepStrictEqual(await estudo.concluirModuloSePronto(inscricao.id, m1.id), { concluido: true, como: 'TELAS' });
  // Idempotente: de novo não duplica nem muda.
  assert.deepStrictEqual(await estudo.concluirModuloSePronto(inscricao.id, m1.id), { concluido: true, como: 'TELAS' });
  const lidos = await concluidos();
  assert.strictEqual(lidos.length, 1);
  assert.strictEqual(lidos[0].como, 'TELAS');
});

test('Próximo que fecha o módulo conclui e leva à abertura do módulo seguinte', { skip }, async () => {
  const m1 = mod(1);
  await aprovarTopico(m1.topicos[0].id); // o teste já foi aprovado
  const r = await proximo(clienteA, inscricao.id, telasDe(m1)[0].id);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${mod(2).id}`);
  assert.deepStrictEqual((await concluidos()).map((c) => c.como), ['TELAS']);
});

test('módulo concluído por "Já sei isso?" (PRE_TESTE) não é regravado como TELAS', { skip }, async () => {
  const m1 = mod(1);
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: m1.id, como: 'PRE_TESTE' } });
  await aprovarTopico(m1.topicos[0].id);
  await proximo(clienteA, inscricao.id, telasDe(m1)[0].id);
  assert.deepStrictEqual((await concluidos()).map((c) => c.como), ['PRE_TESTE']);
});

test('progresso() devolve vistas, aprovados, concluídos e cenários', { skip }, async () => {
  const m1 = mod(1);
  const tela = telasDe(m1)[0];
  await prisma.telaVista.create({ data: { inscricaoId: inscricao.id, telaId: tela.id } });
  await aprovarTopico(m1.topicos[0].id);
  // Só conta o teste de tópico finalizado E aprovado.
  await prisma.tentativaTeste.create({
    data: { inscricaoId: inscricao.id, tipo: 'TOPICO', topicoId: mod(4).topicos[0].id, perguntas: [], respostas: [], acertos: 0, total: 3, aprovado: true, finalizada: false },
  });
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: m1.id, como: 'PRE_TESTE' } });
  const p = await estudo.progresso(inscricao.id);
  assert.ok(p.vistas instanceof Set && p.vistas.has(tela.id) && p.vistas.size === 1);
  assert.ok(p.aprovados instanceof Set && p.aprovados.has(m1.topicos[0].id) && p.aprovados.size === 1);
  assert.deepStrictEqual(p.concluidos, { [m1.id]: 'PRE_TESTE' });
  assert.ok(p.cenarios instanceof Set && p.cenarios.size === 0);
});

// ---------- continuar ----------

test('continuar de uma inscrição nova abre a abertura do módulo 1', { skip }, async () => {
  const r = await clienteA.get(`${base()}/continuar`);
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${mod(1).id}`);
});

test('continuar com tela já vista no módulo segue para a próxima tela; depois de tudo visto, para o teste', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  const telas = telasDe(m4);
  await prisma.telaVista.create({ data: { inscricaoId: inscricao.id, telaId: telas[0].id } });
  let r = await clienteA.get(`${base()}/continuar`);
  const t1 = m4.topicos[0];
  const esperado = t1.telas.length === 1 ? `${base()}/teste/${t1.id}` : `${base()}/tela/${t1.telas[1].id}`;
  assert.strictEqual(r.headers.get('location'), esperado);
  // Teste do tópico 1 aprovado: o próximo passo é a tela do tópico 2.
  await aprovarTopico(t1.id);
  r = await clienteA.get(`${base()}/continuar`);
  assert.strictEqual(r.headers.get('location'), `${base()}/tela/${m4.topicos[1].telas[0].id}`);
});

test('continuar com tentativa de "Já sei isso?" no módulo pula a abertura', { skip }, async () => {
  const m1 = mod(1);
  await prisma.tentativaTeste.create({
    data: { inscricaoId: inscricao.id, tipo: 'PRE_TESTE', moduloId: m1.id, perguntas: [], respostas: [], acertos: 3, total: 10, aprovado: false, finalizada: true },
  });
  const r = await clienteA.get(`${base()}/continuar`);
  assert.strictEqual(r.headers.get('location'), `${base()}/tela/${telasDe(m1)[0].id}`);
});

test('continuar no módulo final vai para a página do módulo; com tudo concluído, para a área do curso', { skip }, async () => {
  const final = modulos.find((m) => m.final);
  await concluirAte(final.ordem);
  let r = await clienteA.get(`${base()}/continuar`);
  assert.strictEqual(r.headers.get('location'), `${base()}/modulo/${final.id}`);
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: final.id, como: 'CENARIOS' } });
  r = await clienteA.get(`${base()}/continuar`);
  assert.strictEqual(r.headers.get('location'), base());
});

// ---------- telas (HTML) ----------

test('área do curso: cabeçalho, lema, progresso, prazo, carimbos, Continuar e itens trancados', { skip }, async () => {
  const m1 = mod(1);
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: m1.id, como: 'TELAS' } });
  await prisma.moduloConcluido.create({ data: { inscricaoId: inscricao.id, moduloId: mod(2).id, como: 'PRE_TESTE' } });
  const r = await clienteA.get(base());
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes(curso.nome.replace(/&/g, '&amp;')) || html.includes('Primeiros Socorros'));
  assert.ok(html.includes('OLHAR') && html.includes('LIGAR') && html.includes('CUIDAR'));
  assert.ok(html.includes('FEITO') && html.includes('JÁ SABIA') && html.includes('AGORA') && html.includes('TRANCADO'));
  assert.match(html, /Faltam 10 dias/);
  assert.match(html, new RegExp(`href="${base()}/continuar"`));
  assert.match(html, /2\/8|2 de 8/); // módulos concluídos
  assert.ok(html.includes(`href="${base()}/modulo/${mod(3).id}"`), 'módulo atual abre');
  assert.ok(!html.includes(`href="${base()}/modulo/${mod(4).id}"`), 'módulo trancado não vira link');
  // Certificado e cartão trancados até a conclusão.
  assert.ok(!html.includes('certificado.pdf') && !html.includes('cartao.pdf'));
  assert.ok(html.includes('Certificado') && html.includes('Cartão de bolso'));
  assert.ok(!/<style/i.test(html) && !/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'sem estilo nem script embutido');
});

test('área do curso concluída: data da conclusão e links do certificado e do cartão', { skip }, async () => {
  await prisma.inscricaoOnline.update({
    where: { id: inscricao.id },
    data: { situacao: 'CONCLUIDA', concluidaEm: new Date('2026-03-04T15:00:00Z'), acessoAte: new Date(Date.now() - DIA) },
  });
  const html = await (await clienteA.get(base())).text();
  assert.ok(html.includes('Concluído em 04/03/2026'));
  assert.ok(html.includes(`href="${base()}/certificado.pdf"`));
  assert.ok(html.includes(`href="${base()}/cartao.pdf"`));
  assert.ok(!/Faltam/.test(html));
});

test('aviso de senha inicial some depois que a pessoa troca a senha', { skip }, async () => {
  let html = await (await clienteA.get(base())).text();
  assert.ok(html.includes('Sua senha ainda é a inicial (4 últimos dígitos do CPF). Troque em Minha conta.'));
  assert.ok(html.includes('href="/minha-conta?sec=seguranca"'));
  await prisma.logAuditoria.create({ data: { atorId: alunoA.id, acao: 'SENHA_ALTERADA', alvoTipo: 'Usuario', alvoId: alunoA.id } });
  try {
    html = await (await clienteA.get(base())).text();
    assert.ok(!html.includes('Sua senha ainda é a inicial'));
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { atorId: alunoA.id, acao: 'SENHA_ALTERADA' } });
  }
});

test('página do módulo: abertura, tópicos com telas, escolha "Quero aprender" / "Já sei isso?"', { skip }, async () => {
  await concluirAte(4);
  const m4 = mod(4);
  await prisma.telaVista.create({ data: { inscricaoId: inscricao.id, telaId: telasDe(m4)[0].id } });
  const r = await clienteA.get(`${base()}/modulo/${m4.id}`);
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('Engasgo'));
  assert.ok(html.includes('Quero aprender'));
  assert.ok(html.includes(`href="${base()}/pre-teste/${m4.id}"`));
  assert.ok(html.includes('Já sei isso?'));
  for (const t of m4.topicos) assert.ok(html.includes(t.titulo.replace(/&/g, '&amp;').replace(/"/g, '&#34;')) || html.includes(t.titulo), t.titulo);
  for (const t of telasDe(m4)) assert.ok(html.includes(`href="${base()}/tela/${t.id}"`), 'liga a cada tela');
  assert.ok(html.includes('ed-tela-vista'), 'tela vista marcada');
  assert.ok(!/<style/i.test(html));
});

test('página do módulo concluído ou final não oferece "Já sei isso?"', { skip }, async () => {
  await concluirAte(4);
  let html = await (await clienteA.get(`${base()}/modulo/${mod(1).id}`)).text();
  assert.ok(!html.includes('Já sei isso?'), 'concluído');
  const final = modulos.find((m) => m.final);
  await concluirAte(final.ordem);
  const r = await clienteA.get(`${base()}/modulo/${final.id}`);
  assert.strictEqual(r.status, 200);
  html = await r.text();
  assert.ok(!html.includes('/pre-teste/'), 'final não tem pré-teste');
});

test('tela: âncora, vídeo (ou aviso de vídeo em produção), revisão, alerta, dica, Próximo com CSRF, tudo escapado', { skip }, async () => {
  const m1 = mod(1);
  const tela = telasDe(m1)[0];
  const original = await prisma.telaOnline.findUnique({ where: { id: tela.id } });
  telasAlteradas.set(tela.id, {
    ancora: original.ancora, videoId: original.videoId, videoTitulo: original.videoTitulo, revisao: original.revisao, alerta: original.alerta, dica: original.dica, titulo: original.titulo,
  });
  const ataque = '<img src=x onerror=alert(1)>';
  await prisma.telaOnline.update({
    where: { id: tela.id },
    data: { ancora: `Âncora ${ataque}`, videoId: 'abc123XYZ_-', videoTitulo: 'Vídeo "de teste"', revisao: [`Um ${ataque}`, 'Dois', 'Três', 'Quatro', 'Cinco'], alerta: `Alerta ${ataque}`, dica: 'Dica útil' },
  });

  let html = await (await clienteA.get(`${base()}/tela/${tela.id}`)).text();
  assert.ok(html.includes('<iframe'));
  assert.ok(html.includes('src="https://www.youtube-nocookie.com/embed/abc123XYZ_-?rel=0&amp;modestbranding=1"') || html.includes('src="https://www.youtube-nocookie.com/embed/abc123XYZ_-?rel=0&modestbranding=1"'));
  assert.ok(html.includes('allowfullscreen') && html.includes('loading="lazy"'));
  assert.ok(html.includes('Dica útil'));
  assert.ok(!html.includes(ataque), 'nada de HTML vindo do conteúdo sem escapar');
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(!html.includes('Cinco'), 'revisão tem no máximo 4 itens');
  assert.ok(html.includes('Quatro'));
  assert.match(html, new RegExp(`<form[^>]*method="post"[^>]*action="${base()}/tela/${tela.id}/proximo"`));
  assert.match(html, /name="_csrf"\s+value="[0-9a-f]+"/);
  assert.ok(!/<style/i.test(html) && !/<script(?![^>]*\ssrc=)[^>]*>/i.test(html));
  assert.ok(html.includes('<details'), 'menu dos tópicos no celular');

  await prisma.telaOnline.update({ where: { id: tela.id }, data: { videoId: null, videoTitulo: null, revisao: [], alerta: null, dica: null } });
  html = await (await clienteA.get(`${base()}/tela/${tela.id}`)).text();
  assert.ok(!html.includes('<iframe'));
  assert.ok(html.includes('Vídeo em produção'));
  assert.ok(!html.includes('REVISÃO RÁPIDA') && !html.includes('ALERTA') && !html.includes('DICA'));

  await prisma.telaOnline.update({ where: { id: tela.id }, data: telasAlteradas.get(tela.id) });
  telasAlteradas.delete(tela.id);
});
