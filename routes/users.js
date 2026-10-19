// routes/users.js — Perfiles y administración.
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { publicUser, issueRecoveryCode, validEmail, cleanPersonFields, PERSON_FIELDS } = require('./auth');
const { createUpload, UPLOAD_DIR } = require('../upload');
const emailer = require('../email');
const pushlib = require('../push');

// Mis suscripciones push (diagnóstico): tipo de servicio y fecha, sin exponer claves
const router = express.Router();

router.get('/push-status', requireAuth, (req, res) => {
  const subs = db.prepare('SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  res.json({
    permission: 'desconocido-desde-servidor',
    subscriptions: subs.map(s => {
      let host = '';
      try { host = new URL(s.endpoint).host; } catch {}
      const type = /fcm.googleapis.com/.test(s.endpoint) ? 'Android/Chrome (FCM)'
        : /web.push.apple.com/.test(s.endpoint) ? 'iPhone/iPad (APNs)'
        : /updates.push.services.mozilla.com/.test(s.endpoint) ? 'Firefox'
        : host || 'otro';
      return { id: s.id, type, host, created_at: s.created_at };
    })
  });
});

// Eliminar una de mis suscripciones push (diagnóstico)
router.delete('/push-subscriptions/:id', requireAuth, (req, res) => {
  const r = db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  if (!r.changes) return res.status(404).json({ error: 'No encontrada.' });
  res.json({ ok: true });
});

// Enviarme un push de prueba a cada una de mis suscripciones (diagnóstico, no borra nada)
router.post('/push-test', requireAuth, async (req, res) => {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(req.session.userId);
  const results = [];
  for (const s of subs) {
    let host = '';
    try { host = new URL(s.endpoint).host; } catch {}
    const type = /fcm.googleapis.com/.test(s.endpoint) ? 'Android/Chrome (FCM)'
      : /web.push.apple.com/.test(s.endpoint) ? 'iPhone/iPad (APNs)'
      : host || 'otro';
    const r = await pushlib.testPushToSubscription(s);
    results.push({ id: s.id, type, ...r });
    await new Promise(r2 => setTimeout(r2, 300));
  }
  res.json({ total: subs.length, results });
});


// Subida segura de avatares: solo imágenes en lista cerrada (sin .svg), MIME validado.
const avatarUpload = createUpload({
  prefix: 'avatar',
  maxBytes: 5 * 1024 * 1024,
  allowPhoto: true,
  allowVideo: false
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

// Ficha de persona por id (para la hoja genealógica) — solo mi familia
router.get('/by-id/:id', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Persona no encontrada.' });
  const myFam = db.getFamilyId(req.session.userId);
  if (u.family_id !== myFam) return res.status(403).json({ error: 'No tienes permiso.' });
  res.json({ user: publicUser(u) });
});

// Ver perfil + sus publicaciones — solo miembros de mi familia
router.get('/:username', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const myFam = db.getFamilyId(req.session.userId);
  if (u.family_id !== myFam) return res.status(403).json({ error: 'No tienes permiso.' });
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
    'occupation', 'education', 'religion', 'nationality', 'residence', 'military_service', 'notes', 'color'];
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
  const fid = db.getFamilyId(req.session.userId);
  const rows = db.prepare('SELECT * FROM users WHERE family_id = ? ORDER BY created_at DESC').all(fid);
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
  const fid = db.getFamilyId(req.session.userId);
  const info = db.prepare('INSERT INTO users (username, name, email, password_hash, role, family_id) VALUES (?,?,?,?,?,?)')
    .run(username, name.trim(), emailNorm, unusable, role === 'admin' ? 'admin' : 'member', fid);
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
  const fid = db.getFamilyId(req.session.userId);
  const info = db.prepare(`INSERT INTO users
    (username, name, email, password_hash, role, is_placeholder, avatar_path, bio, birthdate, phone, family_id, ${cols.join(', ')})
    VALUES (?,?,?,?,?,?,?,?,?,?,?,${cols.map(() => '?').join(',')})`)
    .run(username, name, emailNorm, unusable, 'member', withAccount ? 0 : 1, avatar_path,
      (b.bio || '').toString().trim().slice(0, 300),
      birthdate, (b.phone || '').toString().trim().slice(0, 30) || null, fid,
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
  const fid = db.getFamilyId(req.session.userId);
  const info = db.prepare(`INSERT INTO users (username, name, email, password_hash, role, is_placeholder, family_id)
    VALUES (?,?,NULL,?,?,?,?)`).run(username, name, unusable, 'member', 1, fid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ user: publicUser(u) });
});

