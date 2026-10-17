// app.js — SPA de GENLORIA (vanilla JS)
'use strict';

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => [...(el || document).querySelectorAll(sel)];
const app = $('#app');
const bottomnav = $('#bottomnav');

let me = null;           // usuario actual
let feedCache = [];      // publicaciones
let storyGroups = [];    // historias agrupadas

// ---------- Utilidades ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function timeAgo(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'ahora mismo';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

async function apiForm(path, formData, method = 'POST') {
  const res = await fetch(path, { method, credentials: 'same-origin', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

function avatarHTML(user, cls) {
  const src = user && user.avatar_path ? esc(user.avatar_path) : '/icons/avatar-default.svg';
  return `<img class="${cls || 'avatar'}" src="${src}" alt="avatar" onerror="this.src='/icons/avatar-default.svg'">`;
}

function mediaHTML(post) {
  if (!post.media_path) return '';
  if (post.media_type === 'video')
    return `<div class="post-media"><video src="${esc(post.media_path)}" controls playsinline preload="metadata"></video></div>`;
  return `<div class="post-media"><img src="${esc(post.media_path)}" alt="foto" loading="lazy"></div>`;
}

// ---------- Navegación ----------
function setNav(active) {
  bottomnav.classList.toggle('hidden', !me);
  $$('#bottomnav button').forEach(b => {
    const target = b.dataset.nav;
    b.classList.toggle('active', !!me && (
      (active === 'feed' && target === '#/feed') ||
      (active === 'tree' && target === '#/tree') ||
      (active === 'new' && target === '#/new') ||
      (active === 'profile' && target === '#/profile')
    ));
  });
}

bottomnav.addEventListener('click', e => {
  const b = e.target.closest('button[data-nav]');
  if (b) location.hash = b.dataset.nav;
});

// ---------- Vistas ----------
function topbar(title, rightBtn) {
  return `<div class="topbar"><div class="logo"><img src="/icons/icon-192.png" alt="GENLORIA"> GENLORIA</div>${rightBtn || ''}</div>`;
}

function viewLogin() {
  setNav(null);
  app.innerHTML = `
    ${topbar('GENLORIA')}
    <div class="form-wrap">
      <h1>👋 ¡Hola!</h1>
      <p class="sub">Generaciones unidas · Historias que perduran</p>
      <div class="card">
        <form id="f-login">
          <label>Correo electrónico o usuario</label>
          <input type="text" name="email" autocomplete="username" required placeholder="tucorreo@ejemplo.com o admin">
          <label>Contraseña</label>
          <input type="password" name="password" autocomplete="current-password" required>
          <div class="error hidden" id="err"></div>
          <button class="btn" type="submit">Entrar</button>
        </form>
      </div>
      <p class="link">¿Primera vez? <a href="#/register">Crea tu cuenta con el código familiar</a></p>
      <p class="link">¿Olvidaste tu clave? <a href="#/recover">Recupérala con tu código</a></p>
    </div>`;
  $('#f-login').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
      });
      me = user;
      location.hash = '#/feed';
    } catch (err) {
      const el = $('#err'); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

function viewRecover() {
  setNav(null);
  app.innerHTML = `
    ${topbar('GENLORIA')}
    <div class="form-wrap">
      <h1>🔑 Recuperar clave</h1>
      <p class="sub">Pide tu código al administrador de la familia e ingrésalo aquí para elegir una clave nueva</p>
      <div class="card">
        <form id="f-recover">
          <label>Código de recuperación</label>
          <input type="text" name="code" required placeholder="Ej: A1B2C3D4" style="text-transform:uppercase" maxlength="16">
          <label>Nueva contraseña (mín. 8 caracteres)</label>
          <input type="password" name="newPassword" autocomplete="new-password" required minlength="8">
          <div class="error hidden" id="err"></div>
          <button class="btn" type="submit">Crear mi nueva clave</button>
        </form>
      </div>
      <p class="link"><a href="#/login">Volver a entrar</a></p>
    </div>`;
  $('#f-recover').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ code: fd.get('code'), newPassword: fd.get('newPassword') })
      });
      toast('¡Clave actualizada! Ahora entra con tu correo 🎉');
      location.hash = '#/login';
    } catch (err) {
      const el = $('#err'); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

function viewRegister() {
  setNav(null);
  app.innerHTML = `
    ${topbar('GENLORIA')}
    <div class="form-wrap">
      <h1>Crear cuenta</h1>
      <p class="sub">Necesitas el código de invitación familiar</p>
      <div class="card">
        <form id="f-reg">
          <label>Nombre completo</label>
          <input type="text" name="name" required maxlength="60" placeholder="Ej: María Pérez">
          <label>Correo electrónico</label>
          <input type="email" name="email" required maxlength="120" placeholder="tucorreo@ejemplo.com">
          <label>Contraseña (mín. 8 caracteres)</label>
          <input type="password" name="password" autocomplete="new-password" required minlength="8">
          <label>Código de invitación</label>
          <input type="text" name="inviteCode" required placeholder="Ej: FAMILIA-2026" style="text-transform:uppercase">
          <div class="error hidden" id="err"></div>
          <button class="btn" type="submit">Crear mi cuenta</button>
        </form>
      </div>
      <p class="link">¿Ya tienes cuenta? <a href="#/login">Entrar</a></p>
    </div>`;
  $('#f-reg').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: fd.get('name'), email: fd.get('email'),
          password: fd.get('password'), inviteCode: fd.get('inviteCode')
        })
      });
      me = user;
      toast('¡Bienvenido a la familia! 🎉');
      location.hash = '#/feed';
    } catch (err) {
      const el = $('#err'); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

async function viewFeed() {
  setNav('feed');
  app.innerHTML = `${topbar('GENLORIA')}<div class="loading">Cargando…</div>`;
  try {
    const [feed, stories] = await Promise.all([
      api('/api/posts?limit=30'),
      api('/api/stories')
    ]);
    feedCache = feed.posts;
    storyGroups = stories.groups;
  } catch (e) {
    app.innerHTML = `${topbar('GENLORIA')}<div class="empty">No se pudo cargar. Revisa tu conexión.</div>`;
    return;
  }
  renderFeed();
}

function storyBarHTML() {
  const mine = storyGroups.find(g => g.user.id === me.id);
  let html = `<div class="stories-bar">`;
  html += `<button class="story-thumb add" id="add-story">
      <span class="ring"><img src="${me.avatar_path ? esc(me.avatar_path) : '/icons/avatar-default.svg'}" alt="+" onerror="this.src='/icons/avatar-default.svg'"></span>
      <div class="sname">${mine ? 'Mi historia ＋' : '＋ Historia'}</div>
    </button>`;
  for (const g of storyGroups.filter(g => g.user.id !== me.id)) {
    html += `<button class="story-thumb" data-stories="${esc(g.user.username)}">
      <span class="ring"><img src="${g.user.avatar_path ? esc(g.user.avatar_path) : '/icons/avatar-default.svg'}" alt="" onerror="this.src='/icons/avatar-default.svg'"></span>
      <div class="sname">${esc(g.user.name.split(' ')[0])}</div>
    </button>`;
  }
  html += `</div>`;
  return html;
}

function postCardHTML(p) {
  const canDelete = me && (p.author.id === me.id || me.role === 'admin');
  return `<article class="post" data-post="${p.id}">
    <div class="post-head">
      ${avatarHTML(p.author)}
      <div class="who"><b>${esc(p.author.name)}</b><small>@${esc(p.author.username)} · ${timeAgo(p.created_at)}</small></div>
      ${canDelete ? `<button class="del" data-del="${p.id}" aria-label="Borrar">🗑</button>` : ''}
    </div>
    ${p.text ? `<div class="post-text">${esc(p.text)}</div>` : ''}
    ${mediaHTML(p)}
    <div class="post-actions">
      <button data-like="${p.id}" class="${p.liked ? 'liked' : ''}">${p.liked ? '❤️' : '🤍'} ${p.likeCount}</button>
      <button data-comments="${p.id}">💬 ${p.commentCount}</button>
    </div>
    <div class="comments hidden" id="comments-${p.id}"></div>
  </article>`;
}

function renderFeed() {
  app.innerHTML = `${topbar('GENLORIA')}
    ${storyBarHTML()}
    <div id="feed-list">
      ${feedCache.length ? feedCache.map(postCardHTML).join('') : '<div class="empty">Aún no hay publicaciones.<br>Sé el primero en compartir algo con la familia 💛</div>'}
    </div>`;

  $('#add-story').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData();
      fd.append('media', input.files[0]);
      try {
        toast('Subiendo historia…');
        await apiForm('/api/stories', fd);
        toast('¡Historia publicada! ✨');
        viewFeed();
      } catch (e) { toast('Error: ' + e.message); }
    };
    input.click();
  });

  $$('#feed-list [data-stories]').forEach(b =>
    b.addEventListener('click', () => openStoryViewer(b.dataset.stories)));
  const mineBtn = storyGroups.find(g => g.user.id === me.id);
  if (mineBtn) {
    // si ya tiene historia, el botón ＋ abre su visor también
    $('#add-story').addEventListener('dblclick', () => openStoryViewer(me.username));
  }

  $('#feed-list').addEventListener('click', async e => {
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) {
      const id = likeBtn.dataset.like;
      try {
        const r = await api(`/api/posts/${id}/like`, { method: 'POST' });
        const p = feedCache.find(x => x.id == id);
        if (p) { p.liked = r.liked; p.likeCount = r.likeCount; }
        likeBtn.classList.toggle('liked', r.liked);
        likeBtn.innerHTML = `${r.liked ? '❤️' : '🤍'} ${r.likeCount}`;
      } catch (err) { toast(err.message); }
      return;
    }
    const cBtn = e.target.closest('[data-comments]');
    if (cBtn) {
      const id = cBtn.dataset.comments;
      const box = $(`#comments-${id}`);
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      try {
        const { comments } = await api(`/api/posts/${id}/comments`);
        box.innerHTML = comments.map(c => `
          <div class="comment">${avatarHTML(c.author)}
            <div><b>${esc(c.author.name)}</b> ${esc(c.text)}<br><small style="color:var(--muted)">${timeAgo(c.created_at)}</small></div>
          </div>`).join('') + `
          <form class="comment-form" data-cform="${id}">
            <input type="text" name="text" placeholder="Escribe un comentario…" maxlength="500" required>
            <button type="submit">➤</button>
          </form>`;
        box.classList.remove('hidden');
        box.querySelector('form').addEventListener('submit', async ev => {
          ev.preventDefault();
          const text = ev.target.text.value.trim();
          if (!text) return;
          try {
            await api(`/api/posts/${id}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
            const p = feedCache.find(x => x.id == id);
            if (p) p.commentCount++;
            cBtn.innerHTML = `💬 ${p ? p.commentCount : ''}`;
            box.classList.add('hidden');
            toast('Comentario publicado 💬');
          } catch (err) { toast(err.message); }
        });
      } catch (err) { toast(err.message); }
      return;
    }
    const delBtn = e.target.closest('[data-del]');
    if (delBtn) {
      if (!confirm('¿Borrar esta publicación?')) return;
      try {
        await api(`/api/posts/${delBtn.dataset.del}`, { method: 'DELETE' });
        feedCache = feedCache.filter(x => x.id != delBtn.dataset.del);
        renderFeed();
      } catch (err) { toast(err.message); }
    }
  });
}

// ---------- Visor de historias ----------
let storyState = null;
function openStoryViewer(username) {
  const group = storyGroups.find(g => g.user.username === username);
  if (!group || !group.stories.length) return;
  storyState = { group, idx: 0 };
  renderStory();
  $('#story-viewer').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeStoryViewer() {
  $('#story-viewer').classList.add('hidden');
  $('#story-viewer').innerHTML = '';
  document.body.style.overflow = '';
  storyState = null;
}
function renderStory() {
  const { group, idx } = storyState;
  const s = group.stories[idx];
  const media = s.media_type === 'video'
    ? `<video src="${esc(s.media_path)}" autoplay playsinline controls></video>`
    : `<img src="${esc(s.media_path)}" alt="historia">`;
  const canDel = me && (group.user.id === me.id || me.role === 'admin');
  $('#story-viewer').innerHTML = `
    <div class="s-top">
      ${avatarHTML(group.user)}
      <div class="grow"><b>${esc(group.user.name)}</b><br><small>${timeAgo(s.created_at)} · ${idx + 1}/${group.stories.length}</small></div>
      ${canDel ? `<button id="s-del">🗑</button>` : ''}
      <button id="s-close">✕</button>
    </div>
    <div class="s-media">${media}</div>
    <div class="s-nav">
      <button id="s-prev">‹</button>
      <button id="s-next">›</button>
    </div>`;
  $('#s-close').onclick = closeStoryViewer;
  $('#s-prev').onclick = () => { storyState.idx = (idx - 1 + group.stories.length) % group.stories.length; renderStory(); };
  $('#s-next').onclick = () => {
    if (idx + 1 < group.stories.length) { storyState.idx++; renderStory(); }
    else closeStoryViewer();
  };
  const del = $('#s-del');
  if (del) del.onclick = async () => {
    if (!confirm('¿Borrar esta historia?')) return;
    try { await api(`/api/stories/${s.id}`, { method: 'DELETE' }); closeStoryViewer(); viewFeed(); }
    catch (e) { toast(e.message); }
  };
}

// ---------- Crear publicación ----------
function viewNew() {
  setNav('new');
  app.innerHTML = `
    ${topbar('Nueva publicación')}
    <div class="card">
      <form id="f-post">
        <label>¿Qué quieres compartir con la familia?</label>
        <textarea name="text" maxlength="2000" placeholder="Escribe algo…"></textarea>
        <label class="file-label" for="media-input">📷 Añadir foto o video</label>
        <input type="file" id="media-input" name="media" accept="image/*,video/*">
        <div class="preview hidden" id="preview"></div>
        <div class="error hidden" id="err"></div>
        <button class="btn" type="submit">Publicar 💛</button>
      </form>
    </div>`;
  const input = $('#media-input');
  input.addEventListener('change', () => {
    const f = input.files[0];
    const pv = $('#preview');
    if (!f) { pv.classList.add('hidden'); pv.innerHTML = ''; return; }
    const url = URL.createObjectURL(f);
    pv.innerHTML = f.type.startsWith('video')
      ? `<video src="${url}" controls playsinline></video>`
      : `<img src="${url}" alt="vista previa">`;
    pv.classList.remove('hidden');
  });
  $('#f-post').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('text').toString().trim() && !input.files[0]) {
      const el = $('#err'); el.textContent = 'Escribe algo o adjunta una foto/video.'; el.classList.remove('hidden');
      return;
    }
    try {
      toast('Publicando…');
      await apiForm('/api/posts', fd);
      toast('¡Publicado! 🎉');
      location.hash = '#/feed';
    } catch (err) {
      const el = $('#err'); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

// ---------- Perfil ----------
async function viewProfile(username) {
  setNav('profile');
  const uname = username || (me && me.username);
  app.innerHTML = `${topbar('Perfil')}<div class="loading">Cargando…</div>`;
  try {
    const { user, postCount } = await api(`/api/users/${encodeURIComponent(uname)}`);
    const isMine = me && user.id === me.id;
    // Detalles familiares desde el árbol genealógico
    let familyHTML = '';
    const t = await api('/api/tree').catch(() => null);
    if (t) {
      const byId = Object.fromEntries(t.users.map(u => [u.id, u]));
      const parents = (t.parents[user.id] || []).map(id => byId[id]).filter(Boolean);
      const children = Object.entries(t.parents)
        .filter(([cid, pids]) => pids.includes(user.id))
        .map(([cid]) => byId[cid]).filter(Boolean);
      const pair = (t.couples || []).find(([a, b]) => a === user.id || b === user.id);
      const partner = pair ? byId[pair[0] === user.id ? pair[1] : pair[0]] : null;
      const isAdmin = me && me.role === 'admin';
      const rows = [];
      if (partner) rows.push(['💑 Pareja', partner.name, `delc:${pair[0]}:${pair[1]}`]);
      parents.forEach(p => rows.push(['👪 Padre/Madre', p.name, `delp:${p.id}:${user.id}`]));
      children.forEach(c => rows.push(['🧒 Hijo/a', c.name, `delp:${user.id}:${c.id}`]));
      familyHTML = `<div class="card"><h3 style="margin-top:0">👨‍👩‍👧 Familia</h3>`;
      familyHTML += rows.length
        ? rows.map(([k, v, del]) => `<p style="margin:6px 0"><strong>${k}:</strong> ${esc(v)}${isAdmin ? ` <button class="mini-btn danger" data-famdel="${del}" style="padding:2px 10px">✕</button>` : ''}</p>`).join('')
        : `<p style="color:var(--muted)">Sin relaciones registradas.</p>`;
      if (isAdmin) {
        const opts = t.users.filter(u => u.id !== user.id)
          .map(u => `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)})</option>`).join('');
        familyHTML += `
          <form id="f-famparent" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <select name="parentId" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)"><option value="">Padre/madre…</option>${opts}</select>
            <button class="mini-btn" type="submit">Añadir</button>
          </form>
          ${!partner ? `<form id="f-fampartner" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <select name="partnerId" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)"><option value="">Pareja…</option>${opts}</select>
            <button class="mini-btn" type="submit">Añadir</button>
          </form>` : ''}`;
      } else {
        familyHTML += `<button class="mini-btn" data-go="#/tree/suggest?uid=${user.id}" style="margin-top:8px">Proponer parentesco</button>`;
      }
      familyHTML += `</div>`;
    }
    const det = [];
    if (user.birthdate) det.push(`<p style="margin:6px 0">🎂 <strong>Nació:</strong> ${esc(fmtDate(user.birthdate))}</p>`);
    if (user.phone) det.push(`<p style="margin:6px 0">📞 <strong>Teléfono:</strong> ${esc(user.phone)}</p>`);
    const detailsHTML = det.length ? `<div class="card"><h3 style="margin-top:0">📋 Detalles</h3>${det.join('')}</div>` : '';
    app.innerHTML = `
      ${topbar('Perfil')}
      <div class="profile-head">
        ${avatarHTML(user)}
        <h2>${esc(user.name)}</h2>
        <p class="uname">@${esc(user.username)} ${user.role === 'admin' ? '<span class="chip">ADMIN</span>' : ''}</p>
        ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ''}
        <p class="uname">${postCount} publicaciones</p>
      </div>
      ${detailsHTML}
      ${familyHTML}
      <div class="menu-list">
        ${isMine ? `<button data-go="#/settings">✏️ Editar mi perfil</button>` : ''}
        ${me && me.role === 'admin' ? `<button data-go="#/admin">🛠 Administración</button>` : ''}
        ${isMine ? `<button data-logout style="color:var(--danger)">🚪 Cerrar sesión</button>` : ''}
      </div>`;
    $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
    const fp = $('#f-famparent');
    if (fp) fp.addEventListener('submit', async e => {
      e.preventDefault();
      const pid = parseInt(new FormData(e.target).get('parentId'), 10);
      if (!pid) return;
      try {
        await api('/api/tree/parents', { method: 'POST', body: JSON.stringify({ parentId: pid, childId: user.id }) });
        toast('Parentesco agregado ✅'); viewProfile(username);
      } catch (err) { toast(err.message); }
    });
    const fc = $('#f-fampartner');
    if (fc) fc.addEventListener('submit', async e => {
      e.preventDefault();
      const pid = parseInt(new FormData(e.target).get('partnerId'), 10);
      if (!pid) return;
      try {
        await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({ user1Id: user.id, user2Id: pid }) });
        toast('Pareja agregada ✅'); viewProfile(username);
      } catch (err) { toast(err.message); }
    });
    $$('#app [data-famdel]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('¿Quitar esta relación?')) return;
      const [kind, a, c] = b.dataset.famdel.split(':');
      try {
        if (kind === 'delp') await api('/api/tree/parents', { method: 'DELETE', body: JSON.stringify({ parentId: +a, childId: +c }) });
        else await api('/api/tree/couples', { method: 'DELETE', body: JSON.stringify({ user1Id: +a, user2Id: +c }) });
        toast('Relación eliminada ✅'); viewProfile(username);
      } catch (err) { toast(err.message); }
    }));
    const lo = $('#app [data-logout]');
    if (lo) lo.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      me = null; location.hash = '#/login';
    });
  } catch (e) {
    app.innerHTML = `${topbar('Perfil')}<div class="empty">No se encontró ese perfil.</div>`;
  }
}

function viewSettings() {
  setNav('profile');
  app.innerHTML = `
    ${topbar('Editar perfil')}
    <div class="card">
      <form id="f-profile">
        <div style="text-align:center">${avatarHTML(me)}</div>
        <label class="file-label" for="avatar-input">📷 Cambiar foto de perfil</label>
        <input type="file" id="avatar-input" name="avatar" accept="image/*">
        <label>Nombre</label>
        <input type="text" name="name" value="${esc(me.name)}" maxlength="60" required>
        <label>Bio</label>
        <textarea name="bio" maxlength="300" style="min-height:70px" placeholder="Cuéntanos algo de ti…">${esc(me.bio || '')}</textarea>
        <label>Fecha de nacimiento</label>
        <input type="date" name="birthdate" value="${esc(me.birthdate || '')}">
        <label>Teléfono</label>
        <input type="tel" name="phone" value="${esc(me.phone || '')}" maxlength="30" placeholder="Opcional">
        <button class="btn" type="submit">Guardar cambios</button>
      </form>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Cambiar contraseña</h3>
      <form id="f-pass">
        <label>Contraseña actual</label>
        <input type="password" name="current" required>
        <label>Nueva contraseña (mín. 8)</label>
        <input type="password" name="next" required minlength="8">
        <button class="btn secondary" type="submit">Cambiar contraseña</button>
      </form>
    </div>`;
  $('#f-profile').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const { user } = await apiForm('/api/users/me', new FormData(e.target), 'PUT');
      me = user;
      toast('Perfil actualizado ✅');
      location.hash = '#/profile';
    } catch (err) { toast(err.message); }
  });
  $('#f-pass').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/users/me/password', {
        method: 'PUT',
        body: JSON.stringify({ current: fd.get('current'), next: fd.get('next') })
      });
      toast('Contraseña cambiada ✅');
      e.target.reset();
    } catch (err) { toast(err.message); }
  });
}

// ---------- Hoja inferior ----------
function openSheet(html) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-body">${html}</div>`;
  sh.classList.remove('hidden');
  sh.onclick = e => { if (e.target === sh) closeSheet(); };
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheet').innerHTML = '';
}

// ---------- Árbol genealógico ----------
let treeData = null;

async function viewTree() {
  setNav('tree');
  app.innerHTML = `${topbar('Árbol familiar')}<div class="loading">Dibujando el árbol…</div>`;
  try {
    treeData = await api('/api/tree');
  } catch (e) {
    app.innerHTML = `${topbar('Árbol familiar')}<div class="empty">No se pudo cargar el árbol.</div>`;
    return;
  }
  const { users, parents, couples } = treeData;
  const layout = window.TreeModule.layoutTree(users, parents, couples);
  const linkedIds = new Set(Object.keys(layout.pos).map(Number));
  const unlinked = users.filter(u => !linkedIds.has(u.id));

  app.innerHTML = `
    ${topbar('Árbol familiar', `<button class="icon" id="tree-suggest-top" title="Proponer corrección">✏️</button>`)}
    <div class="tree-wrap">
      <div class="tree-scroll" id="tree-scroll">
        <div class="tree-zoom">
          <button id="zoom-out">−</button>
          <button id="zoom-in">＋</button>
          <button id="zoom-reset" style="background:#e5e7eb;color:var(--text)">⟳</button>
        </div>
        ${window.TreeModule.renderTreeSVG(layout)}
      </div>
    </div>
    ${unlinked.length ? `
      <div class="unlinked">
        <h3 style="margin:12px 12px 4px">Sin relaciones registradas</h3>
        <div class="unlinked-grid">
          ${unlinked.map(u => `<button data-uplink="${u.id}">${avatarHTML(u)} ${esc(u.name.split(' ')[0])}</button>`).join('')}
        </div>
      </div>` : ''}
    <div class="card" style="font-size:.9rem;color:var(--muted)">
      💡 Toca una persona para ver su perfil o proponer una corrección.
      ${me.role === 'admin' ? 'Como administrador puedes editar el árbol desde <b>Perfil → Administración → Árbol</b>.' : 'El administrador revisa las correcciones propuestas.'}
    </div>`;

  // zoom
  let scale = 1;
  const applyZoom = () => {
    const g = $('#tree-zoom');
    if (g) g.setAttribute('transform', `scale(${scale})`);
    const svg = $('#tree-svg');
    if (svg) { svg.setAttribute('width', layout.width * scale); svg.setAttribute('height', layout.height * scale); }
  };
  $('#zoom-in').onclick = () => { scale = Math.min(2.5, scale + 0.25); applyZoom(); };
  $('#zoom-out').onclick = () => { scale = Math.max(0.5, scale - 0.25); applyZoom(); };
  $('#zoom-reset').onclick = () => { scale = 1; applyZoom(); };

  // nodos → hoja con acciones
  const openFor = uid => {
    const u = users.find(x => x.id === uid);
    if (!u) return;
    openSheet(`
      <div class="who">${avatarHTML(u)}<div><b>${esc(u.name)}</b><br><small style="color:var(--muted)">@${esc(u.username)}</small></div></div>
      <button class="btn secondary" id="sh-profile">👤 Ver perfil</button>
      <button class="btn" id="sh-suggest">✏️ Proponer corrección</button>
      <button class="btn secondary" id="sh-close">Cerrar</button>`);
    $('#sh-profile').onclick = () => { closeSheet(); location.hash = '#/u/' + encodeURIComponent(u.username); };
    $('#sh-suggest').onclick = () => { closeSheet(); location.hash = '#/tree/suggest?uid=' + u.id; };
    $('#sh-close').onclick = closeSheet;
  };
  $$('#tree-svg .tnode').forEach(n =>
    n.addEventListener('click', () => openFor(+n.dataset.uid)));
  $$('[data-uplink]').forEach(b =>
    b.addEventListener('click', () => openFor(+b.dataset.uplink)));
  $('#tree-suggest-top').onclick = () => location.hash = '#/tree/suggest';
}

function userOptions(users, selected) {
  return users.map(u =>
    `<option value="${u.id}" ${u.id === selected ? 'selected' : ''}>${esc(u.name)} (@${esc(u.username)})</option>`).join('');
}

async function viewSuggest() {
  setNav('tree');
  const params = new URLSearchParams((location.hash.split('?')[1] || ''));
  const preset = parseInt(params.get('uid') || '0', 10) || null;
  if (!treeData) { try { treeData = await api('/api/tree'); } catch { treeData = { users: [] }; } }
  const users = treeData.users;
  app.innerHTML = `
    ${topbar('Proponer corrección')}
    <div class="card">
      <p style="color:var(--muted);font-size:.92rem;margin-top:0">
        El administrador revisará tu propuesta antes de cambiar el árbol.</p>
      <form id="f-suggest">
        <label>Tipo de corrección</label>
        <select name="kind" id="sg-kind" style="width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--border);font-size:1rem">
          <option value="add_parent">➕ Es su padre/madre (agregar)</option>
          <option value="remove_parent">➖ No es su padre/madre (quitar)</option>
          <option value="add_couple">💛 Son pareja (agregar)</option>
          <option value="remove_couple">💔 Ya no son pareja (quitar)</option>
        </select>
        <label>Persona A</label>
        <select name="userAId" id="sg-a" style="width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--border);font-size:1rem">${userOptions(users, me.id)}</select>
        <label>Persona B</label>
        <select name="userBId" id="sg-b" style="width:100%;padding:12px;border-radius:10px;border:1.5px solid var(--border);font-size:1rem">${userOptions(users, preset)}</select>
        <label>Nota (opcional)</label>
        <textarea name="note" maxlength="500" style="min-height:70px" placeholder="Ej: Es mi tío por parte de mamá…"></textarea>
        <button class="btn" type="submit">Enviar propuesta</button>
      </form>
    </div>`;
  $('#f-suggest').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/tree/suggest', {
        method: 'POST',
        body: JSON.stringify({
          kind: fd.get('kind'),
          userAId: parseInt(fd.get('userAId'), 10),
          userBId: parseInt(fd.get('userBId'), 10),
          note: fd.get('note')
        })
      });
      toast('Propuesta enviada ✅');
      location.hash = '#/tree';
    } catch (err) { toast(err.message); }
  });
}

