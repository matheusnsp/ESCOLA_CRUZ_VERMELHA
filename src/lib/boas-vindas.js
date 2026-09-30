// lib/boas-vindas.js
//
// Mensagem de boas-vindas da turma: data, hora, local, doação solidária, vestimenta e certificação.
// A secretaria libera o envio na tela da turma (/turmas/:id/boas-vindas); a partir daí:
//   - quem já pagou recebe o e-mail na hora;
//   - quem pagar depois recebe sozinho (enviarPendentes, a cada 15 min no server.js);
//   - o mesmo texto aparece em "Minha conta" do aluno até a turma terminar.
//
// O texto padrão fica em Configuracao ('boasvindas_texto', 'boasvindas_doacao', 'boasvindas_local')
// e é editado em /modelos. Cada turma pode trocar só o trecho da doação (Turma.boasVindasDoacao).
// Marcações no estilo WhatsApp: *negrito*. Campos: {CURSO} {curso} {data} {hora} {local} {doacao}.

const prisma = require('../db');

const TEXTO_PADRAO = `*Desejamos aos alunos do curso de {CURSO}, Boas vindas!!!*

Olá a todos,

É com grande prazer que confirmamos a aula do curso de {CURSO}.

*ATENÇÃO*
Início: dia *{data} às {hora}*
Local: {local}

Estamos ansiosos para compartilhar conhecimentos valiosos.

{doacao}

Vestimenta: blusa (camisa com manga curta), calça (sem rasgos) e sapato fechado. *NÃO É PERMITIDO A ENTRADA TRAJANDO: BERMUDA, SHORT, MINI SAIA, BLUSA REGATA OU DECOTADA, CAMISETA, SANDÁLIAS ABERTAS, CHINELO, BONÉ.*

Certificação a partir de 15 dias úteis até 60 dias conforme portaria MEC 1.095/2018.

Agradecemos antecipadamente pela sua generosidade e comprometimento com a nossa causa. Juntos, podemos fazer uma diferença significativa na vida de muitas pessoas.

Atenciosamente,

Secretaria Escolar
*Cruz Vermelha Brasileira Filial do Estado do Rio de Janeiro*`;

const DOACAO_PADRAO = 'Gostaríamos de lembrar da importância da doação solidária. Como parte da nossa iniciativa de apoio às comunidades que estão em situações de vulnerabilidade social, solicitamos a gentileza de trazerem Sabão em Pó ou Líquido *OU* *1 pacote de doces e um brinquedo para o dia das crianças de 03 à 13 anos* que deverá ser entregue antes de entrar para o curso.';

const LOCAL_PADRAO = `Praça da Cruz Vermelha n° 10 - 12 Centro/RJ
Palácio da Cruz Vermelha Brasileira Filial Estadual do Rio de Janeiro`;

const CHAVES = { texto: 'boasvindas_texto', doacao: 'boasvindas_doacao', local: 'boasvindas_local' };
const PADROES = { texto: TEXTO_PADRAO, doacao: DOACAO_PADRAO, local: LOCAL_PADRAO };

async function lerModelo() {
  const cfgs = await prisma.configuracao.findMany({ where: { chave: { in: Object.values(CHAVES) } } });
  const mapa = Object.fromEntries(cfgs.map((c) => [c.chave, c.valor]));
  return Object.fromEntries(Object.entries(CHAVES).map(([k, chave]) => [k, (mapa[chave] || '').trim() ? mapa[chave] : PADROES[k]]));
}

async function salvarModelo(valores) {
  for (const [k, chave] of Object.entries(CHAVES)) {
    const v = String(valores[k] || '').replace(/\r\n/g, '\n').trim();
    if (!v || v === PADROES[k]) await prisma.configuracao.deleteMany({ where: { chave } }); // vazio = volta ao padrão
    else await prisma.configuracao.upsert({ where: { chave }, update: { valor: v }, create: { chave, valor: v } });
  }
}

