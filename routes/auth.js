// routes/auth.js — Registro con código de invitación, login, logout.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' }
});

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, avatar_path: u.avatar_path, bio: u.bio, role: u.role, created_at: u.created_at, birthdate: u.birthdate || null, phone: u.phone || null, email: u.email || null };
}

function validUsername(v) {
  return typeof v === 'string' && /^[a-zA-Z0-9._-]{3,24}$/.test(v);
}

const crypto = require('crypto');

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) && email.trim().length <= 120;
}

// Nombre de usuario interno (para menciones/enlaces) derivado del correo o nombre
function deriveUsername(db, email, name) {
  let base = (String(email).split('@')[0] || String(name)).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '').slice(0, 20) || 'miembro';
  if (base.length < 3) base = (base + '000').slice(0, 3);
  let u = base, i = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(u)) u = `${base}${i++}`;
  return u;
}

// Genera un código de recuperación de un solo uso (válido 24h) y devuelve el código en claro UNA vez
function issueRecoveryCode(db, userId) {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  const codeHash = bcrypt.hashSync(code, 10);
  db.prepare(`INSERT INTO password_resets (user_id, code_hash, expires_at)
              VALUES (?, ?, datetime('now', '+1 day'))`).run(userId, codeHash);
  return code;
}
function findValidReset(db, code) {
  if (typeof code !== 'string' || !code.trim()) return null;
  const rows = db.prepare(`SELECT pr.*, u.id AS uid FROM password_resets pr
                           JOIN users u ON u.id = pr.user_id
                           WHERE pr.used = 0 AND pr.expires_at > datetime('now')`).all();
  for (const r of rows) {
    try { if (bcrypt.compareSync(code.trim().toUpperCase(), r.code_hash)) return r; } catch (e) {}
  }
  return null;
}

// Registro — requiere código de invitación válido. Cada familiar elige su propia clave.
router.post('/register', authLimiter, (req, res) => {
  const { name, email, password, inviteCode } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60)
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  if (!validEmail(email))
    return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 72)
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  if (typeof inviteCode !== 'string' || !inviteCode.trim())
    return res.status(400).json({ error: 'Se requiere un código de invitación.' });

  const code = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1').get(inviteCode.trim());
  if (!code) return res.status(403).json({ error: 'Código de invitación inválido o desactivado.' });
  if (code.max_uses > 0 && code.used_count >= code.max_uses)
    return res.status(403).json({ error: 'Este código de invitación ya se agotó.' });

  const emailNorm = email.trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm);
  if (exists) return res.status(409).json({ error: 'Ese correo ya está registrado.' });

  const username = deriveUsername(db, emailNorm, name.trim());
  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO users (username, name, email, password_hash) VALUES (?,?,?,?)')
    .run(username, name.trim(), emailNorm, hash);
  db.prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?').run(code.id);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.userId = user.id;
  res.status(201).json({ user: publicUser(user) });
});

// Login con correo electrónico (o usuario, por compatibilidad)
router.post('/login', authLimiter, (req, res) => {
  const { email, username, password } = req.body || {};
  const identifier = String(email || username || '').trim();
  if (!identifier || typeof password !== 'string')
    return res.status(400).json({ error: 'Faltan credenciales.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?')
    .get(identifier.toLowerCase(), identifier);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

// Recuperar clave con código de un solo uso (lo genera el admin y lo comparte;
// el familiar elige su propia clave nueva — el admin nunca la ve)
router.post('/recover', authLimiter, (req, res) => {
  const { code, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72)
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
  const reset = findValidReset(db, code);
  if (!reset) return res.status(400).json({ error: 'Código inválido o vencido. Pide uno nuevo al administrador.' });
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.uid);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  res.json({ ok: true });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Sesión actual
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Sesión inválida.' });
  res.json({ user: publicUser(user) });
});

module.exports = { router, publicUser, issueRecoveryCode, validEmail };
