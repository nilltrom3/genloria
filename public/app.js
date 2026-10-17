// app.js — SPA de GENLORIA (vanilla JS)
'use strict';

const APP_VERSION = '9';
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
function fmtDateTime(iso) {
  const d = new Date((iso || '').replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return iso || '';
  const fecha = d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  return `${fecha} · ${h}:${m} ${ap}`;
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
      (active === 'family' && target === '#/family') ||
      (active === 'profile' && target === '#/profile')
    ));
  });
}

bottomnav.addEventListener('click', e => {
  const b = e.target.closest('button[data-nav]');
  if (b) location.hash = b.dataset.nav;
});

// ---------- Idioma (login) ----------
let appLang = localStorage.getItem('genloria-lang') || 'es';
const STR = {
  es: {
    hello: '¡Hola!', loginSub: 'Inicia sesión para continuar tu historia.',
    emailUser: 'Correo electrónico o usuario', password: 'Contraseña',
    login: 'Entrar', remember: 'Mantener sesión iniciada', forgot: '¿Olvidaste tu clave?',
    firstTime: '¿PRIMERA VEZ?', createAccount: 'Crea tu cuenta', joinTree: 'Únete y comienza tu árbol familiar.',
    slogan1: 'Generaciones unidas.', slogan2: 'Historias que perduran.',
    heroDesc: 'Conecta, preserva y celebra la historia de tu familia en un solo lugar.',
    badge1: 'Privado y seguro', badge2: 'Tu familia en un solo lugar', badge3: 'Historias que perduran',
    needCreds: 'Escribe tu correo o usuario y tu contraseña.', loginError: 'Correo o contraseña incorrectos.',
    registerTitle: 'Crear cuenta', registerSub: 'Únete a tu familia con el código familiar.',
    fullName: 'Nombre completo', email: 'Correo electrónico', inviteCode: 'Código familiar',
    createBtn: 'Crear mi cuenta', hasAccount: '¿Ya tienes cuenta? Entra',
    recoverTitle: 'Recuperar acceso', recoverSub: 'Pide tu código al administrador de tu familia.',
    codeLabel: 'Código de recuperación', newPass: 'Nueva contraseña (mín. 8)',
    recoverBtn: 'Cambiar mi contraseña', backToLogin: '← Volver a entrar'
  },
  en: {
    hello: 'Hello!', loginSub: 'Log in to continue your story.',
    emailUser: 'Email or username', password: 'Password',
    login: 'Log in', remember: 'Keep me logged in', forgot: 'Forgot your password?',
    firstTime: 'FIRST TIME?', createAccount: 'Create your account', joinTree: 'Join and start your family tree.',
    slogan1: 'United generations.', slogan2: 'Stories that endure.',
    heroDesc: 'Connect, preserve and celebrate your family history in one place.',
    badge1: 'Private and secure', badge2: 'Your family in one place', badge3: 'Stories that endure',
    needCreds: 'Enter your email or username and password.', loginError: 'Incorrect email or password.',
    registerTitle: 'Create account', registerSub: 'Join your family with the family code.',
    fullName: 'Full name', email: 'Email', inviteCode: 'Family code',
    createBtn: 'Create my account', hasAccount: 'Already have an account? Log in',
    recoverTitle: 'Recover access', recoverSub: 'Ask your family administrator for your code.',
    codeLabel: 'Recovery code', newPass: 'New password (min. 8)',
    recoverBtn: 'Change my password', backToLogin: '← Back to login'
  }
};
const T = k => (STR[appLang] && STR[appLang][k]) || STR.es[k] || k;

// ---------- Vistas ----------
function topbar(title, rightBtn) {
  const infoBtn = `<button class="topbar-info" data-go="#/about" aria-label="Qué es GENLORIA" title="Qué es GENLORIA">ⓘ</button>`;
  return `<div class="topbar"><div class="logo"><img src="/icons/icon-192.png" alt="GENLORIA"> GENLORIA</div><div style="display:flex;gap:8px;align-items:center">${infoBtn}${rightBtn || ''}</div></div>`;
}

