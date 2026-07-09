// Avaliacao de forca de senha no SERVIDOR (a barra no navegador e so o espelho).
// Usamos zxcvbn (criada pelo Dropbox): mede a forca real e penaliza senhas
// previsiveis ou que reutilizam dados pessoais (nome, e-mail).
//
// zxcvbn é sincrono e pode ser pesado (50-500ms). Rodamos em worker_thread
// pra nao bloquear o event loop principal do Node — sem isso, com
// WEB_CONCURRENCY=1, TODO o site fica travado enquanto uma senha e avaliada.
const { Worker } = require('worker_threads');
const path = require('path');

// Exigimos pontuacao >= 3 ("Boa"). Escala do zxcvbn: 0 a 4.
const PONTUACAO_MINIMA = 3;

// userInputs: lista de strings pessoais (nome, e-mail) para a senha NAO poder
// se basear nelas.
function avaliarSenhaAsync(senha, userInputs = []) {
  const entradas = userInputs.filter(Boolean).map(String);
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'zxcvbn-worker.js'));

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Timeout ao avaliar senha'));
    }, 3000);

    worker.once('message', (score) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve({ score, ok: score >= PONTUACAO_MINIMA });
    });

    worker.once('error', (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(err);
    });

    worker.postMessage({ senha, entradas });
  });
}

const MENSAGEM_SENHA_FRACA =
  'Senha muito fraca ou previsível. Use uma combinação mais longa e menos óbvia (evite dados pessoais e sequências comuns).';

module.exports = { avaliarSenhaAsync, PONTUACAO_MINIMA, MENSAGEM_SENHA_FRACA };