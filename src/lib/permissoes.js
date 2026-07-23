// lib/permissoes.js
//
// Modelo de permissões: cada papel tem uma lista de "strings de permissão".
// requirePermissao(...) nas rotas libera se o papel tiver AO MENOS UMA das
// strings passadas (OR). Ver comentário em cada bloco abaixo pra saber
// o que cada permissão nova faz e por que existe.

const PERMISSOES = {

  // ---- SECRETARIA -------------------------------------------------
  // Acesso operacional do dia a dia. NÃO enxerga nem acessa /financeiro
  // (nenhuma das permissões abaixo é financeiro:leitura/aprovar).
  SECRETARIA: [
    'cursos:gerenciar',    // CRUD completo de cursos (criar/editar/excluir/ativar/FAQs)
    'turmas:gerenciar',    // editar turma existente, mudar status, lançar notas, excluir
                            // NOTA: NÃO inclui 'turmas:criar' — Secretaria não cria turma nova
    'doacao:confirmar',    // marcar/desmarcar alimento entregue
    'aluno:mover_turma',   // transferir aluno entre turmas
    'aluno:gerenciar',     // editar dados cadastrais do aluno
    'taxa:aprovar',        // confirmar pagamento da TAXA de inscrição
    'pagamento:confirmar', // NOVO: confirmar pagamento do CURSO (só confirmar —
                            // cancelar e estornar continuam exclusivos do Financeiro/Dev)
  ],

  // ---- COORDENADOR --------------------------------------------------
  // "Acesso total do site" = tudo que Secretaria tem + pode criar turma
  // + financeiro em modo leitura (sem poder aprovar/cancelar/estornar).
  COORDENADOR: [], // montado logo abaixo, por spread

  // ---- FINANCEIRO ----------------------------------------------------
  // ANTES: bypass total (via temPermissao). AGORA: controle total só
  // sobre financeiro; no resto do site, só enxerga (sem editar nada).
  FINANCEIRO: [
    'painel:leitura',      // ver cursos/turmas/alunos/inscrições/notas — SEM nenhum botão de ação
    'financeiro:leitura',  // ver o painel /financeiro
    'financeiro:aprovar',  // confirmar/cancelar/estornar pagamento do curso
  ],

  // ---- CONSULTA -------------------------------------------------------
  // Perfil novo: só enxerga o site (nenhuma ação, nenhum botão),
  // e /financeiro fica totalmente fora do alcance — nem o link aparece.
  CONSULTA: [
    'painel:leitura',      // mesmo "modo espectador" que o Financeiro tem no resto do site
                            // mas sem NENHUMA das permissões de financeiro — por isso o
                            // link some do header e /financeiro devolve 403
  ],
};

// Coordenador = tudo da Secretaria + pode criar turma + financeiro leitura
PERMISSOES.COORDENADOR = [
  ...PERMISSOES.SECRETARIA,
  'turmas:criar',       // única coisa que a Secretaria não tem e o Coordenador ganha
  'financeiro:leitura', // vê o painel /financeiro, mas sem aprovar/cancelar/estornar
];

// Papéis que conseguem logar no painel admin (independente do que cada um pode FAZER lá dentro)
const PAPEIS_ADMIN = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'CONSULTA', 'DEV'];

// DEV é o ÚNICO bypass total agora — acesso de manutenção/emergência.
// Todo o resto (inclusive FINANCEIRO) passa pela lista normal de permissões.
function temPermissao(papel, perm) {
  if (papel === 'DEV') return true;
  return (PERMISSOES[papel] || []).includes(perm);
}

function listarPermissoes(papel) {
  if (papel === 'DEV') return ['(acesso total — bypass, ignora a lista de permissões)'];
  return PERMISSOES[papel] || [];
}

module.exports = { temPermissao, PAPEIS_ADMIN, listarPermissoes };