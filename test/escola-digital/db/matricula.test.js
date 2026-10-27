// Teste da matrícula rápida da Escola Digital: a função matricular() direto no banco e as rotas
// GET/POST /digital/cursos/:slug/matricula com o servidor de verdade. Só roda contra banco local
// (localhost / 127.0.0.1): DATABASE_URL=postgresql://postgres@localhost:5433/escola_ead npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { carregarCurso, ehBancoLocal, resolverPasta } = require('../../../src/lib/escola-digital/conteudo');
const { slugCurso } = require('../../../src/lib/vitrine');
const { iniciarServidor } = require('../ajuda/servidor');

// Nada de e-mail de verdade: sem a chave, o e-mail de confirmação só é impresso no terminal.
delete process.env.RESEND_API_KEY;

const local = ehBancoLocal(process.env.DATABASE_URL);
const skip = local ? false : 'DATABASE_URL ausente ou não é localhost/127.0.0.1';

// Tudo que o teste cria usa este domínio de e-mail (reservado, nunca entrega), para a limpeza achar.
const DOMINIO = 'matricula-teste.invalid';
const EXEC = `${process.pid}${Date.now() % 100000}`;

let prisma;
let curso;
let slug;
let servidor;
let matricular;
let verificarSenha;
let POLITICA_VERSAO;

// CPF válido e único por chamada (9 dígitos sorteados + 2 dígitos verificadores).
function cpfValido() {
  for (;;) {
    const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (new Set(d).size === 1) continue;
    for (let n = 9; n <= 10; n++) {
      const soma = d.reduce((s, x, i) => s + x * (n + 1 - i), 0);
      const r = (soma * 10) % 11;
      d.push(r === 10 ? 0 : r);
    }
    return d.join('');
  }
}

let seq = 0;
function dadosNovos(extra = {}) {
  seq += 1;
  return {
    nome: 'Maria da Silva',
    cpf: cpfValido(),
    celular: '(21) 98888-7777',
    email: `m${EXEC}x${seq}@${DOMINIO}`,
    aceite: 'on',
    ...extra,
  };
}

before(async () => {
  if (!local) return;
  prisma = require('../../../src/db');
  ({ matricular } = require('../../../src/lib/escola-digital/inscricao'));
  ({ verificarSenha } = require('../../../src/lib/password'));
  ({ POLITICA_VERSAO } = require('../../../src/lib/cadastro-aluno'));
  await carregarCurso(resolverPasta('primeiros-socorros'), prisma);
  curso = await prisma.curso.findFirst({ where: { modalidade: 'ONLINE', ativo: true, nome: { contains: 'Primeiros Socorros' } } });
  slug = slugCurso(curso.nome);
  servidor = await iniciarServidor({ env: { ESCOLA_DIGITAL: '1' } });
});

