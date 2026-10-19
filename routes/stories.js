// routes/stories.js — Historias efímeras de 24 horas.
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { createUpload, UPLOAD_DIR } = require('../upload');

const router = express.Router();

const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || '100', 10);

// Subida segura: extensiones en lista cerrada (sin .svg), MIME validado.
const upload = createUpload({
  prefix: 'story',
  maxBytes: MAX_VIDEO_MB * 1024 * 1024,
  allowPhoto: true,
  allowVideo: true
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

// Historias vigentes agrupadas por usuario (las vencidas se excluyen y se purgan).
// Requiere sesión: las historias familiares son privadas.
router.get('/', requireAuth, (req, res) => {
  db.prepare("DELETE FROM stories WHERE expires_at <= datetime('now')").run();
  const meId = req.session.userId;
  const fid = db.getFamilyId(meId);
  let sql = `SELECT s.id, s.media_path, s.media_type, s.created_at, s.expires_at,
    u.id AS uid, u.username, u.name, u.avatar_path
    FROM stories s JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > datetime('now')`;
  const params = [];
  if (fid) { sql += ' AND s.family_id = ?'; params.push(fid); }
  sql += ' ORDER BY s.created_at DESC';
  const rows = db.prepare(sql).all(...params);
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
  const fid = db.getFamilyId(req.session.userId);
  const info = db.prepare(
    "INSERT INTO stories (user_id, media_path, media_type, family_id, expires_at) VALUES (?,?,?,?, datetime('now', '+24 hours'))"
  ).run(req.session.userId, '/uploads/' + path.basename(req.file.path), type, fid);
  // Notificar a la familia
  const author = db.prepare('SELECT name FROM users WHERE id = ?').get(req.session.userId);
  const { sendPushToFamily } = require('../push');
  sendPushToFamily(fid, req.session.userId, {
    title: `✨ ${author.name} publicó una historia`,
    body: type === 'video' ? 'Mira su video antes de que se borre' : 'Mira su foto antes de que se borre',
    url: '/#/feed'
  }).catch(() => {});
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