function viewLogin() {
  setNav(null);
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/icons/icon-192.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
      <button class="login-lang" id="lang-btn">🌐 ${appLang === 'es' ? 'Español' : 'English'} ▾</button>
    </header>
    <div class="login-hero">
      <img src="/images/login-hero.jpg" alt="Árbol familiar">
      <div class="hero-overlay">
        <h1>GENLORIA</h1>
        <p class="slogan">${T('slogan1')}<br>${T('slogan2')}</p>
        <p class="desc">${T('heroDesc')}</p>
      </div>
    </div>
    <div class="login-card">
      <h2>👋 ${T('hello')}</h2>
      <p class="sub">${T('loginSub')}</p>
      <form id="f-login">
        <div class="login-field">
          <span class="fi">✉️</span>
          <input type="text" name="email" autocomplete="username" required placeholder="${T('emailUser')}">
        </div>
        <div class="login-field">
          <span class="fi">🔒</span>
          <input type="password" name="password" id="login-pass" autocomplete="current-password" required placeholder="${T('password')}">
          <button type="button" class="toggle-pass" id="toggle-pass" aria-label="Mostrar">👁</button>
        </div>
        <div class="login-error" id="err"></div>
        <button class="btn-login" type="submit">${T('login')} →</button>
        <div class="login-options">
          <label><input type="checkbox" name="remember" checked> ${T('remember')}</label>
          <a href="#/recover">${T('forgot')}</a>
        </div>
      </form>
    </div>
    <button class="register-card" data-go="#/register">
      <span class="rc-icon">👥</span>
      <span><small>${T('firstTime')}</small><b>${T('createAccount')}</b><p>${T('joinTree')}</p></span>
      <span class="rc-go">›</span>
    </button>
    <div class="trust-badges">
      <div><div class="tb-icon">🛡️</div>${T('badge1')}</div>
      <div><div class="tb-icon">👥</div>${T('badge2')}</div>
      <div><div class="tb-icon">🌿</div>${T('badge3')}</div>
    </div>
    <p class="login-version">GENLORIA v${APP_VERSION}</p>
  </div>`;
  $('#lang-btn').onclick = () => {
    appLang = appLang === 'es' ? 'en' : 'es';
    localStorage.setItem('genloria-lang', appLang);
    viewLogin();
  };
  $('#toggle-pass').onclick = () => {
    const p = $('#login-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
  };
  $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
  $('#f-login').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: fd.get('email'), password: fd.get('password'),
          remember: fd.get('remember') === 'on'
        })
      });
      me = user;
      location.hash = '#/feed';
    } catch (err) {
      $('#err').textContent = err.message;
    }
    btn.disabled = false;
  });
}

function viewRecover() {
  setNav(null);
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/icons/icon-192.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
      <button class="login-lang" id="lang-btn">🌐 ${appLang === 'es' ? 'Español' : 'English'} ▾</button>
    </header>
    <div class="login-card" style="margin-top:24px">
      <h2>🔑 ${T('recoverTitle')}</h2>
      <p class="sub">${T('recoverSub')}</p>
      <form id="f-recover">
        <div class="login-field">
          <span class="fi">🎫</span>
          <input type="text" name="code" required placeholder="${T('codeLabel')}" style="text-transform:uppercase" maxlength="16">
        </div>
        <div class="login-field">
          <span class="fi">🔒</span>
          <input type="password" name="newPassword" autocomplete="new-password" required minlength="8" placeholder="${T('newPass')}">
        </div>
        <div class="login-error" id="err"></div>
        <button class="btn-login" type="submit">${T('recoverBtn')}</button>
      </form>
      <p class="link" style="text-align:center;margin-top:14px"><a href="#/login">${T('backToLogin')}</a></p>
    </div>
  </div>`;
  $('#lang-btn').onclick = () => {
    appLang = appLang === 'es' ? 'en' : 'es';
    localStorage.setItem('genloria-lang', appLang);
    viewRecover();
  };
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
      $('#err').textContent = err.message;
    }
  });
}