// ---------- Admin: pestaña Árbol ----------
async function adminTreeTab(body) {
  const [{ users }, tree, { suggestions }] = await Promise.all([
    api('/api/users/admin/users'), api('/api/tree'), api('/api/tree/suggestions')
  ]);
  const byId = Object.fromEntries(users.map(u => [u.id, u.name]));
  const parentRows = [];
  Object.entries(tree.parents).forEach(([child, ps]) =>
    ps.forEach(p => parentRows.push({ p, child: +child })));
  const pending = suggestions.filter(s => s.status === 'pending');

  body.innerHTML = `
    <h3 style="margin-top:0">Propuestas pendientes (${pending.length})</h3>
    ${pending.length ? pending.map(s => `
      <div class="row"><div class="grow">
        <b>${esc(s.kindLabel)}</b>
        <small>${esc(s.userA.name)} ↔ ${esc(s.userB.name)} · por ${esc(s.proposedBy || '?')}</small>
        ${s.note ? `<small>“${esc(s.note)}”</small>` : ''}
      </div>
      <button class="mini-btn" data-approve="${s.id}">✓</button>
      <button class="mini-btn danger" data-reject="${s.id}">✕</button></div>`).join('')
      : '<p style="color:var(--muted)">Sin propuestas pendientes.</p>'}
    <h3>Agregar padre/madre → hijo/a</h3>
    <form id="f-addparent" style="display:flex;gap:8px;flex-wrap:wrap">
      <select name="parentId" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)">${userOptions(users)}</select>
      <select name="childId" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)">${userOptions(users)}</select>
      <button class="mini-btn" type="submit">Añadir</button>
    </form>
    <h3>Agregar pareja</h3>
    <form id="f-addcouple" style="display:flex;gap:8px;flex-wrap:wrap">
      <select name="user1Id" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)">${userOptions(users)}</select>
      <select name="user2Id" style="flex:1;min-width:130px;padding:10px;border-radius:8px;border:1.5px solid var(--border)">${userOptions(users)}</select>
      <button class="mini-btn" type="submit">Añadir</button>
    </form>
    <h3>Relaciones registradas</h3>
    ${parentRows.map(r => `
      <div class="row"><div class="grow"><small>👪 ${esc(byId[r.p] || '?')} → ${esc(byId[r.child] || '?')}</small></div>
        <button class="mini-btn danger" data-delp="${r.p}:${r.child}">Quitar</button></div>`).join('')}
    ${tree.couples.map(([a, b]) => `
      <div class="row"><div class="grow"><small>💛 ${esc(byId[a] || '?')} ↔ ${esc(byId[b] || '?')}</small></div>
        <button class="mini-btn danger" data-delc="${a}:${b}">Quitar</button></div>`).join('')}
    ${!parentRows.length && !tree.couples.length ? '<p style="color:var(--muted)">Aún no hay relaciones.</p>' : ''}`;

  $('#f-addparent').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/tree/parents', { method: 'POST', body: JSON.stringify({
        parentId: +fd.get('parentId'), childId: +fd.get('childId') }) });
      toast('Relación agregada ✅'); viewAdmin('tree');
    } catch (err) { toast(err.message); }
  });
  $('#f-addcouple').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({
        user1Id: +fd.get('user1Id'), user2Id: +fd.get('user2Id') }) });
      toast('Pareja agregada ✅'); viewAdmin('tree');
    } catch (err) { toast(err.message); }
  });
  $$('[data-delp]', body).forEach(b => b.addEventListener('click', async () => {
    const [p, c] = b.dataset.delp.split(':');
    if (!confirm('¿Quitar esta relación?')) return;
    await api('/api/tree/parents', { method: 'DELETE', body: JSON.stringify({ parentId: +p, childId: +c }) });
    viewAdmin('tree');
  }));
  $$('[data-delc]', body).forEach(b => b.addEventListener('click', async () => {
    const [a, c] = b.dataset.delc.split(':');
    if (!confirm('¿Quitar esta pareja?')) return;
    await api('/api/tree/couples', { method: 'DELETE', body: JSON.stringify({ user1Id: +a, user2Id: +c }) });
    viewAdmin('tree');
  }));
  $$('[data-approve]', body).forEach(b => b.addEventListener('click', async () => {
    try {
      await api(`/api/tree/suggestions/${b.dataset.approve}/approve`, { method: 'POST' });
      toast('Propuesta aplicada ✅'); viewAdmin('tree');
    } catch (err) { toast(err.message); }
  }));
  $$('[data-reject]', body).forEach(b => b.addEventListener('click', async () => {
    await api(`/api/tree/suggestions/${b.dataset.reject}/reject`, { method: 'POST' });
    viewAdmin('tree');
  }));
}

