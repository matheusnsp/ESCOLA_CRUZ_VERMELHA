// lib/curso-assinaturas.js — quem assina o certificado do curso (movido de routes/admin.js para as telas novas).
// As linhas de quem assina são uma lista única (a mesma de Certificados); o curso guarda só a escolha.
const certificado = require('./certificado');
const extras = require('./extras');

// { assinantes, escolha, erro }
function assinaturasDoForm(body) {
  const linhas = [].concat(Object.values(body.assin || {})).slice(0, certificado.MAX_ASSINANTES);
  const assinantes = linhas.map((l) => ({ nome: String(l.nome || '').trim(), cargo: String(l.cargo || '').trim() }));
  const escolha = linhas.map((l, i) => (l.marcado && assinantes[i].nome ? 'a' + i : null)).filter(Boolean);
  if (body.assinInstrutor) escolha.push('instrutor');
  let erro = null;
  if (!assinantes.some((a) => a.nome)) erro = 'Informe pelo menos uma pessoa que assina o certificado.';
  else if (!escolha.length) erro = 'Marque pelo menos uma assinatura para o certificado.';
  else if (escolha.length > certificado.MAX_NO_CERTIFICADO) erro = `O certificado leva no máximo ${certificado.MAX_NO_CERTIFICADO} assinaturas.`;
  return { assinantes, escolha, erro };
}

async function salvarAssinaturasDoCurso(cursoId, body, req, auditar) {
  if (!body.assin) return; // formulário sem a seção de assinaturas
  const { assinantes, escolha } = assinaturasDoForm(body);
  const { livro } = await certificado.lerAjustes();
  await certificado.salvarAjustes({ assinantes, livro });
  await extras.salvarExtra('curso', cursoId, { certAssinaturas: escolha });
  if (auditar) await auditar(req, 'EDITOU_ASSINATURAS_CERTIFICADO', 'Curso', cursoId, { escolha });
}

module.exports = { assinaturasDoForm, salvarAssinaturasDoCurso };
