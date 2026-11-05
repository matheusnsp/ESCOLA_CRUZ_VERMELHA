// lib/ead-progresso.js
//
// Regras do progresso do aluno no curso online, sem banco: o que está concluído, o que está bloqueado
// (e por quê), qual o próximo passo, o sorteio das perguntas e a correção. Nada disso é gravado:
// é calculado a partir do que o aluno fez (lib/ead-progresso-db.js carregarProgresso).
// Spec: docs/superpowers/specs/2026-11-05-ead-aluno.md §4.

const DIAS_SEQUENCIAIS = 7; // prazo de reembolso: nesse período os módulos abrem em sequência
const PRE_TESTE_MIN = 8;
const PRE_TESTE_MAX = 12;
const QUIZ_N = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

// curso: { modulos: [{ id, final, nPerguntasAtivas, topicos: [{ id, telas: [{ id }], nPerguntasAtivas }], cenarios: [{ id }] }] }
//        na ordem do aluno (comuns por ordem, o final por último).
// progresso: { iniciadoEm, telasVistas: Set, tentativas: [{ tipo, moduloId, topicoId, aprovado, concluidaEm }],
//              cenarios: [{ cenarioId, concluidoEm }] }
function estadoDoCurso(curso, progresso, agora) {
  const vistas = progresso.telasVistas || new Set();
  const tentativas = progresso.tentativas || [];
  const cenariosFeitos = new Set((progresso.cenarios || []).filter((c) => c.concluidoEm).map((c) => c.cenarioId));
  const sequencial = agora.getTime() < new Date(progresso.iniciadoEm).getTime() + DIAS_SEQUENCIAIS * DIA_MS;

  // 1º passo: o que está concluído (não depende de bloqueio).
  const modulos = curso.modulos.map((m, i) => {
    const topicos = m.topicos.map((t) => {
      const telasVistas = t.telas.filter((x) => vistas.has(x.id)).length;
      const quizAprovado = tentativas.some((q) => q.tipo === 'QUIZ' && q.topicoId === t.id && q.aprovado === true);
      const concluido = telasVistas === t.telas.length && (t.nPerguntasAtivas === 0 || quizAprovado);
      return { id: t.id, telas: t.telas.length, telasVistas, quizAprovado, concluido };
    });
    const preTestes = tentativas.filter((q) => q.tipo === 'PRE_TESTE' && q.moduloId === m.id);
    const concluido = m.final
      ? m.cenarios.length > 0 && m.cenarios.every((c) => cenariosFeitos.has(c.id))
      : preTestes.some((q) => q.aprovado === true) || (topicos.length > 0 && topicos.every((t) => t.concluido));
    let preTeste = 'disponivel';
    if (m.final || concluido) preTeste = 'indisponivel';
    else if (preTestes.length) preTeste = 'usado'; // já tentou (mesmo que hoje o banco tenha menos de 8)
    else if (m.nPerguntasAtivas < PRE_TESTE_MIN) preTeste = 'indisponivel';
    return { id: m.id, numero: i + 1, final: m.final, concluido, preTeste, topicos };
  });

  // 2º passo: bloqueio.
  const comunsConcluidos = modulos.filter((m) => !m.final).every((m) => m.concluido);
  let anterior = null; // último módulo comum, para a regra de sequência
  for (const m of modulos) {
    let motivo = null;
    if (m.final) {
      if (!comunsConcluidos) motivo = 'Abre quando os outros módulos terminarem.';
    } else {
      if (!m.concluido && sequencial && anterior && !anterior.concluido) motivo = `Abre depois do Módulo ${anterior.numero}.`;
      anterior = m;
    }
    m.estado = m.concluido ? 'concluido' : (motivo ? 'bloqueado' : 'disponivel');
    m.motivo = motivo;
  }
  for (const m of modulos) delete m.concluido;

  const total = modulos.length;
  const feitos = modulos.filter((m) => m.estado === 'concluido').length;
  const concluido = total > 0 && feitos === total;
  return { modulos, percentual: total ? Math.round((feitos / total) * 100) : 0, concluido, proximo: concluido ? null : proximoPasso(curso, modulos, vistas, cenariosFeitos), sequencial };
}

// O primeiro passo pendente no primeiro módulo disponível e não concluído.
function proximoPasso(curso, modulos, vistas, cenariosFeitos) {
  const alvo = modulos.find((m) => m.estado === 'disponivel') || modulos.find((m) => m.estado !== 'concluido');
  if (!alvo) return null;
  const m = curso.modulos.find((x) => x.id === alvo.id);
  if (alvo.estado === 'disponivel') {
    if (m.final) {
      const c = m.cenarios.find((x) => !cenariosFeitos.has(x.id));
      if (c) return { tipo: 'cenario', id: c.id };
    } else {
      for (const t of m.topicos) {
        const tela = t.telas.find((x) => !vistas.has(x.id));
        if (tela) return { tipo: 'tela', id: tela.id };
        if (!alvo.topicos.find((x) => x.id === t.id).concluido) return { tipo: 'quiz', id: t.id };
      }
    }
  }
  return { tipo: 'modulo', id: alvo.id };
}

// n ids distintos, preferindo os que não estão em `evitar` (a tentativa anterior do tópico).
function sortear(ids, n, evitar = [], aleatorio = Math.random) {
  const embaralhar = (l) => {
    const a = [...l];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(aleatorio() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const fora = new Set(evitar);
  const novas = embaralhar(ids.filter((id) => !fora.has(id)));
  const repetidas = embaralhar(ids.filter((id) => fora.has(id)));
  return [...novas, ...repetidas].slice(0, n);
}

const tamanhoPreTeste = (nAtivas) => (nAtivas < PRE_TESTE_MIN ? null : Math.min(PRE_TESTE_MAX, nAtivas));

// Certo só se o conjunto marcado for exatamente o das corretas.
function corrigir(alternativas, marcadas) {
  const certas = new Set(alternativas.filter((a) => a.correta).map((a) => a.id));
  const m = new Set(marcadas || []);
  return m.size === certas.size && [...m].every((id) => certas.has(id));
}

const aprovado = (acertos, total, notaMinima) => total > 0 && (acertos / total) * 100 >= notaMinima;

module.exports = { DIAS_SEQUENCIAIS, PRE_TESTE_MIN, PRE_TESTE_MAX, QUIZ_N, estadoDoCurso, sortear, tamanhoPreTeste, corrigir, aprovado };
