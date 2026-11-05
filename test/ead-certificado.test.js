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
  test('assinaturas sem instrutor; sem escolha válida, a primeira da lista', () => {
    assert.deepEqual(dadosCertificadoEad(base).assinaturas, [{ nome: 'BRUNO', cargo: 'Presidente' }]);
    const s = dadosCertificadoEad({ ...base, curso: { ...base.curso, certAssinaturas: ['instrutor'] } });
    assert.deepEqual(s.assinaturas, [{ nome: 'AMANDA', cargo: 'Coordenadora' }]);
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
