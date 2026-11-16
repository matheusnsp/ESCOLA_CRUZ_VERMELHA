// lib/confirmacao-turma.js
//
// Confirmar a aula pelo WhatsApp Web (2026-11-16): na lista de alunos de uma turma, um botão por aluno abre o
// WhatsApp Web com a mensagem de boas-vindas da turma já preenchida (curso, data e hora da primeira aula, local,
// doação) — o mesmo texto de Turmas › Mensagem de boas-vindas (lib/boas-vindas.js), para confirmar que a turma
// está mantida e não foi adiada. O painel só abre a conversa; quem manda é a pessoa.

const bv = require('./boas-vindas');

// Texto da turma, ou null se ela não existe.
async function textoDaTurma(turmaId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(turmaId || ''))) return null;
  const turma = await bv.carregarTurma(turmaId);
  if (!turma) return null;
  return bv.montarTexto(turma, await bv.lerModelo());
}

// https://web.whatsapp.com/send?phone=55…&text=… ou null se o celular não tem 10 ou 11 dígitos.
function linkWhatsApp(celular, texto) {
  const d = String(celular || '').replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return null;
  return `https://web.whatsapp.com/send?phone=55${d}&text=${encodeURIComponent(texto)}`;
}

module.exports = { textoDaTurma, linkWhatsApp };
