// lib/escola-digital/regras.js
//
// Regras de negócio da Escola Digital (cursos online), todas funções puras: sem banco, sem
// Express, sem relógio escondido (a data e o sorteio podem ser injetados para os testes).

const NOTA_MINIMA = 0.8;        // 80% de acertos para passar
const PERGUNTAS_TOPICO = 3;     // teste rápido ao fim de cada tópico
const PERGUNTAS_PRE_TESTE = 10; // "Já sei isso?" no início de um módulo

// Embaralha uma cópia (Fisher-Yates) usando só o `aleatorio` injetado.
function embaralhar(lista, aleatorio) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(aleatorio() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sorteia `n` ids distintos, preferindo os que não estão em `evitar` (tentativa anterior).
// Se faltarem, completa com ids de `evitar`; se o banco tiver menos de `n`, devolve todos.
function sortear(ids, n, evitar = [], aleatorio = Math.random) {
  const banco = [...new Set(ids)];
  const fora = new Set(evitar);
  const novos = embaralhar(banco.filter((id) => !fora.has(id)), aleatorio);
  if (novos.length >= n) return novos.slice(0, n);
  const repetidos = embaralhar(banco.filter((id) => fora.has(id)), aleatorio);
  return [...novos, ...repetidos].slice(0, n);
}

// Aprovado com 80% ou mais. Compara em inteiros (acertos/total >= 0.8 falharia em 8/10 por
// causa do ponto flutuante). 0 de 0 não é aprovação.
function aprovado(acertos, total) {
  return total > 0 && acertos * 100 >= total * Math.round(NOTA_MINIMA * 100);
}

// Estado de cada módulo na trilha do aluno, em ordem de `ordem`.
//   concluidos: { moduloId: 'TELAS' | 'PRE_TESTE' | 'CENARIOS' }
// Concluído por TELAS/CENARIOS = FEITO; por PRE_TESTE = JA_SABIA. Um módulo abre quando o
// anterior está concluído; o módulo final só abre quando todos os demais estão concluídos.
// Assim há no máximo um AGORA, e todo módulo não concluído depois dele é TRANCADO.
function estadoModulos(modulos, concluidos) {
  const ordenados = [...modulos].sort((a, b) => a.ordem - b.ordem);
  const feito = (m) => Object.prototype.hasOwnProperty.call(concluidos, m.id);
  const normaisPendentes = ordenados.some((m) => !m.final && !feito(m));
  let agoraUsado = false;
  return ordenados.map((m) => {
    if (feito(m)) return { id: m.id, estado: concluidos[m.id] === 'PRE_TESTE' ? 'JA_SABIA' : 'FEITO' };
    if (m.final) {
      if (normaisPendentes || agoraUsado) return { id: m.id, estado: 'TRANCADO' };
      agoraUsado = true;
      return { id: m.id, estado: 'AGORA' };
    }
    if (agoraUsado) return { id: m.id, estado: 'TRANCADO' };
    agoraUsado = true;
    return { id: m.id, estado: 'AGORA' };
  });
}

// Próximo passo dentro de um módulo: percorre os tópicos na ordem dada; se falta alguma tela,
// é a primeira não vista; senão, se o tópico ainda não foi aprovado, é o teste dele; senão
// segue para o tópico seguinte. null quando tudo está feito.
function proximoPasso(topicos, vistas, topicosAprovados) {
  for (const t of topicos) {
    const tela = t.telas.find((x) => !vistas.has(x.id));
    if (tela) return { tipo: 'tela', id: tela.id };
    if (!topicosAprovados.has(t.id)) return { tipo: 'teste', topicoId: t.id };
  }
  return null;
}

// Situação "de verdade" da inscrição: só ATIVA com acesso vencido vira EXPIRADA.
function situacaoAtual(insc, agora = new Date()) {
  if (insc.situacao === 'ATIVA' && insc.acessoAte && new Date(insc.acessoAte) < agora) return 'EXPIRADA';
  return insc.situacao;
}

// Fim do acesso ao curso: `dias` corridos depois da ativação (mesmo horário).
function calcularAcessoAte(ativadaEm, dias) {
  const d = new Date(ativadaEm);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

// Fim da validade do certificado: `meses` no calendário UTC; se o dia não existir no mês de
// destino (31 de janeiro + 1 mês), vale o último dia daquele mês. Mantém a hora.
function calcularValidoAte(concluidaEm, meses) {
  const d = new Date(concluidaEm);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d;
}

// O que um novo status de pagamento faz com a situação da inscrição (null = nada muda).
//   PAGO: só ativa quem aguardava pagamento.
//   ESTORNADO: cancela inscrição ativa ou concluída.
//   CANCELADO (cobrança recusada/expirada): nunca muda; o aluno pode tentar de novo.
function efeitoNaInscricao(situacao, novoStatusPagamento) {
  if (novoStatusPagamento === 'PAGO') return situacao === 'AGUARDANDO_PAGAMENTO' ? 'ATIVA' : null;
  if (novoStatusPagamento === 'ESTORNADO') return situacao === 'ATIVA' || situacao === 'CONCLUIDA' ? 'CANCELADA' : null;
  return null;
}

// Valor e número de parcelas da cobrança. À vista: preço à vista em 1 parcela. Parcelado:
// preço cheio, de 2 até curso.parcelas parcelas. Aceita Decimal do Prisma ou número.
function valorCobranca(curso, { plano, parcelas }) {
  if (plano === 'A_VISTA') {
    if (parcelas !== 1) throw new Error('parcelas inválidas');
    return { valor: Number(curso.precoAvista), parcelas: 1 };
  }
  if (plano === 'PARCELADO') {
    if (!Number.isInteger(parcelas) || parcelas < 2 || parcelas > curso.parcelas) throw new Error('parcelas inválidas');
    return { valor: Number(curso.precoCheio), parcelas };
  }
  throw new Error('plano inválido');
}

module.exports = {
  NOTA_MINIMA, PERGUNTAS_TOPICO, PERGUNTAS_PRE_TESTE,
  sortear, aprovado, estadoModulos, proximoPasso, situacaoAtual,
  calcularAcessoAte, calcularValidoAte, efeitoNaInscricao, valorCobranca,
};
