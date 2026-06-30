// Cliente mínimo do Supabase Storage via REST (usa o fetch nativo do Node 18+).
// Não exige a biblioteca supabase-js. Requer no .env:
//   SUPABASE_URL          = https://SEU-PROJETO.supabase.co
//   SUPABASE_SERVICE_KEY  = a chave "service_role" (secreta, só no servidor)
//   SUPABASE_BUCKET       = nome do bucket (padrão: "cursos")
const URL_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'cursos';

function configurado() {
  return !!(URL_BASE && SERVICE_KEY);
}

// Envia o buffer da imagem e devolve a URL pública.
async function enviarImagem(buffer, contentType, nome) {
  const alvo = `${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURIComponent(nome)}`;
  const resp = await fetch(alvo, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Falha ao enviar a imagem ao Storage (${resp.status}). ${txt}`);
  }
  return `${URL_BASE}/storage/v1/object/public/${BUCKET}/${nome}`;
}

// Remove a imagem do bucket a partir da URL pública. Ignora URLs que não sejam do nosso bucket.
async function removerImagem(publicUrl) {
  if (!configurado() || !publicUrl) return;
  const marcador = `/object/public/${BUCKET}/`;
  const i = publicUrl.indexOf(marcador);
  if (i === -1) return; // não é deste bucket (ex.: foto antiga em /uploads)
  const nome = publicUrl.slice(i + marcador.length);
  const alvo = `${URL_BASE}/storage/v1/object/${BUCKET}/${nome}`;
  await fetch(alvo, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

module.exports = { configurado, enviarImagem, removerImagem, BUCKET };
