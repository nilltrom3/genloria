// routes/export.js — Descarga de datos familiares: PDF y GEDCOM 5.5.1.
const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No has iniciado sesión.' });
  next();
}

// Recolecta personas + relaciones para exportar
function collectFamily() {
  const users = db.prepare(`SELECT * FROM users ORDER BY name`).all();
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  const pl = db.prepare('SELECT parent_id, child_id, link_type, link_set FROM parent_links').all();
  const parents = {};
  for (const r of pl) {
    (parents[r.child_id] = parents[r.child_id] || []).push({ id: r.parent_id, link_type: r.link_type, link_set: r.link_set });
  }
  const couples = db.prepare('SELECT user1_id, user2_id, marriage_date, marriage_place, status FROM couples').all();
  return { users, byId, parents, couples };
}

const fullName = u => u.name;
const years = u => {
  const b = (u.birthdate || '').slice(0, 4), d = (u.death_date || '').slice(0, 4);
  if (!b && !d) return '';
  return u.is_deceased ? `✝ ${b || '…'}–${d || '…'}` : b;
};

// Generaciones: BFS desde las personas sin padres registrados
function generations(users, parents) {
  const ids = new Set(users.map(u => u.id));
  const hasParents = new Set(Object.keys(parents).map(Number));
  const roots = users.filter(u => !hasParents.has(u.id));
  const genOf = {};
  const queue = [];
  (roots.length ? roots : users.slice(0, 1)).forEach(u => { genOf[u.id] = 0; queue.push(u.id); });
  const childrenOf = {};
  for (const [child, ps] of Object.entries(parents))
    for (const p of ps) (childrenOf[p.id] = childrenOf[p.id] || []).push(+child);
  while (queue.length) {
    const id = queue.shift();
    for (const c of (childrenOf[id] || [])) {
      if (genOf[c] === undefined && ids.has(c)) { genOf[c] = genOf[id] + 1; queue.push(c); }
    }
  }
  users.forEach(u => { if (genOf[u.id] === undefined) genOf[u.id] = 0; });
  const max = Math.max(0, ...Object.values(genOf));
  const gens = Array.from({ length: max + 1 }, () => []);
  users.forEach(u => gens[genOf[u.id]].push(u));
  gens.forEach(g => g.sort((a, b) => (b.birthdate || '').localeCompare(a.birthdate || '')));
  return gens;
}

const GEN_LABEL = ['Primera generación', 'Segunda generación', 'Tercera generación',
  'Cuarta generación', 'Quinta generación', 'Sexta generación'];
const genLabel = i => GEN_LABEL[i] || `Generación ${i + 1}`;

