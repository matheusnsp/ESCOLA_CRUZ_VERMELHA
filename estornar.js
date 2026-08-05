require('dotenv').config({ path: '.env.dev' });
const TOKEN = process.env.UNICOPAG_API_TOKEN;
const REF = '6punizifkk';
(async () => {
  const url = `https://api.cloud.unicopag.com.br/public/v1/payments/${REF}/refund?api_token=${TOKEN}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
  });
  const txt = await r.text();
  console.log('HTTP', r.status);
  console.log(txt.slice(0, 500));
  process.exit(0);
})();
