// routes/stories.js — Historias de 24 h (solo fotos) + archivo personal + reacciones.
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { createUpload, UPLOAD_DIR } = require('../upload');

const router = express.Router();

const MAX_PHOTO_MB = parseInt(process.env.MAX_PHOTO_MB || '10', 10);

// Subida segura: solo imágenes en lista cerrada (sin .svg), MIME validado. Sin videos.
const upload = createUpload({
  prefix: 'story',
  maxBytes: MAX_PHOTO_MB * 1024 * 1024,
  allowPhoto: true,
  allowVideo: false
});

const REACTION_EMOJIS = ['❤️', '😂', '🥰', '😮', '🥹', '👏', '😢'];

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

function nowStr() {
  return db.prepare("SELECT datetime('now') n").get().n;
}

// ¿Puede viewerId ver esta historia? (familia + privacidad del archivo si venció)
function canSeeStory(viewerId, story) {
  if (story.user_id === viewerId) return true;
  const myFam = db.getFamilyId(viewerId);
  if (!myFam || story.family_id !== myFam) return false;
  if (story.expires_at <= nowStr()) {
    const owner = db.prepare('SELECT stories_archive_privacy FROM users WHERE id = ?').get(story.user_id);
    if (owner && owner.stories_archive_privacy === 'private') return false;
  }
  return true;
}

// Adjunta conteos de reacciones + mi reacción a una historia
function withReactions(s, myId) {
  const rows = db.prepare('SELECT emoji, COUNT(*) c FROM story_reactions WHERE story_id = ? GROUP BY emoji').all(s.id);
  const counts = {};
  rows.forEach(r => { counts[r.emoji] = r.c; });
  const mine = myId
    ? db.prepare('SELECT emoji FROM story_reactions WHERE story_id = ? AND user_id = ?').get(s.id, myId)
    : null;
  return {
    ...s,
    reactions: counts,
    my_reaction: mine ? mine.emoji : null,
    reaction_count: rows.reduce((a, r) => a + r.c, 0)
  };
}

// Historias vigentes agrupadas por usuario (solo mi familia).
// Las vencidas NO se borran: pasan al archivo personal automáticamente.
router.get('/', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const fid = db.getFamilyId(meId);
  let sql = `SELECT s.id, s.media_path, s.media_type, s.created_at, s.expires_at, s.user_id, s.family_id,
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
    groups.get(r.uid).stories.push(withReactions({
      id: r.id, media_path: r.media_path, media_type: r.media_type,
      created_at: r.created_at, expires_at: r.expires_at
    }, meId));
  }
  res.json({ groups: [...groups.values()] });
});

// Publicar una o varias fotos (máx. 10 por vez). Solo imágenes.
router.post('/', requireAuth, upload.array('media', 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Selecciona al menos una foto.' });
  const fid = db.getFamilyId(req.session.userId);
  const ids = [];
  for (const f of files) {
    const info = db.prepare(
      "INSERT INTO stories (user_id, media_path, media_type, family_id, expires_at) VALUES (?,?,'photo',?, datetime('now', '+24 hours'))"
    ).run(req.session.userId, '/uploads/' + path.basename(f.path), fid);
    ids.push(info.lastInsertRowid);
  }
  // Notificar a la familia (una sola notificación aunque sean varias fotos)
  const author = db.prepare('SELECT name FROM users WHERE id = ?').get(req.session.userId);
  const { sendPushToFamily } = require('../push');
  sendPushToFamily(fid, req.session.userId, {
    title: `✨ ${author.name} publicó ${ids.length > 1 ? 'nuevas fotos' : 'una historia'}`,
    body: 'Míralas antes de que pasen a su archivo',
    url: '/#/feed'
  }).catch(() => {});
  res.status(201).json({ stories: ids.map(id => ({ id })) });
});

// Mi archivo de historias (vencidas). Más recientes primero.
router.get('/archive', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, media_path, media_type, created_at, expires_at, user_id, family_id FROM stories
     WHERE user_id = ? AND expires_at <= datetime('now') ORDER BY created_at DESC`
  ).all(req.session.userId);
  const me = db.prepare('SELECT stories_archive_privacy FROM users WHERE id = ?').get(req.session.userId);
  res.json({
    stories: rows.map(s => withReactions(s, req.session.userId)),
    privacy: me ? me.stories_archive_privacy : 'family'
  });
});

// Archivo de otro miembro (respeta familia y privacidad)
router.get('/archive/:userId', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id, family_id, stories_archive_privacy FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const meId = req.session.userId;
  if (target.id !== meId) {
    const myFam = db.getFamilyId(meId);
    if (!myFam || target.family_id !== myFam) return res.status(403).json({ error: 'No tienes permiso.' });
    if (target.stories_archive_privacy === 'private') return res.status(403).json({ error: 'Su archivo es privado.' });
  }
  const rows = db.prepare(
    `SELECT id, media_path, media_type, created_at, expires_at, user_id, family_id FROM stories
     WHERE user_id = ? AND expires_at <= datetime('now') ORDER BY created_at DESC`
  ).all(target.id);
  res.json({ stories: rows.map(s => withReactions(s, meId)) });
});

// Cambiar la privacidad de mi archivo ('family' o 'private')
router.put('/archive-privacy', requireAuth, (req, res) => {
  const v = (req.body && req.body.privacy) === 'private' ? 'private' : 'family';
  db.prepare('UPDATE users SET stories_archive_privacy = ? WHERE id = ?').run(v, req.session.userId);
  res.json({ privacy: v });
});

// Poner o cambiar mi reacción (una por usuario e historia)
router.post('/:id/react', requireAuth, (req, res) => {
  const emoji = ((req.body && req.body.emoji) || '').toString();
  if (!REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Reacción no válida.' });
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada.' });
  if (!canSeeStory(req.session.userId, story)) return res.status(403).json({ error: 'No tienes permiso.' });
  db.prepare(`INSERT INTO story_reactions (story_id, user_id, emoji) VALUES (?,?,?)
    ON CONFLICT(story_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')`)
    .run(story.id, req.session.userId, emoji);
  res.json({ ok: true, emoji });
});

// Quitar mi reacción
router.delete('/:id/react', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada.' });
  db.prepare('DELETE FROM story_reactions WHERE story_id = ? AND user_id = ?').run(story.id, req.session.userId);
  res.json({ ok: true });
});

// Quién reaccionó y con qué (miembros de la familia)
router.get('/:id/reactions', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada.' });
  if (!canSeeStory(req.session.userId, story)) return res.status(403).json({ error: 'No tienes permiso.' });
  const rows = db.prepare(
    `SELECT r.emoji, r.created_at, u.id AS uid, u.name, u.avatar_path FROM story_reactions r
     JOIN users u ON u.id = r.user_id WHERE r.story_id = ? ORDER BY r.created_at`
  ).all(story.id);
  res.json({ emojis: REACTION_EMOJIS, reactions: rows });
});

// Borrar historia definitivamente (propietario o admin): borra archivo, reacciones y registro
router.delete('/:id', requireAuth, (req, res) => {
  const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (!story) return res.status(404).json({ error: 'Historia no encontrada.' });
  const me = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (story.user_id !== req.session.userId && me.role !== 'admin')
    return res.status(403).json({ error: 'No tienes permiso.' });
  const f = path.join(UPLOAD_DIR, path.basename(story.media_path));
  fs.unlink(f, () => {});
  db.prepare('DELETE FROM story_reactions WHERE story_id = ?').run(story.id);
  db.prepare('DELETE FROM stories WHERE id = ?').run(story.id);
  res.json({ ok: true });
});

module.exports = router;
