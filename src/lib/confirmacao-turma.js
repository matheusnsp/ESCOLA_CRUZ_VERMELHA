// lib/confirmacao-turma.js
//
// Confirmar a aula pelo WhatsApp (2026-11-16): na lista de alunos de uma turma, um botão por aluno abre o
// aplicativo WhatsApp do computador (reserva: WhatsApp Web) com a mensagem de boas-vindas da turma já preenchida (curso, data e hora da primeira aula, local,
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

const digitos = (celular) => { const d = String(celular || '').replace(/\D/g, ''); return d.length === 10 || d.length === 11 ? d : null; };

// Aplicativo WhatsApp do computador (principal): abre a conversa sem aba nova. O WhatsApp Web não deixa reaproveitar
// a aba (cross-origin-opener-policy: same-origin), por isso o app.
function linkApp(celular, texto) {
  const d = digitos(celular);
  return d ? `whatsapp://send?phone=55${d}&text=${encodeURIComponent(texto)}` : null;
}

// WhatsApp Web (reserva, quando o aplicativo não está instalado).
function linkWhatsApp(celular, texto) {
  const d = digitos(celular);
  return d ? `https://web.whatsapp.com/send?phone=55${d}&text=${encodeURIComponent(texto)}` : null;
}

module.exports = { textoDaTurma, linkApp, linkWhatsApp };
