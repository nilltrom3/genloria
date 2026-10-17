// tree.js — Árbol genealógico: layout por generaciones + SVG interactivo.
'use strict';

const TREE = {
  NW: 96,        // ancho por persona
  GEN_GAP: 128,  // separación vertical entre generaciones
  UNIT_GAP: 30,  // separación mínima entre unidades familiares
  R: 26          // radio del avatar
};

function coupleOfMap(couples) {
  const m = {};
  couples.forEach(([a, b]) => { m[a] = b; m[b] = a; });
  return m;
}

// Generación de cada persona (0 = sin padres conocidos)
function computeGens(users, parents) {
  const memo = {};
  function gen(id, stack) {
    if (memo[id] !== undefined) return memo[id];
    if ((stack || []).includes(id)) return 0; // seguridad anti-ciclos
    const ps = parents[id] || [];
    if (!ps.length) return (memo[id] = 0);
    return (memo[id] = Math.max(...ps.map(p => gen(p, [...(stack || []), id]))) + 1);
  }
  users.forEach(u => gen(u.id, []));
  return memo;
}

function layoutTree(users, parents, couples) {
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  const cpl = coupleOfMap(couples);
  const NW = TREE.NW, GAP = TREE.UNIT_GAP;

  // Unidades: parejas juntas, resto solos
  const seen = new Set(), units = [];
  users.forEach(u => {
    if (seen.has(u.id)) return;
    const p = cpl[u.id];
    if (p && byId[p] && !seen.has(p)) {
      units.push({ members: [u.id, p] }); seen.add(u.id); seen.add(p);
    } else if (!seen.has(u.id)) {
      units.push({ members: [u.id] }); seen.add(u.id);
    }
  });
  const unitOf = {};
  units.forEach((un, i) => un.members.forEach(id => { unitOf[id] = i; }));
  const unitW = un => un.members.length * NW;

  const gens = computeGens(users, parents);
  // La pareja se dibuja en la generación más baja de sus miembros
  // (para que los hijos queden siempre debajo de ambos padres).
  units.forEach(un => { un.gen = Math.max(...un.members.map(id => gens[id])); });
  const byGen = {};
  units.forEach(un => { (byGen[un.gen] = byGen[un.gen] || []).push(un); });
  const maxGen = Math.max(0, ...Object.keys(byGen).map(Number));

  // hijos por persona
  const childrenOf = {};
  Object.entries(parents).forEach(([child, ps]) =>
    ps.forEach(p => { (childrenOf[p] = childrenOf[p] || []).push(+child); }));

  // ancla de cada unidad = promedio de x de las unidades de sus padres
  function anchorOf(un) {
    const axs = [];
    un.members.forEach(id => {
      (parents[id] || []).forEach(p => {
        const pu = units[unitOf[p]];
        if (pu && pu.x !== undefined) axs.push(pu.x);
      });
    });
    if (!axs.length) return null;
    return axs.reduce((a, b) => a + b, 0) / axs.length;
  }

  // generación 0: en fila
  let cursor = 0;
  (byGen[0] || []).forEach(un => {
    un.x = cursor + unitW(un) / 2;
    cursor += unitW(un) + GAP;
  });

  // generaciones siguientes: centradas bajo sus padres + resolución de solapes
  for (let g = 1; g <= maxGen; g++) {
    const arr = (byGen[g] || []).slice();
    arr.forEach(un => { un.anchor = anchorOf(un); });
    arr.sort((a, b) => (a.anchor === null) - (b.anchor === null) || (a.anchor || 1e9) - (b.anchor || 1e9));
    let c = 0;
    arr.forEach(un => {
      const w = unitW(un);
      const target = un.anchor === null ? c + w / 2 : un.anchor;
      un.x = Math.max(c + w / 2, target);
      c = un.x + w / 2 + GAP;
    });
    // 3 pasadas de centrado sin solapes
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < arr.length; i++) {
        const un = arr[i], w = unitW(un);
        if (un.anchor === null) continue;
        const prevR = i > 0 ? arr[i - 1].x + unitW(arr[i - 1]) / 2 + GAP : 0;
        const nextL = i < arr.length - 1 ? arr[i + 1].x - unitW(arr[i + 1]) / 2 - GAP : Infinity;
        un.x = Math.min(Math.max(un.anchor, prevR + w / 2), nextL - w / 2);
      }
    }
  }

  // posiciones de nodos
  const pos = {};
  units.forEach(un => {
    const y = 60 + un.gen * TREE.GEN_GAP;
    if (un.members.length === 2) {
      pos[un.members[0]] = { x: un.x - NW / 2, y };
      pos[un.members[1]] = { x: un.x + NW / 2, y };
    } else {
      pos[un.members[0]] = { x: un.x, y };
    }
  });

  const maxX = Math.max(...units.map(un => un.x + unitW(un) / 2), 320);
  return { units, pos, byId, cpl, parentsMap: parents, width: maxX + 40, height: 60 + maxGen * TREE.GEN_GAP + 110, maxGen };
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function renderTreeSVG(layout) {
  const { units, pos, byId, cpl, width, height } = layout;
  const R = TREE.R;
  let s = `<svg id="tree-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  s += `<defs><clipPath id="tclip"><circle r="${R}" /></clipPath></defs>`;
  s += `<g id="tree-zoom" transform="translate(0,0) scale(1)">`;

  // enlaces de pareja
  const drawnCouples = new Set();
  units.forEach(un => {
    if (un.members.length === 2) {
      const [a, b] = un.members, key = a < b ? a + '-' + b : b + '-' + a;
      if (drawnCouples.has(key)) return;
      drawnCouples.add(key);
      s += `<line x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}" stroke="#d4af37" stroke-width="3"/>`;
    }
  });

  // enlaces padre -> hijo (desde el punto familiar)
  const drawnChild = new Set();
  units.forEach(un => {
    const famX = un.members.length === 2
      ? (pos[un.members[0]].x + pos[un.members[1]].x) / 2
      : pos[un.members[0]].x;
    const famY = pos[un.members[0]].y;
    // hijos de esta unidad
    const kids = new Set();
    un.members.forEach(pid => {
      // hijos = personas que tienen a pid como padre
      Object.entries(layout.parentsMap || {}).forEach(([child, ps]) => {
        if (ps.includes(pid)) kids.add(+child);
      });
    });
    kids.forEach(kid => {
      if (drawnChild.has(kid) || !pos[kid]) return;
      drawnChild.add(kid);
      const cx = pos[kid].x, topY = famY + R + 4, botY = pos[kid].y - R - 16;
      const midY = (topY + botY) / 2;
      s += `<path d="M ${famX} ${topY} V ${midY} H ${cx} V ${botY}" fill="none" stroke="#5b7ba6" stroke-width="2"/>`;
    });
  });

  // nodos
  Object.entries(pos).forEach(([id, p]) => {
    const u = byId[id];
    const av = u.avatar_path ? u.avatar_path : null;
    const words = u.name.split(/\s+/);
    const line1 = words.slice(0, 2).join(' ');
    const by = (u.birthdate || '').slice(0, 4);
    const dy = u.is_deceased && u.death_date ? u.death_date.slice(0, 4) : '';
    const line2 = u.is_deceased && (by || dy) ? `✝ ${by || '…'}–${dy || '…'}` : (by || words.slice(2, 4).join(' '));
    const ring = u.is_deceased ? '#6b7280' : '#43a047';
    s += `<g class="tnode" data-uid="${u.id}" transform="translate(${p.x},${p.y})" style="cursor:pointer">`;
    s += `<circle r="${R + 3}" fill="#14253d" stroke="${ring}" stroke-width="${cpl[u.id] ? 2.5 : 0}"/>`;
    s += `<circle r="${R}" fill="#1e3a5f"/>`;
    s += `<text y="6" text-anchor="middle" font-size="20" fill="#7fb3ec" font-weight="700">${esc(initials(u.name))}</text>`;
    if (av) s += `<image href="${esc(av)}" x="${-R}" y="${-R}" width="${R * 2}" height="${R * 2}" clip-path="url(#tclip)" onerror="this.remove()"/>`;
    s += `<text y="${R + 18}" text-anchor="middle" font-size="11" fill="#f1f5f9" font-weight="600">${esc(line1)}</text>`;
    if (line2) s += `<text y="${R + 31}" text-anchor="middle" font-size="11" fill="#8fa3bf">${esc(line2)}</text>`;
    s += `</g>`;
  });

  s += `</g></svg>`;
  return s;
}

// Exponer para app.js
window.TreeModule = { layoutTree, renderTreeSVG, coupleOfMap };
