// routes/feed.js — Publicaciones, likes y comentarios.
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { publicUser } = require('./auth');
const { createUpload, UPLOAD_DIR } = require('../upload');
const router = express.Router();

const MAX_PHOTO_MB = parseInt(process.env.MAX_PHOTO_MB || '10', 10);
const MAX_VIDEO_MB = parseInt(process.env.MAX_VIDEO_MB || '100', 10);

// Subida segura: extensiones en lista cerrada (sin .svg), MIME validado,
// nombre generado por el servidor.
const upload = createUpload({
  prefix: 'post',
  maxBytes: MAX_VIDEO_MB * 1024 * 1024, // el límite fino se valida por tipo
  allowPhoto: true,
  allowVideo: false
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

function mediaTypeOf(mimetype) {
  if (mimetype.startsWith('image/')) return 'photo';
  if (mimetype.startsWith('video/')) return 'video';
  return null;
}

function enrichPost(row, meId) {
  const likeCount = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(row.post_id).c;
  const commentCount = db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id = ?').get(row.post_id).c;
  const liked = meId ? !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(row.post_id, meId) : false;
  return {
    id: row.post_id,
    text: row.text,
    media_path: row.media_path,
    media_type: row.media_type,
    created_at: row.created_at,
    likeCount, commentCount, liked,
    author: { id: row.uid, username: row.username, name: row.name, avatar_path: row.avatar_path }
  };
}

// Feed: publicaciones recientes con autor, likes y conteo de comentarios (solo mi familia).
// Requiere sesión: las publicaciones familiares son privadas.
router.get('/', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const fid = db.getFamilyId(meId);
  const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);
  const before = req.query.before; // paginación por fecha
  let sql = `SELECT p.id AS post_id, p.text, p.media_path, p.media_type, p.created_at,
             u.id AS uid, u.username, u.name, u.avatar_path
             FROM posts p JOIN users u ON u.id = p.user_id`;
  const params = [];
  const wheres = [];
  if (fid) { wheres.push('p.family_id = ?'); params.push(fid); }
  if (before) { wheres.push('p.created_at < ?'); params.push(before); }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params);
  res.json({ posts: rows.map(r => enrichPost(r, meId)) });
});

// Crear publicación (texto y/o foto/video)
router.post('/', requireAuth, upload.single('media'), (req, res) => {
  const text = (req.body.text || '').toString().slice(0, 2000).trim();
  let media_path = null, media_type = null;
  if (req.file) {
    const type = mediaTypeOf(req.file.mimetype);
    const cap = type === 'photo' ? MAX_PHOTO_MB : MAX_VIDEO_MB;
    if (req.file.size > cap * 1024 * 1024) {
      fs.unlinkSync(req.file.path);
      return res.status(413).json({ error: `El archivo supera el límite (${cap} MB).` });
    }
    media_path = '/uploads/' + path.basename(req.file.path);
    media_type = type;
  }
  if (!text && !media_path) return res.status(400).json({ error: 'Escribe algo o adjunta una foto/video.' });
  const fid = db.getFamilyId(req.session.userId);
  const info = db.prepare('INSERT INTO posts (user_id, text, media_path, media_type, family_id) VALUES (?,?,?,?,?)')
    .run(req.session.userId, text, media_path, media_type, fid);
  // Notificar a la familia
  const author = db.prepare('SELECT name FROM users WHERE id = ?').get(req.session.userId);
  const { sendPushToFamily } = require('../push');
  sendPushToFamily(fid, req.session.userId, {
    title: `📸 ${author.name} publicó algo nuevo`,
    body: text.slice(0, 120) || 'Mira lo que compartió en la familia',
    url: '/#/feed'
  }).catch(() => {});
  const row = db.prepare(`SELECT p.id AS post_id, p.text, p.media_path, p.media_type, p.created_at,
                          u.id AS uid, u.username, u.name, u.avatar_path
                          FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`)
    .get(info.lastInsertRowid);
  res.status(201).json({ post: enrichPost(row, req.session.userId) });
});

// Borrar publicación (autor o admin)
// Editar texto de publicación (autor o admin)
router.put('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
  const me = db.prepare('SELECT role, family_id FROM users WHERE id = ?').get(req.session.userId);
  if (post.family_id !== me.family_id)
    return res.status(403).json({ error: 'No tienes permiso.' });
  if (post.user_id !== req.session.userId && me.role !== 'admin')
    return res.status(403).json({ error: 'No tienes permiso.' });
  const text = (req.body.text || '').toString().trim().slice(0, 2000);
  db.prepare('UPDATE posts SET text = ? WHERE id = ?').run(text, post.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
  const me = db.prepare('SELECT role, family_id FROM users WHERE id = ?').get(req.session.userId);
  if (post.family_id !== me.family_id)
    return res.status(403).json({ error: 'No tienes permiso.' });
  if (post.user_id !== req.session.userId && me.role !== 'admin')
    return res.status(403).json({ error: 'No tienes permiso.' });
  if (post.media_path) {
    const f = path.join(UPLOAD_DIR, path.basename(post.media_path));
    fs.unlink(f, () => {});
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

// Like / unlike (toggle)
router.post('/:id/like', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, family_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
  const fid = db.getFamilyId(req.session.userId);
  if (post.family_id !== fid) return res.status(403).json({ error: 'No tienes permiso.' });
  const existing = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.session.userId);
  if (existing) db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(post.id, req.session.userId);
  else db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?,?)').run(post.id, req.session.userId);
  const likeCount = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id = ?').get(post.id).c;
  res.json({ liked: !existing, likeCount });
});

// Comentarios de una publicación (solo mi familia)
router.get('/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT family_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
  if (post.family_id !== db.getFamilyId(req.session.userId))
    return res.status(403).json({ error: 'No tienes permiso.' });
  const rows = db.prepare(`SELECT c.id, c.text, c.created_at, u.id AS uid, u.username, u.name, u.avatar_path
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC`).all(req.params.id);
  res.json({ comments: rows.map(r => ({
    id: r.id, text: r.text, created_at: r.created_at,
    author: { id: r.uid, username: r.username, name: r.name, avatar_path: r.avatar_path }
  })) });
});

// Comentar
router.post('/:id/comments', requireAuth, (req, res) => {
  const post = db.prepare('SELECT id, family_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
  const fid = db.getFamilyId(req.session.userId);
  if (post.family_id !== fid) return res.status(403).json({ error: 'No tienes permiso.' });
  const text = (req.body.text || '').toString().trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'El comentario no puede estar vacío.' });
  const info = db.prepare('INSERT INTO comments (post_id, user_id, text) VALUES (?,?,?)')
    .run(post.id, req.session.userId, text);
  res.status(201).json({ comment: { id: info.lastInsertRowid, text, post_id: post.id } });
});

module.exports = router;
