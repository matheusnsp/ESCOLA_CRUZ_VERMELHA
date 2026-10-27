// lib/escola-digital/testes.js
//
// Testes da Escola Digital (spec §5.5): o "Teste rápido" (3 perguntas, ao fim de cada tópico) e o
// "Já sei isso?" (10 perguntas, no início de um módulo). Sem Express: as rotas
// (routes/escola-digital/estudo.js) cuidam de sessão, tela e redirecionamento.
//
// A tentativa guarda um retrato das perguntas sorteadas (`perguntas`), para que editar o banco
// de perguntas não mude um teste em andamento, e as respostas dadas (`respostas`).
//   perguntas: [{ id, enunciado, alternativas, correta, porque }]
//   respostas: [{ perguntaId, alternativa, certa }]

const prisma = require('../../db');
const regras = require('./regras');
const { concluirModuloSePronto } = require('./estudo');

// Erro de uso (pergunta que não é do teste, alternativa inválida, teste incompleto...). As rotas
// respondem 400/redirecionam; qualquer outro erro é falha de verdade.
class ErroTeste extends Error {
  constructor(mensagem, codigo) {
    super(mensagem);
    this.name = 'ErroTeste';
    this.codigo = codigo;
  }
}

const TIPOS = ['TOPICO', 'PRE_TESTE'];

// Trava a linha da tentativa até o fim da transação (outro pedido para a mesma tentativa espera).
async function travarTentativa(tx, tentativaId) {
  await tx.$queryRaw`SELECT id FROM "TentativaTeste" WHERE id = ${tentativaId} FOR UPDATE`;
  const tentativa = await tx.tentativaTeste.findUnique({ where: { id: tentativaId } });
  if (!tentativa) throw new ErroTeste('tentativa não encontrada', 'NAO_ENCONTRADA');
  return tentativa;
}

const retrato = (p) => ({ id: p.id, enunciado: p.enunciado, alternativas: p.alternativas, correta: p.correta, porque: p.porque });

