// lib/permissoes.js

const PERMISSOES = {

  // ---- SECRETARIA -------------------------------------------------
  // Acesso operacional do dia a dia. Não enxerga /financeiro.
  SECRETARIA: [
    'cursos:gerenciar',    // editar/excluir/ativar/FAQs de curso EXISTENTE
                            // (NÃO inclui 'cursos:criar' — só Coordenador/Dev criam curso novo)
    'turmas:gerenciar',    // CRUD completo de turma, incluindo CRIAR — sem restrição aqui
    'doacao:confirmar',    // marcar/desmarcar alimento entregue
    'aluno:mover_turma',   // transferir aluno entre turmas
    'aluno:gerenciar',     // editar dados cadastrais do aluno
    'taxa:aprovar',        // confirmar pagamento da TAXA de inscrição
    'pagamento:confirmar', // confirmar pagamento do CURSO (cancelar/estornar
                            // continuam exclusivos do Financeiro/Dev)
  ],

  // ---- COORDENADOR --------------------------------------------------
  // Única diferença pra Secretaria: pode criar curso + vê financeiro (leitura).
  COORDENADOR: [], // montado abaixo por spread

  // ---- FINANCEIRO ----------------------------------------------------
  // Controle total só em /financeiro; resto do site é modo leitura.
  FINANCEIRO: [
    'painel:leitura',      // ver cursos/turmas/alunos/notas — sem nenhum botão de ação
    'financeiro:leitura',  // ver o painel /financeiro
    'financeiro:aprovar',  // confirmar/cancelar/estornar pagamento do curso
  ],

  // ---- CONSULTA -------------------------------------------------------
  // Só enxerga o site (nenhuma ação); /financeiro fora do alcance e fora do header.
  CONSULTA: [
    'painel:leitura',
  ],
};

// Coordenador = tudo da Secretaria + criar curso + financeiro em leitura
PERMISSOES.COORDENADOR = [
  ...PERMISSOES.SECRETARIA,
  'cursos:criar',
  'financeiro:leitura',
];

const PAPEIS_ADMIN = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'CONSULTA', 'DEV'];

// Retorna a lista de permissões "efetivas" de um papel, só pra EXIBIÇÃO
// (não usar isso pra checar acesso — quem faz isso é temPermissao()).
function listarPermissoes(papel) {
  if (papel === 'DEV') return ['(acesso total — bypass, ignora a lista de permissões)'];
  return PERMISSOES[papel] || [];
}

module.exports = { temPermissao, PAPEIS_ADMIN, listarPermissoes };