// routes/stories.js — Historias efímeras de 24 horas.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_PHOTO_MB = parseInt(process.env.MAX_PHOTO_MB || '10', 10);
const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || '100', 10);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
      cb(null, `story-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    }
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('Solo se permiten fotos y videos.'));
  }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

// Historias vigentes agrupadas por usuario (las vencidas se excluyen y se purgan)
router.get('/', (req, res) => {
  db.prepare("DELETE FROM stories WHERE expires_at <= datetime('now')").run();
  const rows = db.prepare(`SELECT s.id, s.media_path, s.media_type, s.created_at, s.expires_at,
    u.id AS uid, u.username, u.name, u.avatar_path
    FROM stories s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > datetime('now')
    ORDER BY s.created_at DESC`).all();
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.uid)) groups.set(r.uid, {
      user: { id: r.uid, username: r.username, name: r.name, avatar_path: r.avatar_path },
      stories: []
    });
    groups.get(r.uid).stories.push({
      id: r.id, media_path: r.media_path, media_type: r.media_type,
      created_at: r.created_at, expires_at: r.expires_at
    });
  }
  res.json({ groups: [...groups.values()] });
});

// Publicar historia (foto o video, dura 24 h)
router.post('/', requireAuth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Adjunta una foto o un video.' });
  const type = req.file.mimetype.startsWith('image/') ? 'photo' : 'video';
  const cap = type === 'photo' ? MAX_PHOTO_MB : MAX_VIDEO_MB;
  if (req.file.size > cap * 1024 * 1024) {
    fs.unlinkSync(req.file.path);
    return res.status(413).json({ error: `El archivo supera el límite (${cap} MB).` });
  }
  const info = db.prepare(
    "INSERT INTO stories (user_id, media_path, media_type, expires_at) VALUES (?,?,?, datetime('now', '+24 hours'))"
  ).run(req.session.userId, '/uploads/' + path.basename(req.file.path), type);
  res.status(201).json({ story: { id: info.lastInsertRowid } });
});

// Borrar historia propia (o admin)
router.delete('/:id', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada.' });
  const me = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (story.user_id !== req.session.userId && me.role !== 'admin')
    return res.status(403).json({ error: 'No tienes permiso.' });
  const f = path.join(UPLOAD_DIR, path.basename(story.media_path));
  fs.unlink(f, () => {});
  db.prepare('DELETE FROM stories WHERE id = ?').run(story.id);
  res.json({ ok: true });
});

module.exports = router;
