// lib/permissoes.js
const PERMISSOES = {
    SECRETARIA: [
      'cursos:gerenciar', 'turmas:gerenciar', 'doacao:confirmar',
      'aluno:mover_turma', 'aluno:gerenciar', 'taxa:aprovar',
    ],
    COORDENADOR: [],
  };
  
  // Coordenador = tudo da Secretaria + financeiro em modo leitura
  PERMISSOES.COORDENADOR = [...PERMISSOES.SECRETARIA, 'financeiro:leitura'];
  
  const PAPEIS_ADMIN = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'DEV'];
  
  // Financeiro e Dev têm acesso total — não passam pela lista de permissões, são liberados direto.
  function temPermissao(papel, perm) {
    if (papel === 'FINANCEIRO' || papel === 'DEV') return true;
    return (PERMISSOES[papel] || []).includes(perm);
  }
  
  module.exports = { temPermissao, PAPEIS_ADMIN };