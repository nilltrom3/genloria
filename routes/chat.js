// routes/chat.js — Chat interno tipo Messenger (1-a-1).
const express = require('express');
const db = require('../db');
const { publicUser } = require('./auth');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

// Buscar o crear conversación 1-a-1 con otro usuario
function getOrCreateConversation(meId, otherId) {
  const existing = db.prepare(`
    SELECT c.id FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
    JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
    WHERE (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
    LIMIT 1`).get(meId, otherId);
  if (existing) return existing.id;
  const info = db.prepare('INSERT INTO conversations DEFAULT VALUES').run();
  const cid = info.lastInsertRowid;
  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(cid, meId);
  db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(cid, otherId);
  return cid;
}

function conversationSummary(cid, meId) {
  const other = db.prepare(`
    SELECT u.* FROM users u
    JOIN conversation_participants p ON p.user_id = u.id
    WHERE p.conversation_id = ? AND u.id != ? LIMIT 1`).get(cid, meId);
  const last = db.prepare(`
    SELECT m.*, u.name AS sender_name FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`).get(cid);
  const unread = db.prepare(`
    SELECT COUNT(*) c FROM messages m
    JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.conversation_id = ? AND m.sender_id != ? AND m.created_at > p.last_read_at`).get(meId, cid, meId).c;
  return {
    id: cid,
    other: other ? publicUser(other) : null,
    lastMessage: last ? { id: last.id, text: last.text, sender_id: last.sender_id, created_at: last.created_at } : null,
    unread
  };
}

// Lista de conversaciones (ordenadas por actividad reciente)
router.get('/conversations', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const rows = db.prepare(`
    SELECT c.id, MAX(m.id) AS last_mid FROM conversations c
    JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ?
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id ORDER BY last_mid DESC NULLS LAST, c.updated_at DESC
    LIMIT 100`).all(meId);
  res.json({ conversations: rows.map(r => conversationSummary(r.id, meId)).filter(c => c.other) });
});

// Iniciar o abrir conversación con un usuario (solo de mi familia)
router.post('/conversations', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const otherId = parseInt((req.body || {}).user_id, 10);
  if (!otherId || otherId === meId) return res.status(400).json({ error: 'Usuario inválido.' });
  const other = db.prepare("SELECT id, family_id FROM users WHERE id = ? AND is_placeholder = 0").get(otherId);
  if (!other) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const myFam = db.getFamilyId(meId);
  if (other.family_id !== myFam) return res.status(403).json({ error: 'Ese usuario no es de tu familia.' });
  const cid = getOrCreateConversation(meId, otherId);
  res.json({ conversation: conversationSummary(cid, meId) });
});

// Mensajes de una conversación (paginado)
router.get('/conversations/:id/messages', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const cid = parseInt(req.params.id, 10);
  const part = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(cid, meId);
  if (!part) return res.status(403).json({ error: 'No tienes acceso a esta conversación.' });
  const before = parseInt(req.query.before, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  let sql = 'SELECT m.id, m.text, m.sender_id, m.created_at, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.conversation_id = ?';
  const params = [cid];
  if (before) { sql += ' AND m.id < ?'; params.push(before); }
  sql += ' ORDER BY m.id DESC LIMIT ?';
  params.push(limit);
  const msgs = db.prepare(sql).all(...params).reverse();
  // Marcar como leído
  db.prepare("UPDATE conversation_participants SET last_read_at = datetime('now') WHERE conversation_id = ? AND user_id = ?").run(cid, meId);
  const other = db.prepare(`
    SELECT u.* FROM users u JOIN conversation_participants p ON p.user_id = u.id
    WHERE p.conversation_id = ? AND u.id != ? LIMIT 1`).get(cid, meId);
  res.json({ messages: msgs, other: other ? publicUser(other) : null });
});

// Enviar mensaje
router.post('/conversations/:id/messages', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const cid = parseInt(req.params.id, 10);
  const part = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(cid, meId);
  if (!part) return res.status(403).json({ error: 'No tienes acceso a esta conversación.' });
  const text = ((req.body || {}).text || '').toString().trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Escribe un mensaje.' });
  const info = db.prepare('INSERT INTO messages (conversation_id, sender_id, text) VALUES (?, ?, ?)').run(cid, meId, text);
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(cid);
  const msg = db.prepare('SELECT m.id, m.text, m.sender_id, m.created_at, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?').get(info.lastInsertRowid);
  // Notificar a los otros participantes
  const others = db.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?').all(cid, meId);
  const { sendPushToUser } = require('../push');
  for (const o of others) {
    sendPushToUser(o.user_id, {
      title: `💬 ${msg.sender_name}`,
      body: text.slice(0, 120),
      url: `/#/chat/${cid}`
    }).catch(() => {});
  }
  res.status(201).json({ message: msg });
});

// Total de no leídos (para el indicador en la navegación)
router.get('/unread', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const c = db.prepare(`
    SELECT COUNT(*) c FROM messages m
    JOIN conversation_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
    WHERE m.sender_id != ? AND m.created_at > p.last_read_at`).get(meId, meId).c;
  res.json({ unread: c });
});

// Cerrar (salir de) una conversación — se elimina para quien la cierra
router.delete('/conversations/:id', requireAuth, (req, res) => {
  const meId = req.session.userId;
  const cid = parseInt(req.params.id, 10);
  const part = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(cid, meId);
  if (!part) return res.status(404).json({ error: 'Conversación no encontrada.' });
  db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').run(cid, meId);
  // Si no quedan participantes, borrar la conversación y sus mensajes
  const remaining = db.prepare('SELECT COUNT(*) c FROM conversation_participants WHERE conversation_id = ?').get(cid).c;
  if (remaining === 0) db.prepare('DELETE FROM conversations WHERE id = ?').run(cid);
  res.json({ ok: true });
});

module.exports = router;
