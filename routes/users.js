// routes/users.js — Perfiles y administración.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { publicUser, issueRecoveryCode, validEmail, cleanPersonFields, PERSON_FIELDS } = require('./auth');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.png';
      cb(null, `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('El avatar debe ser una imagen.'));
  }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}
function requireAdmin(req, res, next) {
  const me = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador.' });
  next();
}

// Ficha de persona por id (para la hoja genealógica)
router.get('/by-id/:id', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Persona no encontrada.' });
  res.json({ user: publicUser(u) });
});

// Ver perfil público + sus publicaciones
router.get('/:username', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const postCount = db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id = ?').get(u.id).c;
  res.json({ user: publicUser(u), postCount });
});

// Editar mi perfil (nombre, bio, avatar)
router.put('/me', requireAuth, avatarUpload.single('avatar'), (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const name = (req.body.name || '').toString().trim().slice(0, 60);
  const bio = (req.body.bio || '').toString().trim().slice(0, 300);
  const birthdate = /^\d{4}-\d{2}-\d{2}$/.test((req.body.birthdate || '').toString()) ? req.body.birthdate.toString() : null;
  const phone = (req.body.phone || '').toString().trim().slice(0, 30) || null;
  const emailRaw = (req.body.email || '').toString().trim().toLowerCase();
  if (name && name.length < 2) return res.status(400).json({ error: 'El nombre es muy corto.' });
  let newEmail = null;
  if (emailRaw) {
    if (!validEmail(emailRaw)) return res.status(400).json({ error: 'Correo electrónico inválido.' });
    const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(emailRaw, me.id);
    if (taken) return res.status(409).json({ error: 'Ese correo ya está en uso.' });
    newEmail = emailRaw;
  }
  let avatar_path = me.avatar_path;
  if (req.file) {
    if (me.avatar_path) fs.unlink(path.join(UPLOAD_DIR, path.basename(me.avatar_path)), () => {});
    avatar_path = '/uploads/' + path.basename(req.file.path);
  }
  const pf = cleanPersonFields(req.body);
  const cols = ['nickname', 'maiden_name', 'sex', 'birth_place', 'baptism_date', 'baptism_place',
    'is_deceased', 'death_date', 'death_place', 'death_cause', 'burial_place',
    'occupation', 'education', 'religion', 'nationality', 'residence', 'military_service', 'notes'];
  db.prepare(`UPDATE users SET name = COALESCE(NULLIF(?, ''), name), bio = ?, avatar_path = ?,
              birthdate = ?, phone = ?, email = COALESCE(?, email),
              ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(name || '', bio, avatar_path, birthdate, phone, newEmail, ...cols.map(c => pf[c]), me.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
  res.json({ user: publicUser(updated) });
});

// Cambiar mi contraseña
router.put('/me/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current || '', me.password_hash))
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  if (typeof next !== 'string' || next.length < 8 || next.length > 72)
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 72 caracteres.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(next, 12), me.id);
  res.json({ ok: true });
});

// ---- Administración ----

// Lista de usuarios
router.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: rows.map(publicUser) });
});

// Crear cuenta directamente (admin)
// Crear cuenta desde el admin: el admin NO establece la clave (privacidad).
// Crea la cuenta con una clave aleatoria inutilizable y devuelve un código de
// configuración de un solo uso para que el familiar elija su propia clave.
router.post('/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email, role } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60)
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
  if (!validEmail(email))
    return res.status(400).json({ error: 'Escribe un correo electrónico válido.' });
  const emailNorm = email.trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm))
    return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  // nombre de usuario interno derivado del correo
  let base = emailNorm.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20) || 'miembro';
  if (base.length < 3) base = (base + '000').slice(0, 3);
  let username = base, i = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = `${base}${i++}`;
  const unusable = bcrypt.hashSync(require('crypto').randomBytes(32).toString('hex'), 10);
  const info = db.prepare('INSERT INTO users (username, name, email, password_hash, role) VALUES (?,?,?,?,?)')
    .run(username, name.trim(), emailNorm, unusable, role === 'admin' ? 'admin' : 'member');
  const setupCode = issueRecoveryCode(db, info.lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(u), setupCode });
});

