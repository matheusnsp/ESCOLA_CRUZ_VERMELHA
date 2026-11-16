// 2026-11-16: botão de WhatsApp Web na lista de alunos de uma turma: manda a mensagem de boas-vindas da turma
// (confirma a aula: curso, data e hora, local, doação), preenchida com os dados dela. O envio fica registrado.
require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../src/lib/confirmacao-turma');
const bv = require('../src/lib/boas-vindas');

const turma = { id: 't1', inicioPrevisto: new Date('2026-11-17T12:00:00Z'), curso: { nome: 'Primeiros Socorros Básico' }, aulas: [{ data: new Date('2026-11-17T00:00:00Z'), horario: '09:00 – 13:00' }] };

test('o texto padrão é o da secretaria, com o Canal no WhatsApp, preenchido com a turma', () => {
  const t = bv.montarTexto(turma, bv.PADROES);
  assert.match(t, /^\*Desejamos aos alunos do curso de PRIMEIROS SOCORROS BÁSICO, Boas vindas!!!\*/);
  assert.match(t, /É com grande prazer que confirmamos a aula do curso de PRIMEIROS SOCORROS BÁSICO\./);
  assert.match(t, /Início: dia \*17\/11\/2026 às 09h\*/);
  assert.match(t, /Local: Praça da Cruz Vermelha/);
  assert.match(t, /Será disponibilizado um Canal no WhatsApp onde serão publicadas fotos durante a aula/);
  assert.match(t, /https:\/\/whatsapp\.com\/channel\/0029Vb9EiBm60eBihpjqom0A/);
  assert.match(t, /Secretaria Escolar\n\*Cruz Vermelha Brasileira Filial do Estado do Rio de Janeiro\*$/);
});

test('links do aplicativo (principal) e do WhatsApp Web (reserva); celular inválido -> null', () => {
  assert.equal(C.linkApp('(21) 98877-1122', 'Olá a todos'), 'whatsapp://send?phone=5521988771122&text=Ol%C3%A1%20a%20todos');
  assert.equal(C.linkWhatsApp('(21) 98877-1122', 'Olá a todos'), 'https://web.whatsapp.com/send?phone=5521988771122&text=Ol%C3%A1%20a%20todos');
  assert.equal(C.linkApp('123', 'x'), null);
  assert.equal(C.linkWhatsApp(null, 'x'), null);
});

test('tela intermediária no modo aplicativo: abre o app na mesma aba e volta sozinha para a lista; senão oferece o Web', () => {
  const v = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'contato-whatsapp.ejs'), 'utf8');
  assert.match(v, /typeof linkApp !== 'undefined' && linkApp/);
  assert.match(v, /data-link-app="<%= linkApp %>"/);
  assert.match(v, /data-voltar="<%= voltarPara %>"/);
  assert.match(v, /Abrir no WhatsApp Web/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'whatsapp-app.js'), 'utf8');
  assert.match(js, /location\.href = linkApp/);
  assert.match(js, /addEventListener\('blur'/);
  assert.match(js, /location\.replace\(voltar\)/);
});

