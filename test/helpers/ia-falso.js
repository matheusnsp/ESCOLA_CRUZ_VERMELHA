// Respostas prontas da IA para os testes da etapa 9 (nenhum teste chama a API de verdade).
const alternativas = (certa = 0) => [0, 1, 2, 3].map((i) => ({ texto: `Alternativa ${i + 1}`, correta: i === certa }));
const pergunta = (k) => ({ enunciado: `Pergunta ${k}: o que fazer primeiro?`, alternativas: alternativas(k % 4), porque: 'Porque garante a segurança da cena.' });
const tela = (k) => ({ titulo: `Tela ${k}`, texto: `Texto da tela ${k}.`, revisaoTitulo: 'Para lembrar', revisaoItens: ['Olhar', 'Ligar 192'], alerta: 'Não mova a vítima sem necessidade.', dica: null });
const opcoes = () => [0, 1, 2].map((i) => ({ texto: `Opção ${i + 1}`, correta: i === 1, porque: i === 1 ? 'É o passo certo.' : 'Não é o primeiro passo.' }));

// Roteiro com n módulos; o último é o final com 2 cenários.
function roteiroBom(n = 3) {
  return {
    modulos: Array.from({ length: n }, (_, i) => {
      const final = i === n - 1;
      return {
        titulo: final ? 'Juntando tudo' : `Módulo ${i + 1}`,
        minutos: 20,
        final,
        topicos: final ? [] : [{ titulo: `Tópico ${i + 1}.1` }, { titulo: `Tópico ${i + 1}.2` }, { titulo: `Tópico ${i + 1}.3` }],
        cenarios: final ? [{ titulo: 'Engasgo no recreio' }, { titulo: 'Queda na escada' }] : [],
      };
    }),
  };
}

// Módulo que segue as regras para o módulo do roteiro dado.
function moduloBom(m) {
  return {
    introducao: `Neste módulo: ${m.titulo}.`,
    topicos: (m.final ? [] : m.topicos).map((t, i) => ({ titulo: t.titulo, telas: [tela(i + 1), tela(i + 2)], perguntas: [1, 2, 3].map((k) => pergunta(i * 3 + k)) })),
    cenarios: (m.cenarios || []).map((c) => ({ titulo: c.titulo, cena: `Cena: ${c.titulo}.`, tempoSugeridoSeg: 240, decisoes: [1, 2, 3].map((k) => ({ pergunta: `Decisão ${k}?`, opcoes: opcoes() })) })),
  };
}

// Proposta do passo 2 (criação passo a passo, 2026-11): o que a IA sugere a partir da ideia.
function propostaBoa(extra = {}) {
  return {
    nome: 'Primeiros Socorros na Creche', descricao: 'Capacitação teórica para quem cuida de crianças pequenas.', cargaHoraria: 4,
    publico: 'professores e auxiliares de creche', tema: 'Primeiros socorros na creche: engasgo, quedas e como pedir ajuda',
    nModulos: 4, precoSugerido: 49.9, maxParcelas: 3, observacoes: 'Linguagem simples; exemplos com crianças de 0 a 5 anos.',
    porqueCargaHoraria: 'O tema cabe em 4 módulos curtos de cerca de 1 hora.', porqueModulos: 'Um módulo por situação e o final com cenários.',
    porquePreco: 'Na faixa dos cursos online da escola.', ...extra,
  };
}

// Cliente falso no formato de client.beta.messages.stream(...).finalMessage(). `respostas` é uma lista de
// funções (params) => objeto JSON | { stop_reason, ... } | Promise; cada chamada consome a próxima (a última repete).
function clienteFalso(respostas) {
  const chamadas = [];
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 };
  return {
    chamadas,
    beta: { messages: { stream(params) {
      chamadas.push(params);
      const f = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
      return { finalMessage: async () => {
        const r = await f(params);
        if (r && r.stop_reason) return { content: r.content || [], stop_reason: r.stop_reason, stop_details: r.stop_details || null, usage };
        return { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r) }], stop_reason: 'end_turn', stop_details: null, usage };
      } };
    } } },
  };
}

// Roteiro só com módulos comuns (para acrescentar a um curso que já tem módulo final).
function roteiroComum(n = 3) {
  return { modulos: Array.from({ length: n }, (_, i) => ({ titulo: `Módulo ${i + 1}`, minutos: 20, final: false, topicos: [{ titulo: `Tópico ${i + 1}.1` }, { titulo: `Tópico ${i + 1}.2` }, { titulo: `Tópico ${i + 1}.3` }], cenarios: [] })) };
}

module.exports = { propostaBoa, roteiroBom, roteiroComum, moduloBom, clienteFalso, alternativas };
