// lib/permissoes.js
//
// Modelo de permissões: cada papel tem uma lista de "strings de permissão".
// A lista abaixo é o PADRÃO; o DEV pode mudar em Configurações → Permissões (ver carregar/salvar).
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
    'contas:lancar',       // Contas a pagar: lançar despesas da semana e pedir compra/reembolso.
                           // Não mostra o caixa: ela vê só o que foi lançado e o andamento.
    'pendentes:gerenciar', // ver /pendentes, enviar lembrete, registrar contato
                        // por WhatsApp e REMOVER matrícula fantasma (só as
                        // que nunca tiveram dinheiro: PENDENTE +
                        // taxaConfirmada:false + zero gatewayRef).
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
    'contas:aprovar',       // Contas a pagar: aprovar ou recusar o que a secretaria enviou
    'contas:pagar',         // Contas a pagar: marcar como paga (data, forma, comprovante)
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

// Papéis cujas permissões dá para mudar em Configurações → Permissões (DEV fica de fora: é o bypass).
const PAPEIS_EDITAVEIS = ['SECRETARIA', 'COORDENADOR', 'FINANCEIRO', 'CONSULTA'];

// O que cada permissão libera, em português, para a tela de Permissões. Toda string usada em
// requirePermissao/pode() precisa estar aqui para poder ser dada ou tirada pela tela.
const CATALOGO = [
  { grupo: 'Cursos e turmas', id: 'cursos:criar',          nome: 'Criar cursos' },
  { grupo: 'Cursos e turmas', id: 'cursos:gerenciar',      nome: 'Editar, ocultar e excluir cursos', desc: 'Inclui fotos, valores e dúvidas frequentes.' },
  { grupo: 'Cursos e turmas', id: 'turmas:gerenciar',      nome: 'Criar e editar turmas', desc: 'Datas, aulas, status, notas e a aba Horários dos alunos.' },
  { grupo: 'Alunos e inscrições', id: 'aluno:gerenciar',   nome: 'Editar dados dos alunos', desc: 'Cadastro, convite por WhatsApp.' },
  { grupo: 'Alunos e inscrições', id: 'aluno:mover_turma', nome: 'Transferir aluno de turma' },
  { grupo: 'Alunos e inscrições', id: 'doacao:confirmar',  nome: 'Marcar alimento entregue', desc: 'Também abre a tela de Inscrições.' },
  { grupo: 'Alunos e inscrições', id: 'taxa:aprovar',      nome: 'Confirmar a taxa de inscrição' },
  { grupo: 'Alunos e inscrições', id: 'pagamento:confirmar', nome: 'Confirmar o pagamento da matrícula', desc: 'Só confirmar; cancelar e estornar ficam no Financeiro.' },
  { grupo: 'Alunos e inscrições', id: 'pendentes:gerenciar', nome: 'Tela Pendentes', desc: 'Cobrar por WhatsApp e remover inscrição que nunca pagou.' },
  { grupo: 'Financeiro', id: 'financeiro:leitura',    nome: 'Ver a tela Financeiro', desc: 'E os valores recebidos no Painel.' },
  { grupo: 'Financeiro', id: 'financeiro:aprovar',    nome: 'Cancelar inscrição' },
  { grupo: 'Financeiro', id: 'financeiro:reembolsar', nome: 'Estornar pagamento e marcar reembolso', desc: 'Devolve dinheiro ao aluno; não dá para desfazer.' },
  { grupo: 'Financeiro', id: 'relatorio:baixar',      nome: 'Baixar relatórios', desc: 'Excel, PDF, CSV e OFX com a movimentação.' },
  { grupo: 'Contas a pagar', id: 'contas:lancar',  nome: 'Lançar despesas e pedir compra ou reembolso', desc: 'Envia a semana para aprovação. Não mostra o caixa.' },
  { grupo: 'Contas a pagar', id: 'contas:aprovar', nome: 'Aprovar ou recusar despesas e pedidos' },
  { grupo: 'Contas a pagar', id: 'contas:pagar',   nome: 'Marcar despesa como paga', desc: 'Data, forma de pagamento e comprovante.' },
  { grupo: 'Só visualizar', id: 'painel:leitura',     nome: 'Ver cursos, turmas, alunos e horários', desc: 'Sem botões de ação.' },
];
const IDS = new Set(CATALOGO.map((c) => c.id));

