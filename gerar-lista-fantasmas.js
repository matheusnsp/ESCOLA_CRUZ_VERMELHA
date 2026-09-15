// ═══════════════════════════════════════════════════════════════════════
//  LISTA — inscrições não concluídas (fantasmas)
//
//  Gera uma página HTML com um link de WhatsApp por aluno, com o texto já
//  escrito. Contorno para o botão do painel, que não abre o WhatsApp na
//  máquina de uma das pessoas da secretaria.
//
//  Diferente da lista de prospecção (156 pessoas que só criaram conta),
//  aqui são pessoas que ESCOLHERAM um curso, aceitaram o contrato e
//  escolheram como pagar — e pararam antes de pagar. A secretaria testou a
//  lista larga e 4 de 5 já tinham conversado com ela; este recorte tem
//  contexto real pra citar na mensagem.
//
//  USO, na RAIZ do projeto:
//    node gerar-lista-fantasmas.js
//
//  Gera ./lista-fantasmas.html — é só abrir no navegador.
//
//  ⚠️ O arquivo tem nome e telefone de alunos. Não suba pro git nem mande
//  por e-mail comum. Apague quando terminar:
//    rm gerar-lista-fantasmas.js lista-fantasmas.html
// ═══════════════════════════════════════════════════════════════════════
require('dotenv').config();

const fs = require('fs');
const prisma = require('./src/db');

const APP_URL = (process.env.APP_URL || 'https://escola.cursoscruzvermelha.org').replace(/\/+$/, '');

