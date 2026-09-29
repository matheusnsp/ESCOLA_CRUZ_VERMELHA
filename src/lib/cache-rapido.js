// lib/cache-rapido.js
//
// Cache em memória, curto, para o que é lido a cada página e muda pouco. Cada ida ao banco
// (Supabase) custa caro a partir do Render, então repetir a mesma consulta a cada visita é o que
// mais pesa no tempo de resposta.
//
//   - catálogo público (home, /cursos, página do curso): 60 s, depois atualizado no fundo;
//   - verificação de banimento do usuário logado: 30 s.
//
// Qualquer ação da secretaria no painel (POST) limpa tudo (ver routes/admin.js), então curso,
// turma ou banimento alterados aparecem na hora. O cache é por processo: com mais de uma
// instância, cada uma guarda o seu, e o pior caso é o TTL acima.

const TTL_CATALOGO_MS = 60 * 1000;
const TTL_BAN_MS = 30 * 1000;
const MAX_ENTRADAS = 500;

const catalogo = new Map(); // chave -> { em, valor: Promise }
const bans = new Map();     // usuarioId -> { em, bloqueado }

function aparar(mapa) {
  if (mapa.size <= MAX_ENTRADAS) return;
  const primeira = mapa.keys().next().value; // Map mantém a ordem de inserção
  mapa.delete(primeira);
}

// Devolve o valor guardado ou roda o carregador. Guarda a Promise: duas visitas ao mesmo
// tempo com o cache vazio fazem uma consulta só. Se o carregador falhar, não fica no cache.
//
// Passado o TTL, a visita seguinte recebe na hora o valor anterior e a atualização roda no
// fundo (stale-while-revalidate), por até TTL_VELHO_MS. Só espera o banco a primeira visita
// depois de reiniciar o servidor ou de uma ação da secretaria no painel.
const TTL_VELHO_MS = 10 * 60 * 1000;

function carregarNoCache(chave, carregar, anterior) {
  const valor = Promise.resolve().then(carregar);
  const entrada = { em: Date.now(), valor, pronto: false };
  valor.then(() => {
    entrada.pronto = true;
    if (catalogo.get(chave) === entrada || catalogo.get(chave)?.atualizando === entrada) catalogo.set(chave, entrada);
  }, () => {
    const atual = catalogo.get(chave);
    if (atual === entrada) catalogo.delete(chave);
    else if (atual?.atualizando === entrada) delete atual.atualizando; // mantém o valor anterior
  });
  if (anterior) {
    anterior.atualizando = entrada;
  } else {
    catalogo.set(chave, entrada);
    aparar(catalogo);
  }
  return valor;
}

function doCatalogo(chave, carregar) {
  const agora = Date.now();
  const achado = catalogo.get(chave);
  if (!achado) return carregarNoCache(chave, carregar, null);
  const idade = agora - achado.em;
  if (idade < TTL_CATALOGO_MS || !achado.pronto) return achado.valor;
  if (idade < TTL_VELHO_MS) {
    if (!achado.atualizando) carregarNoCache(chave, carregar, achado);
    return achado.valor;
  }
  catalogo.delete(chave);
  return carregarNoCache(chave, carregar, null);
}

function banGuardado(usuarioId) {
  const achado = bans.get(usuarioId);
  return achado && Date.now() - achado.em < TTL_BAN_MS ? achado : null;
}

function guardarBan(usuarioId, bloqueado) {
  bans.set(usuarioId, { em: Date.now(), bloqueado });
  aparar(bans);
}

function limparTudo() {
  catalogo.clear();
  bans.clear();
}

module.exports = { doCatalogo, banGuardado, guardarBan, limparTudo, TTL_CATALOGO_MS, TTL_BAN_MS };
