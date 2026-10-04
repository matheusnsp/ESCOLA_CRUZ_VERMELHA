// De qual campanha a pessoa veio (utm_*), para a cobrança na Únicopag levar a origem no metadata
// e a Redação ligar a venda à campanha. Quem grava é o bloco de medição (partials/rastreamento.ejs),
// no cookie cvrj_origem, só com consentimento de estatística; o aviso de cookies apaga o cookie
// quando a permissão sai. Aqui o servidor só lê, confere o consentimento de novo e limpa os valores.

const CAMPOS = { utm_source: 120, utm_medium: 120, utm_campaign: 160, utm_content: 160, utm_term: 160 };

function lerCookies(req) {
  const r = {};
  String(req.headers.cookie || '').split(';').forEach((par) => {
    const i = par.indexOf('=');
    if (i > 0) r[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return r;
}

function pares(texto) {
  const r = {};
  let bruto;
  try { bruto = decodeURIComponent(texto || ''); } catch (e) { return r; }
  bruto.split('&').forEach((par) => {
    const i = par.indexOf('=');
    if (i <= 0) return;
    try { r[par.slice(0, i)] = decodeURIComponent(par.slice(i + 1)); } catch (e) { /* valor quebrado: fica de fora */ }
  });
  return r;
}

/** As utm_* da visita ({} sem cookie, sem consentimento de estatística ou com valores vazios). */
function lerOrigem(req) {
  const cookies = lerCookies(req);
  const escolha = pares(cookies.cvrj_consentimento);
  if (escolha.v !== '1' || escolha.e !== '1') return {};
  const valores = pares(cookies.cvrj_origem);
  const origem = {};
  for (const [campo, limite] of Object.entries(CAMPOS)) {
    // Só texto de campanha: sem quebra de linha nem caracteres de controle, e com tamanho limitado.
    const v = typeof valores[campo] === 'string' ? valores[campo].replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limite) : '';
    if (v) origem[campo] = v;
  }
  return origem;
}

module.exports = { lerOrigem };
