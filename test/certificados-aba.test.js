// 2026-11-12: aba "Certificados" no painel — quem assina (nome, cargo, assinatura escaneada), com/sem assinatura no
// certificado online, livro em uso e a prévia. "Modelos" fica só com a mensagem de boas-vindas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const V = (p) => path.join(__dirname, '..', 'src', 'views', 'admin', p);
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const ajustes = {
  assinantes: [{ nome: 'ALESSANDRA RACHEL GOMES DA SILVA', cargo: 'Coordenadora da Escola', imagemUrl: '/uploads/a.webp' }, { nome: 'LUIZ CARLOS DOS SANTOS', cargo: 'Presidente', imagemUrl: null }],
  livro: 2, assinaturaOnline: 'com', assinaturaPresencial: 'mao',
};
const render = (x = {}) => ejs.renderFile(V('certificados.ejs'), {
  ajustes, ok: null, erro: null, csrfToken: 'x', asset: (u) => u, pode: () => true, admPapel: 'DEV', usuario: { nome: 'Dev', papel: 'DEV' }, modo: 'presencial', ...x,
});

test('aba Certificados: cartões de quem assina com miniatura, envio e remover', async () => {
  const html = await render();
  assert.match(html, /<form method="POST" action="\/certificados\?_csrf=x"[^>]*enctype="multipart\/form-data"/);
  assert.match(html, /value="ALESSANDRA RACHEL GOMES DA SILVA"/);
  assert.match(html, /<img src="\/uploads\/a\.webp" alt="Assinatura de ALESSANDRA RACHEL GOMES DA SILVA"/);
  assert.match(html, /name="assinantes\[0\]\[removerImg\]"/);
  assert.equal((html.match(/type="file" name="assinaturaImg\d"/g) || []).length, 6);
  assert.match(await render({ aba: 'online' }), /name="assinaturaOnline" value="com" checked/); // 2026-11-26: na sub-aba Online
  assert.match(html, /name="livro" min="1" value="2"/);
  assert.match(html, /<iframe[^>]+src="\/certificados\/previa\?modalidade=presencial"/);
});

// 2026-11-26: sub-abas Presencial | Online | Webinário, cada uma com as suas opções e a sua prévia; "Quem assina e livro"
// aparece nas três; o campo oculto `aba` devolve à mesma sub-aba depois de salvar.
test('sub-abas: sem aba abre em Presencial; cada uma com as suas opções e prévia; bloco comum nas três', async () => {
  const pres = await render();
  assert.match(pres, /<a href="\/certificados\?aba=presencial" class="adm-aba on">Presencial<\/a>/);
  assert.match(pres, /<a href="\/certificados\?aba=online" class="adm-aba ">Online<\/a>/);
  assert.match(pres, /<a href="\/certificados\?aba=webinario" class="adm-aba ">Webinário<\/a>/);
  assert.match(pres, /id="imprimir-turmas"/);
  assert.match(pres, /name="assinaturaPresencial" value="mao" checked/);
  assert.match(pres, /name="assinaturaPresencial" value="escaneada" (?!checked)/);
  assert.doesNotMatch(pres, /name="assinaturaOnline"/);
  assert.match(pres, /<input type="hidden" name="aba" value="presencial">/);
  assert.match(pres, /href="\/cursos"/);

  const on = await render({ aba: 'online', ajustes: { ...ajustes, assinaturaPresencial: 'escaneada' } });
  assert.match(on, /class="adm-aba on">Online</);
  assert.doesNotMatch(on, /id="imprimir-turmas"/);
  assert.match(on, /name="assinaturaOnline" value="com" checked/);
  assert.doesNotMatch(on, /name="assinaturaPresencial"/);
  assert.match(on, /<input type="hidden" name="aba" value="online">/);
  assert.match(on, /<iframe[^>]+src="\/certificados\/previa\?modalidade=online"/);

  const web = await render({ aba: 'webinario' });
  assert.match(web, /class="adm-aba on">Webinário</);
  assert.doesNotMatch(web, /name="assinaturaOnline"|name="assinaturaPresencial"/);
  assert.match(web, /Segue a regra do certificado online/);
  assert.match(web, /<iframe[^>]+src="\/certificados\/previa\?modalidade=webinario"/);

  for (const html of [pres, on, web]) {
    assert.match(html, /Quem assina e livro/);
    assert.equal((html.match(/type="file" name="assinaturaImg\d"/g) || []).length, 6);
    assert.match(html, /name="livro" min="1" value="2"/);
    assert.equal((html.match(/action="\/certificados\?_csrf=x"/g) || []).length, 1, 'um formulário só para a página');
  }
  assert.match(await render({ aba: 'qualquer' }), /class="adm-aba on">Presencial</);
});