after(async () => {
  if (servidor) await servidor.parar();
  if (!prisma) return;
  const ids = (await prisma.usuario.findMany({ where: { email: { endsWith: `@${DOMINIO}` } }, select: { id: true } })).map((u) => u.id);
  await prisma.inscricaoOnline.deleteMany({ where: { alunoId: { in: ids } } });
  await prisma.tokenAuth.deleteMany({ where: { usuarioId: { in: ids } } });
  await prisma.logAuditoria.deleteMany({ where: { atorId: { in: ids } } });
  await prisma.usuario.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

const contarUsuarios = (dados) => prisma.usuario.count({ where: { OR: [{ cpfCnpj: dados.cpf }, { email: dados.email }] } });

// ---------- matricular() ----------

test('(a) conta nova: aluno com CPF normalizado, senha dos 4 últimos dígitos, consentimento e inscrição aguardando', { skip }, async () => {
  const dados = dadosNovos();
  const r = await matricular({ cursoId: curso.id, dados });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.contaNova, true);
  assert.strictEqual(r.inscricao.situacao, 'AGUARDANDO_PAGAMENTO');
  assert.strictEqual(r.inscricao.cursoId, curso.id);

  const u = await prisma.usuario.findUnique({ where: { email: dados.email } });
  assert.strictEqual(r.inscricao.alunoId, u.id);
  assert.strictEqual(u.papel, 'ALUNO');
  assert.strictEqual(u.tipoDocumento, 'CPF');
  assert.strictEqual(u.cpfCnpj, dados.cpf);
  assert.strictEqual(u.celular, '21988887777');
  assert.strictEqual(u.emailVerificado, false);
  assert.strictEqual(u.consentimentoVersao, POLITICA_VERSAO);
  assert.ok(u.consentimentoLgpdEm);
  assert.strictEqual(await verificarSenha(u.senhaHash, dados.cpf.slice(-4)), true);
  assert.strictEqual(await verificarSenha(u.senhaHash, '0000x'), false);
  // E-mail de confirmação saiu como no /cadastro: há um token de verificação.
  assert.strictEqual(await prisma.tokenAuth.count({ where: { usuarioId: u.id, tipo: 'VERIFICACAO_EMAIL' } }), 1);
});

test('(a) CPF digitado com pontuação e e-mail em maiúsculas são normalizados', { skip }, async () => {
  const base = dadosNovos();
  const r = await matricular({ cursoId: curso.id, dados: { ...base, cpf: base.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'), email: base.email.toUpperCase() } });
  assert.strictEqual(r.ok, true);
  const u = await prisma.usuario.findUnique({ where: { id: r.inscricao.alunoId } });
  assert.strictEqual(u.cpfCnpj, base.cpf);
  assert.strictEqual(u.email, base.email);
});

test('(b) CPF já cadastrado, sem login: precisa_login e nenhuma conta nova', { skip }, async () => {
  const existente = dadosNovos();
  await matricular({ cursoId: curso.id, dados: existente });
  const outro = dadosNovos({ cpf: existente.cpf });
  const r = await matricular({ cursoId: curso.id, dados: outro });
  assert.deepStrictEqual({ ok: r.ok, motivo: r.motivo }, { ok: false, motivo: 'precisa_login' });
  assert.strictEqual(await prisma.usuario.count({ where: { email: outro.email } }), 0);
  assert.strictEqual(await prisma.usuario.count({ where: { cpfCnpj: existente.cpf } }), 1);
});

test('(b) e-mail já cadastrado, sem login: precisa_login e nenhuma conta nova', { skip }, async () => {
  const existente = dadosNovos();
  await matricular({ cursoId: curso.id, dados: existente });
  const outro = dadosNovos({ email: existente.email });
  const r = await matricular({ cursoId: curso.id, dados: outro });
  assert.deepStrictEqual({ ok: r.ok, motivo: r.motivo }, { ok: false, motivo: 'precisa_login' });
  assert.strictEqual(await prisma.usuario.count({ where: { cpfCnpj: outro.cpf } }), 0);
  assert.strictEqual(await prisma.usuario.count({ where: { email: existente.email } }), 1);
});

test('(b) conta anonimizada (exclusão) com o mesmo CPF volta a ser usada, como no /cadastro', { skip }, async () => {
  const dados = dadosNovos();
  const antiga = await prisma.usuario.create({
    data: { nome: 'Conta excluída', email: `conta-excluida-${EXEC}${seq}@excluida.invalid`, tipoDocumento: 'CPF', cpfCnpj: dados.cpf, papel: 'ALUNO', bloqueioTotal: true },
  });
  try {
    const r = await matricular({ cursoId: curso.id, dados });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.contaNova, true);
    assert.strictEqual(r.inscricao.alunoId, antiga.id);
    const u = await prisma.usuario.findUnique({ where: { id: antiga.id } });
    assert.strictEqual(u.email, dados.email);
    assert.strictEqual(u.bloqueioTotal, false);
  } finally {
    await prisma.inscricaoOnline.deleteMany({ where: { alunoId: antiga.id } });
    await prisma.tokenAuth.deleteMany({ where: { usuarioId: antiga.id } });
    await prisma.usuario.delete({ where: { id: antiga.id } });
  }
});

test('(c) logado: usa a conta dele e ignora os dados do formulário', { skip }, async () => {
  const dados = dadosNovos();
  const { inscricao: primeira } = await matricular({ cursoId: curso.id, dados });
  const aluno = await prisma.usuario.findUnique({ where: { id: primeira.alunoId } });
  await prisma.inscricaoOnline.delete({ where: { id: primeira.id } });

  const intruso = dadosNovos({ nome: 'Outra Pessoa' });
  const r = await matricular({ cursoId: curso.id, usuarioLogadoId: aluno.id, dados: intruso });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.contaNova, false);
  assert.strictEqual(r.inscricao.alunoId, aluno.id);
  assert.strictEqual(r.inscricao.situacao, 'AGUARDANDO_PAGAMENTO');
  assert.strictEqual(await contarUsuarios(intruso), 0);
  // Também funciona sem dados.
  const r2 = await matricular({ cursoId: curso.id, usuarioLogadoId: aluno.id });
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.inscricao.id, r.inscricao.id);
});

test('(c) logado sem papel de aluno não se matricula', { skip }, async () => {
  const dados = dadosNovos();
  const staff = await prisma.usuario.create({ data: { nome: 'Pessoa da Secretaria', email: dados.email, papel: 'SECRETARIA', consentimentoLgpdEm: new Date(), consentimentoVersao: POLITICA_VERSAO } });
  const r = await matricular({ cursoId: curso.id, usuarioLogadoId: staff.id });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'invalido');
  assert.strictEqual(await prisma.inscricaoOnline.count({ where: { alunoId: staff.id } }), 0);
});

