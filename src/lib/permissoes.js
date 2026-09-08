// lib/permissoes.js
//
// Modelo de permissões: cada papel tem uma lista de "strings de permissão".
// requirePermissao(...) nas rotas libera se o papel tiver AO MENOS UMA das
// strings passadas (OR). Ver comentário em cada bloco abaixo pra saber
// o que cada permissão nova faz e por que existe.

const PERMISSOES = {

  // ---- SECRETARIA -------------------------------------------------
  // Acesso operacional completo do dia a dia. NÃO enxerga a aba
  // /financeiro (não tem financeiro:leitura) e não mexe em dinheiro que
  // volta: cancelar, estornar e reembolsar ficam fora.
  SECRETARIA: [
    'cursos:gerenciar',    // CRUD de cursos (editar/excluir/ativar/FAQs)
    'cursos:criar',        // criar curso
    'turmas:gerenciar',    // criar/editar turma, mudar status, lançar notas, excluir
    'doacao:confirmar',    // marcar/desmarcar alimento entregue
    'aluno:mover_turma',   // transferir aluno entre turmas
    'aluno:gerenciar',     // editar dados cadastrais do aluno, convidar por WhatsApp
    'taxa:aprovar',        // confirmar pagamento da TAXA de inscrição
    'pagamento:confirmar', // confirmar pagamento do CURSO (só confirmar —
                            // cancelar/estornar continuam do Financeiro/Dev)
    'pendentes:gerenciar', // ver /pendentes e enviar lembrete de pagamento.
                            // Antes dependia de financeiro:leitura, o que
                            // amarrava a tela de cobrança à aba de tesouraria
                            // — são coisas diferentes: cobrar é trabalho de
                            // secretaria, ver o caixa não.
    // 💡 REMOVIDO: 'turmas:criar'. Ela estava aqui mas NENHUMA rota a exigia
    // — quem cria turma é POST /turmas, que pede 'turmas:gerenciar'. Uma
    // permissão que não controla nada só engana quem lê a lista depois.
  ],

  // ---- COORDENADOR --------------------------------------------------
  // Tudo da Secretaria + vê a aba /financeiro. Só isso: não baixa
  // relatório, não cancela inscrição, não estorna, não marca reembolso.
  // No financeiro ele é observador puro.
  COORDENADOR: [], // montado logo abaixo, por spread

  // ---- FINANCEIRO ----------------------------------------------------
  // Controle total sobre dinheiro; no resto do site, só enxerga.
  FINANCEIRO: [
    'painel:leitura',       // ver cursos/turmas/alunos/inscrições/notas — sem botões
    'financeiro:leitura',   // ver a aba /financeiro
    'financeiro:aprovar',   // cancelar inscrição
    'financeiro:reembolsar',// estornar e marcar reembolso concluído.
                            // Separado de financeiro:aprovar porque estorno
                            // devolve dinheiro ao aluno e é irreversível —
                            // não pode viajar junto com "cancelar", que é
                            // operação corriqueira.
    'relatorio:baixar',     // downloads Excel/PDF/CSV/OFX. Exclusivo daqui:
                            // relatório carrega a movimentação financeira
                            // inteira num arquivo que sai do sistema.
    'pendentes:gerenciar',  // ver /pendentes e enviar lembrete
  ],

  // ---- CONSULTA -------------------------------------------------------
  // Só enxerga o site (nenhuma ação, nenhum botão), e /financeiro fica
  // totalmente fora do alcance — nem o link aparece.
  CONSULTA: [
    'painel:leitura',
  ],
};

// Coordenador = tudo da Secretaria + ver a aba /financeiro.
// 💡 REMOVIDO: 'relatorio:baixar'. Baixar relatório passou a ser exclusivo
// do Financeiro e do Dev — é o arquivo que tira a movimentação inteira de
// dentro do sistema. O Coordenador continua vendo os números na tela.
PERMISSOES.COORDENADOR = [
  ...PERMISSOES.SECRETARIA,
  'financeiro:leitura', // vê a aba /financeiro — seu único diferencial
];

// Papéis que conseguem logar no painel admin (independente do que cada um pode FAZER lá dentro)
const PAPEIS_ADMIN = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'CONSULTA', 'DEV'];

// DEV é o ÚNICO bypass total — acesso de manutenção/emergência.
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