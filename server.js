// server.js — App principal: red social familiar privada (PWA).
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./db');

const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1); // Render/Railway/Nginx

app.use(helmet({
  contentSecurityPolicy: false, // SPA sencilla; se puede endurecer después
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));

// Sesiones persistentes en SQLite (mismo directorio que la BD principal)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'genloria.db');
const SESSION_DIR = path.dirname(DB_PATH);
fs.mkdirSync(SESSION_DIR, { recursive: true });
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-esto-en-produccion';
if (!process.env.SESSION_SECRET && isProd) {
  console.warn('[seguridad] SESSION_SECRET no configurado: usando valor de desarrollo. ¡Configúralo!');
}
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: SESSION_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd, // requiere HTTPS en producción
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
  }
}));

// Archivos subidos
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// Frontend (PWA) — el service worker y el app shell nunca se cachean en HTTP
// para que las actualizaciones se detecten de inmediato
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '1h' : 0,
  setHeaders: (res, filePath) => {
    if (/service-worker\.js$|index\.html$|app\.js$|styles\.js$|manifest\.json$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// API
app.get('/api/version', (req, res) => res.json({ v: 57 }));
app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/posts', require('./routes/feed'));
app.use('/api/stories', require('./routes/stories'));
app.use('/api/tree', require('./routes/tree'));
app.use('/api/export', require('./routes/export'));
app.use('/api/users', require('./routes/users'));
app.use('/api/chat', require('./routes/chat'));

// Manejo de errores de subida
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.message) return res.status(400).json({ error: err.message });
  res.status(500).json({ error: 'Error interno.' });
});

// SPA: cualquier ruta no-API devuelve index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Datos iniciales (solo primera vez) ----
function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'Cambiar123!';
  db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?,?,?,?)')
    .run(adminUser, 'Administrador', bcrypt.hashSync(adminPass, 12), 'admin');
  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser).id;
  // Asignar el admin a la familia por defecto (creada en la migración de db.js)
  const defFam = db.prepare('SELECT id FROM families ORDER BY id LIMIT 1').get();
  if (defFam) {
    db.prepare('UPDATE users SET family_id = ?, role = ? WHERE id = ?').run(defFam.id, 'admin', adminId);
    db.prepare('UPDATE families SET created_by = ? WHERE id = ?').run(adminId, defFam.id);
  }
  const invite = process.env.INVITE_CODE || 'FAMILIA-2026';
  db.prepare('INSERT INTO invite_codes (code, created_by, max_uses, family_id) VALUES (?,?,0,?)')
    .run(invite.toUpperCase(), adminId, defFam ? defFam.id : null);
  console.log('──────────────────────────────────────────────');
  console.log('[init] Cuenta admin creada:');
  console.log(`[init]   usuario: ${adminUser}`);
  console.log('[init]   (contraseña: la de ADMIN_PASS o "Cambiar123!" por defecto)');
  console.log(`[init] Código de invitación inicial: ${invite.toUpperCase()}`);
  console.log('[init] ⚠️  CAMBIA la contraseña del admin y el código en producción.');
  console.log('──────────────────────────────────────────────');
}
seed();

app.listen(PORT, () => {
  console.log(`[app] GENLORIA v1 escuchando en http://localhost:${PORT}`);
});

module.exports = app;