const dataBr = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}`;
};

// "09:00 – 13:00" → "09h"; "18:30 às 22:00" → "18h30".
function horaInicio(horario) {
  const m = /(\d{1,2})[:h](\d{2})?/.exec(String(horario || ''));
  if (!m) return '';
  const h = m[1].padStart(2, '0');
  return m[2] && m[2] !== '00' ? `${h}h${m[2]}` : `${h}h`;
}

// Texto final da turma (com *negrito* do WhatsApp). turma precisa de curso e aulas.
function montarTexto(turma, modelo) {
  const aulas = [...(turma.aulas || [])].sort((a, b) => new Date(a.data) - new Date(b.data));
  const primeira = aulas[0];
  const data = dataBr(primeira ? primeira.data : turma.inicioPrevisto);
  const hora = primeira ? horaInicio(primeira.horario) : '';
  const doacao = (turma.boasVindasDoacao || '').trim() || modelo.doacao;
  let t = modelo.texto;
  if (!hora) t = t.replace(/ às \{hora\}/g, '').replace(/\{hora\}/g, '');
  return t
    .replace(/\{CURSO\}/g, turma.curso.nome.toUpperCase())
    .replace(/\{curso\}/g, turma.curso.nome)
    .replace(/\{data\}/g, data)
    .replace(/\{hora\}/g, hora)
    .replace(/\{local\}/g, modelo.local.trim())
    .replace(/\{doacao\}/g, doacao.trim())
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// HTML seguro: escapa tudo, depois *x* vira <strong>, linha em branco separa parágrafos.
function textoParaHtml(texto, estiloP = '') {
  return texto.split(/\n\s*\n/).map((bloco) => {
    const linhas = escapar(bloco).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    return `<p${estiloP ? ` style="${estiloP}"` : ''}>${linhas}</p>`;
  }).join('\n');
}

function assunto(turma) {
  const aulas = [...(turma.aulas || [])].sort((a, b) => new Date(a.data) - new Date(b.data));
  return `Boas-vindas: ${turma.curso.nome} começa em ${dataBr(aulas[0] ? aulas[0].data : turma.inicioPrevisto)}`;
}

// Quem recebe: taxa confirmada e pagamento em dia (pago ou parcelado).
const FILTRO_ALUNO_OK = { taxaConfirmada: true, statusPagamento: { in: ['PAGO', 'PARCELADO'] } };

// A turma ainda não terminou? (a última aula é hoje ou depois; sem aulas, o início)
function turmaEmCurso(turma) {
  const datas = (turma.aulas || []).map((a) => new Date(a.data).getTime());
  const fim = datas.length ? Math.max(...datas) : new Date(turma.inicioPrevisto).getTime();
  const hoje = new Date(); hoje.setUTCHours(0, 0, 0, 0);
  return fim >= hoje.getTime() && ['ABERTA', 'CONFIRMADA'].includes(turma.status);
}

// Envia para uma matrícula, uma vez só. A marcação é gravada ANTES de mandar (updateMany com
// boasVindasEm null): se dois serviços do Render rodarem ao mesmo tempo, só um "ganha" o aluno.
async function enviarPara(matricula, turma, modelo) {
  const { enviarBoasVindasTurma } = require('./email');
  const marcou = await prisma.matricula.updateMany({ where: { id: matricula.id, boasVindasEm: null }, data: { boasVindasEm: new Date() } });
  if (!marcou.count) return false;
  try {
    const texto = montarTexto(turma, modelo);
    await enviarBoasVindasTurma(matricula.aluno.email, matricula.aluno.nome.split(' ')[0], { assunto: assunto(turma), texto });
    return true;
  } catch (e) {
    await prisma.matricula.update({ where: { id: matricula.id }, data: { boasVindasEm: null } }); // tenta de novo na próxima passada
    throw e;
  }
}

// Liberar e enviar para todos que já podem receber (botão na tela da turma).
async function enviarTurma(turmaId) {
  const turma = await prisma.turma.findUnique({ where: { id: turmaId }, include: { curso: true, aulas: true } });
  if (!turma) return { enviados: 0, erros: 0 };
  if (!turma.boasVindasEnviadaEm) await prisma.turma.update({ where: { id: turma.id }, data: { boasVindasEnviadaEm: new Date() } });
  const modelo = await lerModelo();
  const matriculas = await prisma.matricula.findMany({
    where: { turmaId, ...FILTRO_ALUNO_OK, boasVindasEm: null },
    include: { aluno: { select: { nome: true, email: true } } },
  });
  const r = { enviados: 0, erros: 0 };
  for (const m of matriculas) {
    try { if (await enviarPara(m, turma, modelo)) r.enviados++; } catch (e) { r.erros++; console.error('[BOAS-VINDAS]', m.id, e.message); }
  }
  return r;
}

// Quem pagou depois de a turma ter sido liberada (roda a cada 15 min).
async function enviarPendentes() {
  try {
    const turmas = await prisma.turma.findMany({
      where: { boasVindasEnviadaEm: { not: null }, status: { in: ['ABERTA', 'CONFIRMADA'] }, matriculas: { some: { ...FILTRO_ALUNO_OK, boasVindasEm: null } } },
      include: { curso: true, aulas: true },
    });
    if (!turmas.length) return;
    const modelo = await lerModelo();
    for (const turma of turmas.filter(turmaEmCurso)) {
      const matriculas = await prisma.matricula.findMany({
        where: { turmaId: turma.id, ...FILTRO_ALUNO_OK, boasVindasEm: null },
        include: { aluno: { select: { nome: true, email: true } } },
      });
      for (const m of matriculas) {
        try { await enviarPara(m, turma, modelo); } catch (e) { console.error('[BOAS-VINDAS]', m.id, e.message); }
      }
    }
  } catch (e) {
    console.error('[BOAS-VINDAS] passada falhou:', e.message);
  }
}

module.exports = {
  PADROES, lerModelo, salvarModelo, montarTexto, textoParaHtml, assunto, turmaEmCurso,
  FILTRO_ALUNO_OK, enviarTurma, enviarPendentes,
};