// Crear familiar (persona del árbol, con o sin cuenta).
// Si `with_account` es falsy se crea como placeholder: no inicia sesión.
router.post('/admin/people', requireAuth, requireAdmin, avatarUpload.single('photo'), (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (name.length < 2 || name.length > 80)
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  const withAccount = b.with_account === '1' || b.with_account === true;
  let emailNorm = null;
  if (withAccount) {
    emailNorm = (b.email || '').toString().trim().toLowerCase();
    if (!validEmail(emailNorm)) return res.status(400).json({ error: 'Correo electrónico inválido.' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm))
      return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  }
  let base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 20) || 'familiar';
  if (base.length < 3) base = (base + '000').slice(0, 3);
  let username = base, i = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = `${base}${i++}`;
  const unusable = bcrypt.hashSync(require('crypto').randomBytes(32).toString('hex'), 10);
  const pf = cleanPersonFields(b);
  const birthdate = /^\d{4}-\d{2}-\d{2}$/.test((b.birthdate || '').toString()) ? b.birthdate.toString() : null;
  const cols = ['nickname', 'maiden_name', 'sex', 'birth_place', 'baptism_date', 'baptism_place',
    'is_deceased', 'death_date', 'death_place', 'death_cause', 'burial_place',
    'occupation', 'education', 'religion', 'nationality', 'residence', 'military_service', 'notes'];
  const avatar_path = req.file ? '/uploads/' + path.basename(req.file.path) : null;
  const info = db.prepare(`INSERT INTO users
    (username, name, email, password_hash, role, is_placeholder, avatar_path, bio, birthdate, phone, ${cols.join(', ')})
    VALUES (?,?,?,?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`)
    .run(username, name, emailNorm, unusable, 'member', withAccount ? 0 : 1, avatar_path,
      (b.bio || '').toString().trim().slice(0, 300),
      birthdate, (b.phone || '').toString().trim().slice(0, 30) || null,
      ...cols.map(c => pf[c]));
  const newId = info.lastInsertRowid;
  const linkErrs = [];
  const lt = ['biologico', 'adoptivo', 'acogida'].includes(b.link_type) ? b.link_type : 'biologico';
  for (const pid of [b.father_id, b.mother_id]) {
    const p = parseInt(pid, 10);
    if (!p) continue;
    const err = require('./tree').addParentLink(p, newId, lt, 1);
    if (err) linkErrs.push(err);
  }
  const ap = parseInt(b.partner_id, 10);
  if (ap) {
    const err = require('./tree').addCouple(newId, ap, { marriage_date: b.marriage_date, marriage_place: b.marriage_place, status: 'actual' });
    if (err) linkErrs.push(err);
  }
  let setupCode = null;
  if (withAccount) setupCode = issueRecoveryCode(db, newId);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(newId);
  res.status(201).json({ user: publicUser(u), setupCode, linkErrs });
});

// Crear un familiar sin cuenta (placeholder) — cualquier miembro autenticado.
// Sirve para agregar al árbol a familiares que aún no tienen cuenta, para invitarlos después.
router.post('/people', requireAuth, (req, res) => {
  const name = ((req.body || {}).name || '').toString().trim();
  if (name.length < 2 || name.length > 80)
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  let base = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 20) || 'familiar';
  if (base.length < 3) base = (base + '000').slice(0, 3);
  let username = base, i = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) username = `${base}${i++}`;
  const unusable = bcrypt.hashSync(require('crypto').randomBytes(32).toString('hex'), 10);
  const info = db.prepare(`INSERT INTO users (username, name, email, password_hash, role, is_placeholder)
    VALUES (?,?,NULL,?,?,?)`).run(username, name, unusable, 'member', 1);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(u) });
});

// Editar ficha de cualquier persona (admin)
router.put('/admin/users/:id', requireAuth, requireAdmin, avatarUpload.single('photo'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Persona no encontrada.' });
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (name && (name.length < 2 || name.length > 80))
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  const pf = cleanPersonFields(b);
  const birthdate = /^\d{4}-\d{2}-\d{2}$/.test((b.birthdate || '').toString()) ? b.birthdate.toString() : null;
  const cols = ['nickname', 'maiden_name', 'sex', 'birth_place', 'baptism_date', 'baptism_place',
    'is_deceased', 'death_date', 'death_place', 'death_cause', 'burial_place',
    'occupation', 'education', 'religion', 'nationality', 'residence', 'military_service', 'notes'];
  let avatar_path = target.avatar_path;
  if (req.file) {
    if (target.avatar_path) fs.unlink(path.join(UPLOAD_DIR, path.basename(target.avatar_path)), () => {});
    avatar_path = '/uploads/' + path.basename(req.file.path);
  }
  db.prepare(`UPDATE users SET name = COALESCE(NULLIF(?, ''), name),
    bio = COALESCE(?, bio), avatar_path = ?, birthdate = COALESCE(?, birthdate),
    phone = COALESCE(?, phone), ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(name || '', (b.bio || '').toString().trim().slice(0, 300) || null, avatar_path,
      birthdate, (b.phone || '').toString().trim().slice(0, 30) || null,
      ...cols.map(c => pf[c]), target.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  res.json({ user: publicUser(updated) });
});

// Eliminar persona (admin; no puede eliminarse a sí mismo)
router.delete('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, role, avatar_path FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Persona no encontrada.' });
  if (target.id === req.session.userId)
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  if (target.avatar_path) fs.unlink(path.join(UPLOAD_DIR, path.basename(target.avatar_path)), () => {});
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

// Generar código de recuperación para un miembro (el admin lo comparte;
// el familiar elige su propia clave — el admin nunca la ve ni entra a su cuenta)
router.post('/admin/users/:id/recovery-code', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.id === req.session.userId)
    return res.status(400).json({ error: 'Para tu propia cuenta usa "Editar mi perfil".' });
  const code = issueRecoveryCode(db, target.id);
  res.json({ userId: target.id, name: target.name, code });
});

// Crear código de invitación
router.post('/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  const { code, maxUses } = req.body || {};
  const finalCode = (code || '').toString().trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32)
    || ('FAM-' + Math.random().toString(36).slice(2, 8).toUpperCase());
  try {
    const info = db.prepare('INSERT INTO invite_codes (code, created_by, max_uses) VALUES (?,?,?)')
      .run(finalCode, req.session.userId, Math.max(0, parseInt(maxUses || '0', 10)));
    res.status(201).json({ inviteCode: db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) {
    res.status(409).json({ error: 'Ese código ya existe.' });
  }
});

// Lista de códigos
router.get('/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  res.json({ codes: db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC').all() });
});

// Desactivar código
router.delete('/admin/invite-codes/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('UPDATE invite_codes SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
