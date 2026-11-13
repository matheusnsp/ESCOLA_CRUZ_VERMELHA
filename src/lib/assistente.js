// lib/assistente.js
//
// Assistente da secretaria (2026-11-13; spec docs/superpowers/specs/2026-11-13-assistente-secretaria-design.md).
// Uma mensagem da pessoa -> laço com o Claude (até 6 rodadas de ferramentas) -> eventos para o navegador:
//   { tipo: 'texto', texto }          pedaço do texto, enquanto o Claude escreve (mostrado sem links)
//   { tipo: 'ferramenta', nome }      consultando ("Procurando aluno…")
//   { tipo: 'preencher', formulario, campos }   proposta de preenchimento (o navegador mostra o cartão)
//   { tipo: 'resposta', texto }       texto final, com os links já filtrados
//   { tipo: 'erro', mensagem }        problema, em português e sem detalhe técnico
//   { tipo: 'fim' }
// Nunca grava dados do sistema. O texto da conversa não é guardado (só tokens, em UsoAssistente).

const ia = require('./ead-ia');
const uso = require('./assistente-uso');
const ferramentas = require('./assistente-ferramentas');
const contexto = require('./assistente-contexto');

const MODELO = 'claude-opus-5-5';
const MAX_RODADAS = 6;
const MAX_MENSAGENS = 20;
const MAX_CARACTERES = 2000;
const MSG = {
  semChave: 'O assistente ainda não está ligado (falta a chave da API no servidor).',
  teto: 'O limite de uso de IA deste mês foi atingido. Fale com o dev.',
  longa: 'A mensagem passou de 2.000 caracteres. Resuma um pouco e envie de novo.',
  vazia: 'Escreva a sua pergunta.',
  foraDoAr: 'O assistente está fora do ar agora. Tente de novo em instantes.',
  recusa: 'Não posso ajudar com esse pedido. Se for algo do dia a dia da secretaria, tente explicar de outro jeito.',
  rodadas: 'Não consegui terminar de procurar tudo agora. Tente perguntar de um jeito mais específico (por exemplo, com o nome do curso ou da turma).',
};
const NOMES_FERRAMENTAS = new Set([...ferramentas.DEFINICOES_CONSULTA, ...ferramentas.DEFINICOES_FORMULARIO].map((d) => d.name));

// Conversa do navegador -> mensagens da API: só texto, últimas 20, começando pela pessoa.
function montarConversa(mensagens) {
  const lista = (Array.isArray(mensagens) ? mensagens : [])
    .filter((m) => m && (m.papel === 'pessoa' || m.papel === 'assistente') && String(m.texto || '').trim())
    .slice(-MAX_MENSAGENS)
    .map((m) => ({ role: m.papel === 'pessoa' ? 'user' : 'assistant', content: String(m.texto).slice(0, MAX_CARACTERES * 3) }));
  while (lista.length && lista[0].role !== 'user') lista.shift();
  return lista;
}

const somar = (a, b) => ({
  input_tokens: (a.input_tokens || 0) + ((b && b.input_tokens) || 0),
  output_tokens: (a.output_tokens || 0) + ((b && b.output_tokens) || 0),
  cache_read_input_tokens: (a.cache_read_input_tokens || 0) + ((b && b.cache_read_input_tokens) || 0),
  cache_creation_input_tokens: (a.cache_creation_input_tokens || 0) + ((b && b.cache_creation_input_tokens) || 0),
});

async function responder({ mensagens, pagina, usuarioId, pode, papel, documentoAluno, cliente, emitir }) {
  const fim = () => emitir({ tipo: 'fim' });
  const erro = (mensagem) => { emitir({ tipo: 'erro', mensagem }); fim(); };

  const conversa = montarConversa(mensagens);
  const ultima = conversa[conversa.length - 1];
  const ultimaOriginal = (Array.isArray(mensagens) ? mensagens : []).filter((m) => m && m.papel === 'pessoa').pop();
  if (ultimaOriginal && String(ultimaOriginal.texto || '').length > MAX_CARACTERES) return erro(MSG.longa);
  if (!ultima || ultima.role !== 'user') return erro(MSG.vazia);
  if (!cliente && !ia.ehChaveConfigurada()) return erro(MSG.semChave);
  const limite = await uso.podeEnviar(usuarioId);
  if (!limite.ok) return erro(limite.erro);
  const teto = await ia.dentroDoTeto();
  if (!teto.ok) return erro(MSG.teto);

  const ctx = { pode, papel, documentoAluno, cliente, vistos: { alunos: new Set(), turmas: new Set(), cursos: new Set() } };
  const pag = await contexto.paginaAtual(pagina, ctx).catch(() => ({ texto: 'Página atual: desconhecida.' }));
  const api = cliente || ia.clientePadrao();
  const system = [{ type: 'text', text: contexto.montarSistema(), cache_control: { type: 'ephemeral' } }];
  const tools = [...ferramentas.DEFINICOES_CONSULTA, ...ferramentas.DEFINICOES_FORMULARIO];
  // A página atual entra como mensagem de sistema no fim do turno (não mexe no prefixo do cache).
  const messages = [...conversa, { role: 'system', content: pag.texto }];

  let usage = {};
  const usadas = [];
  let textoTotal = '';
  let terminou = false;
  try {
    for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
      const stream = api.beta.messages.stream({
        model: MODELO, max_tokens: 4000, system, tools, messages,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      });
      stream.on('text', (delta) => { textoTotal += delta; emitir({ tipo: 'texto', texto: delta }); });
      const msg = await stream.finalMessage();
      usage = somar(usage, msg.usage);
      if (msg.stop_reason === 'refusal') { await registrar(); return erro(MSG.recusa); }
      const pedidos = (msg.content || []).filter((b) => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !pedidos.length) { terminou = true; break; }
      // Texto entre rodadas: separa do que vier depois.
      if (textoTotal && !/\n\n$/.test(textoTotal)) { textoTotal += '\n\n'; emitir({ tipo: 'texto', texto: '\n\n' }); }
      const resultados = [];
      for (const b of pedidos) {
        usadas.push(b.name);
        emitir({ tipo: 'ferramenta', nome: b.name });
        let resultado;
        if (!NOMES_FERRAMENTAS.has(b.name)) resultado = { erro: 'ferramenta_desconhecida' };
        else if (ferramentas.DEFINICOES_FORMULARIO.some((d) => d.name === b.name)) {
          const r = await ferramentas.executarFormulario(b.name, b.input, ctx);
          resultado = r.resultado;
          if (r.evento) emitir(r.evento);
        } else resultado = await ferramentas.executarConsulta(b.name, b.input, ctx);
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(resultado) });
      }
      messages.push({ role: 'assistant', content: msg.content });
      messages.push({ role: 'user', content: resultados });
    }
  } catch (e) {
    console.error('[ASSISTENTE]', e && e.status ? `API ${e.status}` : '', e && e.message);
    await registrar();
    return erro(MSG.foraDoAr);
  }
  if (!terminou) textoTotal += (textoTotal ? '\n\n' : '') + MSG.rodadas;
  emitir({ tipo: 'resposta', texto: contexto.filtrarLinks(textoTotal.trim(), ctx) });
  await registrar();
  fim();

  async function registrar() {
    if (!usage.input_tokens && !usage.output_tokens) return;
    await uso.registrarUso(usuarioId, usage, usadas).catch((e) => console.error('[ASSISTENTE] uso:', e.message));
    await ia.somarCustoAvulso(usage).catch(() => {});
  }
}

module.exports = { responder, montarConversa, MODELO, MAX_RODADAS };
