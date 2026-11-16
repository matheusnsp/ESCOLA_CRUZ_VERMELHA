// 2026-11-16: "Confirmar aula" abre primeiro a tela com a mensagem; só "Enviar no WhatsApp" registra e abre o app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const ler = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('lista: Confirmar aula é um link para a prévia (não envia nada)', () => {
  const v = ler('views/admin/alunos.ejs');
  assert.match(v, /href="\/alunos\/<%= a\.id %>\/confirmar-turma\?turma=<%= turmaId %>"[^>]*>\s*<i class="fa-brands fa-whatsapp"><\/i> Confirmar aula/);
  assert.doesNotMatch(v, /<form method="POST" action="\/alunos\/<%= a\.id %>\/confirmar-turma"/);
});

test('rota GET da prévia: mesma permissão, não registra; o POST continua registrando e abrindo o app', () => {
  const admin = ler('routes/admin.js');
  const i = admin.indexOf("router.get('/alunos/:id/confirmar-turma', requirePermissao('turmas:gerenciar', 'aluno:gerenciar')");
  assert.ok(i > 0);
  const rota = admin.slice(i, admin.indexOf('\n});', i));
  assert.doesNotMatch(rota, /salvarExtra|auditar\(/, 'ver não registra');
  assert.match(rota, /render\('admin\/confirmar-aula'/);
  assert.match(admin, /router\.post\('\/alunos\/:id\/confirmar-turma'/);
});

test('tela da prévia: a mensagem inteira, o botão de enviar (POST) e onde editar o texto', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'admin', 'confirmar-aula.ejs'), {
    ativo: 'alunos', modoPainel: 'presencial', admPapel: 'X', csrfToken: 'x', usuario: { nome: 'T' }, asset: (u) => u,
    montarMenu: require('../src/lib/menu-painel').montarMenu, pode: () => true,
    aluno: { id: 'a1', nome: 'Ana Paula', celular: '(21) 98877-1122' }, turma: { id: 't1', curso: { id: 'c1', nome: 'Socorrista' } },
    texto: '*Desejamos aos alunos do curso de SOCORRISTA, Boas vindas!!!*\n\nOlá a todos,', jaEnviadaEm: '2026-11-16T15:00:00Z',
  });
  assert.match(html, /Desejamos aos alunos do curso de SOCORRISTA/);
  assert.match(html, /<form method="POST" action="\/alunos\/a1\/confirmar-turma"/);
  assert.match(html, /name="turma" value="t1"/);
  assert.match(html, /Enviar no WhatsApp/);
  assert.match(html, /href="\/modelos"/, 'link para editar o texto');
  assert.match(html, /href="\/turmas\/t1\/boas-vindas"/, 'doação só desta turma');
  assert.match(html, /já foi enviada em/);
  assert.match(html, /href="\/alunos\?turma=t1"/, 'voltar');
});

test('[bug do print] o botão vermelho da caixa Confirmar volta a ter texto branco (classe não sobrescrita)', () => {
  const css = ler('public/admin.css');
  const regras = css.match(/(^|\n)\s*\.adm-btn-perigo\s*\{[^}]*\}/g) || [];
  assert.equal(regras.length, 1, 'uma regra só para .adm-btn-perigo');
  assert.match(regras[0], /color:\s*#fff/);
  assert.match(css, /\.adm-btn-excluir\s*\{/);
  for (const f of ['views/admin/curso-secao.ejs', 'views/admin/turma-resumo.ejs']) assert.doesNotMatch(ler(f), /class="adm-btn-perigo"/, f);
});

test('cada tela diz o canal: e-mail (todos de uma vez) ou WhatsApp (um por um)', () => {
  const bv = ler('views/admin/turma-boas-vindas.ejs');
  assert.match(bv, /Envio por e-mail/);
  assert.match(bv, /'Enviar por e-mail para ' \+ faltam\.length/);
  assert.match(bv, /já receberam por e-mail/);
  assert.match(bv, /Pelo WhatsApp/);
  assert.match(bv, /href="\/alunos\?turma=<%= turma\.id %>"/);
  assert.match(bv, /Copiar texto para o grupo do WhatsApp/);
  const r = ler('views/admin/turma-resumo.ejs');
  assert.match(r, /por e-mail \(para todos de uma vez\) e pelo WhatsApp \(um por um/);
  assert.match(ler('views/admin/confirmar-aula.ejs'), /Confirmar aula pelo WhatsApp/);
});
