// "Adicionar à agenda": arquivo .ics (iCalendar, RFC 5545) com as aulas de uma turma.
// Abre no Google Agenda, no calendário do iPhone e no Outlook. Rota em routes/cursos.js
// (/turmas/:turmaId/agenda.ics), link em "Minhas inscrições" e no e-mail de matrícula confirmada.

const ENDERECO = 'Praça da Cruz Vermelha, 10 - Centro, Rio de Janeiro - RJ';

// Texto do iCalendar: escapa \ ; , e quebras de linha.
function texto(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Linhas com mais de 75 bytes são dobradas (continuação começa com espaço).
function dobrar(linha) {
  const partes = [];
  let atual = '';
  for (const ch of linha) {
    if (Buffer.byteLength(atual + ch) > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; }
    atual += ch;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

const p2 = (n) => String(n).padStart(2, '0');
// AulaData.data é coluna DATE (meia-noite UTC): o dia vem dos componentes UTC, sem fuso.
const diaDe = (d) => { const dt = new Date(d); return `${dt.getUTCFullYear()}${p2(dt.getUTCMonth() + 1)}${p2(dt.getUTCDate())}`; };
// Rio de Janeiro: UTC-3 o ano todo (sem horário de verão desde 2019) → hora local + 3 = UTC.
function instante(dia, hh, mm) {
  const dt = new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(4, 6) - 1, +dia.slice(6, 8), hh + 3, mm));
  return `${dt.getUTCFullYear()}${p2(dt.getUTCMonth() + 1)}${p2(dt.getUTCDate())}T${p2(dt.getUTCHours())}${p2(dt.getUTCMinutes())}00Z`;
}
// "09:00 - 17:00", "08:00 – 12:00", "18h às 22h" → { ini: [9, 0], fim: [17, 0] }; senão null (vira evento de dia inteiro).
function horas(horario) {
  const h = String(horario || '').match(/(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:-|–|—|às|as|a)\s*(\d{1,2})(?:[:h](\d{2}))?/i);
  if (!h) return null;
  const ini = [+h[1], +(h[2] || 0)], fim = [+h[3], +(h[4] || 0)];
  if (ini[0] > 23 || fim[0] > 23 || ini[1] > 59 || fim[1] > 59) return null;
  return { ini, fim };
}

/**
 * turma: { id, inicioPrevisto, curso: { nome }, aulas: [{ id, data, horario }] }
 * Sem aulas cadastradas, entra um evento de dia inteiro na data de início.
 */
function icsDaTurma(turma, urlCurso) {
  const agora = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const nome = turma.curso && turma.curso.nome ? turma.curso.nome : 'Curso';
  const aulas = (turma.aulas && turma.aulas.length)
    ? turma.aulas
    : [{ id: 'inicio', data: turma.inicioPrevisto, horario: '' }];
  const linhas = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Escola de Educacao e Saude CVB-RJ//Agenda//PT-BR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + texto(nome),
  ];
  aulas.forEach((a, i) => {
    const dia = diaDe(a.data);
    const h = horas(a.horario);
    linhas.push('BEGIN:VEVENT', `UID:${a.id}-${turma.id}@escola.cruzvermelhariodejaneiro.org`, `DTSTAMP:${agora}`);
    if (h) {
      linhas.push(`DTSTART:${instante(dia, h.ini[0], h.ini[1])}`, `DTEND:${instante(dia, h.fim[0], h.fim[1])}`);
    } else {
      const dt = new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(4, 6) - 1, +dia.slice(6, 8) + 1));
      linhas.push(`DTSTART;VALUE=DATE:${dia}`, `DTEND;VALUE=DATE:${diaDe(dt)}`);
    }
    const titulo = aulas.length > 1 ? `${nome} (aula ${i + 1} de ${aulas.length})` : nome;
    linhas.push(
      'SUMMARY:' + texto(titulo),
      'LOCATION:' + texto('Cruz Vermelha Brasileira – ' + ENDERECO),
      'DESCRIPTION:' + texto('Aula presencial na Escola de Educação e Saúde da Cruz Vermelha Brasileira – RJ.'
        + (urlCurso ? '\nDetalhes: ' + urlCurso : '')),
      // lembrete na véspera
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', 'DESCRIPTION:' + texto('Amanhã: ' + titulo), 'END:VALARM',
      'END:VEVENT'
    );
  });
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}

module.exports = { icsDaTurma, horas };
