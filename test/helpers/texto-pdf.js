// Texto de um PDF do pdfkit gerado com compress: false (fontes padrão, WinAnsi): junta os trechos de cada
// operador TJ/Tj, tirando o kerning. Basta para conferir frases nos testes.
module.exports = function textoDoPdf(buffer) {
  const s = buffer.toString('latin1');
  const linhas = [];
  for (const m of s.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
    const pedacos = m[1] !== undefined ? [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]) : [m[2]];
    linhas.push(pedacos.map((h) => Buffer.from(h, 'hex').toString('latin1')).join(''));
  }
  return linhas.join('\n');
};
