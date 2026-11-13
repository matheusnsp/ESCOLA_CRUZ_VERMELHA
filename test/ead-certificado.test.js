// Certificado do curso online: dados (sem banco), modelo (view) e emissão (com banco local).
require('dotenv').config();
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { dadosCertificadoEad } = require('../src/lib/ead-certificado'); // no topo: erro aqui derruba o arquivo

const VIEW = path.join(__dirname, '..', 'src', 'views', 'admin', 'certificado-imprimir.ejs');
const render = (dados) => ejs.render(fs.readFileSync(VIEW, 'utf8'), { avisoRedacao: null, ...dados, asset: (u) => u }, { filename: VIEW });
const RESSALVA = 'Capacitação teórica. Não inclui treinamento prático em manequim, oferecido nos cursos presenciais da Escola.';

describe('modelo do certificado', () => {
  test('presencial: HTML igual ao de antes da etapa 3', () => {
    const fx = require('./fixtures/certificado-presencial');
    assert.equal(render(fx), fs.readFileSync(path.join(__dirname, 'fixtures', 'certificado-presencial.html'), 'utf8'));
  });
});

describe('dadosCertificadoEad', () => {
  const documentoAluno = (u) => (u.cpfCnpj ? { tipo: 'CPF · pessoa física', numero: u.cpfCnpj } : (u.passaporte ? { tipo: 'Passaporte', numero: u.passaporte } : null));
  const base = {
    usuario: { nome: ' Ana Professora ', genero: 'Feminino', cpfCnpj: '12345678909' },
    curso: { nome: 'Primeiros Socorros', cargaHoraria: 3, certAssinaturas: ['a1', 'instrutor'] },
    modulos: [{ titulo: 'Juntando tudo', final: true }, { titulo: 'Antes de tudo', final: false }, { titulo: 'Engasgo', final: false }],
    numero: { livro: 3, registro: 120, emitidoEm: new Date('2026-11-05T15:00:00Z') },
    concluidoEm: new Date('2026-11-05T14:00:00Z'),
    ajustes: { assinantes: [{ nome: 'AMANDA', cargo: 'Coordenadora' }, { nome: 'BRUNO', cargo: 'Presidente' }], livro: 3 },
    documentoAluno,
  };

  test('campos principais', () => {
    const d = dadosCertificadoEad(base);
    assert.equal(d.online, true);
    assert.equal(d.nome, 'Ana Professora');
    assert.equal(d.portador, 'Portadora');
    assert.deepEqual(d.documento, { tipo: 'CPF', numero: '12345678909' });
    assert.equal(d.curso, 'Primeiros Socorros');
    assert.equal(d.cargaHoraria, '03 horas');
    assert.equal(d.concluidoEm, '05/11/2026');
    assert.equal(d.periodo.frase, 'concluído em 05/11/2026');
    assert.equal(d.livro, 3); assert.equal(d.registro, 120);
    assert.match(d.emitidoEm, /^Rio de Janeiro, 05 de Novembro de 2026\.$/);
    assert.deepEqual(d.conteudo, ['Antes de tudo', 'Engasgo', 'Juntando tudo']);
  });
  test('assinaturas: a escolha do curso, sem o instrutor', () => {
    assert.deepEqual(dadosCertificadoEad(base).assinaturas, [{ nome: 'BRUNO', cargo: 'Presidente' }]);
  });
  // 2026-11-12 (pedido do Matheus): o certificado online sai com as três primeiras pessoas de "Quem assina"
  // (painel → Modelos): Alessandra (coordenação), Luiz Carlos (Presidente) e Márcio (Coordenador Estadual).
  test('sem escolha (ou só o instrutor): as três primeiras da lista', () => {
    const lista = [
      { nome: 'Alessandra Rachel Gomes da Silva', cargo: 'Coordenadora da Escola' },
      { nome: 'Luiz Carlos dos Santos', cargo: 'Presidente' },
      { nome: 'Márcio Romero', cargo: 'Coordenador Estadual de Educação e Saúde' },
      { nome: 'Outra Pessoa', cargo: 'Outro cargo' },
    ];
    const coord = { assinantes: lista, livro: 3 };
    assert.deepEqual(dadosCertificadoEad({ ...base, ajustes: coord, curso: { nome: 'X', cargaHoraria: 3 } }).assinaturas, lista.slice(0, 3));
    assert.deepEqual(dadosCertificadoEad({ ...base, ajustes: coord, curso: { ...base.curso, certAssinaturas: ['instrutor'] } }).assinaturas, lista.slice(0, 3));
    // só uma pessoa cadastrada: sai só ela
    assert.deepEqual(dadosCertificadoEad({ ...base, ajustes: { assinantes: [lista[0]], livro: 3 }, curso: { nome: 'X', cargaHoraria: 3 } }).assinaturas, [lista[0]]);
  });
  test('nome no certificado do curso (extras) e sem documento', () => {
    const d = dadosCertificadoEad({ ...base, curso: { ...base.curso, nomeCertificado: 'Primeiros Socorros (Lei Lucas)' }, usuario: { nome: 'Sem Doc', genero: null } });
    assert.equal(d.curso, 'Primeiros Socorros (Lei Lucas)');
    assert.equal(d.documento, null);
    assert.equal(d.portador, 'Portador(a)');
  });
  test('modelo com item online: selo, modalidade, conclusão e ressalva', () => {
    const d = dadosCertificadoEad(base);
    // Compara o texto visível (sem as tags de negrito).
    const html = render({ turma: { curso: { nome: 'Primeiros Socorros' } }, lista: [{ id: 'x', ...d }] }).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(html, /CURSO ONLINE/);
    assert.match(html, /na modalidade a distância \(100% online\)/);
    assert.match(html, /concluído em 05\/11\/2026/);
    assert.ok(html.includes(RESSALVA));
    assert.doesNotMatch(html, /no período de/);
  });
});

