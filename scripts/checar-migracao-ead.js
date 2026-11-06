// scripts/checar-migracao-ead.js <arquivo.sql>
//
// Confere que uma migração do EAD só CRIA coisas. O banco é de produção: em 30/09 uma versão que
// dependia de coluna nova derrubou o site (ver lib/extras.js). Sai com código 1 e mostra a linha se
// encontrar DROP, ALTER TYPE, ALTER COLUMN ou ALTER TABLE numa tabela que não seja do EAD.

const fs = require('fs');

const TABELAS_EAD = ['CursoOnline', 'ModuloEad', 'TopicoEad', 'TelaEad', 'PerguntaEad', 'AlternativaEad',
  'CenarioEad', 'DecisaoCenario', 'OpcaoDecisao',
  // etapa 7: cupom
  'CupomEad', 'CupomMatriculaEad',
  // etapa 9: criar curso com IA
  'GeracaoIaEad',
  // etapa 2: progresso do aluno
  'AlunoCursoEad', 'TelaVistaEad', 'TentativaEad', 'CenarioFeitoEad',
  // etapa 5: dúvidas por aula
  'DuvidaEad',
  // etapa 6: venda em lote
  'EscolaEad', 'GestorEscolaEad', 'LoteEad', 'VagaLoteEad'];

const arquivo = process.argv[2];
if (!arquivo) { console.error('Uso: node scripts/checar-migracao-ead.js <arquivo.sql>'); process.exit(2); }

const problemas = [];
fs.readFileSync(arquivo, 'utf8').split('\n').forEach((linha, i) => {
  const l = linha.replace(/--.*$/, '');
  // Única mudança de tipo aceita: o status ONLINE da turma (etapa 4), só acrescentando.
  const addOnline = /^\s*ALTER\s+TYPE\s+"StatusTurma"\s+ADD\s+VALUE\s+IF\s+NOT\s+EXISTS\s+'ONLINE'\s*;?\s*$/i.test(l);
  const proibido = (!addOnline && /\bALTER\s+TYPE\b/i.test(l)) || /\bDROP\b|\bALTER\s+COLUMN\b|\bRENAME\b|\bTRUNCATE\b/i.test(l) || /^\s*(DELETE|UPDATE)\b/i.test(l);
  const alter = l.match(/\bALTER\s+TABLE\s+(?:ONLY\s+)?"?([A-Za-z_]+)"?/i);
  if (proibido || (alter && !TABELAS_EAD.includes(alter[1]))) problemas.push(`${i + 1}: ${linha.trim()}`);
});

if (problemas.length) {
  console.error('Migração mexe no que já existe:\n' + problemas.join('\n'));
  process.exit(1);
}
console.log('OK: a migração só cria.');