test('lista de alunos da turma: Confirmar aula leva à prévia; o POST registra e abre o app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'admin', 'alunos.ejs'), 'utf8');
  assert.match(src, /href="\/alunos\/<%= a\.id %>\/confirmar-turma\?turma=<%= turmaId %>"/);
  assert.match(src, /Confirmar aula/);
  assert.match(src, /confirmação enviada em/);
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  const i = admin.indexOf("router.post('/alunos/:id/confirmar-turma', requirePermissao('turmas:gerenciar', 'aluno:gerenciar')");
  assert.ok(i > 0, 'rota com a permissão');
  const rota = admin.slice(i, i + 2500);
  assert.match(rota, /salvarExtra\('matricula', [^,]+, \{ confirmacaoTurmaEm/);
  assert.match(rota, /CONFIRMOU_TURMA_WHATSAPP/);
  assert.match(rota, /render\('admin\/contato-whatsapp'/);
  assert.match(rota, /linkApp/);
});

const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
test('textoDaTurma usa o modelo salvo e a doação da turma', { skip: temBanco ? false : 'sem banco' }, async () => {
  const prisma = require('../src/db');
  const extras = require('../src/lib/extras');
  const c = await prisma.curso.create({ data: { nome: `Curso Confirmar ${Date.now()}`, cargaHoraria: 8, precoAvista: 1, precoCheio: 1, valorParcela: 1 } });
  const t = await prisma.turma.create({ data: { cursoId: c.id, inicioPrevisto: new Date('2026-12-01T12:00:00Z'), vagas: 30, minimoAlunos: 0, status: 'ABERTA', aulas: { create: [{ data: new Date('2026-12-01T00:00:00Z'), horario: '18:00 – 22:00' }] } } });
  try {
    await extras.salvarExtra('turma', t.id, { boasVindasDoacao: 'Traga 1 pacote de CAFÉ.' });
    const txt = await C.textoDaTurma(t.id);
    assert.match(txt, /Início: dia \*01\/12\/2026 às 18h\*/);
    assert.match(txt, /Traga 1 pacote de CAFÉ\./);
    assert.equal(await C.textoDaTurma('00000000-0000-0000-0000-000000000000'), null);
  } finally {
    await extras.salvarExtra('turma', t.id, { boasVindasDoacao: null });
    await prisma.aulaData.deleteMany({ where: { turmaId: t.id } }); await prisma.turma.delete({ where: { id: t.id } }); await prisma.curso.delete({ where: { id: c.id } });
  }
});

test('a lista renderiza com o botão para quem tem celular e "sem WhatsApp" para quem não tem', async () => {
  const ejs = require('ejs');
  const a = (o) => ({ id: 'a1', nome: 'Ana Paula', email: 'a@x', celular: '21988771122', cpfCnpj: null, _count: { matriculas: 1 }, matriculas: [{ id: 'm1', statusPagamento: 'PENDENTE' }], celularValido: true, confirmacaoTurmaEm: null, bloqueioTotal: false, ...o });
  const html = await ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'admin', 'alunos.ejs'), {
    ativo: 'alunos', modoPainel: 'presencial', admPapel: 'X', csrfToken: 'x', usuario: { nome: 'T' }, asset: (u) => u, montarMenu: require('../src/lib/menu-painel').montarMenu,
    rotuloTurma: (s) => s, pode: () => true, documentoAluno: () => null, mascarar: (x) => x,
    alunos: [a(), a({ id: 'a2', nome: 'Bruno', celularValido: false, confirmacaoTurmaEm: '2026-11-16T15:00:00Z' })], total: 2, busca: '', inscricao: '', turmas: [], turmaId: 't1', pagTurma: null, ok: null, erro: null,
  });
  assert.equal((html.match(/Confirmar aula/g) || []).length, 1);
  assert.match(html, /sem WhatsApp/);
  assert.match(html, /confirmação enviada em/);
});

let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { /* sem playwright */ }
test('modo aplicativo no navegador: abriu (perdeu o foco) → volta à lista; não abriu → mostra o Web', { skip: chromium ? false : 'sem Playwright' }, async () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'whatsapp-app.js'), 'utf8');
  const pagina = '<div id="wppApp" data-link-app="about:blank#app" data-voltar="http://painel.test/alunos?turma=t1"><p id="nota">Abrindo</p><p id="semApp" hidden>sem app</p></div>';
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.route('http://painel.test/**', (r) => r.fulfill({ contentType: 'text/html', body: r.request().url().includes('/alunos') ? '<p>lista</p>' : pagina }));
    // abriu: o navegador perde o foco
    await p.goto('http://painel.test/contato');
    await p.evaluate(() => { window.__abriu = []; });
    await p.addScriptTag({ content: js.replace('location.href = linkApp', 'window.__abriu.push(linkApp)') });
    await p.evaluate(() => window.dispatchEvent(new Event('blur')));
    await p.waitForURL('http://painel.test/alunos?turma=t1');
    // não abriu: depois de 3 s aparece a reserva
    await p.goto('http://painel.test/contato');
    await p.evaluate(() => { window.__abriu = []; });
    await p.addScriptTag({ content: js.replace('location.href = linkApp', 'window.__abriu.push(linkApp)') });
    await p.waitForTimeout(3500);
    assert.equal(await p.isVisible('#semApp'), true);
    assert.deepEqual(await p.evaluate(() => window.__abriu), ['about:blank#app']);
  } finally { await b.close(); }
});
