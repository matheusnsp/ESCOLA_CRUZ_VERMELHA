// Endereço dos CSS e JS do próprio site com a versão do conteúdo: asset('/admin.css') vira
// '/admin.css?v=3f9a1c07b2'.
//
// Por quê: o express.static manda esses arquivos com cache de 7 dias (server.js). Com o endereço
// sempre igual, quem abriu o site antes de um deploy continuava até 7 dias com o CSS velho, e as
// telas novas apareciam quebradas (foi o que aconteceu com a aba Horários). Com a versão no
// endereço, ele muda quando o arquivo muda, e o navegador baixa o novo na hora; quando o arquivo
// não muda, o cache de 7 dias continua valendo.
//
// A versão é o começo do sha256 do arquivo. Em produção é calculada uma vez por arquivo (cada
// deploy sobe um processo novo); fora dela, a cada página, para a edição de CSS aparecer sem
// reiniciar. Arquivo que não existe fica sem versão.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLICO = path.join(__dirname, '..', 'public');
const guardar = process.env.NODE_ENV === 'production';
const versoes = new Map();

function versao(url) {
  const arquivo = path.join(PUBLICO, url);
  if (!arquivo.startsWith(PUBLICO + path.sep)) return '';
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex').slice(0, 10);
  } catch (e) {
    return '';
  }
}

function asset(url) {
  let v = versoes.get(url);
  if (v === undefined) {
    v = versao(url);
    if (guardar) versoes.set(url, v);
  }
  return v ? `${url}?v=${v}` : url;
}

module.exports = { asset };