function viewRegister() {
  setNav(null);
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/icons/icon-192.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
      <button class="login-lang" id="lang-btn">🌐 ${appLang === 'es' ? 'Español' : 'English'} ▾</button>
    </header>
    <div class="login-card" style="margin-top:24px">
      <h2>👥 ${T('registerTitle')}</h2>
      <p class="sub">${T('registerSub')}</p>
      <form id="f-reg">
        <div class="login-field">
          <span class="fi">👤</span>
          <input type="text" name="name" required maxlength="60" placeholder="${T('fullName')}">
        </div>
        <div class="login-field">
          <span class="fi">✉️</span>
          <input type="email" name="email" required maxlength="120" placeholder="${T('email')}">
        </div>
        <div class="login-field">
          <span class="fi">🔒</span>
          <input type="password" name="password" autocomplete="new-password" required minlength="8" placeholder="${T('password')} (mín. 8)">
        </div>
        <div class="login-field">
          <span class="fi">🎫</span>
          <input type="text" name="inviteCode" required placeholder="${T('inviteCode')}" style="text-transform:uppercase">
        </div>
        <div class="login-error" id="err"></div>
        <button class="btn-login" type="submit">${T('createBtn')}</button>
      </form>
      <p class="link" style="text-align:center;margin-top:14px"><a href="#/login">${T('hasAccount')}</a></p>
    </div>
  </div>`;
  $('#lang-btn').onclick = () => {
    appLang = appLang === 'es' ? 'en' : 'es';
    localStorage.setItem('genloria-lang', appLang);
    viewRegister();
  };
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
      $('#err').textContent = err.message;
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
      <div class="who"><b>${esc(p.author.name)}</b><small>${timeAgo(p.created_at)} · ${fmtDateTime(p.created_at)}</small></div>
      ${canDelete ? `<button class="del" data-postmenu="${p.id}" aria-label="Opciones">⋯</button>` : ''}
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
    const menuBtn = e.target.closest('[data-postmenu]');
    if (menuBtn) {
      const pid = menuBtn.dataset.postmenu;
      const post = feedCache.find(x => x.id == pid);
      openSheet(`
        <div class="menu-list" style="margin:0">
          <button id="pm-edit">✏️ Editar publicación</button>
          <button id="pm-del" style="color:var(--danger)">🗑 Eliminar publicación</button>
          <button id="pm-cancel">Cancelar</button>
        </div>`);
      $('#pm-cancel').onclick = closeSheet;
      $('#pm-del').onclick = async () => {
        closeSheet();
        if (!confirm('¿Borrar esta publicación?')) return;
        try {
          await api(`/api/posts/${pid}`, { method: 'DELETE' });
          feedCache = feedCache.filter(x => x.id != pid);
          renderFeed();
        } catch (err) { toast(err.message); }
      };
      $('#pm-edit').onclick = () => {
        closeSheet();
        openSheet(`
          <h3 style="margin-top:0">Editar publicación</h3>
          <textarea id="pm-text" style="min-height:120px">${esc(post ? post.text : '')}</textarea>
          <button class="btn" id="pm-save">Guardar cambios</button>
          <button class="btn secondary" id="pm-cancel2">Cancelar</button>`);
        $('#pm-cancel2').onclick = closeSheet;
        $('#pm-save').onclick = async () => {
          try {
            await api(`/api/posts/${pid}`, { method: 'PUT', body: JSON.stringify({ text: $('#pm-text').value }) });
            closeSheet(); toast('Publicación actualizada ✅'); loadFeed();
          } catch (err) { toast(err.message); }
        };
      };
      return;
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
    // Ficha genealógica (resumen) + botón para ver/editar la ficha completa
    let fichaHTML = '';
    {
      const rows = [];
      const kv = (k, v) => { if (v) rows.push(`<p style="margin:6px 0"><strong>${k}:</strong> ${v}</p>`); };
      if (user.nickname) kv('Apodo', `«${esc(user.nickname)}»`);
      kv('Nacimiento', [user.birthdate ? fmtDate(user.birthdate) : '', user.birth_place ? esc(user.birth_place) : ''].filter(Boolean).join(' — '));
      if (user.is_deceased) {
        kv('Fallecimiento', [user.death_date ? fmtDate(user.death_date) : '', user.death_place ? esc(user.death_place) : ''].filter(Boolean).join(' — '));
      }
      if (user.phone) kv('Teléfono', esc(user.phone));
      if (user.occupation) kv('Ocupación', esc(user.occupation));
      if (user.residence) kv('Residencia', esc(user.residence));
      fichaHTML = `<div class="card"><h3 style="margin-top:0">📋 Ficha genealógica</h3>
        ${rows.length ? rows.join('') : '<p style="color:var(--muted)">Sin datos registrados.</p>'}
        <button class="mini-btn" id="btn-ficha" style="margin-top:8px">Ver ficha completa</button>
      </div>`;
    }
    const exportHTML = isMine ? `<div class="card"><h3 style="margin-top:0">⬇️ Descargar datos familiares</h3>
      <p style="color:var(--muted);font-size:.9rem;margin-top:0">El PDF trae la portada, los datos por generación y el árbol. El GEDCOM sirve para otros programas de genealogía.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="mini-btn" href="/api/export/family.pdf" style="text-decoration:none" download>📄 PDF familiar</a>
        <a class="mini-btn" href="/api/export/family.gedcom" style="text-decoration:none" download>🌳 GEDCOM</a>
      </div></div>` : '';
    app.innerHTML = `
      ${topbar('Perfil')}
      <div class="profile-head">
        ${avatarHTML(user)}
        <h2>${esc(user.name)}${user.is_deceased ? ' ✝' : ''}</h2>
        <p class="uname">${user.is_placeholder ? '<span class="chip">SOLO ÁRBOL</span>' : `@${esc(user.username)}`} ${user.role === 'admin' ? '<span class="chip">ADMIN</span>' : ''}</p>
        ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ''}
        ${user.is_placeholder ? '' : `<p class="uname">${postCount} publicaciones</p>`}
      </div>
      ${fichaHTML}
      ${exportHTML}
      <div class="menu-list">
        ${isMine ? `<button data-go="#/settings">✏️ Editar mi perfil</button>` : ''}
        ${me && me.role === 'admin' ? `<button data-go="#/admin">🛠 Administración</button>` : ''}
        ${isMine ? `<button data-logout style="color:var(--danger)">🚪 Cerrar sesión</button>` : ''}
      </div>`;
    $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
    $('#btn-ficha').onclick = () => openPersonSheet(user.id, 'view');
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
      <h3 style="margin-top:0">📋 Ficha genealógica</h3>
      <p style="color:var(--muted);font-size:.92rem;margin-top:0">Tus datos de familia: apodo, lugares, bautismo, ocupación, padres, pareja y más.</p>
      <button class="btn secondary" id="btn-ficha-edit" style="margin-top:0">Abrir mi ficha</button>
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
  $('#btn-ficha-edit').onclick = () => openPersonSheet(me.id, 'edit');
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

// ---------- Hoja de familiar (ficha genealógica) ----------
const LINK_TYPE_LABEL = { biologico: 'Biológico', adoptivo: 'Adoptivo', acogida: 'Acogida' };

function relState(t, uid) {
  const pm = t.parentMeta || {};
  const parents1 = [], parents2 = [];
  for (const pid of (t.parents[uid] || [])) {
    const m = pm[`${pid}:${uid}`] || {};
    (m.link_set === 2 ? parents2 : parents1).push({ id: pid, link_type: m.link_type || 'biologico' });
  }
  const cm = t.coupleMeta || {};
  let partner = null;
  const former = [];
  for (const [a, b] of (t.couples || [])) {
    if (a !== uid && b !== uid) continue;
    const other = a === uid ? b : a;
    const m = cm[`${Math.min(a, b)}:${Math.max(a, b)}`] || {};
    if (m.status === 'anterior') former.push(other);
    else partner = { id: other, marriage_date: m.marriage_date || '', marriage_place: m.marriage_place || '' };
  }
  const children = Object.entries(t.parents || {})
    .filter(([cid, pids]) => pids.includes(uid)).map(([cid]) => +cid);
  return { parents1, parents2, partner, former, children };
}

function personOpts(users, excludeId, selected) {
  return users.filter(u => u.id !== excludeId)
    .map(u => `<option value="${u.id}"${+u.id === +selected ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
}

const pVal = (person, k) => person ? esc(person[k] || '') : '';
const pDate = (person, k) => person && person[k] ? person[k].slice(0, 10) : '';