// ─── Emissão (banco local) ─────────────────────────────────────────────────────────────────────────
const http = require('http');
const temBanco = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');
const prisma = temBanco ? require('../src/db') : null;
const eadCert = require('../src/lib/ead-certificado');
const email = require('../src/lib/email');

describe('emitirCertificadoEad', { skip: temBanco ? false : 'sem DATABASE_URL local' }, () => {
  const LIVRO = 9998;
  const TOKEN = 'x'.repeat(40);
  let livroAntes; let curso; let co; let u; let ac; let redacao; let recebidos = []; let enviados = [];
  const envAntes = { url: process.env.REDACAO_URL, token: process.env.REDACAO_ESCOLA_TOKEN };
  const documentoAluno = (x) => (x.cpfCnpj ? { tipo: 'CPF', numero: x.cpfCnpj } : null);
  const original = email.enviarCertificadoEadPronto;

  const { before, after } = require('node:test');
  before(async () => {
    livroAntes = await prisma.configuracao.findUnique({ where: { chave: 'cert_livro_atual' } });
    await prisma.configuracao.upsert({ where: { chave: 'cert_livro_atual' }, update: { valor: String(LIVRO) }, create: { chave: 'cert_livro_atual', valor: String(LIVRO) } });
    curso = await prisma.curso.create({ data: { nome: 'TESTE emissão', cargaHoraria: 3, precoAvista: 0, precoCheio: 0, valorParcela: 0 } });
    co = await prisma.cursoOnline.create({ data: { cursoId: curso.id, modulos: { create: [{ titulo: 'Engasgo', ordem: 0 }, { titulo: 'Juntando tudo', ordem: 1, final: true }] } } });
    u = await prisma.usuario.create({ data: { nome: 'Carla Emissão', email: `emissao-${Date.now()}@teste.local`, papel: 'ALUNO', cpfCnpj: String(Date.now()).slice(-11) } });
    ac = await prisma.alunoCursoEad.create({ data: { usuarioId: u.id, cursoOnlineId: co.id } });
    redacao = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{}'); }
        recebidos.push(JSON.parse(corpo));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ codigo: 'ABCD-EFGH' }));
      });
    });
    await new Promise((r) => redacao.listen(0, '127.0.0.1', r));
    email.enviarCertificadoEadPronto = async (...args) => { enviados.push(args); };
  });
  after(async () => {
    email.enviarCertificadoEadPronto = original;
    process.env.REDACAO_URL = envAntes.url || ''; process.env.REDACAO_ESCOLA_TOKEN = envAntes.token || '';
    if (redacao.listening) redacao.close();
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ id: { startsWith: `cert-num-${LIVRO}-` } }, { alvoId: ac.id }] } });
    if (livroAntes) await prisma.configuracao.update({ where: { chave: 'cert_livro_atual' }, data: { valor: livroAntes.valor } });
    else await prisma.configuracao.deleteMany({ where: { chave: 'cert_livro_atual' } });
    await prisma.usuario.delete({ where: { id: u.id } });
    await prisma.cursoOnline.delete({ where: { id: co.id } });
    await prisma.curso.delete({ where: { id: curso.id } });
    await prisma.$disconnect();
  });

  const opcoes = { enviarEmail: true, linkCertificado: 'http://localhost:3000/ead-teste/x/certificado', documentoAluno };

  test('sem conclusão: não emite nada', async () => {
    assert.equal(await eadCert.emitirCertificadoEad(ac.id, opcoes), null);
    assert.equal(await prisma.logAuditoria.count({ where: { alvoId: ac.id } }), 0);
  });

  test('sem Redação: número, sem QR, e-mail uma vez só', async () => {
    process.env.REDACAO_URL = ''; process.env.REDACAO_ESCOLA_TOKEN = '';
    await prisma.alunoCursoEad.update({ where: { id: ac.id }, data: { concluidoEm: new Date() } });
    const r1 = await eadCert.emitirCertificadoEad(ac.id, opcoes);
    assert.equal(r1.dados.livro, LIVRO); assert.ok(r1.dados.registro >= 1);
    assert.equal(r1.dados.online, true); assert.equal(r1.dados.nome, 'Carla Emissão');
    assert.deepEqual(r1.dados.conteudo, ['Engasgo', 'Juntando tudo']);
    assert.equal(r1.verificacao, null); assert.equal(r1.avisoRedacao, 'nao_configurado');
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0][0], u.email);
    assert.equal(enviados[0][2].link, opcoes.linkCertificado);
    const r2 = await eadCert.emitirCertificadoEad(ac.id, opcoes);
    assert.equal(r2.dados.registro, r1.dados.registro);
    assert.equal(enviados.length, 1, 'segunda emissão não manda outro e-mail');
  });

  test('com a Redação: código, QR e registro guardado', async () => {
    process.env.REDACAO_URL = `http://127.0.0.1:${redacao.address().port}`; process.env.REDACAO_ESCOLA_TOKEN = TOKEN;
    const r = await eadCert.emitirCertificadoEad(ac.id, { documentoAluno });
    assert.equal(r.verificacao.codigo, 'ABCD-EFGH'); assert.match(r.verificacao.qr, /^<svg/); assert.equal(r.avisoRedacao, null);
    assert.equal(recebidos.length, 1);
    assert.equal(recebidos[0].curso, 'TESTE emissão (online)');
    assert.equal(recebidos[0].turma_id, co.id); assert.equal(recebidos[0].matricula_id, ac.id);
    assert.ok(await prisma.logAuditoria.findUnique({ where: { id: `cert-redacao-${ac.id}` } }));
    redacao.close();
    const r3 = await eadCert.emitirCertificadoEad(ac.id, { documentoAluno });
    assert.equal(r3.verificacao.codigo, 'ABCD-EFGH');
    assert.equal(recebidos.length, 1);
  });
});