function esc(t) {
  return String(t || '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Data pura: lê em UTC. Coluna DATE/timestamp de início não deve sofrer
// conversão de fuso — foi o bug que mandou 23/09 no lugar de 24/09 por e-mail.
function dataBR(d) {
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
}

function telBR(c) {
  const d = String(c || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return c || '—';
}

// Celular do Rio (e de todo o país, hoje) tem 11 dígitos com 9 na terceira
// posição. Marcamos os que fogem disso pra secretaria conferir antes.
function celularValido(c) {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 && d[2] === '9';
}

// A pessoa nunca pagou nada, então NUNCA dizer que a vaga está reservada —
// ela não está. Dizer o contrário criaria uma expectativa que a secretaria
// teria que desfazer depois.
function montarTexto(m) {
  const nome = String(m.aluno.nome).trim().split(/\s+/)[0];
  const curso = m.turma.curso.nome;
  const inicio = dataBR(m.turma.inicioPrevisto);
  const link = `${APP_URL}/inscrever/${m.turmaId}`;

  return `Olá, ${nome}! Aqui é da Escola de Educação e Saúde da Cruz Vermelha RJ.\n\n`
    + `Vimos que você começou a inscrição no curso ${curso}, mas o pagamento não foi concluído — `
    + `então sua vaga ainda não está garantida.\n\n`
    + `A turma começa em ${inicio}. Você pode retomar por aqui:\n${link}`;
}

function urlWhatsApp(celular, texto) {
  const d = String(celular || '').replace(/\D/g, '');
  if (d.length !== 10 && d.length !== 11) return null;
  return `https://web.whatsapp.com/send?phone=55${d}&text=${encodeURIComponent(texto)}`;
}

(async () => {
  const matriculas = await prisma.matricula.findMany({
    where: {
      statusPagamento: 'PENDENTE',
      taxaConfirmada: false,
      pagamentos: { none: { gatewayRef: { not: null } } },
    },
    include: {
      aluno: true,
      turma: { include: { curso: true } },
    },
  });

  const agora = new Date();
  const linhas = matriculas.map((m) => {
    const aberta = m.turma.status === 'ABERTA' && new Date(m.turma.inicioPrevisto) > agora;
    const texto = montarTexto(m);
    return {
      nome: m.aluno.nome,
      email: m.aluno.email,
      tel: telBR(m.aluno.celular),
      telOk: celularValido(m.aluno.celular),
      curso: m.turma.curso.nome,
      inicio: dataBR(m.turma.inicioPrevisto),
      aberta,
      dias: Math.floor((agora - new Date(m.criadoEm)) / 86400000),
      link: urlWhatsApp(m.aluno.celular, texto),
    };
  });

  // Turma aberta primeiro, e dentro dela quem começa antes — é quem tem
  // menos tempo pra decidir.
  linhas.sort((a, b) => {
    if (a.aberta !== b.aberta) return a.aberta ? -1 : 1;
    return a.inicio.split('/').reverse().join('') > b.inicio.split('/').reverse().join('') ? 1 : -1;
  });

  const uteis = linhas.filter((l) => l.aberta);
  const encerradas = linhas.filter((l) => !l.aberta);

  const linhaHtml = (l) => `    <tr class="${l.aberta ? '' : 'encerrada'}">
      <td>
        <div class="nome">${esc(l.nome)}</div>
        <div class="mut">${esc(l.email)}</div>
      </td>
      <td>
        ${esc(l.tel)}
        ${l.telOk ? '' : '<div class="alerta">confira este número</div>'}
      </td>
      <td>
        ${esc(l.curso)}
        <div class="mut">começa ${l.inicio}${l.aberta ? '' : ' — já encerrada'}</div>
      </td>
      <td class="mut">${l.dias}d</td>
      <td>${l.link
        ? `<a class="btn" href="${l.link}" target="_blank" rel="noopener">WhatsApp</a>`
        : '<span class="mut">sem celular</span>'}</td>
    </tr>`;

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Inscrições não concluídas — ${linhas.length}</title>
<style>
  body { font-family: -apple-system, Inter, Arial, sans-serif; max-width: 980px;
         margin: 32px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin: 32px 0 8px; color: #4a5568; }
  .sub { color: #718096; font-size: 14px; margin-bottom: 20px; }
  .aviso { background: #f0f7ff; border: 1px solid #cfe0f5; border-radius: 10px;
           padding: 14px 16px; font-size: 13px; line-height: 1.55; color: #2c5282;
           margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; padding: 8px 10px; background: #f5f6f9; font-size: 12px;
       text-transform: uppercase; letter-spacing: .04em; color: #4a5568; }
  td { padding: 10px; border-bottom: 1px solid #eef0f4; vertical-align: middle; }
  tr.feito { opacity: .35; }
  tr.feito .nome::before { content: "✓ "; color: #0d7a58; }
  tr.encerrada { background: #fcfcfd; }
  .nome { font-weight: 600; }
  .mut { color: #718096; font-size: 12px; }
  .alerta { color: #b7791f; font-size: 12px; font-weight: 600; }
  a.btn { display: inline-block; background: #25d366; color: #fff; padding: 7px 14px;
          border-radius: 7px; text-decoration: none; font-weight: 600; font-size: 13px;
          white-space: nowrap; }
  a.btn:hover { background: #1da851; }
  .prog { position: sticky; top: 0; background: #fff; padding: 12px 0;
          border-bottom: 2px solid #eef0f4; margin-bottom: 12px; font-size: 14px; }
</style>

<h1>Inscrições não concluídas</h1>
<p class="sub">
  ${uteis.length} com turma aberta${encerradas.length ? ` &middot; ${encerradas.length} de turma já encerrada` : ''}
</p>

<div class="aviso">
  Estas pessoas escolheram um curso, aceitaram o contrato e escolheram como
  pagar — mas pararam antes de pagar qualquer coisa. Por isso a mensagem diz
  que a vaga <strong>ainda não está garantida</strong>: ela não está.
  <br><br>
  O link leva pra tela de inscrição do curso que a pessoa escolheu, então ela
  retoma de onde parou.
</div>

<div class="prog">
  Enviados nesta sessão: <strong id="conta">0</strong> de ${uteis.length}
  <span class="mut">— clicar marca a linha; recarregar zera</span>
</div>

<table>
  <thead>
    <tr><th>Aluno</th><th>Telefone</th><th>Curso</th><th>Parado</th><th></th></tr>
  </thead>
  <tbody>
${uteis.map(linhaHtml).join('\n')}
  </tbody>
</table>

${encerradas.length ? `
<h2>Turma já encerrada</h2>
<p class="sub">O curso que essas pessoas escolheram já aconteceu. A mensagem
não faria sentido; se quiser falar com elas, é pra oferecer outra turma.</p>
<table>
  <thead>
    <tr><th>Aluno</th><th>Telefone</th><th>Curso</th><th>Parado</th><th></th></tr>
  </thead>
  <tbody>
${encerradas.map(linhaHtml).join('\n')}
  </tbody>
</table>` : ''}

<script>
  var conta = 0;
  document.querySelectorAll('a.btn').forEach(function (a) {
    a.addEventListener('click', function () {
      var tr = a.closest('tr');
      if (!tr.classList.contains('feito')) {
        tr.classList.add('feito');
        if (!tr.classList.contains('encerrada')) {
          document.getElementById('conta').textContent = ++conta;
        }
      }
    });
  });
</script>
`;

  fs.writeFileSync('lista-fantasmas.html', html);

  console.log('\n─────────────────────────────────────────────');
  console.log('Total encontrado:          ' + linhas.length);
  console.log('Turma aberta (contatar):   ' + uteis.length);
  console.log('Turma encerrada:           ' + encerradas.length);
  console.log('Celular suspeito:          ' + linhas.filter((l) => !l.telOk).length);
  console.log('─────────────────────────────────────────────');
  console.log('\nArquivo: lista-fantasmas.html');
  console.log('Abra com:  open lista-fantasmas.html\n');
  process.exit(0);
})().catch((e) => {
  console.error('\nFalhou:', e.message, '\n');
  process.exit(1);
});