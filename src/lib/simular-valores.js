// O que o aluno vê na inscrição, para mostrar na secretaria (lista e formulário de cursos).
//
// É a MESMA conta do checkout da escola (routes/cursos.js):
//   - à vista (PIX ou cartão): preço à vista + taxa de matrícula;
//   - parcelado: o preço "no parcelado" vai para a Únicopag, que devolve as parcelas já com os
//     juros do cartão (installment_amount / total_amount); a taxa é cobrada à parte, sem juros
//     (como em montarParceladoComJuros). Se mudar a regra lá, mude aqui também.
// A taxa é a de exibição (taxaExibicao), a mesma dos cartões do site.
//
// A consulta à Únicopag fica guardada por 10 min por valor e nº de parcelas: a lista de cursos
// não chama o gateway a cada carregamento. Sem resposta do gateway, mostra a conta sem juros e
// avisa (juros: false).
const { obterOpcaoParcelamento } = require('./unicopag');
const { taxaExibicao } = require('./matricula');

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

async function opcaoComCache(centavos, parcelas, buscar = obterOpcaoParcelamento) {
  const chave = `${centavos}:${parcelas}`;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.opcao;
  let opcao = null;
  try {
    opcao = await buscar(centavos, parcelas);
  } catch (e) {
    opcao = null;
  }
  if (opcao) cache.set(chave, { opcao, em: Date.now() }); // falha não fica guardada
  return opcao;
}

async function simularValores(curso, cfgMap, buscar) {
  const taxa = Number(taxaExibicao(curso, cfgMap)) || 0;
  const precoAvista = Number(curso.precoAvista) || 0;
  const aVista = { curso: precoAvista, taxa, total: precoAvista + taxa };

  const numParcelas = Number(curso.parcelas) || 1;
  let parcelado = null;
  if (numParcelas > 1) {
    const base = Number(curso.precoCheio) || 0;
    const opcao = await opcaoComCache(Math.round(base * 100), numParcelas, buscar);
    if (opcao) {
      const cursoComJuros = opcao.total_amount / 100;
      parcelado = {
        numParcelas,
        valorParcela: opcao.installment_amount / 100,
        cursoComJuros,
        taxa,
        total: cursoComJuros + taxa,
        juros: true,
      };
    } else {
      parcelado = { numParcelas, valorParcela: base / numParcelas, cursoComJuros: base, taxa, total: base + taxa, juros: false };
    }
  }
  return { aVista, parcelado };
}

module.exports = { simularValores, _limparCache: () => cache.clear() };