function personFormHTML(person, t, mode) {
  const isCreate = mode === 'create';
  const uid = person ? person.id : 0;
  const r = person ? relState(t, uid) : { parents1: [], parents2: [], partner: null, former: [], children: [] };
  const p1 = r.parents1[0], p2 = r.parents1[1];
  const fatherId = p1 ? p1.id : '', motherId = p2 ? p2.id : '';
  const linkType = (p1 || p2 || {}).link_type || 'biologico';
  const a1 = r.parents2[0], a2 = r.parents2[1];
  const partnerId = r.partner ? r.partner.id : '';
  const others = t.users.filter(u => u.id !== uid);
  return `
  <h2 style="margin-top:0">${isCreate ? 'Agregar familiar' : 'Editar familiar'}</h2>
  <form id="f-person">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <span id="ph-preview">${avatarHTML(person || {}, '')}</span>
      <label class="file-label" for="ph-photo" style="margin:0;flex:1">📷 ${person && person.avatar_path ? 'Cambiar foto' : 'Agregar foto'}</label>
      <input type="file" id="ph-photo" name="photo" accept="image/*">
    </div>
    <label>Nombre completo</label>
    <input type="text" name="name" required maxlength="80" value="${pVal(person, 'name')}">
    <label>Apodo o sobrenombre (opcional)</label>
    <input type="text" name="nickname" maxlength="60" placeholder="Ej.: «El Flaco», «Tía Mery»…" value="${pVal(person, 'nickname')}">
    <label>Apellido de soltera / nombre de nacimiento (opcional)</label>
    <input type="text" name="maiden_name" maxlength="80" placeholder="Ej.: nacida como Rodríguez" value="${pVal(person, 'maiden_name')}">
    <label>Sexo (opcional, para el registro genealógico)</label>
    <select name="sex">
      <option value="">— Sin indicar —</option>
      <option value="M"${person && person.sex === 'M' ? ' selected' : ''}>Hombre</option>
      <option value="F"${person && person.sex === 'F' ? ' selected' : ''}>Mujer</option>
      <option value="X"${person && person.sex === 'X' ? ' selected' : ''}>Otro</option>
    </select>
    <label>Fecha de nacimiento</label>
    <input type="date" name="birthdate" value="${pDate(person, 'birthdate')}">
    <label>Lugar de nacimiento (opcional)</label>
    <input type="text" name="birth_place" maxlength="120" placeholder="Ciudad, provincia, país" value="${pVal(person, 'birth_place')}">
    <label>Fecha de bautismo (opcional)</label>
    <input type="date" name="baptism_date" value="${pDate(person, 'baptism_date')}">
    <label>Lugar de bautismo (opcional)</label>
    <input type="text" name="baptism_place" maxlength="120" placeholder="Parroquia o iglesia, ciudad" value="${pVal(person, 'baptism_place')}">
    <p class="sub" style="text-align:left">El bautismo se registra como evento aparte: si no se conoce la fecha de nacimiento, sirve como fecha aproximada sin mezclarla con el nacimiento.</p>
    <label style="display:flex;align-items:center;gap:8px;font-size:1rem">
      <input type="checkbox" name="is_deceased" value="1"${person && person.is_deceased ? ' checked' : ''} style="width:auto"> Esta persona ya falleció
    </label>
    <div id="ph-death" style="${person && person.is_deceased ? '' : 'display:none'}">
      <label>Fecha de fallecimiento</label>
      <input type="date" name="death_date" value="${pDate(person, 'death_date')}">
      <label>Lugar de fallecimiento (opcional)</label>
      <input type="text" name="death_place" maxlength="120" value="${pVal(person, 'death_place')}">
      <label>Causa de fallecimiento (opcional)</label>
      <input type="text" name="death_cause" maxlength="200" value="${pVal(person, 'death_cause')}">
      <label>Lugar de entierro (opcional)</label>
      <input type="text" name="burial_place" maxlength="160" value="${pVal(person, 'burial_place')}">
    </div>
    <label>Teléfono</label>
    <input type="tel" name="phone" maxlength="30" placeholder="Ej.: 215-555-0134" value="${pVal(person, 'phone')}">
    <label>Sobre esta persona (opcional)</label>
    <textarea name="bio" maxlength="300" style="min-height:70px" placeholder="Una frase que la describa…">${pVal(person, 'bio')}</textarea>
    <label>Ocupación (opcional)</label>
    <input type="text" name="occupation" maxlength="120" placeholder="Ej.: maestra, carpintero, comerciante…" value="${pVal(person, 'occupation')}">
    <label>Educación (opcional)</label>
    <input type="text" name="education" maxlength="160" placeholder="Estudios, títulos, graduación" value="${pVal(person, 'education')}">
    <label>Religión (opcional)</label>
    <input type="text" name="religion" maxlength="80" value="${pVal(person, 'religion')}">
    <label>Nacionalidad / origen (opcional)</label>
    <input type="text" name="nationality" maxlength="80" value="${pVal(person, 'nationality')}">
    <label>Residencia (opcional)</label>
    <input type="text" name="residence" maxlength="160" placeholder="Dónde vivió la mayor parte de su vida" value="${pVal(person, 'residence')}">
    <label>Servicio militar (opcional)</label>
    <input type="text" name="military_service" maxlength="200" placeholder="Rama, años, condecoraciones…" value="${pVal(person, 'military_service')}">
    <label>Notas y fuentes (opcional)</label>
    <textarea name="notes" maxlength="2000" style="min-height:70px" placeholder="De dónde salieron los datos: acta de nacimiento, censo, entrevista con…">${pVal(person, 'notes')}</textarea>
    <p class="sub" style="text-align:left">En genealogía, cada dato debería poder respaldarse con una fuente. Lo que no se conozca se deja en blanco: nunca se inventan datos.</p>
    <h3 style="margin:18px 0 4px">👪 Padres</h3>
    <label>Padre</label>
    <select name="father_id"><option value="">— Sin indicar —</option>${personOpts(t.users, uid, fatherId)}</select>
    <label>Madre</label>
    <select name="mother_id"><option value="">— Sin indicar —</option>${personOpts(t.users, uid, motherId)}</select>
    <label>Vínculo con los padres</label>
    <select name="link_type">
      <option value="biologico"${linkType === 'biologico' ? ' selected' : ''}>Biológico</option>
      <option value="adoptivo"${linkType === 'adoptivo' ? ' selected' : ''}>Adoptivo</option>
      <option value="acogida"${linkType === 'acogida' ? ' selected' : ''}>Acogida</option>
    </select>
    <p class="sub" style="text-align:left">Los vínculos adoptivos o de acogida se dibujan con línea punteada en el árbol.</p>
    <fieldset style="border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-top:12px">
      <legend style="padding:0 8px;font-weight:700">Segundo juego de padres (opcional)</legend>
      <p class="sub" style="text-align:left;margin-top:0">Una persona puede tener dos juegos de padres registrados a la vez —por ejemplo, los biológicos y los adoptivos—, como permiten el estándar GEDCOM y plataformas como MyHeritage.</p>
      <label>Tipo de vínculo del segundo juego</label>
      <select name="alt_link_type">
        <option value="adoptivo"${((a1 || {}).link_type || 'adoptivo') === 'adoptivo' ? ' selected' : ''}>Adoptivo</option>
        <option value="acogida"${((a1 || {}).link_type) === 'acogida' ? ' selected' : ''}>Acogida</option>
      </select>
      <label>Padre (segundo juego)</label>
      <select name="alt_father_id"><option value="">— Sin indicar —</option>${personOpts(t.users, uid, a1 ? a1.id : '')}</select>
      <label>Madre (segundo juego)</label>
      <select name="alt_mother_id"><option value="">— Sin indicar —</option>${personOpts(t.users, uid, a2 ? a2.id : '')}</select>
    </fieldset>
    <h3 style="margin:18px 0 4px">💑 Pareja</h3>
    <label>Pareja actual</label>
    <select name="partner_id"><option value="">— Sin indicar —</option>${personOpts(t.users, uid, partnerId)}</select>
    <label>Fecha de matrimonio (opcional)</label>
    <input type="date" name="marriage_date" value="${r.partner ? r.partner.marriage_date : ''}">
    <label>Lugar de matrimonio (opcional)</label>
    <input type="text" name="marriage_place" maxlength="120" placeholder="Ciudad, iglesia o registro civil" value="${esc(r.partner ? r.partner.marriage_place : '')}">
    <label>Parejas anteriores</label>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${others.map(u => `<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:0"><input type="checkbox" name="former_partners" value="${u.id}"${r.former.includes(u.id) ? ' checked' : ''} style="width:auto"> ${esc(u.name)}</label>`).join('')}
    </div>
    <p class="sub" style="text-align:left">Los hijos se enlazan solos: al indicar padre o madre en la ficha de cada hijo, aparecerán aquí como hijos.</p>
    ${isCreate ? `
    <label style="display:flex;align-items:center;gap:8px;font-size:1rem;margin-top:16px">
      <input type="checkbox" name="with_account" value="1" style="width:auto"> Crear cuenta de acceso para esta persona
    </label>
    <div id="ph-acct" style="display:none">
      <label>Correo electrónico (para su cuenta)</label>
      <input type="email" name="email" maxlength="120" placeholder="Su correo para entrar a GENLORIA">
      <p class="sub" style="text-align:left">Se generará un código para que elija su propia clave. Sin esto, el familiar solo existe en el árbol.</p>
    </div>` : ''}
    <div style="display:flex;gap:10px;margin-top:18px">
      <button type="button" class="btn secondary" id="ph-cancel" style="margin-top:0">Cancelar</button>
      <button type="submit" class="btn" style="margin-top:0">Guardar</button>
    </div>
  </form>`;
}

function wirePersonForm(person, t, mode) {
  const isCreate = mode === 'create';
  const isAdmin = me && me.role === 'admin';
  const form = $('#f-person');
  const decChk = form.querySelector('[name=is_deceased]');
  const deathDiv = $('#ph-death');
  decChk.addEventListener('change', () => deathDiv.style.display = decChk.checked ? '' : 'none');
  const photo = $('#ph-photo');
  photo.addEventListener('change', () => {
    const f = photo.files[0];
    if (f) {
      const r = new FileReader();
      r.onload = e => { $('#ph-preview').innerHTML = `<img class="avatar" style="width:56px;height:56px" src="${e.target.result}">`; };
      r.readAsDataURL(f);
    }
  });
  if (isCreate) {
    const wa = form.querySelector('[name=with_account]');
    wa.addEventListener('change', () => $('#ph-acct').style.display = wa.checked ? '' : 'none');
  }
  $('#ph-cancel').onclick = closeSheet;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const get = k => (fd.get(k) || '').toString().trim();
      const getId = k => parseInt(fd.get(k), 10) || 0;
      const rel = {
        father_id: getId('father_id'), mother_id: getId('mother_id'), link_type: get('link_type') || 'biologico',
        alt_father_id: getId('alt_father_id'), alt_mother_id: getId('alt_mother_id'),
        alt_link_type: get('alt_link_type') || 'adoptivo',
        partner_id: getId('partner_id'), marriage_date: get('marriage_date'), marriage_place: get('marriage_place'),
        former: fd.getAll('former_partners').map(v => parseInt(v, 10)).filter(Boolean)
      };
      let uid;
      if (isCreate) {
        const { user, setupCode, linkErrs } = await apiForm('/api/users/admin/people', fd);
        uid = user.id;
        await syncRelations(null, uid, rel, t, isAdmin);
        closeSheet();
        toast('Familiar agregado ✅' + (linkErrs && linkErrs.length ? ' (' + linkErrs.join('; ') + ')' : ''));
        if (setupCode) setTimeout(() => alert('Código de acceso para ' + user.name + ': ' + setupCode), 400);
      } else {
        uid = person.id;
        const url = (isAdmin && person.id !== me.id) ? `/api/users/admin/users/${uid}` : '/api/users/me';
        await apiForm(url, fd, 'PUT');
        await syncRelations(person, uid, rel, t, isAdmin);
        closeSheet();
        toast('Ficha guardada ✅');
      }
      if (location.hash.startsWith('#/tree')) viewTree();
      else if (location.hash.startsWith('#/family')) viewFamily();
      else location.reload();
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = 'Guardar';
  });
}

async function syncRelations(person, uid, rel, t, isAdmin) {
  if (!isAdmin) return;
  const cur = relState(t, uid);
  const curP1 = new Map(cur.parents1.map(p => [p.id, p]));
  const curP2 = new Map(cur.parents2.map(p => [p.id, p]));
  const wantP1 = new Map();
  if (rel.father_id) wantP1.set(rel.father_id, rel.link_type);
  if (rel.mother_id) wantP1.set(rel.mother_id, rel.link_type);
  const wantP2 = new Map();
  if (rel.alt_father_id) wantP2.set(rel.alt_father_id, rel.alt_link_type);
  if (rel.alt_mother_id) wantP2.set(rel.alt_mother_id, rel.alt_link_type);
  for (const [pid] of curP1) if (!wantP1.has(pid))
    await api('/api/tree/parents', { method: 'DELETE', body: JSON.stringify({ parentId: pid, childId: uid }) }).catch(e => toast(e.message));
  for (const [pid, lt] of wantP1) if (!curP1.has(pid))
    await api('/api/tree/parents', { method: 'POST', body: JSON.stringify({ parentId: pid, childId: uid, link_type: lt, link_set: 1 }) }).catch(e => toast(e.message));
  for (const [pid] of curP2) if (!wantP2.has(pid))
    await api('/api/tree/parents', { method: 'DELETE', body: JSON.stringify({ parentId: pid, childId: uid }) }).catch(e => toast(e.message));
  for (const [pid, lt] of wantP2) if (!curP2.has(pid))
    await api('/api/tree/parents', { method: 'POST', body: JSON.stringify({ parentId: pid, childId: uid, link_type: lt, link_set: 2 }) }).catch(e => toast(e.message));
  // Pareja actual
  const curPid = cur.partner ? cur.partner.id : 0;
  if (curPid !== rel.partner_id) {
    if (curPid) {
      const [a, b] = curPid < uid ? [curPid, uid] : [uid, curPid];
      await api('/api/tree/couples', { method: 'DELETE', body: JSON.stringify({ user1Id: a, user2Id: b }) }).catch(e => toast(e.message));
    }
    if (rel.partner_id)
      await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({ user1Id: uid, user2Id: rel.partner_id, marriage_date: rel.marriage_date, marriage_place: rel.marriage_place, status: 'actual' }) }).catch(e => toast(e.message));
  } else if (rel.partner_id && (rel.marriage_date || rel.marriage_place)) {
    // actualizar datos de matrimonio: recrear el vínculo
    const [a, b] = curPid < uid ? [curPid, uid] : [uid, curPid];
    await api('/api/tree/couples', { method: 'DELETE', body: JSON.stringify({ user1Id: a, user2Id: b }) }).catch(() => {});
    await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({ user1Id: uid, user2Id: rel.partner_id, marriage_date: rel.marriage_date, marriage_place: rel.marriage_place, status: 'actual' }) }).catch(e => toast(e.message));
  }
  // Parejas anteriores
  const curF = new Set(cur.former), wantF = new Set(rel.former.filter(id => id !== rel.partner_id));
  for (const fid of curF) if (!wantF.has(fid)) {
    const [a, b] = fid < uid ? [fid, uid] : [uid, fid];
    await api('/api/tree/couples', { method: 'DELETE', body: JSON.stringify({ user1Id: a, user2Id: b }) }).catch(() => {});
  }
  for (const fid of wantF) if (!curF.has(fid))
    await api('/api/tree/couples', { method: 'POST', body: JSON.stringify({ user1Id: uid, user2Id: fid, status: 'anterior' }) }).catch(e => toast(e.message));
}

function personViewHTML(person, t, isAdmin) {
  const r = relState(t, person.id);
  const byId = Object.fromEntries(t.users.map(u => [u.id, u]));
  const nm = id => byId[id] ? esc(byId[id].name) : '';
  const rows = [];
  const kv = (k, v) => { if (v) rows.push(`<p style="margin:6px 0"><strong>${k}:</strong> ${v}</p>`); };
  if (person.nickname) kv('Apodo', `«${esc(person.nickname)}»`);
  if (person.maiden_name) kv('Apellido de soltera', esc(person.maiden_name));
  if (person.sex) kv('Sexo', { M: 'Hombre', F: 'Mujer', X: 'Otro' }[person.sex] || esc(person.sex));
  kv('Nacimiento', [person.birthdate ? fmtDate(person.birthdate) : '', person.birth_place ? esc(person.birth_place) : ''].filter(Boolean).join(' — '));
  kv('Bautismo', [person.baptism_date ? fmtDate(person.baptism_date) : '', person.baptism_place ? esc(person.baptism_place) : ''].filter(Boolean).join(' — '));
  if (person.is_deceased) {
    kv('Fallecimiento', [person.death_date ? fmtDate(person.death_date) : '', person.death_place ? esc(person.death_place) : ''].filter(Boolean).join(' — '));
    kv('Causa', person.death_cause ? esc(person.death_cause) : '');
    kv('Entierro', person.burial_place ? esc(person.burial_place) : '');
  }
  kv('Teléfono', person.phone ? esc(person.phone) : '');
  if (person.bio) kv('Sobre esta persona', esc(person.bio));
  kv('Ocupación', person.occupation ? esc(person.occupation) : '');
  kv('Educación', person.education ? esc(person.education) : '');
  kv('Religión', person.religion ? esc(person.religion) : '');
  kv('Nacionalidad', person.nationality ? esc(person.nationality) : '');
  kv('Residencia', person.residence ? esc(person.residence) : '');
  kv('Servicio militar', person.military_service ? esc(person.military_service) : '');
  if (person.notes) kv('Notas y fuentes', esc(person.notes));
  const y = (person.birthdate || '').slice(0, 4), dy = (person.death_date || '').slice(0, 4);
  return `
  <div class="sheet-body" style="padding:0">
    <div style="text-align:center;padding:20px 20px 8px">
      ${avatarHTML(person, '')}
      <h2 style="margin:10px 0 2px">${esc(person.name)}${person.is_deceased ? ' ✝' : ''}</h2>
      <p class="uname">${y || dy ? (person.is_deceased ? `✝ ${y || '…'}–${dy || '…'}` : y) : ''}${person.is_placeholder ? ' · <span class="chip">SOLO ÁRBOL</span>' : ''}</p>
    </div>
    <div style="padding:0 20px">
      ${rows.length ? `<div class="card" style="margin:0 0 12px">${rows.join('')}</div>` : ''}
      <div class="card" style="margin:0 0 12px"><h3 style="margin-top:0">👨‍👩‍👧 Familia</h3>
        ${r.parents1.length ? `<p style="margin:6px 0"><strong>Padres:</strong> ${r.parents1.map(p => `${nm(p.id)}${p.link_type !== 'biologico' ? ` (${LINK_TYPE_LABEL[p.link_type]})` : ''}`).join(', ')}</p>` : ''}
        ${r.parents2.length ? `<p style="margin:6px 0"><strong>Padres (${LINK_TYPE_LABEL[r.parents2[0].link_type]}):</strong> ${r.parents2.map(p => nm(p.id)).join(', ')}</p>` : ''}
        ${r.partner ? `<p style="margin:6px 0"><strong>Pareja:</strong> ${nm(r.partner.id)}${r.partner.marriage_date ? ` (matr. ${fmtDate(r.partner.marriage_date)})` : ''}</p>` : ''}
        ${r.former.length ? `<p style="margin:6px 0"><strong>Parejas anteriores:</strong> ${r.former.map(nm).join(', ')}</p>` : ''}
        ${r.children.length ? `<p style="margin:6px 0"><strong>Hijos:</strong> ${r.children.map(nm).join(', ')}</p>` : ''}
        ${!r.parents1.length && !r.partner && !r.children.length ? '<p style="color:var(--muted)">Sin relaciones registradas.</p>' : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px;padding:0 20px 20px">
      ${(isAdmin || person.id === (me && me.id)) ? `<button class="btn" id="pv-edit" style="margin-top:0">✏️ Editar ficha</button>` : `<button class="btn secondary" id="pv-suggest" style="margin-top:0">Proponer corrección</button>`}
      <button class="btn secondary" id="pv-close" style="margin-top:0">Cerrar</button>
    </div>
  </div>`;
}

function wirePersonView(person, t, isAdmin) {
  $('#pv-close').onclick = closeSheet;
  const ed = $('#pv-edit');
  if (ed) ed.onclick = () => openPersonSheet(person.id, 'edit');
  const sg = $('#pv-suggest');
  if (sg) sg.onclick = () => { closeSheet(); location.hash = `#/tree/suggest?uid=${person.id}`; };
}

async function openPersonSheet(userId, mode) {
  const isAdmin = me && me.role === 'admin';
  if (mode === 'create' && !isAdmin) { toast('Solo el administrador puede agregar familiares.'); return; }
  let t;
  try { t = await api('/api/tree'); } catch (e) { toast('No se pudo cargar el árbol.'); return; }
  let person = null;
  if (userId) {
    try { person = (await api(`/api/users/by-id/${userId}`)).user; }
    catch (e) { toast('Persona no encontrada.'); return; }
    if (mode === 'edit' && !isAdmin && person.id !== me.id) { toast('Sin permiso para editar.'); return; }
  }
  if (mode === 'view') {
    openSheet(personViewHTML(person, t, isAdmin));
    wirePersonView(person, t, isAdmin);
  } else {
    openSheet(`<div class="sheet-body" style="padding:20px">${personFormHTML(person, t, mode)}</div>`);
    wirePersonForm(person, t, mode);
  }
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
          <button id="zoom-reset" style="background:#22344f;color:var(--text)">⟳</button>
          ${me.role === 'admin' ? `<button id="tree-add" style="margin-left:auto;background:transparent;border:1.5px solid var(--green);color:var(--green);font-weight:700">＋ Agregar familiar</button>` : ''}
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
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px">
        <span><span style="color:var(--gold);font-weight:700">━</span> Pareja</span>
        <span><span style="font-weight:700">┄┄</span> vínculo adoptivo o de acogida</span>
        <span>✝ fallecido</span>
      </div>
      Arrastra con el dedo para moverte por el árbol. Toca una persona para ver su ficha.
      ${me.role === 'admin' ? '' : 'El administrador revisa las correcciones propuestas.'}
    </div>
    <div class="card">
      <h3 style="margin-top:0">📖 Cómo se compone un árbol genealógico</h3>
      <div style="font-size:.92rem;color:var(--muted);line-height:1.5">
        <p>Cada persona tiene una <b>ficha</b> con sus datos: nombre, fechas y lugares de nacimiento, bautismo y fallecimiento, ocupación, y notas con las fuentes de donde salió cada dato.</p>
        <p>Las <b>parejas</b> se dibujan al mismo nivel unidas por una línea dorada. Los <b>hijos</b> cuelgan debajo de sus padres. Los vínculos <b>adoptivos o de acogida</b> usan línea punteada.</p>
        <p>Las personas <b>fallecidas</b> se muestran en gris con sus años (✝ 1930–2010) como memorial.</p>
        <p>Lo que no se conozca se deja en blanco: <b>nunca se inventan datos</b>.</p>
      </div>
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

  // nodos → ficha de la persona
  const openFor = uid => openPersonSheet(uid, 'view');
  $$('#tree-svg .tnode').forEach(n =>
    n.addEventListener('click', () => openFor(+n.dataset.uid)));
  $$('[data-uplink]').forEach(b =>
    b.addEventListener('click', () => openFor(+b.dataset.uplink)));
  $('#tree-suggest-top').onclick = () => location.hash = '#/tree/suggest';
  const addBtn = $('#tree-add');
  if (addBtn) addBtn.onclick = () => openPersonSheet(null, 'create');
}

// ---------- Familia (directorio) ----------
async function viewFamily() {
  setNav('family');
  app.innerHTML = `${topbar('Familia')}<div class="loading">Cargando familia…</div>`;
  let t;
  try { t = await api('/api/tree'); }
  catch { app.innerHTML = `${topbar('Familia')}<div class="empty">No se pudo cargar.</div>`; return; }
  const users = [...t.users].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const row = u => {
    const y = (u.birthdate || '').slice(0, 4);
    const dy = (u.death_date || '').slice(0, 4);
    const years = u.is_deceased && (y || dy) ? `✝ ${y || '…'}–${dy || '…'}` : (y || '');
    return `<button class="row" data-person="${u.id}" style="width:100%;background:var(--card);border:0;border-bottom:1px solid var(--border);text-align:left;cursor:pointer">
      ${avatarHTML(u)}<span class="grow"><b>${esc(u.name)}</b>${u.is_placeholder ? ' <span class="chip">SOLO ÁRBOL</span>' : ''}<small>${years}</small></span><span style="color:var(--muted)">›</span>
    </button>`;
  };
  app.innerHTML = `
    ${topbar('Familia')}
    ${me && me.role === 'admin' ? `<div style="padding:12px 12px 0"><button class="btn" data-go="#/admin/codes" style="width:100%">✉️ Invitar a un familiar</button></div>` : ''}
    <div style="padding:12px 12px 0"><input type="search" id="fam-q" placeholder="🔍 Buscar familiar…" style="margin:0"></div>
    <div class="card" style="padding:0;overflow:hidden" id="fam-list">
      ${users.map(row).join('')}
    </div>
    <p style="text-align:center;color:var(--muted);font-size:.85rem">${users.length} persona(s) en la familia</p>`;
  const q = $('#fam-q'), list = $('#fam-list');
  $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    list.innerHTML = users.filter(u => u.name.toLowerCase().includes(s)).map(row).join('') ||
      '<div class="empty">Sin resultados.</div>';
  });
  list.addEventListener('click', e => {
    const b = e.target.closest('[data-person]');
    if (b) openPersonSheet(+b.dataset.person, 'view');
  });
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
      <p class="sub" style="margin-top:-8px">Genera un código y compártelo con tu familiar. Con ese código creará su cuenta en la pantalla de registro.</p>
      <form id="f-newcode">
        <label>Código (vacío = aleatorio)</label><input type="text" name="code" placeholder="Ej: NAVIDAD-2026">
        <label>Usos máximos (0 = ilimitado)</label><input type="text" name="maxUses" value="0" inputmode="numeric">
        <button class="btn" type="submit">Generar código</button>
      </form>
      <h3>Códigos</h3>
      ${codes.map(c => `<div class="row">
        <div class="grow"><b>${esc(c.code)}</b><small>${c.used_count}${c.max_uses > 0 ? '/' + c.max_uses : ''} usados · ${c.active ? 'activo' : 'desactivado'}</small></div>
        ${c.active ? `<button class="mini-btn" data-copy="${esc(c.code)}">📋 Copiar</button>
        <button class="mini-btn danger" data-deact="${c.id}">Desactivar</button>` : ''}
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
    $$('[data-copy]', body).forEach(b => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Código copiado 📋'); }
      catch { toast('Código: ' + b.dataset.copy); }
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
// ---------- Qué es GENLORIA ----------
function viewAbout() {
  setNav(null);
  app.innerHTML = `
    ${topbar('Qué es GENLORIA')}
    <div class="about-hero">
      <img src="/images/login-hero.jpg" alt="Árbol familiar GENLORIA">
      <div class="hero-overlay">
        <h1>GENLORIA</h1>
        <p><b>Generaciones unidas. Historias que perduran.</b></p>
      </div>
    </div>
    <div class="about-section">
      <h2>🌳 Qué es GENLORIA</h2>
      <p>GENLORIA es tu red social familiar privada: un lugar seguro donde tu familia comparte historias, fotos y videos, y construye junta su árbol genealógico. Solo tu familia — nadie más puede ver lo que comparten.</p>
    </div>
    <div class="about-section">
      <h2>🚀 Cómo funciona</h2>
      <div class="about-steps">
        <div class="about-step"><span class="n">1</span><div><b>Crea tu cuenta</b><small>Regístrate con el código familiar que te compartió el administrador.</small></div></div>
        <div class="about-step"><span class="n">2</span><div><b>Completa tu ficha</b><small>Agrega tu foto, tus datos y tu historia en tu perfil familiar.</small></div></div>
        <div class="about-step"><span class="n">3</span><div><b>Construye el árbol</b><small>Conecta padres, hijos y parejas para ver crecer tu árbol genealógico.</small></div></div>
        <div class="about-step"><span class="n">4</span><div><b>Comparte momentos</b><small>Publica fotos, videos e historias en el muro familiar.</small></div></div>
      </div>
    </div>
    <div class="about-section">
      <h2>✨ Qué puedes hacer</h2>
      <div class="about-feats">
        <div class="about-feat"><div class="fi">📰</div><b>Muro familiar</b><small>Historias, fotos y videos solo para tu familia.</small></div>
        <div class="about-feat"><div class="fi">🌳</div><b>Árbol genealógico</b><small>Visualiza tus generaciones con fotos.</small></div>
        <div class="about-feat"><div class="fi">👥</div><b>Directorio</b><small>Encuentra a cada familiar y su ficha.</small></div>
        <div class="about-feat"><div class="fi">🔒</div><b>Privado</b><small>Solo miembros invitados. Tus datos son tuyos.</small></div>
        <div class="about-feat"><div class="fi">📄</div><b>Descargas</b><small>Exporta tu historia en PDF o GEDCOM.</small></div>
        <div class="about-feat"><div class="fi">📖</div><b>Fichas</b><small>Biografías y datos de cada familiar.</small></div>
      </div>
    </div>
    <div class="about-cta">
      <button class="btn" data-go="#/feed" style="width:100%">← Volver a la app</button>
    </div>`;
}

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
    if (h === '#/family') return viewFamily();
    if (h === '#/profile') return viewProfile();
    if (h === '#/settings') return viewSettings();
    if (h === '#/admin') return viewAdmin();
    if (h === '#/admin/codes') return viewAdmin('codes');
    if (h === '#/about') return viewAbout();
    const m = h.match(/^#\/u\/(.+)$/);
    if (m) return viewProfile(decodeURIComponent(m[1]));
    location.hash = '#/feed';
  }
  window.addEventListener('hashchange', route);
  route();
}

document.addEventListener('DOMContentLoaded', boot);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) location.hash = b.dataset.go;
});
