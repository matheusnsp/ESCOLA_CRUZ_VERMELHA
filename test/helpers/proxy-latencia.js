// Proxy TCP que atrasa cada pedaço nos dois sentidos: simula a distância entre o Render e o Supabase
// para os testes de transação (test/latencia.test.js). A ordem dos pedaços é mantida.
const net = require('net');

function abrir(destinoPorta, atrasoMs, destinoHost = '127.0.0.1') {
  const conexoes = new Set();
  const atrasar = (de, para) => {
    let fila = Promise.resolve();
    de.on('data', (pedaco) => {
      const sai = Date.now() + atrasoMs;
      fila = fila.then(() => new Promise((r) => setTimeout(r, Math.max(0, sai - Date.now())))).then(() => { if (!para.destroyed) para.write(pedaco); });
    });
    de.on('end', () => { fila.then(() => para.end()); });
    de.on('error', () => para.destroy());
  };
  const servidor = net.createServer((cliente) => {
    const banco = net.connect(destinoPorta, destinoHost);
    conexoes.add(cliente); conexoes.add(banco);
    cliente.on('close', () => conexoes.delete(cliente));
    banco.on('close', () => conexoes.delete(banco));
    atrasar(cliente, banco);
    atrasar(banco, cliente);
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => resolve({
      porta: servidor.address().port,
      fechar: () => new Promise((r) => { conexoes.forEach((c) => c.destroy()); servidor.close(() => r()); }),
    }));
  });
}

module.exports = { abrir };
