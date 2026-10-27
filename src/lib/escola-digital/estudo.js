// lib/escola-digital/estudo.js
//
// Estudo na Escola Digital (spec §5.4–5.5): estrutura do curso, progresso do aluno, gravação
// de tela vista, conclusão de módulo pelas telas e para onde "Continuar" leva. Sem Express: as
// rotas (routes/escola-digital/estudo.js) cuidam de sessão, tela e redirecionamento.

const prisma = require('../../db');
const regras = require('./regras');

// Endereços do estudo. `cenario` é da tarefa dos cenários; `certificado` e `cartao`, da do certificado.
const urls = {
  area: (insc) => `/digital/estudo/${insc}`,
  continuar: (insc) => `/digital/estudo/${insc}/continuar`,
  modulo: (insc, moduloId) => `/digital/estudo/${insc}/modulo/${moduloId}`,
  tela: (insc, telaId) => `/digital/estudo/${insc}/tela/${telaId}`,
  proximo: (insc, telaId) => `/digital/estudo/${insc}/tela/${telaId}/proximo`,
  teste: (insc, topicoId) => `/digital/estudo/${insc}/teste/${topicoId}`,
  preTeste: (insc, moduloId) => `/digital/estudo/${insc}/pre-teste/${moduloId}`,
  tentativa: (insc, tentativaId, n) => `/digital/estudo/${insc}/tentativa/${tentativaId}${n ? `?n=${n}` : ''}`,
  responder: (insc, tentativaId) => `/digital/estudo/${insc}/tentativa/${tentativaId}/responder`,
  finalizar: (insc, tentativaId) => `/digital/estudo/${insc}/tentativa/${tentativaId}/finalizar`,
  resultado: (insc, tentativaId) => `/digital/estudo/${insc}/tentativa/${tentativaId}/resultado`,
  cenario: (insc, cenarioId) => `/digital/estudo/${insc}/cenario/${cenarioId}`,
  certificado: (insc) => `/digital/estudo/${insc}/certificado.pdf`,
  cartao: (insc) => `/digital/estudo/${insc}/cartao.pdf`,
};

// Módulos do curso em ordem, cada um com tópicos (em ordem), telas (em ordem) e cenários.
async function carregarEstrutura(cursoId) {
  return prisma.moduloOnline.findMany({
    where: { cursoId },
    orderBy: { ordem: 'asc' },
    include: {
      topicos: { orderBy: { ordem: 'asc' }, include: { telas: { orderBy: { ordem: 'asc' } } } },
      cenarios: { orderBy: { ordem: 'asc' }, select: { id: true, ordem: true, titulo: true, tempoSugerido: true } },
    },
  });
}

// O que o aluno já fez.
//   vistas:     Set de telaId com TelaVista
//   aprovados:  Set de topicoId com teste rápido (TOPICO) finalizado e aprovado
//   concluidos: { moduloId: 'TELAS' | 'PRE_TESTE' | 'CENARIOS' }
//   cenarios:   Set de cenarioId feitos
async function progresso(inscricaoId) {
  const [telas, testes, modulos, cenarios] = await Promise.all([
    prisma.telaVista.findMany({ where: { inscricaoId }, select: { telaId: true } }),
    prisma.tentativaTeste.findMany({
      where: { inscricaoId, tipo: 'TOPICO', finalizada: true, aprovado: true, topicoId: { not: null } },
      select: { topicoId: true },
    }),
    prisma.moduloConcluido.findMany({ where: { inscricaoId }, select: { moduloId: true, como: true } }),
    prisma.cenarioFeito.findMany({ where: { inscricaoId }, select: { cenarioId: true } }),
  ]);
  const concluidos = {};
  for (const m of modulos) concluidos[m.moduloId] = m.como;
  return {
    vistas: new Set(telas.map((t) => t.telaId)),
    aprovados: new Set(testes.map((t) => t.topicoId)),
    concluidos,
    cenarios: new Set(cenarios.map((c) => c.cenarioId)),
  };
}

// Grava que a tela foi vista. Repetir não duplica (chave composta, duplicata ignorada).
// Devolve true quando gravou agora.
async function marcarVista(inscricaoId, telaId) {
  const r = await prisma.telaVista.createMany({ data: [{ inscricaoId, telaId }], skipDuplicates: true });
  return r.count > 0;
}