// 2026-11-12: certificado online "com assinatura" (linha + imagem escaneada, se houver) ou "sem assinatura" (só nome
// e cargo). A escolha e as imagens ficam em painel → Modelos.
describe('assinatura do certificado online: com ou sem', () => {
  const ejs = require('ejs');
  const path = require('path');
  const documentoAluno = () => null;
  const lista = [{ nome: 'ALESSANDRA', cargo: 'Coordenadora', imagemUrl: '/uploads/ass-alessandra.webp' }, { nome: 'LUIZ', cargo: 'Presidente' }];
  const dados = (assinaturaOnline) => dadosCertificadoEad({
    usuario: { nome: 'Ana', genero: 'Feminino' }, curso: { nome: 'PS', cargaHoraria: 3 }, modulos: [],
    numero: { livro: 1, registro: 1, emitidoEm: new Date('2026-11-12T15:00:00Z') }, concluidoEm: new Date('2026-11-12T14:00:00Z'),
    ajustes: { assinantes: lista, livro: 1, assinaturaOnline }, documentoAluno,
  });
  const render = (d) => ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'admin', 'certificado-imprimir.ejs'), {
    lista: [{ id: 'x', ...d, verificacao: null }], turma: { curso: { nome: 'PS' } }, avisoRedacao: null, barraAluno: null, asset: (u) => u, csrfToken: 'x',
  });
  test('com assinatura (padrão): linha e a imagem de quem tem', async () => {
    const d = dados(undefined);
    assert.equal(d.assinaturaOnline, 'com');
    assert.equal(d.assinaturas[0].imagemUrl, '/uploads/ass-alessandra.webp');
    const html = await render(d);
    assert.equal((html.match(/class="cert-linha"/g) || []).length, 2);
    assert.match(html, /<img class="cert-assinatura-img" src="\/uploads\/ass-alessandra\.webp" alt="">/);
  });
  test('sem assinatura: só nome e cargo, sem linha nem imagem', async () => {
    const d = dados('sem');
    const html = await render(d);
    assert.doesNotMatch(html, /class="cert-linha"/);
    assert.doesNotMatch(html, /cert-assinatura-img/);
    assert.match(html, /ALESSANDRA/);
  });
});
