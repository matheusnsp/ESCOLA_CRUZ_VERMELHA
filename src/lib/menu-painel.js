// lib/menu-painel.js
//
// Menu do painel em grupos (2026-11-13; spec docs/superpowers/specs/2026-11-13-menu-submenus-design.md §1).
// Só dados e regras: quais grupos e itens cada pessoa vê e qual fica marcado. O header.ejs só desenha.
// A permissão de cada item é a mesma do link que existia no menu antigo (ou da rota).

const DEV = (pode, papel) => papel === 'DEV';
const SEMPRE = () => true;
const P = (...perms) => (pode) => perms.some((p) => pode(p));

// Configurações aparece nos dois modos.
const CONFIG = {
  id: 'configuracoes', rotulo: 'Configurações', icone: 'fa-gear', sistema: true,
  itens: [
    { id: 'dev-usuarios', rotulo: 'Usuários do painel', href: '/dev/usuarios', pode: DEV },
    { id: 'permissoes', rotulo: 'Permissões', href: '/dev/permissoes', pode: DEV },
    { id: 'banimentos', rotulo: 'Alunos banidos', href: '/banimentos', pode: DEV },
    { id: 'suspeitos', rotulo: 'Suspeitos', href: '/suspeitos', pode: DEV },
    { id: 'integracao', rotulo: 'Integração', href: '/integracao', pode: P('integracao:gerenciar') },
  ],
};
const CERTIFICADOS = { id: 'certificados', rotulo: 'Certificados', icone: 'fa-award', href: '/certificados', pode: P('turmas:gerenciar') };

const MENUS = {
  presencial: [
    { id: 'home', rotulo: 'Painel', icone: 'fa-gauge', href: '/', pode: SEMPRE },
    {
      id: 'cursos-turmas', rotulo: 'Cursos e turmas', icone: 'fa-calendar-days',
      itens: [
        { id: 'cursos', rotulo: 'Cursos', href: '/cursos', pode: SEMPRE },
        { id: 'turmas', rotulo: 'Turmas', href: '/turmas', pode: SEMPRE },
        { id: 'matricula-rapida', rotulo: 'Matrícula rápida', href: '/matricula-rapida', pode: P('turmas:gerenciar', 'painel:leitura') },
        { id: 'horarios', rotulo: 'Mapa de horários', href: '/horarios', pode: P('turmas:gerenciar', 'painel:leitura') },
        { id: 'boas-vindas', rotulo: 'Mensagem de boas-vindas', href: '/modelos', pode: P('turmas:gerenciar') },
      ],
    },
    {
      id: 'alunos-grupo', rotulo: 'Alunos', icone: 'fa-user-graduate',
      itens: [
        { id: 'alunos', rotulo: 'Alunos', href: '/alunos', pode: SEMPRE },
        { id: 'inscricoes', rotulo: 'Matrículas', href: '/inscricoes', pode: P('doacao:confirmar', 'financeiro:aprovar', 'financeiro:leitura') },
        { id: 'pendentes', rotulo: 'Pendentes', href: '/pendentes', pode: P('pendentes:gerenciar') },
        { id: 'comprovantes', rotulo: 'Comprovantes', href: '/comprovantes-saude', pode: P('aluno:gerenciar') },
        { id: 'pesquisa', rotulo: 'Pesquisa de satisfação', href: '/pesquisa', pode: P('pesquisa:gerenciar', 'painel:leitura') },
      ],
    },
    {
      id: 'financeiro-grupo', rotulo: 'Financeiro', icone: 'fa-sack-dollar',
      itens: [
        { id: 'financeiro', rotulo: 'Financeiro', href: '/financeiro', pode: P('financeiro:leitura') },
        { id: 'contas', rotulo: 'Contas a pagar', href: '/contas', pode: P('contas:lancar', 'contas:aprovar', 'contas:pagar') },
        { id: 'cupons', rotulo: 'Cupons', href: '/ead/cupons', pode: DEV },
      ],
    },
    CERTIFICADOS,
    CONFIG,
  ],
  online: [
    {
      id: 'cursos-online', rotulo: 'Cursos online', icone: 'fa-laptop-medical',
      itens: [
        { id: 'ead', rotulo: 'Cursos', href: '/ead', pode: SEMPRE },
        { id: 'ia', rotulo: 'Criar curso com IA', href: '/ead/ia', pode: SEMPRE },
        { id: 'duvidas', rotulo: 'Dúvidas dos alunos', href: '/ead/duvidas', pode: SEMPRE, selo: 'duvidas' },
      ],
    },
    { id: 'conteudos', rotulo: 'Conteúdos', icone: 'fa-photo-film', itens: [{ id: 'ebooks', rotulo: 'E-books', href: '/ead/ebooks', pode: SEMPRE }] },
    {
      id: 'vendas', rotulo: 'Vendas', icone: 'fa-tags',
      itens: [
        { id: 'cupons', rotulo: 'Cupons', href: '/ead/cupons', pode: SEMPRE },
        { id: 'escolas', rotulo: 'Escolas (lotes)', href: '/ead/escolas', pode: SEMPRE },
      ],
    },
    CERTIFICADOS,
    CONFIG,
  ],
};

const ATIVOS = new Set();
for (const lista of Object.values(MENUS)) {
  for (const g of lista) {
    if (g.href) ATIVOS.add(g.id);
    for (const i of g.itens || []) ATIVOS.add(i.id);
  }
}

// Grupos/itens que a pessoa vê, com o ativo marcado e o grupo dele aberto.
function montarMenu({ modo, papel, pode, ativo, duvidasAguardando } = {}) {
  const podeF = typeof pode === 'function' ? pode : () => false;
  const lista = modo === 'online' && papel === 'DEV' ? MENUS.online : MENUS.presencial;
  const selos = { duvidas: Number(duvidasAguardando) > 0 ? Number(duvidasAguardando) : 0 };
  const saida = [];
  for (const g of lista) {
    if (g.href) {
      if (!g.pode(podeF, papel)) continue;
      saida.push({ id: g.id, rotulo: g.rotulo, icone: g.icone, href: g.href, ativo: g.id === ativo, aberto: false, sistema: !!g.sistema });
      continue;
    }
    const itens = g.itens.filter((i) => i.pode(podeF, papel)).map((i) => ({
      id: i.id, rotulo: i.rotulo, href: i.href, ativo: i.id === ativo, ...(i.selo && selos[i.selo] ? { selo: selos[i.selo] } : {}),
    }));
    if (!itens.length) continue;
    const temAtivo = itens.some((i) => i.ativo);
    const selo = itens.reduce((s, i) => s + (i.selo || 0), 0);
    saida.push({ id: g.id, rotulo: g.rotulo, icone: g.icone, itens, ativo: temAtivo, aberto: temAtivo, sistema: !!g.sistema, ...(selo ? { selo } : {}) });
  }
  const iSis = saida.findIndex((g) => g.sistema);
  if (iSis > 0) saida.splice(iSis, 0, { separador: 'Sistema' });
  return saida;
}

module.exports = { montarMenu, ATIVOS };