// Editar ficha de cualquier persona (admin de MI familia)
router.put('/admin/users/:id', requireAuth, requireAdmin, avatarUpload.single('photo'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Persona no encontrada.' });
  const myFam = db.getFamilyId(req.session.userId);
  if (target.family_id !== myFam)
    return res.status(403).json({ error: 'Esa persona no es de tu familia.' });
  const b = req.body || {};
  const name = (b.name || '').toString().trim();
  if (name && (name.length < 2 || name.length > 80))
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
  const pf = cleanPersonFields(b);
  const birthdate = /^\d{4}-\d{2}-\d{2}$/.test((b.birthdate || '').toString()) ? b.birthdate.toString() : null;
  const cols = ['nickname', 'maiden_name', 'sex', 'birth_place', 'baptism_date', 'baptism_place',
    'is_deceased', 'death_date', 'death_place', 'death_cause', 'burial_place',
    'occupation', 'education', 'religion', 'nationality', 'residence', 'military_service', 'notes', 'color'];
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

// Eliminar persona (admin de MI familia; no puede eliminarse a sí mismo)
// Borra la cuenta y, por CASCADE, sus publicaciones, likes, comentarios,
// historias y parentescos. También borra sus archivos subidos.
router.delete('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, role, avatar_path, family_id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Persona no encontrada.' });
  if (target.id === req.session.userId)
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
  const myFam = db.getFamilyId(req.session.userId);
  if (target.family_id !== myFam)
    return res.status(403).json({ error: 'Esa persona no es de tu familia.' });
  const media = db.prepare(`SELECT media_path FROM posts WHERE user_id = ?
                            UNION SELECT media_path FROM stories WHERE user_id = ?`)
    .all(target.id, target.id);
  for (const m of media) {
    if (m.media_path) fs.unlink(path.join(UPLOAD_DIR, path.basename(m.media_path)), () => {});
  }
  if (target.avatar_path) fs.unlink(path.join(UPLOAD_DIR, path.basename(target.avatar_path)), () => {});
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

// Cambiar rol de un miembro (hacer/quitar administrador de la familia)
router.put('/admin/users/:id/role', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, role, family_id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Persona no encontrada.' });
  if (target.id === req.session.userId)
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' });
  const myFam = db.getFamilyId(req.session.userId);
  if (target.family_id !== myFam)
    return res.status(403).json({ error: 'Esa persona no es de tu familia.' });
  const newRole = (req.body || {}).role === 'admin' ? 'admin' : 'member';
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, target.id);
  res.json({ ok: true, role: newRole });
});

// Generar código de recuperación para un miembro (el admin lo comparte;
// el familiar elige su propia clave — el admin nunca la ve ni entra a su cuenta)
router.post('/admin/users/:id/recovery-code', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, name, family_id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (target.id === req.session.userId)
    return res.status(400).json({ error: 'Para tu propia cuenta usa "Editar mi perfil".' });
  const me = db.prepare('SELECT is_superadmin, family_id FROM users WHERE id = ?').get(req.session.userId);
  if (!me.is_superadmin && target.family_id !== me.family_id)
    return res.status(403).json({ error: 'Esa persona no es de tu familia.' });
  const code = issueRecoveryCode(db, target.id);
  res.json({ userId: target.id, name: target.name, code });
});