test('(c) logado sem consentimento da política atual precisa aceitar; ao aceitar, fica registrado', { skip }, async () => {
  const dados = dadosNovos();
  const aluno = await prisma.usuario.create({ data: { nome: 'Aluno Antigo', email: dados.email, papel: 'ALUNO', consentimentoLgpdEm: new Date('2024-01-01'), consentimentoVersao: '2024-01-01' } });
  const sem = await matricular({ cursoId: curso.id, usuarioLogadoId: aluno.id });
  assert.strictEqual(sem.ok, false);
  assert.strictEqual(sem.motivo, 'invalido');
  assert.ok(sem.erros.some((e) => /aceite|termos/i.test(e)));
  assert.strictEqual(await prisma.inscricaoOnline.count({ where: { alunoId: aluno.id } }), 0);

  const com = await matricular({ cursoId: curso.id, usuarioLogadoId: aluno.id, dados: { aceite: 'on' } });
  assert.strictEqual(com.ok, true);
  const u = await prisma.usuario.findUnique({ where: { id: aluno.id } });
  assert.strictEqual(u.consentimentoVersao, POLITICA_VERSAO);
});

test('(d) chamar duas vezes devolve a mesma inscrição (uma só), inclusive ao mesmo tempo', { skip }, async () => {
  const dados = dadosNovos();
  const a = await matricular({ cursoId: curso.id, dados });
  const alunoId = a.inscricao.alunoId;
  const b = await matricular({ cursoId: curso.id, usuarioLogadoId: alunoId });
  assert.strictEqual(b.inscricao.id, a.inscricao.id);
  assert.strictEqual(b.contaNova, false);

  // Duas ao mesmo tempo para um aluno que ainda não tem inscrição: a corrida cai no P2002 e relê.
  await prisma.inscricaoOnline.delete({ where: { id: a.inscricao.id } });
  const [x, y] = await Promise.all([
    matricular({ cursoId: curso.id, usuarioLogadoId: alunoId }),
    matricular({ cursoId: curso.id, usuarioLogadoId: alunoId }),
  ]);
  assert.strictEqual(x.ok && y.ok, true);
  assert.strictEqual(x.inscricao.id, y.inscricao.id);
  assert.strictEqual(await prisma.inscricaoOnline.count({ where: { alunoId, cursoId: curso.id } }), 1);
});

