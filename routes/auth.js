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

// Campos de la ficha genealógica (persona)
const PERSON_FIELDS = ['nickname', 'maiden_name', 'sex', 'birth_place',
  'baptism_date', 'baptism_place', 'death_date', 'death_place', 'death_cause', 'burial_place',
  'occupation', 'education', 'religion', 'nationality', 'residence',
  'military_service', 'notes'];

function publicUser(u) {
  const p = { id: u.id, username: u.username, name: u.name, avatar_path: u.avatar_path, bio: u.bio, role: u.role, created_at: u.created_at, birthdate: u.birthdate || null, phone: u.phone || null, email: u.email || null, is_deceased: !!u.is_deceased, is_placeholder: !!u.is_placeholder };
  for (const f of PERSON_FIELDS) p[f] = u[f] || null;
  return p;
}

// Limpia y valida los campos de ficha genealógica del body (para PUT /me y admin)
function cleanPersonFields(body) {
  const out = {};
  const str = (v, n) => (v || '').toString().trim().slice(0, n) || null;
  const date = v => /^\d{4}-\d{2}-\d{2}$/.test((v || '').toString()) ? v.toString() : null;
  out.nickname = str(body.nickname, 60);
  out.maiden_name = str(body.maiden_name, 60);
  out.sex = str(body.sex, 20);
  out.birth_place = str(body.birth_place, 120);
  out.baptism_date = date(body.baptism_date);
  out.baptism_place = str(body.baptism_place, 120);
  out.is_deceased = body.is_deceased ? 1 : 0;
  out.death_date = date(body.death_date);
  out.death_place = str(body.death_place, 120);
  out.death_cause = str(body.death_cause, 200);
  out.burial_place = str(body.burial_place, 160);
  out.occupation = str(body.occupation, 120);
  out.education = str(body.education, 120);
  out.religion = str(body.religion, 60);
  out.nationality = str(body.nationality, 60);
  out.residence = str(body.residence, 120);
  out.military_service = str(body.military_service, 200);
  out.notes = str(body.notes, 2000);
  return out;
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

  const code = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1').get(inviteCode.trim().toUpperCase());
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
  // "Mantener sesión iniciada": 30 días; si no, la cookie expira al cerrar el navegador
  if (req.body && req.body.remember === false) {
    req.session.cookie.maxAge = null;
    req.session.cookie.expires = false;
  } else {
    req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
  }
  res.json({ user: publicUser(user) });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

// Reclamar identidad: cuando un familiar se registra con un código y su nombre ya
// está en el árbol como placeholder (sin cuenta), puede seleccionar "soy esta persona".
// Su cuenta nueva se fusiona con el placeholder, heredando sus relaciones.
router.post('/claim', authLimiter, requireAuth, (req, res) => {
  const placeholderId = parseInt((req.body || {}).placeholderId, 10);
  if (!placeholderId) return res.status(400).json({ error: 'Elige la persona que eres.' });
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!me) return res.status(401).json({ error: 'No has iniciado sesión.' });
  if (me.is_placeholder) return res.status(400).json({ error: 'Tu cuenta ya está vinculada.' });
  const ph = db.prepare('SELECT * FROM users WHERE id = ?').get(placeholderId);
  if (!ph || !ph.is_placeholder)
    return res.status(404).json({ error: 'Esa persona ya tiene cuenta o no existe.' });
  if (ph.id === me.id) return res.status(400).json({ error: 'No puedes reclamarte a ti mismo.' });
  // Fusionar: el placeholder adopta las credenciales de la cuenta nueva.
  // Primero se borra la cuenta temporal para liberar el email, luego se activa el placeholder.
  const { name, email, password_hash, avatar_path, bio } = me;
  db.prepare('DELETE FROM users WHERE id = ?').run(me.id);
  db.prepare(`UPDATE users SET name = ?, email = ?, password_hash = ?, is_placeholder = 0,
    avatar_path = COALESCE(avatar_path, ?), bio = COALESCE(NULLIF(bio,''), ?)
    WHERE id = ?`).run(name, email, password_hash, avatar_path, bio, ph.id);
  req.session.userId = ph.id;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(ph.id);
  res.json({ user: publicUser(u) });
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

module.exports = { router, publicUser, issueRecoveryCode, validEmail, cleanPersonFields, PERSON_FIELDS };
