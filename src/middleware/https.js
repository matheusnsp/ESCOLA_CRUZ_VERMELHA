// Força HTTPS no próprio servidor (proteção contra SSL stripping).
//
// Em produção o site fica atrás do Cloudflare e da Render, que terminam o TLS e repassam a
// requisição para o Node por HTTP interno, dizendo o protocolo original nos cabeçalhos
// X-Forwarded-Proto (padrão) e CF-Visitor (Cloudflare). Hoje o Cloudflare já redireciona
// http → https; este middleware é a segunda camada: se essa regra for desligada, ou se alguém
// chegar direto no endereço da Render por http, o próprio Express responde com o redirecionamento.
//
//   GET/HEAD                → 301 (permanente; o navegador e os buscadores guardam)
//   POST/PUT/PATCH/DELETE   → 308 (permanente e mantém o método e o corpo)
//
// Só redireciona quando um proxy AFIRMA que a requisição veio por http. Requisição sem esses
// cabeçalhos é tráfego interno (health check da Render, chamada local) e segue normal: assim um
// cabeçalho ausente nunca gera um laço de redirecionamento que derrube o site.
//
// Fora de produção (NODE_ENV !== 'production') e para localhost não faz nada: o desenvolvimento
// local continua em http://localhost. Para desligar em produção numa emergência: FORCAR_HTTPS=0.

const HOSTS_LOCAIS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)(:\d+)?$|\.localhost(:\d+)?$/i;
// Host válido (nome ou IP, porta opcional). Evita montar um Location com lixo vindo do cabeçalho.
const HOST_VALIDO = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function protocoloInformado(req) {
  const protos = [];
  const xfp = req.headers['x-forwarded-proto'];
  if (xfp) protos.push(...String(xfp).split(',').map((p) => p.trim().toLowerCase()));
  const cf = req.headers['cf-visitor'];
  if (cf) {
    try {
      const { scheme } = JSON.parse(cf);
      if (scheme) protos.push(String(scheme).toLowerCase());
    } catch (e) { /* cabeçalho malformado: ignora */ }
  }
  return protos;
}

function forcarHttps({ producao = process.env.NODE_ENV === 'production' } = {}) {
  const ligado = producao && process.env.FORCAR_HTTPS !== '0';
  return function (req, res, next) {
    if (!ligado) return next();
    const host = String(req.headers.host || '');
    if (HOSTS_LOCAIS.test(host)) return next();
    const protos = protocoloInformado(req);
    // Nenhum proxy disse nada (tráfego interno) ou algum salto foi https: segue.
    if (!protos.length || protos.includes('https')) return next();
    if (!HOST_VALIDO.test(host)) return res.status(400).send('Host inválido.');
    const status = req.method === 'GET' || req.method === 'HEAD' ? 301 : 308;
    return res.redirect(status, `https://${host}${req.originalUrl}`);
  };
}

module.exports = { forcarHttps, protocoloInformado };
