// Upload da foto do curso.
// Se o Supabase Storage estiver configurado (.env), a foto vai para lá (persistente,
// sobrevive a resets do banco e a deploys). Caso contrário, cai no disco local
// (public/uploads) — útil só para desenvolvimento.
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const storageRemoto = require('./storage-supabase');

const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const EXT_POR_TIPO = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const TIPOS_OK = Object.keys(EXT_POR_TIPO);

// Guardamos o arquivo em memória para poder enviá-lo ao Storage (ou gravar no disco).
const fotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
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

function nomeArquivo(mimetype) {
  const ext = EXT_POR_TIPO[mimetype] || '.img';
  return `curso-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

// Salva a foto e devolve a URL para gravar em Curso.imagemUrl.
// Usa o Supabase Storage se configurado; senão, grava em disco (dev).
async function salvarFotoCurso(file) {
  const nome = nomeArquivo(file.mimetype);
  if (storageRemoto.configurado()) {
    return storageRemoto.enviarImagem(file.buffer, file.mimetype, nome);
  }
  await fs.promises.writeFile(path.join(uploadsDir, nome), file.buffer);
  return '/uploads/' + nome;
}

// Remove a foto antiga, seja do Storage (URL http) ou do disco (/uploads/...).
async function removerFotoCurso(imagemUrl) {
  if (!imagemUrl) return;
  if (imagemUrl.startsWith('/uploads/')) {
    await fs.promises.unlink(path.join(uploadsDir, path.basename(imagemUrl))).catch(() => {});
    return;
  }
  await storageRemoto.removerImagem(imagemUrl);
}

module.exports = { uploadFoto, salvarFotoCurso, removerFotoCurso, uploadsDir };