// Conclui o módulo "pelas telas" quando todas foram vistas e todos os testes rápidos dos tópicos
// foram aprovados. Idempotente: se já está concluído (por TELAS, PRE_TESTE ou CENARIOS), não mexe.
// O módulo final (sem telas) conclui só pelos cenários (Task 10), nunca por aqui.
//   -> { concluido: true, como } | { concluido: false }
async function concluirModuloSePronto(inscricaoId, moduloId) {
  const modulo = await prisma.moduloOnline.findUnique({
    where: { id: moduloId },
    select: { final: true, topicos: { select: { id: true, telas: { select: { id: true } } } } },
  });
  if (!modulo || modulo.final) return { concluido: false };

  const jaFeito = await prisma.moduloConcluido.findUnique({ where: { inscricaoId_moduloId: { inscricaoId, moduloId } } });
  if (jaFeito) return { concluido: true, como: jaFeito.como };

  const telaIds = modulo.topicos.flatMap((t) => t.telas.map((x) => x.id));
  if (!telaIds.length) return { concluido: false };

  const prog = await progresso(inscricaoId);
  const tudoVisto = telaIds.every((id) => prog.vistas.has(id));
  const testesOk = modulo.topicos.every((t) => prog.aprovados.has(t.id));
  if (!tudoVisto || !testesOk) return { concluido: false };

  await prisma.moduloConcluido.createMany({ data: [{ inscricaoId, moduloId, como: 'TELAS' }], skipDuplicates: true });
  const gravado = await prisma.moduloConcluido.findUnique({ where: { inscricaoId_moduloId: { inscricaoId, moduloId } } });
  return { concluido: true, como: gravado ? gravado.como : 'TELAS' };
}

// Estado de cada módulo: Map moduloId -> 'FEITO' | 'JA_SABIA' | 'AGORA' | 'TRANCADO'.
function mapaDeEstados(estrutura, concluidos) {
  const lista = regras.estadoModulos(estrutura.map((m) => ({ id: m.id, ordem: m.ordem, final: m.final })), concluidos);
  return new Map(lista.map((e) => [e.id, e.estado]));
}

// Acha a tela no curso. null se não for dele.
function localizarTela(estrutura, telaId) {
  for (const modulo of estrutura) {
    const telasDoModulo = modulo.topicos.flatMap((t) => t.telas);
    for (const topico of modulo.topicos) {
      const tela = topico.telas.find((x) => x.id === telaId);
      if (tela) return { modulo, topico, tela, telasDoModulo, posicao: telasDoModulo.findIndex((x) => x.id === telaId) + 1 };
    }
  }
  return null;
}

const passoParaUrl = (inscricaoId, passo) => (passo.tipo === 'tela' ? urls.tela(inscricaoId, passo.id) : urls.teste(inscricaoId, passo.topicoId));

// Para onde "Continuar" leva (spec §5.4): o primeiro módulo em AGORA.
//   - todos concluídos: a área do curso;
//   - módulo final: a página do módulo (cenários);
//   - módulo com "Já sei isso?" ainda sem nenhuma tela vista nem tentativa: a abertura do módulo;
//   - senão, o próximo passo (tela não vista ou teste do tópico).
// Se o módulo parece pronto mas ainda não foi marcado, tenta concluí-lo (só com `gravar`).
async function destinoContinuar(inscricaoId, estrutura, prog, { gravar = false } = {}) {
  const estados = mapaDeEstados(estrutura, prog.concluidos);
  const agora = estrutura.find((m) => estados.get(m.id) === 'AGORA');
  if (!agora) return urls.area(inscricaoId);
  if (agora.final) return urls.modulo(inscricaoId, agora.id);

  if (agora.temPreTeste) {
    const algumaVista = agora.topicos.some((t) => t.telas.some((x) => prog.vistas.has(x.id)));
    if (!algumaVista) {
      const tentou = await prisma.tentativaTeste.count({ where: { inscricaoId, tipo: 'PRE_TESTE', moduloId: agora.id } });
      if (!tentou) return urls.modulo(inscricaoId, agora.id);
    }
  }

  const passo = regras.proximoPasso(agora.topicos, prog.vistas, prog.aprovados);
  if (passo) return passoParaUrl(inscricaoId, passo);

  // Tudo visto e aprovado mas sem marca de conclusão (ex.: dado gravado fora do fluxo): conclui e recalcula.
  if (gravar) {
    const r = await concluirModuloSePronto(inscricaoId, agora.id);
    if (r.concluido) return destinoContinuar(inscricaoId, estrutura, await progresso(inscricaoId), { gravar: false });
  }
  return urls.modulo(inscricaoId, agora.id);
}

// Para onde o botão "Próximo" de uma tela leva.
//   `jaConcluido`: o módulo já estava concluído antes deste clique (revisão): vai para a tela
//   seguinte na ordem do módulo, e na última volta para a área do curso.
//   Senão, o próximo passo do módulo; se não há mais nada nele, o mesmo destino de "Continuar".
async function destinoAposTela(inscricaoId, estrutura, prog, achada, { jaConcluido, gravar }) {
  if (jaConcluido) {
    const proxima = achada.telasDoModulo[achada.posicao]; // posicao é 1-based: o índice seguinte
    return proxima ? urls.tela(inscricaoId, proxima.id) : urls.area(inscricaoId);
  }
  const passo = regras.proximoPasso(achada.modulo.topicos, prog.vistas, prog.aprovados);
  if (passo) return passoParaUrl(inscricaoId, passo);
  return destinoContinuar(inscricaoId, estrutura, prog, { gravar });
}

module.exports = {
  urls, carregarEstrutura, progresso, marcarVista, concluirModuloSePronto,
  mapaDeEstados, localizarTela, destinoContinuar, destinoAposTela,
};