test('rotas: ?aba= e ?modalidade= (presencial, online, webinário); o POST volta à sub-aba', () => {
  const a = ler('src/routes/admin.js');
  const get = a.slice(a.indexOf("router.get('/certificados'"), a.indexOf("router.post('/certificados'"));
  assert.match(get, /aba: abaCert\(req\.query\.aba\)/);
  const post = a.slice(a.indexOf("router.post('/certificados'"), a.indexOf("router.get('/certificados/previa'"));
  assert.match(post, /assinaturaPresencial: req\.body\.assinaturaPresencial/);
  assert.match(post, /res\.redirect\(`\/certificados\?aba=\$\{aba\}&ok=`/);
  const previa = a.slice(a.indexOf("router.get('/certificados/previa'"), a.indexOf("router.get('/certificados/previa'") + 900);
  assert.match(previa, /modalidade === 'presencial' \? certificado\.exemploCertificadoPresencial\(ajustes\)/);
  assert.match(previa, /modalidade === 'webinario' \? require\('\.\.\/lib\/webinario-certificado'\)\.exemploCertificadoWebinario\(ajustes\)/);
  assert.match(previa, /exemploCertificadoEad\(ajustes\)/);
});

test('exemplo do presencial: aluno, turma e instrutor de exemplo, validade de 2 anos, imagem só com "escaneada"', () => {
  const cert = require('../src/lib/certificado');
  const mao = cert.exemploCertificadoPresencial(ajustes);
  assert.equal(mao.nome, 'Aluno Exemplo');
  assert.equal(mao.teste, true);
  assert.ok(!mao.online && !mao.webinario);
  assert.equal(mao.assinaturaPresencial, 'mao');
  assert.deepEqual(mao.assinaturas.map((x) => x.nome), ['ALESSANDRA RACHEL GOMES DA SILVA', 'Instrutor(a) de Exemplo']);
  assert.equal(mao.assinaturas[0].imagemUrl, undefined);
  assert.match(mao.validade, /^Válido até \d{2}\/\d{2}\/\d{4}$/);
  assert.ok(mao.conteudo.length >= 3);
  assert.match(mao.periodo.frase, /^no período de /);
  const esc = cert.exemploCertificadoPresencial({ ...ajustes, assinaturaPresencial: 'escaneada' });
  assert.equal(esc.assinaturaPresencial, 'escaneada');
  assert.equal(esc.assinaturas[0].imagemUrl, '/uploads/a.webp');
  const web = require('../src/lib/webinario-certificado').exemploCertificadoWebinario(ajustes);
  assert.ok(web.webinario && web.webinario.titulo);
  assert.match(web.validade, /^Válido até /);
  assert.match(require('../src/lib/ead-certificado').exemploCertificadoEad(ajustes).validade, /^Válido até /);
});

test('validoAte / textoValidade: mesmo dia meses depois (dia de Brasília), fim do mês quando o dia não existe, texto antigo', () => {
  const { validoAte, textoValidade, mesesValidade, VALIDADES } = require('../src/lib/certificado');
  const iso = (d) => d.toISOString().slice(0, 10);
  assert.equal(iso(validoAte(new Date('2026-11-26T15:00:00Z'), 24)), '2028-11-26');
  assert.equal(iso(validoAte(new Date('2026-11-26T02:30:00Z'), 24)), '2028-11-25', '23h30 do dia 25 em Brasília');
  assert.equal(iso(validoAte(new Date('2026-01-31T12:00:00Z'), 1)), '2026-02-28');
  assert.equal(iso(validoAte(new Date('2024-02-29T12:00:00Z'), 12)), '2025-02-28');
  assert.equal(iso(validoAte(new Date('2026-08-31T12:00:00Z'), 6)), '2027-02-28');
  assert.equal(validoAte(new Date(), null), null);
  assert.equal(validoAte(null, 12), null);
  assert.equal(validoAte('data ruim', 12), null);
  assert.equal(textoValidade({ certificadoValidadeMeses: 24 }, new Date('2026-11-26T15:00:00Z')), 'Válido até 26/11/2028');
  assert.equal(textoValidade({ certificadoValidadeMeses: 24, certificadoValidade: 'Validade de 2 anos' }, new Date('2026-11-26T15:00:00Z')), 'Válido até 26/11/2028', 'o prazo novo ganha do texto antigo');
  assert.equal(textoValidade({ certificadoValidade: ' Validade de 2 anos ' }, new Date()), 'Validade de 2 anos');
  assert.equal(textoValidade({}, new Date()), '');
  assert.equal(textoValidade(null, new Date()), '');
  assert.deepEqual(VALIDADES.map((v) => v.meses), [6, 12, 24, 36, 60]);
  assert.equal(mesesValidade('24'), 24); assert.equal(mesesValidade('7'), null); assert.equal(mesesValidade(''), null);
});

test('modelo impresso: presencial à mão sem a imagem (só a linha); com "escaneada", a imagem; o online não muda', async () => {
  const cert = require('../src/lib/certificado');
  const render = (d) => ejs.renderFile(V('certificado-imprimir.ejs'), { lista: [{ id: 'x', ...d, verificacao: null }], turma: { curso: { nome: 'PS' } }, avisoRedacao: null, barraAluno: null, asset: (u) => u });
  const mao = await render(cert.exemploCertificadoPresencial(ajustes));
  assert.doesNotMatch(mao, /cert-assinatura-img/);
  assert.equal((mao.match(/class="cert-linha"/g) || []).length, 2);
  assert.match(mao, /Válido até \d{2}\/\d{2}\/\d{4}/);
  const esc = await render(cert.exemploCertificadoPresencial({ ...ajustes, assinaturaPresencial: 'escaneada' }));
  assert.match(esc, /<img class="cert-assinatura-img" src="\/uploads\/a\.webp" alt="">/);
  assert.equal((esc.match(/class="cert-linha"/g) || []).length, 2);
  // Online "sem" segue como antes: nem linha nem imagem, mesmo com o presencial em "escaneada".
  const on = await render(require('../src/lib/ead-certificado').exemploCertificadoEad({ ...ajustes, assinaturaOnline: 'sem', assinaturaPresencial: 'escaneada' }));
  assert.doesNotMatch(on, /cert-assinatura-img|class="cert-linha"/);
});

test('formulário do curso: validade em meses (select) nas duas telas; o texto antigo aparece como opção marcada', async () => {
  const sec = ler('src/views/admin/_curso-secao-certificado.ejs');
  assert.match(sec, /include\('_curso-validade'/);
  assert.doesNotMatch(sec, /name="certificadoValidade"/);
  assert.match(ler('src/views/admin/curso-novo.ejs'), /include\('_curso-validade'/);
  assert.match(ler('src/public/js/curso-passos.js'), /'certificadoValidadeMeses'/);
  const h = await ejs.renderFile(V('_curso-validade.ejs'), { c: { certificadoValidadeMeses: 24 }, classe: 'full' });
  assert.match(h, /<select name="certificadoValidadeMeses">/);
  for (const v of [6, 12, 24, 36, 60]) assert.match(h, new RegExp(`<option value="${v}"`));
  assert.match(h, /<option value="24" selected>2 anos</);
  assert.doesNotMatch(h, /value="antigo"/);
  const antigo = await ejs.renderFile(V('_curso-validade.ejs'), { c: { certificadoValidade: 'Validade de 2 anos' }, classe: '' });
  assert.match(antigo, /<option value="antigo" selected>Texto antigo: "Validade de 2 anos"</);
  assert.match(antigo, /<option value="" >Sem validade</);
  assert.match(await ejs.renderFile(V('_curso-validade.ejs'), { c: {}, classe: '' }), /<option value="" selected>Sem validade</);
});

test('rotas: GET/POST /certificados e a prévia; Modelos não salva mais o certificado', () => {
  const a = ler('src/routes/admin.js');
  assert.match(a, /router\.get\('\/certificados', requirePermissao\('turmas:gerenciar'\)/);
  assert.match(a, /router\.post\('\/certificados', requirePermissao\('turmas:gerenciar'\), receberAssinaturas/);
  assert.match(a, /router\.get\('\/certificados\/previa', requirePermissao\('turmas:gerenciar'\)/);
  const post = a.slice(a.indexOf("router.post('/modelos'"), a.indexOf("router.post('/modelos'") + 600);
  assert.doesNotMatch(post, /certificado\.salvarAjustes/);
  assert.doesNotMatch(ler('src/views/admin/modelos.ejs'), /assinantes\[/);
});

test('menu do painel tem "Certificados" nos dois modos', () => {
  // 2026-11-13: o menu saiu do header.ejs para lib/menu-painel.js.
  const { montarMenu } = require('../src/lib/menu-painel');
  for (const modo of ['presencial', 'online']) {
    const m = montarMenu({ modo, papel: 'DEV', pode: () => true, ativo: '' });
    assert.ok(m.some((g) => g.href === '/certificados'), modo);
  }
});

test('exemplo da prévia: aluno de exemplo com as assinaturas atuais', () => {
  const { exemploCertificadoEad } = require('../src/lib/ead-certificado');
  const d = exemploCertificadoEad(ajustes);
  assert.equal(d.nome, 'Aluno Exemplo');
  assert.equal(d.teste, true);
  assert.deepEqual(d.assinaturas.map((x) => x.nome), ['ALESSANDRA RACHEL GOMES DA SILVA', 'LUIZ CARLOS DOS SANTOS']);
  assert.equal(d.assinaturas[0].imagemUrl, '/uploads/a.webp');
});
