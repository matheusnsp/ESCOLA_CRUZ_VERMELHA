// Dados fixos de um certificado PRESENCIAL para comparar o HTML da view antes e depois da etapa 3 do EAD.
module.exports = {
  turma: { curso: { nome: 'Bombeiro Civil' } },
  avisoRedacao: null,
  lista: [{
    id: 'mat-1', nome: 'Maria da Silva', portador: 'Portadora', documento: { tipo: 'CPF', numero: '123.456.789-09' },
    curso: 'Bombeiro Civil', cargaHoraria: '80 horas', periodo: { frase: 'no período de 01/10/2026 a 05/10/2026', curta: '01/10/2026 a 05/10/2026' },
    emitidoEm: 'Rio de Janeiro, 06 de Outubro de 2026.',
    assinaturas: [{ nome: 'AMANDA FERRARI PENZA', cargo: 'Coordenadora de Cursos Livres' }, { nome: 'João Instrutor', cargo: 'Instrutor', instrutor: true }],
    instrutorNome: 'João Instrutor', instrutorRegistro: '', livro: 1, registro: 42, validade: '2 anos',
    conteudo: ['Prevenção de incêndios', 'Combate a incêndios'],
    verificacao: { codigo: 'ABCD-EFGH', url: 'https://redacao.exemplo/certificado/ABCD-EFGH', qr: '<svg id="qr-fixo"></svg>' },
  }],
};