// ---- Super-admin: estadísticas de toda la plataforma ----
function requireSuperAdmin(req, res, next) {
  const me = db.prepare('SELECT is_superadmin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_superadmin) return res.status(403).json({ error: 'Solo el administrador de la plataforma.' });
  next();
}

router.get('/platform/stats', requireAuth, requireSuperAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalFamilies = db.prepare('SELECT COUNT(*) c FROM families').get().c;
  const totalPosts = db.prepare('SELECT COUNT(*) c FROM posts').get().c;
  const perFamily = db.prepare(`
    SELECT f.id, f.name, f.invite_code, f.created_at,
           COUNT(u.id) AS members,
           SUM(CASE WHEN u.role = 'admin' THEN 1 ELSE 0 END) AS admins
    FROM families f LEFT JOIN users u ON u.family_id = f.id
    GROUP BY f.id ORDER BY f.created_at DESC`).all();
  // Registros por día (últimos 30 días)
  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n
    FROM users WHERE created_at >= date('now', '-30 days')
    GROUP BY day ORDER BY day`).all();
  res.json({ totalUsers, totalFamilies, totalPosts, perFamily, byDay });
});

router.get('/platform/users', requireAuth, requireSuperAdmin, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  let sql = `SELECT u.id, u.name, u.email, u.role, u.is_superadmin, u.created_at, f.name AS family_name
             FROM users u LEFT JOIN families f ON f.id = u.family_id`;
  const params = [];
  if (q) { sql += ' WHERE u.name LIKE ? OR u.email LIKE ?'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY u.created_at DESC LIMIT 200';
  res.json({ users: db.prepare(sql).all(...params) });
});
router.post('/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  const { code, maxUses } = req.body || {};
  const myFam = db.getFamilyId(req.session.userId);
  const finalCode = (code || '').toString().trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32)
    || ('FAM-' + crypto.randomBytes(4).toString('hex').toUpperCase());
  try {
    const info = db.prepare('INSERT INTO invite_codes (code, created_by, max_uses, family_id) VALUES (?,?,?,?)')
      .run(finalCode, req.session.userId, Math.max(0, parseInt(maxUses || '0', 10)), myFam);
    res.status(201).json({ inviteCode: db.prepare('SELECT * FROM invite_codes WHERE id = ?').get(info.lastInsertRowid) });
  } catch (e) {
    res.status(409).json({ error: 'Ese código ya existe.' });
  }
});

// Lista de códigos (solo de mi familia)
router.get('/admin/invite-codes', requireAuth, requireAdmin, (req, res) => {
  const myFam = db.getFamilyId(req.session.userId);
  res.json({ codes: db.prepare('SELECT * FROM invite_codes WHERE family_id = ? ORDER BY created_at DESC').all(myFam) });
});

// Desactivar código (solo de mi familia)
router.delete('/admin/invite-codes/:id', requireAuth, requireAdmin, (req, res) => {
  const myFam = db.getFamilyId(req.session.userId);
  const code = db.prepare('SELECT id FROM invite_codes WHERE id = ? AND family_id = ?').get(req.params.id, myFam);
  if (!code) return res.status(404).json({ error: 'Código no encontrado.' });
  db.prepare('UPDATE invite_codes SET active = 0 WHERE id = ?').run(code.id);
  res.json({ ok: true });
});

// Enviar correo de bienvenida personalizado (nombre + familia de CADA persona).
// Alcance: 'family' (mi familia, cualquier admin) o 'platform' (toda la plataforma, solo superadmin).
router.post('/admin/broadcast-welcome', requireAuth, requireAdmin, async (req, res) => {
  if (!emailer.configured()) return res.status(400).json({ error: 'El servicio de correo no está configurado.' });
  const me = db.prepare('SELECT is_superadmin FROM users WHERE id = ?').get(req.session.userId);
  const scope = (req.body && req.body.scope === 'platform' && me && me.is_superadmin) ? 'platform' : 'family';
  let members;
  if (scope === 'platform') {
    members = db.prepare("SELECT id, name, email, family_id FROM users WHERE email IS NOT NULL AND TRIM(email) != ''").all();
  } else {
    const myFam = db.getFamilyId(req.session.userId);
    members = db.prepare("SELECT id, name, email, family_id FROM users WHERE family_id = ? AND email IS NOT NULL AND TRIM(email) != ''").all(myFam);
  }
  // Nombre de la familia de CADA destinatario (no uno solo para todos)
  const famNames = {};
  function famName(fid) {
    if (!(fid in famNames)) {
      const f = db.prepare('SELECT name FROM families WHERE id = ?').get(fid);
      famNames[fid] = f ? f.name : 'tu familia';
    }
    return famNames[fid];
  }
  let sent = 0, failed = 0;
  const failures = [];
  for (const m of members) {
    const w = emailer.welcomeEmail(m.name, famName(m.family_id));
    const r = await emailer.sendEmail({ to: m.email, subject: w.subject, html: w.html });
    if (r.ok) sent++; else { failed++; failures.push(m.email); }
    await new Promise(r2 => setTimeout(r2, 400));
  }
  res.json({ total: members.length, sent, failed, failures, scope });
});

// Enviarme una muestra del correo de bienvenida a mi propio correo (solo admin)
router.post('/admin/test-welcome', requireAuth, requireAdmin, async (req, res) => {
  if (!emailer.configured()) return res.status(400).json({ error: 'El servicio de correo no está configurado.' });
  const me = db.prepare('SELECT name, email, family_id FROM users WHERE id = ?').get(req.session.userId);
  if (!me.email || !me.email.trim()) return res.status(400).json({ error: 'Tu cuenta no tiene correo registrado.' });
  const fam = db.prepare('SELECT name FROM families WHERE id = ?').get(me.family_id);
  const msg = emailer.welcomeEmail(me.name, fam ? fam.name : null);
  const r = await emailer.sendEmail({ to: me.email.trim(), subject: '[MUESTRA] ' + msg.subject, html: msg.html });
  if (!r.ok) return res.status(500).json({ error: 'No se pudo enviar la muestra.' });
  res.json({ ok: true, to: me.email.trim() });
});

// Conteo de destinatarios para la pestaña Correos
router.get('/admin/broadcast-counts', requireAuth, requireAdmin, (req, res) => {
  const me = db.prepare('SELECT is_superadmin FROM users WHERE id = ?').get(req.session.userId);
  const myFam = db.getFamilyId(req.session.userId);
  const family = db.prepare("SELECT COUNT(*) c FROM users WHERE family_id = ? AND email IS NOT NULL AND TRIM(email) != ''").get(myFam).c;
  let platform = null;
  if (me && me.is_superadmin) {
    platform = db.prepare("SELECT COUNT(*) c FROM users WHERE email IS NOT NULL AND TRIM(email) != ''").get().c;
  }
  res.json({ family, platform });
});

module.exports = router;