test('inscrição que já passou do pagamento ou foi encerrada volta como está, sem mexer', { skip }, async () => {
  for (const situacao of ['ATIVA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA']) {
    const dados = dadosNovos();
    const { inscricao } = await matricular({ cursoId: curso.id, dados });
    await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao } });
    const r = await matricular({ cursoId: curso.id, usuarioLogadoId: inscricao.alunoId });
    assert.strictEqual(r.ok, true, situacao);
    assert.strictEqual(r.inscricao.id, inscricao.id);
    assert.strictEqual(r.inscricao.situacao, situacao);
    const depois = await prisma.inscricaoOnline.findUnique({ where: { id: inscricao.id } });
    assert.strictEqual(depois.situacao, situacao);
    assert.strictEqual(depois.plano, null);
    assert.strictEqual(depois.ativadaEm, null);
  }
});

test('(e) CPF inválido, celular sem DDD e falta de aceite: invalido com erros, nada criado', { skip }, async () => {
  const casos = [
    [{ cpf: '111.111.111-11' }, /CPF/],
    [{ cpf: '123' }, /CPF/],
    [{ celular: '98888-7777' }, /[Cc]elular/],
    [{ aceite: undefined }, /[Aa]ceite|termos/],
    [{ nome: 'Maria' }, /sobrenome|[Nn]ome/],
    [{ email: 'maria-sem-arroba' }, /[Ee]-mail/],
  ];
  for (const [troca, padrao] of casos) {
    const dados = dadosNovos(troca);
    const r = await matricular({ cursoId: curso.id, dados });
    assert.strictEqual(r.ok, false, JSON.stringify(troca));
    assert.strictEqual(r.motivo, 'invalido');
    assert.ok(Array.isArray(r.erros) && r.erros.length >= 1);
    assert.ok(r.erros.some((e) => padrao.test(e)), `${JSON.stringify(troca)} -> ${r.erros}`);
    assert.strictEqual(await prisma.usuario.count({ where: { email: dados.email } }), 0);
  }
  // Tudo errado de uma vez: um erro por campo.
  const r = await matricular({ cursoId: curso.id, dados: { nome: '', cpf: '1', celular: '1', email: 'x' } });
  assert.strictEqual(r.ok, false);
  assert.ok(r.erros.length >= 5);
  assert.deepStrictEqual(Object.keys(r.campos).sort(), ['aceite', 'celular', 'cpf', 'email', 'nome']);
});

// ---------- rotas ----------