// Começa (ou retoma) um teste.
//   { tipo: 'TOPICO', topicoId }    3 perguntas ativas do tópico
//   { tipo: 'PRE_TESTE', moduloId } 10 perguntas ativas de todos os tópicos do módulo
// Já existindo uma tentativa aberta do mesmo alvo, devolve ela. Senão sorteia, evitando as
// perguntas da última tentativa finalizada do mesmo alvo. Sem nenhuma pergunta ativa devolve
// null (teste indisponível; nada é gravado).
async function iniciarTeste(inscricaoId, { tipo, topicoId, moduloId } = {}) {
  if (!TIPOS.includes(tipo)) throw new ErroTeste('tipo de teste inválido', 'ARGUMENTO');
  if (tipo === 'TOPICO' && !topicoId) throw new ErroTeste('topicoId é obrigatório no teste do tópico', 'ARGUMENTO');
  if (tipo === 'PRE_TESTE' && !moduloId) throw new ErroTeste('moduloId é obrigatório no "Já sei isso?"', 'ARGUMENTO');

  const alvo = tipo === 'TOPICO' ? { topicoId } : { moduloId };
  const quantas = tipo === 'TOPICO' ? regras.PERGUNTAS_TOPICO : regras.PERGUNTAS_PRE_TESTE;
  const onde = tipo === 'TOPICO' ? { topicoId } : { topico: { moduloId } };

  return prisma.$transaction(async (tx) => {
    // Dois pedidos ao mesmo tempo para o mesmo alvo não criam duas tentativas abertas.
    const chave = `teste:${inscricaoId}:${tipo}:${topicoId || moduloId}`;
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${chave}))) AS trava`;

    const aberta = await tx.tentativaTeste.findFirst({
      where: { inscricaoId, tipo, ...alvo, finalizada: false },
      orderBy: { criadoEm: 'desc' },
    });
    if (aberta) return aberta;

    const banco = await tx.perguntaOnline.findMany({ where: { ativa: true, ...onde }, orderBy: { id: 'asc' } });
    if (!banco.length) return null;

    const anterior = await tx.tentativaTeste.findFirst({
      where: { inscricaoId, tipo, ...alvo, finalizada: true },
      orderBy: { criadoEm: 'desc' },
      select: { perguntas: true },
    });
    const evitar = Array.isArray(anterior && anterior.perguntas) ? anterior.perguntas.map((p) => p.id) : [];

    const porId = new Map(banco.map((p) => [p.id, p]));
    const sorteadas = regras.sortear(banco.map((p) => p.id), quantas, evitar).map((id) => retrato(porId.get(id)));
    return tx.tentativaTeste.create({
      data: { inscricaoId, tipo, ...alvo, perguntas: sorteadas, respostas: [], acertos: 0, total: sorteadas.length },
    });
  });
}

// Registra a resposta de uma pergunta. Devolve { certa, porque? }: `porque` só no teste rápido
// (o "Já sei isso?" mostra tudo no fim). Responder de novo a mesma pergunta não conta e devolve
// o resultado da primeira resposta.
async function responder(tentativaId, perguntaId, alternativa) {
  return prisma.$transaction(async (tx) => {
    const tentativa = await travarTentativa(tx, tentativaId);
    const perguntas = Array.isArray(tentativa.perguntas) ? tentativa.perguntas : [];
    const pergunta = perguntas.find((p) => p.id === perguntaId);
    if (!pergunta) throw new ErroTeste('a pergunta não faz parte desta tentativa', 'PERGUNTA');
    const comPorque = (certa) => (tentativa.tipo === 'TOPICO' ? { certa, porque: pergunta.porque } : { certa });

    const respostas = Array.isArray(tentativa.respostas) ? tentativa.respostas : [];
    const anterior = respostas.find((r) => r.perguntaId === perguntaId);
    if (anterior) return comPorque(anterior.certa);

    if (tentativa.finalizada) throw new ErroTeste('a tentativa já foi finalizada', 'FINALIZADA');
    if (!Number.isInteger(alternativa) || alternativa < 0 || alternativa >= pergunta.alternativas.length) {
      throw new ErroTeste('alternativa inválida', 'ALTERNATIVA');
    }
    const certa = alternativa === pergunta.correta;
    await tx.tentativaTeste.update({
      where: { id: tentativaId },
      data: { respostas: [...respostas, { perguntaId, alternativa, certa }], acertos: tentativa.acertos + (certa ? 1 : 0) },
    });
    return comPorque(certa);
  });
}

// Fecha a tentativa quando todas as perguntas sorteadas foram respondidas. Idempotente: se já
// está finalizada devolve ela (e repete, sem efeito, a gravação da conclusão, que é idempotente,
// caso o servidor tenha caído entre fechar a tentativa e gravá-la).
//   PRE_TESTE aprovado → ModuloConcluido 'PRE_TESTE' (sem sobrescrever conclusão que já existe)
//   TOPICO aprovado    → concluirModuloSePronto (conclui por TELAS se era o que faltava)
async function finalizar(tentativaId) {
  const tentativa = await prisma.$transaction(async (tx) => {
    const t = await travarTentativa(tx, tentativaId);
    if (t.finalizada) return t;
    const respondidas = new Set((Array.isArray(t.respostas) ? t.respostas : []).map((r) => r.perguntaId));
    const perguntas = Array.isArray(t.perguntas) ? t.perguntas : [];
    if (!perguntas.length || !perguntas.every((p) => respondidas.has(p.id))) {
      throw new ErroTeste('faltam perguntas a responder', 'INCOMPLETA');
    }
    return tx.tentativaTeste.update({
      where: { id: tentativaId },
      data: { finalizada: true, aprovado: regras.aprovado(t.acertos, t.total) },
    });
  });

  if (tentativa.aprovado) {
    if (tentativa.tipo === 'PRE_TESTE' && tentativa.moduloId) {
      await prisma.moduloConcluido.createMany({
        data: [{ inscricaoId: tentativa.inscricaoId, moduloId: tentativa.moduloId, como: 'PRE_TESTE' }],
        skipDuplicates: true,
      });
    } else if (tentativa.tipo === 'TOPICO' && tentativa.topicoId) {
      const topico = await prisma.topicoOnline.findUnique({ where: { id: tentativa.topicoId }, select: { moduloId: true } });
      if (topico) await concluirModuloSePronto(tentativa.inscricaoId, topico.moduloId);
    }
  }
  return tentativa;
}

module.exports = { ErroTeste, iniciarTeste, responder, finalizar };