// ---------- Admin ----------
async function viewAdmin(tab) {
  if (!me || me.role !== 'admin') { location.hash = '#/feed'; return; }
  setNav('profile');
  app.innerHTML = `${topbar('Administración')}<div class="loading">Cargando…</div>`;
  const [{ users }, { codes }] = await Promise.all([
    api('/api/users/admin/users'), api('/api/users/admin/invite-codes')
  ]);
  app.innerHTML = `
    ${topbar('Administración')}
    <div class="tabs">
      <button id="tab-users" class="${tab !== 'codes' && tab !== 'tree' ? 'active' : ''}">👥 Usuarios</button>
      <button id="tab-codes" class="${tab === 'codes' ? 'active' : ''}">🎟 Códigos</button>
      <button id="tab-tree" class="${tab === 'tree' ? 'active' : ''}">🌳 Árbol</button>
    </div>
    <div class="card" id="admin-body"></div>`;
  const body = $('#admin-body');
  function showUsers() {
    body.innerHTML = `
      <h3 style="margin-top:0">Crear cuenta</h3>
      <p class="sub">El familiar elegirá su propia clave con el código que se genere — tú nunca la verás.</p>
      <form id="f-newuser">
        <label>Nombre completo</label><input type="text" name="name" required maxlength="60">
        <label>Correo electrónico</label><input type="email" name="email" required maxlength="120">
        <label>Padre (opcional)</label><select name="fatherId"><option value="">— Ninguno —</option>${userOptions(users)}</select>
        <label>Madre (opcional)</label><select name="motherId"><option value="">— Ninguna —</option>${userOptions(users)}</select>
        <label>Pareja (opcional)</label><select name="partnerId"><option value="">— Ninguna —</option>${userOptions(users)}</select>
        <button class="btn" type="submit">Crear cuenta</button>
      </form>
      <div id="setup-code"></div>
      <h3>Miembros (${users.length})</h3>
      ${users.map(u => `<div class="row">${avatarHTML(u)}
        <div class="grow"><b>${esc(u.name)}</b><small>${esc(u.email || '')}${u.role === 'admin' ? ' · ADMIN' : ''}</small></div>
        ${u.id !== me.id ? `<button class="mini-btn" data-recover="${u.id}">🔑 Código</button>` : ''}
      </div>`).join('')}
      <div id="recover-code"></div>`;
    $('#f-newuser').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { user, setupCode } = await api('/api/users/admin/users', {
          method: 'POST',
          body: JSON.stringify({ name: fd.get('name'), email: fd.get('email') })
        });
        const linkErrs = [];
        const fid = parseInt(fd.get('fatherId'), 10) || 0;
        const mid = parseInt(fd.get('motherId'), 10) || 0;
        const pid = parseInt(fd.get('partnerId'), 10) || 0;
        for (const p of [fid, mid]) {
          if (!p) continue;
          try { await api('/api/tree/parents', { method: 'POST', body: JSON.stringify({ parentId: p, childId: user.id }) }); }
          catch (e) { linkErrs.push(e.message); }
        }
        if (pid) {
          try { await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({ user1Id: user.id, user2Id: pid }) }); }
          catch (e) { linkErrs.push(e.message); }
        }
        $('#setup-code').innerHTML = `<div class="card" style="border-color:var(--accent)">
          <b>Código de configuración (compártelo con el familiar):</b>
          <div style="font-size:1.6rem;letter-spacing:.2em;margin:.4rem 0"><b>${esc(setupCode)}</b></div>
          <small>Con este código elegirá su propia clave. Válido por 24 horas, un solo uso.</small></div>`;
        toast(linkErrs.length ? 'Cuenta creada ✅ (parentesco: ' + linkErrs.join('; ') + ')' : 'Cuenta creada ✅'); viewAdmin();
      } catch (err) { toast(err.message); }
    });
    body.querySelectorAll('[data-recover]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const { name, code } = await api(`/api/users/admin/users/${btn.dataset.recover}/recovery-code`, { method: 'POST' });
          $('#recover-code').innerHTML = `<div class="card" style="border-color:var(--accent)">
            <b>Código de recuperación para ${esc(name)}:</b>
            <div style="font-size:1.6rem;letter-spacing:.2em;margin:.4rem 0"><b>${esc(code)}</b></div>
            <small>Compártelo con ${esc(name)} para que elija su clave nueva. Válido por 24 horas, un solo uso. Tú no verás su clave.</small></div>`;
        } catch (err) { toast(err.message); }
      });
    });
  }
  function showCodes() {
    body.innerHTML = `
      <h3 style="margin-top:0">Nuevo código de invitación</h3>
      <form id="f-newcode">
        <label>Código (vacío = aleatorio)</label><input type="text" name="code" placeholder="Ej: NAVIDAD-2026">
        <label>Usos máximos (0 = ilimitado)</label><input type="text" name="maxUses" value="0" inputmode="numeric">
        <button class="btn" type="submit">Generar código</button>
      </form>
      <h3>Códigos</h3>
      ${codes.map(c => `<div class="row">
        <div class="grow"><b>${esc(c.code)}</b><small>${c.used_count}${c.max_uses > 0 ? '/' + c.max_uses : ''} usados · ${c.active ? 'activo' : 'desactivado'}</small></div>
        ${c.active ? `<button class="mini-btn danger" data-deact="${c.id}">Desactivar</button>` : ''}
      </div>`).join('') || '<p class="empty">Sin códigos</p>'}`;
    $('#f-newcode').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { inviteCode } = await api('/api/users/admin/invite-codes', {
          method: 'POST',
          body: JSON.stringify({ code: fd.get('code'), maxUses: fd.get('maxUses') })
        });
        toast('Código: ' + inviteCode.code); viewAdmin();
      } catch (err) { toast(err.message); }
    });
    $$('[data-deact]', body).forEach(b => b.addEventListener('click', async () => {
      await api(`/api/users/admin/invite-codes/${b.dataset.deact}`, { method: 'DELETE' });
      viewAdmin();
    }));
  }
  function activateTab(name) {
    ['users', 'codes', 'tree'].forEach(t =>
      $('#tab-' + t).classList.toggle('active', t === name));
  }
  $('#tab-users').addEventListener('click', () => { activateTab('users'); showUsers(); });
  $('#tab-codes').addEventListener('click', () => { activateTab('codes'); showCodes(); });
  $('#tab-tree').addEventListener('click', () => { activateTab('tree'); adminTreeTab(body); });
  if (tab === 'tree') { activateTab('tree'); adminTreeTab(body); }
  else if (tab === 'codes') { activateTab('codes'); showCodes(); }
  else showUsers();
}

// ---------- Router ----------
async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    me = user;
  } catch { me = null; }

  async function route() {
    const h = location.hash || '#/feed';
    if (!me && h !== '#/login' && h !== '#/register' && h !== '#/recover') { location.hash = '#/login'; return; }
    if (me && (h === '#/login' || h === '#/register' || h === '#/recover')) { location.hash = '#/feed'; return; }
    if (h === '#/login') return viewLogin();
    if (h === '#/register') return viewRegister();
    if (h === '#/recover') return viewRecover();
    if (h === '#/feed') return viewFeed();
    if (h === '#/new') return viewNew();
    if (h === '#/tree' || h.startsWith('#/tree?')) return viewTree();
    if (h.startsWith('#/tree/suggest')) return viewSuggest();
    if (h === '#/profile') return viewProfile();
    if (h === '#/settings') return viewSettings();
    if (h === '#/admin') return viewAdmin();
    const m = h.match(/^#\/u\/(.+)$/);
    if (m) return viewProfile(decodeURIComponent(m[1]));
    location.hash = '#/feed';
  }
  window.addEventListener('hashchange', route);
  route();
}

document.addEventListener('DOMContentLoaded', boot);
