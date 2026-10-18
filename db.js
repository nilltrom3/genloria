// db.js — Inicialización de SQLite (better-sqlite3) y esquema.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'genloria.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_path TEXT,
  bio TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  family_id INTEGER REFERENCES families(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  max_uses INTEGER NOT NULL DEFAULT 0, -- 0 = ilimitado
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT DEFAULT '',
  media_path TEXT,
  media_type TEXT CHECK (media_type IN ('photo','video')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo','video')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

-- Árbol genealógico
CREATE TABLE IF NOT EXISTS parent_links (
  parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (parent_id, child_id),
  CHECK (parent_id != child_id)
);

CREATE TABLE IF NOT EXISTS couples (
  user1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user1_id, user2_id),
  CHECK (user1_id < user2_id)
);

-- Propuestas de corrección de miembros (las revisa el admin)
CREATE TABLE IF NOT EXISTS tree_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('add_parent','remove_parent','add_couple','remove_couple')),
  user_a_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  user_b_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  note TEXT DEFAULT '',
  proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
`);

// Migración: ficha genealógica completa (persona) — datos básicos + apodo,
// lugares, bautismo, fallecimiento, ocupación, educación, religión,
// nacionalidad, residencia, servicio militar, notas y fuentes.
for (const col of [
  'birthdate', 'phone', 'email',
  'nickname', 'maiden_name', 'sex',
  'birth_place', 'baptism_date', 'baptism_place',
  'death_date', 'death_place', 'death_cause', 'burial_place',
  'occupation', 'education', 'religion', 'nationality', 'residence',
  'military_service', 'notes', 'color'
]) {
  const exists = db.prepare('PRAGMA table_info(users)').all().some(c => c.name === col);
  if (!exists) db.prepare(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT ''`).run();
}

// Migración multi-familia: family_id en users, invite_codes, posts, stories
for (const [tbl] of [['users'], ['invite_codes'], ['posts'], ['stories']]) {
  const exists = db.prepare(`PRAGMA table_info(${tbl})`).all().some(c => c.name === 'family_id');
  if (!exists) db.prepare(`ALTER TABLE ${tbl} ADD COLUMN family_id INTEGER REFERENCES families(id)`).run();
}
// Super-admin de la plataforma (dueño)
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'is_superadmin')) {
  db.prepare('ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0').run();
  // El primer administrador (cuenta original) es el super-admin
  const first = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (first) db.prepare('UPDATE users SET is_superadmin = 1 WHERE id = ?').run(first.id);
}

// Crear familia por defecto y asignar datos existentes
try {
  const famCount = db.prepare('SELECT COUNT(*) n FROM families').get().n;
  if (famCount === 0) {
    const code = 'FAMILIA-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    const fam = db.prepare('INSERT INTO families (name, invite_code, created_by) VALUES (?,?,?)')
      .run('Mi Familia', code, admin ? admin.id : null);
    const fid = fam.lastInsertRowid;
    db.prepare('UPDATE users SET family_id = ? WHERE family_id IS NULL').run(fid);
    db.prepare('UPDATE invite_codes SET family_id = ? WHERE family_id IS NULL').run(fid);
    // Posts y stories heredan la familia de su autor
    db.prepare(`UPDATE posts SET family_id = (SELECT family_id FROM users WHERE users.id = posts.user_id) WHERE family_id IS NULL`).run();
    db.prepare(`UPDATE stories SET family_id = (SELECT family_id FROM users WHERE users.id = stories.user_id) WHERE family_id IS NULL`).run();
    console.log(`[db] Familia por defecto creada (id=${fid}, código=${code}).`);
  }
  // Reparación: posts/stories con family_id NULL (migración anterior usó columna incorrecta)
  const nullPosts = db.prepare('SELECT COUNT(*) c FROM posts WHERE family_id IS NULL').get().c;
  if (nullPosts > 0) {
    db.prepare(`UPDATE posts SET family_id = (SELECT family_id FROM users WHERE users.id = posts.user_id) WHERE family_id IS NULL`).run();
    console.log(`[db] Reparados ${nullPosts} posts sin familia.`);
  }
  const nullStories = db.prepare('SELECT COUNT(*) c FROM stories WHERE family_id IS NULL').get().c;
  if (nullStories > 0) {
    db.prepare(`UPDATE stories SET family_id = (SELECT family_id FROM users WHERE users.id = stories.user_id) WHERE family_id IS NULL`).run();
    console.log(`[db] Reparadas ${nullStories} historias sin familia.`);
  }
} catch (e) { console.error('[db] Error migración multi-familia:', e.message); }
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'is_deceased')) {
  db.prepare('ALTER TABLE users ADD COLUMN is_deceased INTEGER NOT NULL DEFAULT 0').run();
}
// Familiar sin cuenta: persona del árbol que no inicia sesión (ej. antepasado fallecido).
// El admin la crea y mantiene; no puede autenticarse.
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'is_placeholder')) {
  db.prepare('ALTER TABLE users ADD COLUMN is_placeholder INTEGER NOT NULL DEFAULT 0').run();
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
// Migración: tipo de vínculo en parent_links (biológico/adoptivo/acogida) y
// segundo juego de padres; fecha/lugar de matrimonio en couples.
for (const [tbl, col, def] of [
  ['parent_links', 'link_type', "TEXT NOT NULL DEFAULT 'biologico'"],
  ['parent_links', 'link_set', 'INTEGER NOT NULL DEFAULT 1'],
  ['couples', 'marriage_date', 'TEXT'],
  ['couples', 'marriage_place', 'TEXT'],
  ['couples', 'status', "TEXT NOT NULL DEFAULT 'actual'"]
]) {
  const exists = db.prepare(`PRAGMA table_info(${tbl})`).all().some(c => c.name === col);
  if (!exists) db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`).run();
}

// Códigos de recuperación de clave (un solo uso, con vencimiento).
// El admin genera el código y lo comparte; el familiar elige su propia clave.
// El admin nunca ve ni establece claves de otros.
db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+1 day')),
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id)');

// Chat interno tipo Messenger (conversaciones 1-a-1 y mensajes).
db.exec(`CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now', '-1 day')),
  PRIMARY KEY (conversation_id, user_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id)');

// Limpieza periódica de historias vencidas (cada 15 minutos)
setInterval(() => {
  try {
    const r = db.prepare("DELETE FROM stories WHERE expires_at <= datetime('now')").run();
    if (r.changes > 0) console.log(`[db] Historias vencidas eliminadas: ${r.changes}`);
  } catch (e) { console.error('[db] Error limpiando historias:', e.message); }
}, 15 * 60 * 1000).unref();

// Helper: obtiene el family_id del usuario de la sesión (para scoping multi-familia)
db.getFamilyId = function(userId) {
  const u = db.prepare('SELECT family_id FROM users WHERE id = ?').get(userId);
  return u ? u.family_id : null;
};

module.exports = db;
