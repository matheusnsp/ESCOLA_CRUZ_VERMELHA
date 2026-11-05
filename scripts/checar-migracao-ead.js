// scripts/checar-migracao-ead.js <arquivo.sql>
//
// Confere que uma migração do EAD só CRIA coisas. O banco é de produção: em 30/09 uma versão que
// dependia de coluna nova derrubou o site (ver lib/extras.js). Sai com código 1 e mostra a linha se
// encontrar DROP, ALTER TYPE, ALTER COLUMN ou ALTER TABLE numa tabela que não seja do EAD.

const fs = require('fs');

const TABELAS_EAD = ['CursoOnline', 'ModuloEad', 'TopicoEad', 'TelaEad', 'PerguntaEad', 'AlternativaEad',
  'CenarioEad', 'DecisaoCenario', 'OpcaoDecisao'];

const arquivo = process.argv[2];
if (!arquivo) { console.error('Uso: node scripts/checar-migracao-ead.js <arquivo.sql>'); process.exit(2); }

const problemas = [];
fs.readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
  const l = linha.replace(/--.*$/, '');
  const proibido = /\bDROP\b|\bALTER\s+TYPE\b|\bALTER\s+COLUMN\b|\bRENAME\b|\bTRUNCATE\b/i.test(l) || /^\s*(DELETE|UPDATE)\b/i.test(l);
  const alter = l.match(/\bALTER\s+TABLE\s+(?:ONLY\s+)?"?([A-Za-z_]+)"?/i);
  if (proibido || (alter && !TABELAS_EAD.includes(alter[1]))) problemas.push(`${i + 1}: ${linha.trim()}`);
});

if (problemas.length) {
  console.error('Migração mexe no que já existe:\n' + problemas.join('\n'));
  process.exit(1);
}
console.log('OK: a migração só cria.');