// O padrão acima (PERMISSOES) vale até alguém mudar pela tela; aí a lista de cada papel fica
// gravada em Configuracao 'permissoes_papeis' (JSON). Guardada em memória e relida do banco a cada
// 30 s no máximo: a secretaria roda em mais de um serviço, e a mudança chega em todos.
const CHAVE = 'permissoes_papeis';
const RELER_MS = 30 * 1000;
const PADRAO = Object.fromEntries(PAPEIS_EDITAVEIS.map((p) => [p, [...PERMISSOES[p]]]));
let atual = PADRAO;
let lidoEm = 0;
let lendo = null;

// Permissões criadas depois que a tela de Permissões já existia. Uma lista gravada antes delas não
// sabe que existem: para essas, vale o padrão do papel (senão a secretaria perderia a função nova
// só porque alguém já tinha mexido nas permissões). A lista gravada guarda em "_conhecidas" o
// catálogo da época; o que não está lá recebe o padrão.
const NOVAS_DEPOIS_DA_TELA = ['contas:lancar', 'contas:aprovar', 'contas:pagar'];

function limpar(mapa) {
  const certo = {};
  const conhecidas = mapa && Array.isArray(mapa._conhecidas)
    ? mapa._conhecidas
    : CATALOGO.map((c) => c.id).filter((id) => !NOVAS_DEPOIS_DA_TELA.includes(id));
  for (const papel of PAPEIS_EDITAVEIS) {
    const gravada = mapa && Array.isArray(mapa[papel]) ? mapa[papel] : null;
    const tem = (id) => (gravada && conhecidas.includes(id) ? gravada : PADRAO[papel]).includes(id);
    certo[papel] = CATALOGO.map((c) => c.id).filter(tem); // só ids conhecidos, na ordem do catálogo
  }
  return certo;
}

// Relê do banco se passou do prazo. Falha de banco não derruba a tela: fica com o que já tinha.
async function carregar({ forcar = false } = {}) {
  if (!forcar && Date.now() - lidoEm < RELER_MS) return;
  if (lendo) return lendo;
  lendo = (async () => {
    try {
      const prisma = require('../db');
      const cfg = await prisma.configuracao.findUnique({ where: { chave: CHAVE } });
      atual = cfg ? limpar(JSON.parse(cfg.valor)) : PADRAO;
      lidoEm = Date.now();
    } catch (err) {
      console.error('[permissoes] não consegui ler do banco:', err.message);
    } finally {
      lendo = null;
    }
  })();
  return lendo;
}

// Grava a lista de todos os papéis editáveis (ou volta ao padrão, com null).
async function salvar(mapa) {
  const prisma = require('../db');
  if (mapa === null) {
    await prisma.configuracao.deleteMany({ where: { chave: CHAVE } });
    atual = PADRAO;
  } else {
    const certo = limpar({ ...mapa, _conhecidas: CATALOGO.map((c) => c.id) });
    const valor = JSON.stringify({ ...certo, _conhecidas: CATALOGO.map((c) => c.id) });
    await prisma.configuracao.upsert({ where: { chave: CHAVE }, update: { valor }, create: { chave: CHAVE, valor } });
    atual = certo;
  }
  lidoEm = Date.now();
  return atual;
}

// DEV é o ÚNICO bypass total — acesso de manutenção/emergência.
// Todo o resto (inclusive FINANCEIRO) passa pela lista normal de permissões.
function temPermissao(papel, perm) {
  if (papel === 'DEV') return true;
  return (atual[papel] || []).includes(perm);
}

function listarPermissoes(papel) {
  if (papel === 'DEV') return ['(acesso total — bypass, ignora a lista de permissões)'];
  return atual[papel] || [];
}

const permissoesAtuais = () => atual;
const permissoesPadrao = () => PADRAO;

module.exports = {
  temPermissao, PAPEIS_ADMIN, PAPEIS_EDITAVEIS, CATALOGO, IDS, listarPermissoes,
  carregar, salvar, permissoesAtuais, permissoesPadrao,
};
