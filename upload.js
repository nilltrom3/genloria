// upload.js — Configuración SEGURA de multer compartida por todas las rutas.
//
// Endurece la subida de archivos contra:
//  - XSS almacenado via SVG/HTML (extensión y MIME deben coincidir con la lista permitida)
//  - Ejecución de scripts disfrazados (se bloquean .svg/.html/.htm/.js/.php/.exe)
//  - Path traversal (el nombre final siempre lo genera el servidor)
//  - Nombres predecibles (componente aleatorio criptográfico)
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Extensiones permitidas (lista cerrada). Nada de .svg: un SVG con JS incrustado
// se ejecutaría en el navegador de quien lo abra (XSS almacenado).
const PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp'];
const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.3gp', '.m4v', '.avi', '.mkv'];

function createUpload({ prefix = 'file', maxBytes, allowPhoto = true, allowVideo = false }) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      let ext = path.extname(file.originalname || '').toLowerCase();
      const ok = (allowPhoto && PHOTO_EXTS.includes(ext)) || (allowVideo && VIDEO_EXTS.includes(ext));
      // Si la extensión no es válida, el fileFilter ya rechazó el archivo;
      // este fallback evita guardar extensiones peligrosas en cualquier caso.
      if (!ok) ext = allowPhoto ? '.jpg' : '.mp4';
      const rand = crypto.randomBytes(6).toString('hex');
      cb(null, `${prefix}-${Date.now()}-${rand}${ext}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const mime = String(file.mimetype || '').toLowerCase();
      const photoOk = allowPhoto && PHOTO_EXTS.includes(ext) && mime.startsWith('image/') && mime !== 'image/svg+xml';
      const videoOk = allowVideo && VIDEO_EXTS.includes(ext) && mime.startsWith('video/');
      if (photoOk || videoOk) return cb(null, true);
      const que = allowPhoto && allowVideo ? 'Solo fotos y videos.' : allowPhoto ? 'Solo fotos.' : 'Solo videos.';
      cb(new Error('Tipo de archivo no permitido. ' + que));
    }
  });
}

module.exports = { createUpload, UPLOAD_DIR, PHOTO_EXTS, VIDEO_EXTS };