// ---- PDF familiar ----
router.get('/family.pdf', requireAuth, (req, res) => {
  const { users, byId, parents, couples } = collectFamily();
  const gens = generations(users, parents);
  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="genloria-datos-familiares.pdf"');
  doc.pipe(res);

  const NAVY = '#0b2b4f', BLUE = '#2b7cd3', GOLD = '#b8912a', GREEN = '#2e7d32', GRAY = '#616161';

  // Portada
  const logoPath = path.join(__dirname, '..', 'public', 'logo-genloria.png');
  if (fs.existsSync(logoPath)) doc.image(logoPath, { fit: [140, 140], align: 'center' });
  doc.moveDown(1.5);
  doc.fontSize(30).fillColor(NAVY).font('Helvetica-Bold').text('GENLORIA', { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(13).fillColor(GRAY).font('Helvetica-Oblique')
    .text('Generaciones unidas. Historias que perduran.', { align: 'center' });
  doc.moveDown(1.2);
  doc.fontSize(12).fillColor('#333').font('Helvetica')
    .text(`Datos familiares — ${users.length} persona(s) en ${gens.length} generación(es).`, { align: 'center' });
  const living = users.filter(u => !u.is_deceased).length;
  doc.text(`${living} con vida · ${users.length - living} fallecidos.`, { align: 'center' });
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor(GRAY)
    .text(`Generado el ${new Date().toLocaleDateString('es')} desde GENLORIA.`, { align: 'center' });

  // Datos por generación
  const personBlock = u => {
    const y = years(u);
    doc.fontSize(14).fillColor(u.is_deceased ? GRAY : NAVY).font('Helvetica-Bold')
      .text(`${fullName(u)}${y ? '  ' + y : ''}`);
    const small = [];
    if (u.nickname) small.push(`«${u.nickname}»`);
    if (u.maiden_name) small.push(`nacida como ${u.maiden_name}`);
    if (u.sex) small.push({ M: 'Hombre', F: 'Mujer', X: 'Otro' }[u.sex] || u.sex);
    const ps = (parents[u.id] || []).filter(p => p.link_set === 1).map(p => byId[p.id]).filter(Boolean);
    if (ps.length) small.push(`Padre/madre: ${ps.map(p => p.name).join(', ')}`);
    const cpl = couples.find(c => c.status === 'actual' && (c.user1_id === u.id || c.user2_id === u.id));
    if (cpl) {
      const other = byId[cpl.user1_id === u.id ? cpl.user2_id : cpl.user1_id];
      if (other) small.push(`Pareja: ${other.name}${cpl.marriage_date ? ` (matr. ${cpl.marriage_date})` : ''}`);
    }
    if (small.length) doc.fontSize(9).fillColor(GRAY).font('Helvetica').text(small.join(' · '));
    const det = [];
    const kv = (k, v) => { if (v) det.push([k, v]); };
    kv('Nacimiento', [u.birthdate, u.birth_place].filter(Boolean).join(' — '));
    kv('Bautismo', [u.baptism_date, u.baptism_place].filter(Boolean).join(' — '));
    if (u.is_deceased) {
      kv('Fallecimiento', [u.death_date, u.death_place].filter(Boolean).join(' — '));
      kv('Causa', u.death_cause);
      kv('Entierro', u.burial_place);
    }
    kv('Teléfono', u.phone);
    kv('Ocupación', u.occupation);
    kv('Educación', u.education);
    kv('Religión', u.religion);
    kv('Nacionalidad', u.nationality);
    kv('Residencia', u.residence);
    kv('Servicio militar', u.military_service);
    if (u.bio) kv('Sobre esta persona', u.bio);
    if (u.notes) kv('Notas y fuentes', u.notes);
    for (const [k, v] of det) {
      doc.fontSize(10).fillColor('#333').font('Helvetica-Bold').text(k + ': ', { continued: true })
        .font('Helvetica').text(v);
    }
    doc.moveDown(0.8);
  };

  gens.forEach((g, i) => {
    doc.addPage();
    doc.fontSize(18).fillColor(BLUE).font('Helvetica-Bold').text(genLabel(i));
    doc.moveDown(0.3);
    doc.strokeColor('#d0d7e3').lineWidth(1)
      .moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.8);
    g.forEach(personBlock);
  });

  // Última página: árbol por generaciones
  doc.addPage();
  doc.fontSize(18).fillColor(BLUE).font('Helvetica-Bold').text('Árbol familiar');
  doc.moveDown(0.5);
  gens.forEach((g, i) => {
    doc.fontSize(12).fillColor(GOLD).font('Helvetica-Bold').text(genLabel(i));
    doc.moveDown(0.2);
    g.forEach(u => {
      const ps = (parents[u.id] || []).filter(p => p.link_set === 1).map(p => byId[p.id]).filter(Boolean);
      const cpl = couples.find(c => c.status === 'actual' && (c.user1_id === u.id || c.user2_id === u.id));
      const other = cpl ? byId[cpl.user1_id === u.id ? cpl.user2_id : cpl.user1_id] : null;
      doc.fontSize(10).fillColor('#222').font('Helvetica')
        .text(`• ${fullName(u)}${years(u) ? ' ' + years(u) : ''}`, { continued: false });
      const sub = [];
      if (ps.length) sub.push(`Padre/madre: ${ps.map(p => p.name).join(', ')}`);
      if (other) sub.push(`Pareja: ${other.name}`);
      if (sub.length) doc.fontSize(8).fillColor(GRAY).text('   ' + sub.join(' · '));
    });
    doc.moveDown(0.6);
  });

  doc.end();
});

// ---- GEDCOM 5.5.1 ----
router.get('/family.gedcom', requireAuth, (req, res) => {
  const { users, byId, parents, couples } = collectFamily();
  const L = [];
  const esc = s => (s || '').toString().replace(/@/g, '(at)').trim();
  const gid = id => `@P${id}@`, fid = (a, b) => `@F${Math.min(a, b)}_${Math.max(a, b)}@`;
  L.push('0 HEAD', '1 SOUR GENLORIA', '2 NAME GENLORIA — red social familiar', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
  for (const u of users) {
    L.push(`0 ${gid(u.id)} INDI`);
    const [g1, ...rest] = u.name.split(/\s+/);
    L.push(`1 NAME ${esc(g1)} /${esc(rest.join(' ') || '...')}/`);
    if (u.nickname) L.push(`2 NICK ${esc(u.nickname)}`);
    if (u.sex === 'M') L.push('1 SEX M'); else if (u.sex === 'F') L.push('1 SEX F');
    if (u.birthdate || u.birth_place) {
      L.push('1 BIRT');
      if (u.birthdate) L.push(`2 DATE ${u.birthdate}`);
      if (u.birth_place) L.push(`2 PLAC ${esc(u.birth_place)}`);
    }
    if (u.baptism_date || u.baptism_place) {
      L.push('1 CHR');
      if (u.baptism_date) L.push(`2 DATE ${u.baptism_date}`);
      if (u.baptism_place) L.push(`2 PLAC ${esc(u.baptism_place)}`);
    }
    if (u.is_deceased && (u.death_date || u.death_place)) {
      L.push('1 DEAT');
      if (u.death_date) L.push(`2 DATE ${u.death_date}`);
      if (u.death_place) L.push(`2 PLAC ${esc(u.death_place)}`);
      if (u.death_cause) L.push(`2 CAUS ${esc(u.death_cause)}`);
    }
    if (u.burial_place) L.push(`1 BURI\n2 PLAC ${esc(u.burial_place)}`);
    if (u.occupation) L.push(`1 OCCU ${esc(u.occupation)}`);
    if (u.education) L.push(`1 EDUC ${esc(u.education)}`);
    if (u.religion) L.push(`1 RELI ${esc(u.religion)}`);
    if (u.nationality) L.push(`1 NATI ${esc(u.nationality)}`);
    if (u.residence) L.push(`1 RESI ${esc(u.residence)}`);
    if (u.notes) L.push(`1 NOTE ${esc(u.notes).slice(0, 400)}`);
  }
  // Familias (parejas + hijos)
  const fams = new Map();
  for (const c of couples) {
    if (c.status !== 'actual') continue;
    const key = fid(c.user1_id, c.user2_id);
    if (!fams.has(key)) fams.set(key, { a: c.user1_id, b: c.user2_id, mdate: c.marriage_date, mplac: c.marriage_place, kids: [] });
  }
  for (const [child, ps] of Object.entries(parents)) {
    const set1 = ps.filter(p => p.link_set === 1).map(p => p.id).sort((x, y) => x - y);
    if (set1.length === 2) {
      const key = fid(set1[0], set1[1]);
      if (!fams.has(key)) fams.set(key, { a: set1[0], b: set1[1], kids: [] });
      fams.get(key).kids.push(+child);
    }
  }
  for (const [key, f] of fams) {
    L.push(`0 ${key} FAM`);
    L.push(`1 HUSB ${gid(f.a)}`, `1 WIFE ${gid(f.b)}`);
    if (f.mdate || f.mplac) {
      L.push('1 MARR');
      if (f.mdate) L.push(`2 DATE ${f.mdate}`);
      if (f.mplac) L.push(`2 PLAC ${esc(f.mplac)}`);
    }
    for (const k of f.kids) L.push(`1 CHIL ${gid(k)}`);
  }
  L.push('0 TRLR');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="genloria-familia.gedcom"');
  res.send(L.join('\n'));
});

module.exports = router;
