// lib/permissoes.js
const PERMISSOES = {
    SECRETARIA: [
      'cursos:gerenciar', 'turmas:gerenciar', 'doacao:confirmar',
      'aluno:mover_turma', 'aluno:gerenciar', 'taxa:aprovar',
    ],
    COORDENADOR: [],
    FINANCEIRO: ['financeiro:aprovar'],
    DEV: [],
  };
  
  PERMISSOES.COORDENADOR = [...PERMISSOES.SECRETARIA, 'financeiro:leitura'];
  PERMISSOES.FINANCEIRO = [...PERMISSOES.FINANCEIRO, 'secretaria:leitura'];
  
  const PAPEIS_ADMIN = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'DEV'];
  
  function temPermissao(papel, perm) {
    if (papel === 'DEV') return true;
    return (PERMISSOES[papel] || []).includes(perm);
  }
  
  module.exports = { temPermissao, PAPEIS_ADMIN };