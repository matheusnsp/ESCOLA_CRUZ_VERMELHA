const { parentPort } = require('worker_threads');
const zxcvbn = require('zxcvbn');

parentPort.on('message', ({ senha, entradas }) => {
  const r = zxcvbn(senha, entradas);
  parentPort.postMessage(r.score);
});