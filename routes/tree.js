// routes/tree.js — Árbol genealógico familiar.
// Permisos: el administrador gestiona la estructura; los miembros pueden
// proponer correcciones que el admin aprueba o rechaza.
const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}
function requireAdmin(req, res, next) {
  const me = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
  if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador.' });
  next();
}

function userExists(id) {
  return !!db.prepare('SELECT id FROM users WHERE id = ?').get(id);
}

// Ancestros de una persona (para evitar ciclos)
function ancestorsOf(id) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    const parents = db.prepare('SELECT parent_id FROM parent_links WHERE child_id = ?').all(cur);
    for (const p of parents) {
      if (!seen.has(p.parent_id)) { seen.add(p.parent_id); stack.push(p.parent_id); }
    }
  }
  return seen;
}

function addParentLink(parentId, childId) {
  parentId = parseInt(parentId, 10); childId = parseInt(childId, 10);
  if (!userExists(parentId) || !userExists(childId)) return 'Una de las personas no existe.';
  if (parentId === childId) return 'Una persona no puede ser su propio padre/madre.';
  if (db.prepare('SELECT 1 FROM parent_links WHERE parent_id = ? AND child_id = ?').get(parentId, childId))
    return 'Esa relación ya está registrada.';
  if (ancestorsOf(parentId).has(childId)) return 'Eso crearía un ciclo en el árbol.';
  db.prepare('INSERT INTO parent_links (parent_id, child_id) VALUES (?,?)').run(parentId, childId);
  return null;
}

function addCouple(a, b) {
  a = parseInt(a, 10); b = parseInt(b, 10);
  if (!userExists(a) || !userExists(b)) return 'Una de las personas no existe.';
  if (a === b) return 'Debe ser otra persona.';
  const [u1, u2] = a < b ? [a, b] : [b, a];
  if (db.prepare('SELECT 1 FROM couples WHERE user1_id = ? AND user2_id = ?').get(u1, u2))
    return 'Esa pareja ya está registrada.';
  const busy = db.prepare('SELECT 1 FROM couples WHERE user1_id = ? OR user2_id = ? OR user1_id = ? OR user2_id = ?')
    .get(a, a, b, b);
  if (busy) return 'Una de esas personas ya tiene pareja registrada.';
  db.prepare('INSERT INTO couples (user1_id, user2_id) VALUES (?,?)').run(u1, u2);
  return null;
}

// ---- Lectura: todo el árbol (cualquier miembro) ----
router.get('/', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, username, name, avatar_path FROM users ORDER BY name').all();
  const pl = db.prepare('SELECT parent_id, child_id FROM parent_links').all();
  const parents = {};
  for (const r of pl) { (parents[r.child_id] = parents[r.child_id] || []).push(r.parent_id); }
  const couples = db.prepare('SELECT user1_id, user2_id FROM couples').all()
    .map(r => [r.user1_id, r.user2_id]);
  res.json({ users, parents, couples });
});

// ---- Gestión (admin) ----
router.post('/parents', requireAuth, requireAdmin, (req, res) => {
  const err = addParentLink(req.body.parentId, req.body.childId);
  if (err) return res.status(400).json({ error: err });
  res.status(201).json({ ok: true });
});

router.delete('/parents', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM parent_links WHERE parent_id = ? AND child_id = ?')
    .run(req.body.parentId, req.body.childId);
  res.json({ ok: true });
});

router.post('/couples', requireAuth, requireAdmin, (req, res) => {
  const err = addCouple(req.body.user1Id, req.body.user2Id);
  if (err) return res.status(400).json({ error: err });
  res.status(201).json({ ok: true });
});

router.delete('/couples', requireAuth, requireAdmin, (req, res) => {
  const a = parseInt(req.body.user1Id, 10), b = parseInt(req.body.user2Id, 10);
  const [u1, u2] = a < b ? [a, b] : [b, a];
  db.prepare('DELETE FROM couples WHERE user1_id = ? AND user2_id = ?').run(u1, u2);
  res.json({ ok: true });
});

// ---- Sugerencias de miembros ----
const KINDS = ['add_parent', 'remove_parent', 'add_couple', 'remove_couple'];
const KIND_LABEL = {
  add_parent: 'Agregar padre/madre', remove_parent: 'Quitar padre/madre',
  add_couple: 'Agregar pareja', remove_couple: 'Quitar pareja'
};

router.post('/suggest', requireAuth, (req, res) => {
  const { kind, userAId, userBId, note } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo de propuesta inválido.' });
  const a = parseInt(userAId, 10), b = parseInt(userBId, 10);
  if (!userExists(a) || !userExists(b) || a === b)
    return res.status(400).json({ error: 'Elige dos personas válidas.' });
  const info = db.prepare(
    'INSERT INTO tree_suggestions (kind, user_a_id, user_b_id, note, proposed_by) VALUES (?,?,?,?,?)'
  ).run(kind, a, b, (note || '').toString().slice(0, 500), req.session.userId);
  res.status(201).json({ suggestion: { id: info.lastInsertRowid } });
});

router.get('/suggestions', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT s.*, p.username AS proposed_by_name
    FROM tree_suggestions s LEFT JOIN users p ON p.id = s.proposed_by
    ORDER BY s.created_at DESC LIMIT 100`).all();
  const users = db.prepare('SELECT id, name FROM users').all();
  const names = Object.fromEntries(users.map(u => [u.id, u.name]));
  res.json({
    suggestions: rows.map(r => ({
      id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind],
      userA: { id: r.user_a_id, name: names[r.user_a_id] },
      userB: { id: r.user_b_id, name: names[r.user_b_id] },
      note: r.note, proposedBy: r.proposed_by_name,
      status: r.status, created_at: r.created_at
    }))
  });
});

router.post('/suggestions/:id/approve', requireAuth, requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM tree_suggestions WHERE id = ?').get(req.params.id);
  if (!s || s.status !== 'pending') return res.status(404).json({ error: 'Propuesta no encontrada.' });
  let err = null;
  if (s.kind === 'add_parent') err = addParentLink(s.user_a_id, s.user_b_id);
  else if (s.kind === 'remove_parent')
    db.prepare('DELETE FROM parent_links WHERE parent_id = ? AND child_id = ?').run(s.user_a_id, s.user_b_id);
  else if (s.kind === 'add_couple') err = addCouple(s.user_a_id, s.user_b_id);
  else if (s.kind === 'remove_couple') {
    const [u1, u2] = s.user_a_id < s.user_b_id ? [s.user_a_id, s.user_b_id] : [s.user_b_id, s.user_a_id];
    db.prepare('DELETE FROM couples WHERE user1_id = ? AND user2_id = ?').run(u1, u2);
  }
  if (err) return res.status(400).json({ error: 'No se pudo aplicar: ' + err });
  db.prepare("UPDATE tree_suggestions SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?").run(s.id);
  res.json({ ok: true });
});

router.post('/suggestions/:id/reject', requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE tree_suggestions SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
