// Imagens em WebP (2026-11-09): o GIF enviado pelo painel também vira WebP (animado).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { salvarFotoCurso, removerFotoCurso, uploadsDir } = require('../src/lib/upload');

test('GIF enviado é guardado como WebP', async () => {
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff0000' } }).gif().toBuffer();
  const url = await salvarFotoCurso({ buffer: gif, mimetype: 'image/gif' });
  assert.match(url, /\.webp$/);
  const meta = await sharp(fs.readFileSync(path.join(uploadsDir, path.basename(url)))).metadata();
  assert.equal(meta.format, 'webp');
  await removerFotoCurso(url);
});
