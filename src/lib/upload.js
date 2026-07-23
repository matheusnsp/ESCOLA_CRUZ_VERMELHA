const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const storageRemoto = require('./storage-supabase');

const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const EXT_POR_TIPO = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const TIPOS_OK = Object.keys(EXT_POR_TIPO);

const fotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (TIPOS_OK.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Envie uma imagem JPG, PNG, WEBP ou GIF.'));
  },
});

function uploadFoto(req, res, next) {
  fotoUpload.single('foto')(req, res, (err) => {
    if (err) {
      req.uploadErro = err.code === 'LIMIT_FILE_SIZE' ? 'Imagem muito grande (máximo 3 MB).' : err.message;
    }
    next();
  });
}

// Comprime qualquer imagem para WEBP (melhor compressão, menor egress).
// GIF é preservado sem conversão pra não perder animação.
async function comprimirImagem(file) {
  if (file.mimetype === 'image/gif') return { buffer: file.buffer, mimetype: 'image/gif' };
  const buffer = await sharp(file.buffer)
    .resize({ width: 1200, withoutEnlargement: true }) // não amplia imagens pequenas
    .webp({ quality: 82 })
    .toBuffer();
  return { buffer, mimetype: 'image/webp' };
}

function nomeArquivo(mimetype) {
  const ext = EXT_POR_TIPO[mimetype] || '.img';
  return `curso-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

async function salvarFotoCurso(file) {
  const { buffer, mimetype } = await comprimirImagem(file);
  const nome = nomeArquivo(mimetype);
  if (storageRemoto.configurado()) {
    return storageRemoto.enviarImagem(buffer, mimetype, nome);
  }
  await fs.promises.writeFile(path.join(uploadsDir, nome), buffer);
  return '/uploads/' + nome;
}

async function removerFotoCurso(imagemUrl) {
  if (!imagemUrl) return;
  if (imagemUrl.startsWith('/uploads/')) {
    await fs.promises.unlink(path.join(uploadsDir, path.basename(imagemUrl))).catch(() => {});
    return;
  }
  await storageRemoto.removerImagem(imagemUrl);
}

module.exports = { uploadFoto, salvarFotoCurso, removerFotoCurso, uploadsDir };