// Pequeno cliente com cookie: guarda o escola.sid entre as chamadas.
function cliente() {
  let cookie = '';
  const guardar = (r) => {
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of sc) { if (c.startsWith('escola.sid=')) cookie = c.split(';')[0]; }
  };
  return {
    temSessao: () => cookie !== '',
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

// Lê o token CSRF de uma página (o login quebra o <input> em várias linhas).
const lerCsrf = (html) => html.match(/name="_csrf"\s+value="([0-9a-f]+)"/)[1];

async function abrirFormulario(c) {
  const r = await c.get(`/digital/cursos/${slug}/matricula`);
  const html = await r.text();
  const m = html.match(/name="_csrf"\s+value="([0-9a-f]+)"/);
  return { r, html, csrf: m && m[1] };
}

test('GET do formulário mostra os campos, o aceite e o token CSRF', { skip }, async () => {
  const c = cliente();
  const { r, html, csrf } = await abrirFormulario(c);
  assert.strictEqual(r.status, 200);
  for (const nome of ['nome', 'cpf', 'celular', 'email', 'aceite']) assert.ok(html.includes(`name="${nome}"`), nome);
  assert.ok(csrf);
  assert.ok(html.includes('href="/privacidade"'));
  assert.ok(html.includes(`href="/digital/cursos/${slug}"`));
  assert.ok(/Li e aceito os/.test(html));
});

test('curso inexistente dá 404 na matrícula', { skip }, async () => {
  const r = await fetch(servidor.url + '/digital/cursos/nao-existe/matricula');
  assert.strictEqual(r.status, 404);
});

test('POST sem o token CSRF é recusado', { skip }, async () => {
  const c = cliente();
  await abrirFormulario(c);
  const r = await c.post(`/digital/cursos/${slug}/matricula`, dadosNovos());
  assert.strictEqual(r.status, 403);
});

test('POST com dados inválidos devolve o formulário com os erros ao lado dos campos e os valores preenchidos', { skip }, async () => {
  const c = cliente();
  const { csrf } = await abrirFormulario(c);
  const dados = dadosNovos({ cpf: '123.456.789-00', celular: '98888-7777', nome: 'Maria da Silva' });
  delete dados.aceite;
  const r = await c.post(`/digital/cursos/${slug}/matricula`, { ...dados, _csrf: csrf });
  assert.strictEqual(r.status, 400);
  const html = await r.text();
  assert.ok(html.includes('CPF inválido'));
  assert.ok(html.includes('Celular inválido'));
  assert.ok(/Aceite/.test(html));
  assert.ok(html.includes('value="Maria da Silva"'));
  assert.ok(html.includes(`value="${dados.email}"`));
  assert.strictEqual(await prisma.usuario.count({ where: { email: dados.email } }), 0);
});

test('POST com dados válidos cria a conta, abre a sessão e segue para o pagamento; repetir o CPF sem login vai ao login', { skip }, async () => {
  const c = cliente();
  const { csrf } = await abrirFormulario(c);
  const dados = dadosNovos();
  const r = await c.post(`/digital/cursos/${slug}/matricula`, { ...dados, _csrf: csrf });
  assert.strictEqual(r.status, 302);
  const u = await prisma.usuario.findUnique({ where: { email: dados.email } });
  assert.ok(u);
  const insc = await prisma.inscricaoOnline.findUnique({ where: { alunoId_cursoId: { alunoId: u.id, cursoId: curso.id } } });
  assert.strictEqual(r.headers.get('location'), `/digital/pagamento/${insc.id}`);
  assert.ok(c.temSessao());
  assert.ok(/escola\.sid=/.test((r.headers.getSetCookie() || []).join(';')));

  // Já logado como aluno: o formulário vira a confirmação, e como a inscrição já existe vai ao pagamento.
  const volta = await c.get(`/digital/cursos/${slug}/matricula`);
  assert.strictEqual(volta.status, 302);
  assert.strictEqual(volta.headers.get('location'), `/digital/pagamento/${insc.id}`);

  // Outra pessoa (sem sessão) com o mesmo CPF: manda entrar, sem criar conta.
  const c2 = cliente();
  const { csrf: csrf2 } = await abrirFormulario(c2);
  const repetido = dadosNovos({ cpf: dados.cpf });
  const r2 = await c2.post(`/digital/cursos/${slug}/matricula`, { ...repetido, _csrf: csrf2 });
  assert.strictEqual(r2.status, 302);
  assert.strictEqual(r2.headers.get('location'), '/login');
  assert.strictEqual(await prisma.usuario.count({ where: { email: repetido.email } }), 0);

  // A sessão do visitante guarda o destino para depois do login (testado mais abaixo).
  assert.ok(c2.temSessao());
});

test('aluno logado vê "Você vai se matricular como" e confirma com um clique', { skip }, async () => {
  // Aluno antigo com o login feito de verdade (senha = 4 últimos dígitos), sem inscrição.
  const dados = dadosNovos();
  const { inscricao } = await matricular({ cursoId: curso.id, dados });
  await prisma.inscricaoOnline.delete({ where: { id: inscricao.id } });
  const c = cliente();
  const f = await c.get('/login');
  const csrfLogin = lerCsrf(await f.text());
  const l = await c.post('/login', { _csrf: csrfLogin, identificador: dados.email, senha: dados.cpf.slice(-4) });
  assert.strictEqual(l.status, 302);

  const { r, html, csrf } = await abrirFormulario(c);
  assert.strictEqual(r.status, 200);
  assert.ok(html.includes('Você vai se matricular como'));
  assert.ok(html.includes('Maria da Silva'));
  assert.ok(!html.includes('name="cpf"'));
  assert.ok(!html.includes('name="aceite"')); // consentimento já está em dia

  const p = await c.post(`/digital/cursos/${slug}/matricula`, { _csrf: csrf });
  assert.strictEqual(p.status, 302);
  const nova = await prisma.inscricaoOnline.findUnique({ where: { alunoId_cursoId: { alunoId: inscricao.alunoId, cursoId: curso.id } } });
  assert.strictEqual(p.headers.get('location'), `/digital/pagamento/${nova.id}`);
});

test('inscrição encerrada: o aluno logado vê o aviso e é mandado à secretaria', { skip }, async () => {
  const dados = dadosNovos();
  const { inscricao } = await matricular({ cursoId: curso.id, dados });
  await prisma.inscricaoOnline.update({ where: { id: inscricao.id }, data: { situacao: 'CANCELADA' } });
  const c = cliente();
  const f = await c.get('/login');
  const csrfLogin = lerCsrf(await f.text());
  await c.post('/login', { _csrf: csrfLogin, identificador: dados.email, senha: dados.cpf.slice(-4) });
  const r = await c.get(`/digital/cursos/${slug}/matricula`);
  assert.strictEqual(r.status, 200);
  assert.ok((await r.text()).includes('Sua inscrição neste curso foi encerrada. Fale com a secretaria.'));
});

test('depois de entrar, o "precisa_login" devolve à matrícula (returnTo)', { skip }, async () => {
  const existente = dadosNovos();
  await matricular({ cursoId: curso.id, dados: existente });
  const c = cliente();
  const { csrf } = await abrirFormulario(c);
  const r = await c.post(`/digital/cursos/${slug}/matricula`, { ...dadosNovos({ cpf: existente.cpf }), _csrf: csrf });
  assert.strictEqual(r.headers.get('location'), '/login');
  const f = await c.get('/login');
  const csrfLogin = lerCsrf(await f.text());
  const l = await c.post('/login', { _csrf: csrfLogin, identificador: existente.cpf, senha: existente.cpf.slice(-4) });
  assert.strictEqual(l.status, 302);
  assert.strictEqual(l.headers.get('location'), `/digital/cursos/${slug}/matricula`);
});

test('com a chave desligada a matrícula dá 404', { skip }, async () => {
  const desligado = await iniciarServidor({});
  try {
    const r = await fetch(`${desligado.url}/digital/cursos/${slug}/matricula`);
    assert.strictEqual(r.status, 404);
  } finally { await desligado.parar(); }
});

// ---------- o /cadastro do site segue igual ----------

test('/cadastro continua criando a conta, mandando e-mail de confirmação e abrindo a sessão', { skip }, async () => {
  const c = cliente();
  const f = await c.get('/cadastro');
  assert.strictEqual(f.status, 200);
  const csrf = lerCsrf(await f.text());
  const d = dadosNovos();
  const r = await c.post('/cadastro', {
    _csrf: csrf, nome: d.nome, email: d.email, tipoDocumento: 'CPF', documento: d.cpf, celular: d.celular,
    escolaridade: 'Ensino Médio', escolaridadeSituacao: 'Completo', consentimento: 'on',
  });
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.headers.get('location'), '/minha-conta?sec=seguranca');
  const u = await prisma.usuario.findUnique({ where: { email: d.email } });
  assert.strictEqual(u.papel, 'ALUNO');
  assert.strictEqual(u.consentimentoVersao, POLITICA_VERSAO);
  assert.strictEqual(await verificarSenha(u.senhaHash, d.cpf.slice(-4)), true);
  assert.strictEqual(await prisma.tokenAuth.count({ where: { usuarioId: u.id, tipo: 'VERIFICACAO_EMAIL' } }), 1);
});
