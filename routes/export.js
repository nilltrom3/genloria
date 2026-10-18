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

// Reemplazo completo de la ruta /family.pdf con el diseño acordado
router.get('/family.pdf', requireAuth, (req, res) => {
  const { users, byId, parents, couples } = collectFamily();
  const meRow = db.prepare('SELECT family_id FROM users WHERE id = ?').get(req.session.userId);
  const famRow = meRow && meRow.family_id
    ? db.prepare('SELECT name FROM families WHERE id = ?').get(meRow.family_id) : null;
  const gens = generations(users, parents);
  const doc = new PDFDocument({ margin: 0, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="genloria-datos-familiares.pdf"');
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  doc.pipe(res);

  const NAVY = '#0b2b4f', GOLD = '#d4a017', GREEN = '#2e7d32', GRAY = '#616161', DARK = '#1a1a1a';
  const PW = 612; // LETTER width
  const M = 48;   // margin

  const familyName = (famRow && famRow.name) || 'Mi familia';
  const now = new Date();
  const dateStr = now.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' · ' + now.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });

  // ---------- Portada / encabezado ----------
  const headerH = 150;
  doc.rect(0, 0, PW, headerH).fill(NAVY);
  // Línea dorada inferior
  doc.rect(0, headerH - 4, PW, 4).fill(GOLD);

  // Logo (árbol) a la izquierda
  const logoPath = path.join(__dirname, '..', 'public', 'logo-genloria.png');
  let lx = M;
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, M, 28, { fit: [70, 70] });
    lx = M + 86;
  }
  doc.fontSize(26).fillColor('#ffffff').font('Helvetica-Bold').text('GENLORIA', lx, 38);
  doc.fontSize(10).fillColor('#c5d3e8').font('Helvetica-Oblique')
    .text('Generaciones unidas. Historias que perduran.', lx, 68);
  // Línea dorada corta
  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(lx, 88).lineTo(lx + 220, 88).stroke();
  doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold').text('FAMILIA', lx, 96);
  doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold').text(familyName, lx, 108);

  let y = headerH + 24;

  // Fecha de exportación
  doc.fontSize(8).fillColor(GRAY).font('Helvetica')
    .text(`Datos familiares exportados el ${dateStr}.`, M, y, { width: PW - M * 2 });
  y += 22;

  // ---------- Resumen de la familia ----------
  doc.fontSize(13).fillColor(NAVY).font('Helvetica-Bold').text('Resumen de la familia', M, y);
  y += 6;
  // Rayita dorada
  doc.strokeColor(GOLD).lineWidth(3).moveTo(M, y).lineTo(M + 28, y).stroke();
  y += 12;

  const withAccount = users.filter(u => u.username).length;
  const coupleCount = couples.filter(c => c.status === 'actual').length;
  const stats = [
    [String(users.length), 'FAMILIARES'],
    [String(gens.length), 'GENERACIONES'],
    [String(withAccount), 'CON CUENTA'],
    [String(coupleCount), 'PAREJAS'],
  ];
  const cardW = (PW - M * 2 - 24) / 4, cardH = 58;
  stats.forEach(([num, label], i) => {
    const x = M + i * (cardW + 8);
    doc.roundedRect(x, y, cardW, cardH, 8).fill('#eef1f6');
    doc.fontSize(20).fillColor(NAVY).font('Helvetica-Bold')
      .text(num, x, y + 8, { width: cardW, align: 'center' });
    doc.fontSize(7).fillColor(GRAY).font('Helvetica')
      .text(label, x, y + 36, { width: cardW, align: 'center' });
  });
  y += cardH + 26;

  // ---------- Miembros de la familia ----------
  const sectionTitle = (t, yy) => {
    doc.fontSize(13).fillColor(NAVY).font('Helvetica-Bold').text(t, M, yy);
    const ty = yy + 20;
    doc.strokeColor(GOLD).lineWidth(3).moveTo(M, ty).lineTo(M + 28, ty).stroke();
    return ty + 14;
  };
  y = sectionTitle('Miembros de la familia', y);

  const needSpace = h => {
    if (y + h > 740) { addFooter(); doc.addPage(); y = 40; }
  };
  const addFooter = () => {
    doc.fontSize(7).fillColor('#9aa3b2').font('Helvetica')
      .text('GENLORIA · Generaciones unidas. Historias que perduran.', M, 752);
    const pg = doc.bufferedPageRange().count + 1;
    doc.text(`Página ${pg}`, PW - M - 60, 752, { width: 60, align: 'right' });
  };

  const ageStr = u => {
    if (!u.birthdate) return '';
    const b = new Date(u.birthdate);
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
    const ds = b.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${ds} (${age} años)`;
  };

  // Rol/título de cada persona
  const roleOf = u => {
    const hasParents = (parents[u.id] || []).length > 0;
    if (!hasParents) return 'Raíz de la familia';
    const cpl = couples.find(c => c.status === 'actual' && (c.user1_id === u.id || c.user2_id === u.id));
    if (cpl) return 'Pareja';
    return 'Hijo/a';
  };

  // Orden: por generación
  const ordered = gens.flat();

  for (const u of ordered) {
    needSpace(90);
    // Nombre
    doc.fontSize(12).fillColor(DARK).font('Helvetica-Bold').text(u.name, M, y);
    y += 16;
    // Rol en verde
    doc.fontSize(9).fillColor(GREEN).font('Helvetica').text(roleOf(u), M, y);
    y += 14;

    const lines = [];
    const cpl = couples.find(c => c.status === 'actual' && (c.user1_id === u.id || c.user2_id === u.id));
    if (cpl) {
      const other = byId[cpl.user1_id === u.id ? cpl.user2_id : cpl.user1_id];
      if (other) lines.push(['Pareja', other.name]);
    }
    if (u.birthdate) lines.push(['Nacimiento', ageStr(u)]);
    // Hijos
    const kids = [];
    for (const [cid, ps] of Object.entries(parents)) {
      if (ps.some(p => p.id === u.id && p.link_set === 1) && byId[cid]) kids.push(byId[cid].name.split(' ')[0]);
    }
    if (kids.length) lines.push(['Hijos', [...new Set(kids)].join(', ')]);
    // Padres
    const ps = (parents[u.id] || []).filter(p => p.link_set === 1).map(p => byId[p.id]).filter(Boolean);
    if (ps.length >= 1) lines.push(['Padre', ps[0].name.split(' ')[0]]);
    if (ps.length >= 2) lines.push(['Madre', ps[1].name.split(' ')[0]]);
    if (u.username) lines.push(['Cuenta GENLORIA', 'Tiene su propia cuenta']);

    for (const [k, v] of lines) {
      doc.fontSize(9).fillColor(DARK).font('Helvetica-Bold').text(k + ': ', M, y, { continued: true })
        .font('Helvetica').text(v);
      y += 13;
    }
    y += 6;
    // Separador
    doc.strokeColor('#e0e4ea').lineWidth(0.7).moveTo(M, y).lineTo(PW - M, y).stroke();
    y += 14;
  }

  // ---------- Árbol genealógico (diagrama) ----------
  addFooter();
  doc.addPage();
  y = 40;
  // Mini encabezado
  doc.rect(0, 0, PW, 46).fill(NAVY);
  doc.rect(0, 42, PW, 4).fill(GOLD);
  doc.fontSize(11).fillColor('#fff').font('Helvetica-Bold').text('GENLORIA', M, 14);
  doc.fontSize(8).fillColor('#c5d3e8').font('Helvetica').text(familyName, PW - M - 120, 16, { width: 120, align: 'right' });
  y = 70;
  y = sectionTitle('Árbol genealógico', y);
  doc.fontSize(9).fillColor(GRAY).font('Helvetica')
    .text(`Familia ${familyName} · ${users.length} familiares`, M, y);
  y += 30;

  // Dibujar árbol simple por generaciones
  const drawTree = (startY) => {
    let cy = startY;
    const nodeR = 22;
    const levelGap = 95;
    // Por cada generación, dibujar nodos en fila
    const positions = {}; // id -> {x, y}
    gens.forEach((g, gi) => {
      const n = g.length;
      if (!n) return;
      const totalW = PW - M * 2;
      const stepX = n === 1 ? 0 : Math.min(130, totalW / n);
      const rowW = stepX * (n - 1);
      const x0 = (PW - rowW) / 2;
      g.forEach((u, i) => {
        const x = n === 1 ? PW / 2 : x0 + i * stepX;
        const yy = cy;
        positions[u.id] = { x, y: yy };
        // Círculo
        doc.circle(x, yy, nodeR).fillOpacity(1).fill('#eef3f8');
        doc.circle(x, yy, nodeR).strokeColor(GREEN).lineWidth(2).stroke();
        // Inicial
        const initial = (u.name || '?').trim().charAt(0).toUpperCase();
        doc.fontSize(16).fillColor(NAVY).font('Helvetica-Bold')
          .text(initial, x - nodeR, yy - 11, { width: nodeR * 2, align: 'center' });
        // Nombre debajo
        const first = u.name.split(' ')[0];
        doc.fontSize(8).fillColor(NAVY).font('Helvetica-Bold')
          .text(first, x - 45, yy + nodeR + 4, { width: 90, align: 'center' });
        doc.fontSize(7).fillColor(GREEN).font('Helvetica')
          .text(roleOf(u), x - 45, yy + nodeR + 16, { width: 90, align: 'center' });
      });
      cy += levelGap;
    });
    // Conexiones pareja (línea dorada)
    doc.strokeColor(GOLD).lineWidth(2.5);
    for (const c of couples) {
      if (c.status !== 'actual') continue;
      const a = positions[c.user1_id], b = positions[c.user2_id];
      if (a && b && Math.abs(a.y - b.y) < 5) {
        doc.moveTo(a.x + nodeR, a.y).lineTo(b.x - nodeR, b.y).stroke();
      }
    }
    // Conexiones padres-hijos (línea gris)
    doc.strokeColor('#9aa3b2').lineWidth(1.2);
    for (const [cid, ps] of Object.entries(parents)) {
      const child = positions[cid];
      if (!child) continue;
      const set1 = ps.filter(p => p.link_set === 1 && positions[p.id]);
      if (!set1.length) continue;
      // Punto medio de los padres
      const pxs = set1.map(p => positions[p.id].x);
      const pys = set1.map(p => positions[p.id].y);
      const midX = pxs.reduce((s, v) => s + v, 0) / pxs.length;
      const parY = pys[0];
      if (child.y > parY + 10) {
        const dropY = parY + 40;
        doc.moveTo(midX, parY + nodeR).lineTo(midX, dropY).stroke();
        doc.moveTo(Math.min(midX, child.x), dropY).lineTo(Math.max(midX, child.x), dropY).stroke();
        doc.moveTo(child.x, dropY).lineTo(child.x, child.y - nodeR).stroke();
      }
    }
    return cy;
  };

  drawTree(y);

  // Leyenda
  const ly = 700;
  doc.strokeColor(GOLD).lineWidth(2.5).moveTo(M, ly).lineTo(M + 28, ly).stroke();
  doc.fontSize(8).fillColor(GRAY).font('Helvetica').text('Pareja', M + 34, ly - 6);
  doc.strokeColor('#9aa3b2').lineWidth(1.2).dash(3, { space: 3 }).moveTo(M + 110, ly).lineTo(M + 138, ly).stroke();
  doc.undash();
  doc.fontSize(8).fillColor(GRAY).text('Vínculo adoptivo o de acogida', M + 144, ly - 6);

  addFooter();
  doc.end();
});


// ---- PDF de ficha personal ----
router.get('/person/:id.pdf', requireAuth, (req, res) => {
  const { users, byId, parents, couples } = collectFamily();
  const person = byId[req.params.id];
  if (!person) return res.status(404).json({ error: 'Persona no encontrada.' });

  const doc = new PDFDocument({ margin: 0, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  const fname = (person.name || 'ficha').replace(/[^a-zA-Z0-9áéíóúñü ]/gi, '').trim().replace(/\s+/g, '-');
  res.setHeader('Content-Disposition', `attachment; filename="genloria-ficha-${fname}.pdf"`);
  doc.pipe(res);

  const NAVY = '#0b2b4f', GOLD = '#d4a017', GREEN = '#2e7d32', GRAY = '#616161', DARK = '#1a1a1a';
  const PW = 612, M = 48;
  const now = new Date();

  // Encabezado
  const headerH = 150;
  doc.rect(0, 0, PW, headerH).fill(NAVY);
  doc.rect(0, headerH - 4, PW, 4).fill(GOLD);
  const logoPath = path.join(__dirname, '..', 'public', 'logo-genloria.png');
  let lx = M;
  if (fs.existsSync(logoPath)) { doc.image(logoPath, M, 28, { fit: [70, 70] }); lx = M + 86; }
  doc.fontSize(26).fillColor('#ffffff').font('Helvetica-Bold').text('GENLORIA', lx, 38);
  doc.fontSize(10).fillColor('#c5d3e8').font('Helvetica-Oblique')
    .text('Generaciones unidas. Historias que perduran.', lx, 68);
  doc.strokeColor(GOLD).lineWidth(1.5).moveTo(lx, 88).lineTo(lx + 220, 88).stroke();
  doc.fontSize(8).fillColor(GOLD).font('Helvetica-Bold').text('FICHA PERSONAL', lx, 96);
  doc.fontSize(14).fillColor('#ffffff').font('Helvetica-Bold').text(person.name, lx, 108);

  let y = headerH + 20;

  // Foto si existe
  const avatarPath = person.avatar_path ? path.join(__dirname, '..', 'public', person.avatar_path.replace(/^\//, '')) : null;
  if (avatarPath && fs.existsSync(avatarPath)) {
    try {
      doc.image(avatarPath, PW - M - 90, headerH + 20, { fit: [90, 90] });
    } catch (e) { /* ignorar */ }
  }

  const section = (t, yy) => {
    doc.fontSize(13).fillColor(NAVY).font('Helvetica-Bold').text(t, M, yy);
    const ty = yy + 20;
    doc.strokeColor(GOLD).lineWidth(3).moveTo(M, ty).lineTo(M + 28, ty).stroke();
    return ty + 14;
  };

  const kv = (k, v) => {
    if (!v) return;
    doc.fontSize(10).fillColor(DARK).font('Helvetica-Bold').text(k + ': ', M, y, { continued: true })
      .font('Helvetica').text(String(v));
    y += 15;
  };

  const fmtD = d => {
    if (!d) return '';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (e) { return d; }
  };

  // Información personal
  y = section('Información personal', y);
  if (person.nickname) kv('Apodo', `«${person.nickname}»`);
  if (person.maiden_name) kv('Apellido de soltera', person.maiden_name);
  if (person.sex) kv('Sexo', { M: 'Hombre', F: 'Mujer', X: 'Otro' }[person.sex] || person.sex);
  kv('Nacimiento', [fmtD(person.birthdate), person.birth_place].filter(Boolean).join(' — '));
  kv('Bautismo', [fmtD(person.baptism_date), person.baptism_place].filter(Boolean).join(' — '));
  if (person.is_deceased) {
    kv('Fallecimiento', [fmtD(person.death_date), person.death_place].filter(Boolean).join(' — '));
    kv('Causa', person.death_cause);
    kv('Entierro', person.burial_place);
  }
  kv('Teléfono', person.phone);
  if (person.bio) kv('Sobre esta persona', person.bio);
  kv('Ocupación', person.occupation);
  kv('Educación', person.education);
  kv('Religión', person.religion);
  kv('Nacionalidad', person.nationality);
  kv('Residencia', person.residence);
  kv('Servicio militar', person.military_service);
  if (person.notes) kv('Notas y fuentes', person.notes);
  if (person.username) kv('Cuenta GENLORIA', 'Tiene su propia cuenta');
  y += 10;

  // Familia
  y = section('Familia', y);
  const ps = (parents[person.id] || []).filter(p => p.link_set === 1).map(p => byId[p.id]).filter(Boolean);
  if (ps.length) kv('Padres', ps.map(p => p.name).join(', '));
  const cpl = couples.find(c => c.status === 'actual' && (c.user1_id === person.id || c.user2_id === person.id));
  if (cpl) {
    const other = byId[cpl.user1_id === person.id ? cpl.user2_id : cpl.user1_id];
    if (other) kv('Pareja', other.name + (cpl.marriage_date ? ` (matr. ${fmtD(cpl.marriage_date)})` : ''));
  }
  const kids = [];
  for (const [cid, cps] of Object.entries(parents)) {
    if (cps.some(p => p.id === person.id && p.link_set === 1) && byId[cid]) kids.push(byId[cid].name);
  }
  if (kids.length) kv('Hijos', [...new Set(kids)].join(', '));

  // Pie
  doc.fontSize(7).fillColor('#9aa3b2').font('Helvetica')
    .text('GENLORIA · Generaciones unidas. Historias que perduran.', M, 752);
  doc.text(`Generado el ${now.toLocaleDateString('es')}`, PW - M - 150, 752, { width: 150, align: 'right' });

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
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.setHeader('Content-Disposition', 'attachment; filename="genloria-familia.gedcom"');
  res.send(L.join('\n'));
});

module.exports = router;
