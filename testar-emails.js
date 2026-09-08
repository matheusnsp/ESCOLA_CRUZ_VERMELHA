// Envia os dois e-mails novos, com dados de exemplo, pro endereço abaixo.
// Uso, na RAIZ do projeto:   node testar-emails.js
// Apague o arquivo depois:   rm testar-emails.js
require('dotenv').config();

const DESTINO = process.env.EMAIL_TESTE || 'matheusnevessp50@gmail.com';
const NOME    = 'Matheus';

const {
  enviarEmailConfirmacao,
  enviarEmailMatriculaConfirmada,
} = require('./src/lib/email');

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

(async () => {
  console.log('\nDestino:         ' + DESTINO);
  console.log('Remetente:       ' + (process.env.EMAIL_REMETENTE || '(padrao do email.js)'));
  console.log('RESEND_API_KEY:  ' + (process.env.RESEND_API_KEY ? 'configurada' : 'AUSENTE -- nada sai, so imprime'));
  console.log('ESCOLA_ENDERECO: ' + (process.env.ESCOLA_ENDERECO || '(padrao: Praca Cruz Vermelha, 10)'));

  console.log('\n--- 1/2  BOAS-VINDAS + CONFIRMACAO ---');
  await enviarEmailConfirmacao(
    DESTINO,
    NOME,
    APP_URL + '/confirmar-email?token=TOKEN-DE-TESTE'
  );

  console.log('\n--- 2/2  MATRICULA CONFIRMADA ---');
  await enviarEmailMatriculaConfirmada(DESTINO, NOME, {
    curso: 'Punção Venosa',
    inicioTurma: '24/09/2026',
    aulas: [
      { data: '24/09/2026', horario: '09:00 - 17:00' },
      { data: '25/09/2026', horario: '09:00 - 17:00' },
    ],
    valorPago: 'R$ 250,00',
    plano: 'PARCELADO',
    parcelas: 2,
    alimento: true,
    link: APP_URL + '/minha-conta?sec=inscricoes',
  });

  console.log('\nPronto. Confira a caixa de entrada e o spam.\n');
  process.exit(0);
})().catch((e) => {
  console.error('\nFalhou:', e.message, '\n');
  process.exit(1);
});
