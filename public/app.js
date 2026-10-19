// app.js — SPA de GENLORIA (vanilla JS)
'use strict';

const APP_VERSION = '10';
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
// Cada familiar tiene un color único y consistente.
// Si tiene color preferido guardado se usa ese; si no, se genera uno
// visualmente distinto usando el ángulo dorado (137.5°) sobre el ID.
function userColorFor(user) {
  if (user && user.color && /^#[0-9a-fA-F]{6}$/.test(user.color)) return user.color;
  const n = parseInt(user && user.id, 10) || 0;
  const hue = Math.round((n * 137.508) % 360);
  return `hsl(${hue}, 75%, 62%)`;
}
function coloredName(user) {
  if (!user) return '';
  return `<b style="color:${userColorFor(user)}">${esc(user.name)}</b>`;
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

// Convierte clave VAPID base64url a Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// Pide permiso y suscribe el dispositivo a notificaciones push
async function requestPushPermission(silent) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      if (!silent) toast('Tu dispositivo no soporta notificaciones');
      return false;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (!silent) toast('Activa el permiso de notificaciones para recibir avisos');
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    // Clave pública actual del servidor
    const kd = await api('/api/auth/push-key').catch(() => ({}));
    if (!kd.publicKey) {
      if (!silent) toast('Notificaciones no disponibles por ahora');
      return false;
    }
    // Si la clave del servidor cambió desde la última suscripción, re-suscribir
    const storedKey = localStorage.getItem('genloria_vapid_key') || '';
    let sub = await reg.pushManager.getSubscription().catch(() => null);
    // Si no hay clave guardada o la clave cambió, la suscripción local es obsoleta:
    // eliminarla y crear una nueva con la clave actual
    if (sub && (!storedKey || storedKey !== kd.publicKey)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(kd.publicKey)
      });
    }
    // Guardar suscripción en el servidor
    await api('/api/auth/push-subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: bufToBase64(sub.getKey('p256dh')),
        auth: bufToBase64(sub.getKey('auth'))
      })
    });
    localStorage.setItem('genloria_vapid_key', kd.publicKey);
    if (!silent) toast('Notificaciones activadas 🔔');
    return true;
  } catch (e) {
    console.warn('[push]', e);
    if (!silent) toast('No se pudieron activar las notificaciones');
    return false;
  }
}

// Verifica al iniciar sesión: si el permiso está dado pero no hay suscripción válida, suscribir en silencio
async function ensurePushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!me || !me.id) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    const kd = await api('/api/auth/push-key').catch(() => ({}));
    const storedKey = localStorage.getItem('genloria_vapid_key') || '';
    const st = await api('/api/auth/push-status').catch(() => ({}));
    // Re-suscribir si: no hay suscripción local, la clave cambió, o el servidor no tiene registro
    if (!sub || (storedKey && kd.publicKey && storedKey !== kd.publicKey) || !st.subscribed) {
      await requestPushPermission(true);
    }
  } catch {}
}

async function apiForm(path, formData, method = 'POST') {
  const res = await fetch(path, { method, credentials: 'same-origin', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

// Comprime una imagen en el teléfono antes de subirla (las fotos del celular
// suelen pesar 8-20MB y el servidor las rechaza). Devuelve un File listo.
function compressImageFile(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return resolve(file);
    // HEIC/HEIF (formato por defecto del iPhone): el navegador no lo puede
    // procesar ni mostrar. Avisar con un mensaje claro en vez de fallar.
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
    if (isHeic) {
      return reject(new Error('Esta foto está en formato HEIC (iPhone). Abre Ajustes → Cámara → Formatos → "Más compatible", o elige otra foto.'));
    }
    // GIFs animados y archivos pequeños se suben tal cual
    if (file.type === 'image/gif' || file.size < 900 * 1024) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w <= maxDim && h <= maxDim) return resolve(file);
      const r = maxDim / Math.max(w, h);
      w = Math.round(w * r); h = Math.round(h * r);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Reemplaza en el FormData todo archivo de imagen por su versión comprimida
async function compressFormImages(fd, maxDim, quality) {
  for (const key of [...fd.keys()]) {
    const v = fd.get(key);
    if (v instanceof File && v.size > 0 && v.type.startsWith('image/')) {
      fd.set(key, await compressImageFile(v, maxDim, quality));
    }
  }
  return fd;
}

// Verifica que los videos no excedan 3 minutos (para cuidar el almacenamiento)
function checkVideoDuration(fd) {
  return new Promise((resolve, reject) => {
    for (const key of [...fd.keys()]) {
      const v = fd.get(key);
      if (v instanceof File && v.type.startsWith('video/')) {
        const url = URL.createObjectURL(v);
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.onloadedmetadata = () => {
          URL.revokeObjectURL(url);
          if (vid.duration > 60) reject(new Error('El video no puede durar más de 60 segundos.'));
          else resolve();
        };
        vid.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        vid.src = url;
        return;
      }
    }
    resolve();
  });
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
      (active === 'chat' && target === '#/chat') ||
      (active === 'profile' && target === '#/profile')
    ));
  });
  if (me) updateChatBadge();
}

// Insignia de mensajes no leídos en la navegación
async function updateChatBadge() {
  try {
    const { unread } = await api('/api/chat/unread');
    const badge = $('#chat-badge');
    if (!badge) return;
    badge.classList.toggle('hidden', !unread);
    badge.textContent = unread > 99 ? '99+' : unread;
  } catch (e) { /* silencioso */ }
}
// Actualizar la insignia cada 30 segundos
setInterval(() => { if (me) updateChatBadge(); }, 30000);

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
    recoverBtn: 'Cambiar mi contraseña', backToLogin: '← Volver a entrar',
    newToGenloria: '¿Nuevo en GENLORIA?', conoceBtn: 'Conoce GENLORIA',
    conoceSub: 'Descubre todo lo que puedes hacer.', appVersion: 'GENLORIA v1.0',
    menuConoce: '🌳 Conoce GENLORIA', menuRegister: '👤 Crea tu cuenta', menuLogin: '🔑 Iniciar sesión',
    whoAreYou: '¿Eres una de estas personas?', whoAreYouSub: 'Si tu nombre ya está en el árbol familiar, selecciónalo para vincular tu cuenta.',
    iAmThis: 'Soy esta persona', notInList: 'No estoy en la lista →', skipForNow: 'Omitir por ahora',
    connectFamily: 'Conecta tu familia', connectFamilySub: 'Elige a tus familiares o agrega sus nombres para invitarlos después.',
    father: 'Padre', mother: 'Madre', spouse: 'Esposa/o', children: 'Hijos',
    noneOption: '— Ninguno —', addNewName: '＋ Agregar nombre nuevo…', newNamePh: 'Nombre del familiar',
    addChild: '＋ Agregar otro hijo', finishBtn: 'Terminar', welcomeClaimed: '¡Cuenta vinculada! 🎉'
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
    recoverBtn: 'Change my password', backToLogin: '← Back to login',
    newToGenloria: 'New to GENLORIA?', conoceBtn: 'Meet GENLORIA',
    conoceSub: 'Discover everything you can do.', appVersion: 'GENLORIA v1.0',
    menuConoce: '🌳 Meet GENLORIA', menuRegister: '👤 Create your account', menuLogin: '🔑 Log in',
    whoAreYou: 'Are you one of these people?', whoAreYouSub: 'If your name is already in the family tree, select it to link your account.',
    iAmThis: 'This is me', notInList: 'I am not on the list →', skipForNow: 'Skip for now',
    connectFamily: 'Connect your family', connectFamilySub: 'Choose your relatives or add their names to invite them later.',
    father: 'Father', mother: 'Mother', spouse: 'Spouse', children: 'Children',
    noneOption: '— None —', addNewName: '＋ Add a new name…', newNamePh: "Relative's name",
    addChild: '＋ Add another child', finishBtn: 'Finish', welcomeClaimed: 'Account linked! 🎉'
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
  document.title = 'GENLORIA — Generaciones unidas. Historias que perduran.';
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/logo-genloria.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="login-lang" id="lang-btn">🌐 ${appLang === 'es' ? 'Español' : 'English'} ▾</button>
        <button class="login-menu-btn" id="menu-btn" aria-label="Menú">☰</button>
      </div>
      <div class="login-menu hidden" id="login-menu">
        <button data-go="#/conoce">${T('menuConoce')}</button>
        <button data-go="#/register">${T('menuRegister')}</button>
        <button data-go="#/login">${T('menuLogin')}</button>
      </div>
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
      <div class="login-sep"><span>${T('newToGenloria')}</span></div>
      <button class="btn-create-account" data-go="#/register">
        <span class="rc-icon">👤</span>
        <span><b>${T('createAccount')}</b><p>${T('joinTree')}</p></span>
      </button>
      <button class="btn-conoce" data-go="#/conoce">
        <span class="rc-icon">🌳</span>
        <span><b>${T('conoceBtn')}</b><p>${T('conoceSub')}</p></span>
        <span class="rc-go">›</span>
      </button>
      <button class="btn-conoce" id="btn-install-guide" style="margin-top:8px">
        <span class="rc-icon">📲</span>
        <span><b>Instalar como app</b><p>Agrega GENLORIA a tu pantalla de inicio</p></span>
        <span class="rc-go">›</span>
      </button>
    </div>
    <div class="trust-badges">
      <div><div class="tb-icon">🛡️</div>${T('badge1')}</div>
      <div class="tb-sep"></div>
      <div><div class="tb-icon">👥</div>${T('badge2')}</div>
      <div class="tb-sep"></div>
      <div><div class="tb-icon">🌿</div>${T('badge3')}</div>
    </div>
    <p class="login-version">${T('appVersion')}</p>
  </div>`;
  $('#lang-btn').onclick = () => {
    appLang = appLang === 'es' ? 'en' : 'es';
    localStorage.setItem('genloria-lang', appLang);
    viewLogin();
  };
  $('#btn-install-guide').onclick = () => openSheet(`<div class="sheet-body">
    <h3 style="margin-top:0">📲 Instalar GENLORIA como app</h3>
    <h4>🍎 En iPhone (Safari)</h4>
    <ol style="padding-left:20px;line-height:1.8">
      <li>Abre <b>genloria.com</b> en Safari</li>
      <li>Toca el botón <b>Compartir</b> (cuadrado con flecha ↑)</li>
      <li>Elige <b>"Agregar a pantalla de inicio"</b></li>
      <li>Toca <b>Agregar</b>. ¡Listo! Tendrás el ícono de GENLORIA</li>
    </ol>
    <h4>🤖 En Android (Chrome)</h4>
    <ol style="padding-left:20px;line-height:1.8">
      <li>Abre <b>genloria.com</b> en Chrome</li>
      <li>Toca el menú <b>⋮</b> (tres puntos)</li>
      <li>Elige <b>"Agregar a pantalla principal"</b> o <b>"Instalar app"</b></li>
      <li>Confirma. ¡Listo!</li>
    </ol>
    <p class="sub">La app se abre a pantalla completa y se actualiza sola.</p>
  </div>`);
  const menuBtn = $('#menu-btn'), menu = $('#login-menu');
  menuBtn.onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
  document.addEventListener('click', function hideMenu(e) {
    if (!menu.classList.contains('hidden') && !e.target.closest('#login-menu') && !e.target.closest('#menu-btn')) {
      menu.classList.add('hidden');
    }
  });
  $('#toggle-pass').onclick = () => {
    const p = $('#login-pass');
    p.type = p.type === 'password' ? 'text' : 'password';
  };
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
      ensurePushSubscription();
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
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button type="button" id="mode-create" class="btn" style="flex:1">🌳 Crear mi familia</button>
        <button type="button" id="mode-join" class="btn-ghost" style="flex:1;border:1px solid var(--border)">🎫 Unirme con código</button>
      </div>
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
        <div class="login-field" id="field-familyname">
          <span class="fi">🌳</span>
          <input type="text" name="familyName" maxlength="80" placeholder="Nombre de tu familia (ej: Familia De La Cruz)">
        </div>
        <div class="login-field hidden" id="field-invitecode">
          <span class="fi">🎫</span>
          <input type="text" name="inviteCode" placeholder="${T('inviteCode')}" style="text-transform:uppercase">
        </div>
        <div class="login-error" id="err"></div>
        <button class="btn-login" type="submit">${T('createBtn')}</button>
      </form>
      <p class="link" style="text-align:center;margin-top:14px"><a href="#/login">${T('hasAccount')}</a></p>
    </div>
  </div>`;
  let regMode = 'create';
  const btnC = $('#mode-create'), btnJ = $('#mode-join');
  const fFam = $('#field-familyname'), fCode = $('#field-invitecode');
  function setMode(m) {
    regMode = m;
    const isC = m === 'create';
    btnC.className = isC ? 'btn' : 'btn-ghost';
    btnC.style.cssText = isC ? 'flex:1' : 'flex:1;border:1px solid var(--border)';
    btnJ.className = isC ? 'btn-ghost' : 'btn';
    btnJ.style.cssText = isC ? 'flex:1;border:1px solid var(--border)' : 'flex:1';
    fFam.classList.toggle('hidden', !isC);
    fCode.classList.toggle('hidden', isC);
    fFam.querySelector('input').required = isC;
    fCode.querySelector('input').required = !isC;
  }
  btnC.onclick = () => setMode('create');
  btnJ.onclick = () => setMode('join');
  setMode('create');
  $('#lang-btn').onclick = () => {
    appLang = appLang === 'es' ? 'en' : 'es';
    localStorage.setItem('genloria-lang', appLang);
    viewRegister();
  };
  $('#f-reg').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user, family } = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fd.get('name'), email: fd.get('email'),
          password: fd.get('password'), mode: regMode,
          familyName: fd.get('familyName'), inviteCode: fd.get('inviteCode')
        })
      });
      me = user;
      if (regMode === 'create' && family) {
        toast(`¡Familia "${family.name}" creada! 🎉 Tu código: ${family.invite_code}`);
      } else {
        toast('¡Bienvenido a la familia! 🎉');
      }
      // Notificaciones activadas por defecto: pedir permiso al registrarse
      try { await requestPushPermission(); } catch {}
      viewClaimIdentity(); // paso 2: ¿ya estás en el árbol?
    } catch (err) {
      $('#err').textContent = err.message;
    }
  });
}

// Paso 2 del registro: "¿Eres una de estas personas?" (reclamar placeholder)
async function viewClaimIdentity() {
  setNav(null);
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/logo-genloria.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
    </header>
    <div class="login-card" style="margin-top:24px">
      <h2>👤 ${T('whoAreYou')}</h2>
      <p class="sub">${T('whoAreYouSub')}</p>
      <div id="ph-list"><div class="loading">Cargando…</div></div>
      <div class="login-error" id="err"></div>
      <button class="btn-login" id="btn-notme" style="margin-top:14px;background:var(--card);color:var(--text);border:1.5px solid var(--border)">${T('notInList')}</button>
      <p class="link" style="text-align:center;margin-top:12px"><a href="#/feed">${T('skipForNow')}</a></p>
    </div>
  </div>`;
  $('#btn-notme').onclick = () => viewConnectFamily();
  try {
    const t = await api('/api/tree');
    const placeholders = t.users.filter(u => u.is_placeholder && u.id !== me.id);
    $('#ph-list').innerHTML = placeholders.length ? placeholders.map(u => `
      <div class="row">${avatarHTML(u)}
        <div class="grow"><b>${esc(u.name)}</b></div>
        <button class="mini-btn" data-claim="${u.id}">${T('iAmThis')}</button>
      </div>`).join('') : `<p class="empty">${T('notInList')}</p>`;
    $$('#ph-list [data-claim]').forEach(b => b.addEventListener('click', async () => {
      try {
        const { user } = await api('/api/auth/claim', {
          method: 'POST', body: JSON.stringify({ placeholderId: +b.dataset.claim })
        });
        me = user;
        toast(T('welcomeClaimed'));
        location.hash = '#/feed';
      } catch (err) { $('#err').textContent = err.message; }
    }));
  } catch { $('#ph-list').innerHTML = `<p class="empty">${T('notInList')}</p>`; }
}

// Paso 3 del registro: conectar padre, madre, pareja e hijos (existentes o nuevos)
async function viewConnectFamily() {
  setNav(null);
  let users = [];
  try { users = (await api('/api/tree')).users.filter(u => u.id !== me.id); } catch {}
  const opts = sel => `<option value="">${T('noneOption')}</option>` +
    users.map(u => `<option value="${u.id}">${esc(u.name)}${u.is_placeholder ? ' (árbol)' : ''}</option>`).join('') +
    `<option value="__new">${T('addNewName')}</option>`;
  const relRow = (label, key) => `
    <div style="margin-bottom:12px">
      <label style="font-weight:700;font-size:.92rem">${label}</label>
      <select id="rel-${key}" style="margin-top:4px">${opts()}</select>
      <input type="text" id="rel-${key}-new" class="hidden" placeholder="${T('newNamePh')}" maxlength="80" style="margin-top:8px">
    </div>`;
  app.innerHTML = `
  <div class="login-page">
    <header class="login-header">
      <div class="login-brand"><img src="/logo-genloria.png" alt="GENLORIA"><div>GENLORIA<small>by Nilltrom</small></div></div>
    </header>
    <div class="login-card" style="margin-top:24px">
      <h2>👪 ${T('connectFamily')}</h2>
      <p class="sub">${T('connectFamilySub')}</p>
      <form id="f-connect">
        ${relRow(T('father'), 'father')}
        ${relRow(T('mother'), 'mother')}
        ${relRow(T('spouse'), 'spouse')}
        <div id="children-wrap"></div>
        <button type="button" class="mini-btn" id="btn-addchild" style="margin-bottom:14px">${T('addChild')}</button>
        <div class="login-error" id="err"></div>
        <button class="btn-login" type="submit">${T('finishBtn')}</button>
      </form>
      <p class="link" style="text-align:center;margin-top:12px"><a href="#/feed">${T('skipForNow')}</a></p>
    </div>
  </div>`;
  // Mostrar/ocultar campo de nombre nuevo
  const wireSelect = sel => {
    sel.addEventListener('change', () => {
      const input = $('#rel-' + sel.id.replace('rel-', '') + '-new');
      if (input) input.classList.toggle('hidden', sel.value !== '__new');
    });
  };
  ['father', 'mother', 'spouse'].forEach(k => wireSelect($('#rel-' + k)));
  let childN = 0;
  const addChildRow = () => {
    const k = 'child' + (childN++);
    const div = document.createElement('div');
    div.innerHTML = `<label style="font-weight:700;font-size:.92rem">${T('children')} ${childN}</label>
      <select id="rel-${k}" style="margin-top:4px;margin-bottom:12px">${opts()}</select>
      <input type="text" id="rel-${k}-new" class="hidden" placeholder="${T('newNamePh')}" maxlength="80" style="margin-top:8px;margin-bottom:12px">`;
    $('#children-wrap').appendChild(div);
    wireSelect($('#rel-' + k));
  };
  addChildRow();
  $('#btn-addchild').onclick = addChildRow;
  $('#f-connect').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      // Resolver cada selección: id existente o crear placeholder con el nombre nuevo
      const resolve = async key => {
        const sel = $('#rel-' + key);
        if (!sel || !sel.value) return 0;
        if (sel.value === '__new') {
          const nm = $('#rel-' + key + '-new').value.trim();
          if (nm.length < 2) throw new Error(T('newNamePh') + ': ' + nm);
          const { user } = await api('/api/users/people', {
            method: 'POST', body: JSON.stringify({ name: nm })
          });
          return user.id;
        }
        return +sel.value || 0;
      };
      const fatherId = await resolve('father');
      const motherId = await resolve('mother');
      const spouseId = await resolve('spouse');
      const childrenIds = [];
      for (let i = 0; i < childN; i++) {
        const id = await resolve('child' + i);
        if (id) childrenIds.push(id);
      }
      const r = await api('/api/tree/self-links', {
        method: 'POST', body: JSON.stringify({ fatherId, motherId, spouseId, childrenIds })
      });
      if (r.warnings && r.warnings.length) toast(r.warnings.join('; '));
      else toast('¡Familia conectada! 🎉');
      location.hash = '#/feed';
    } catch (err) { $('#err').textContent = err.message; }
    btn.disabled = false;
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
  // Miniatura simple: foto de la historia o avatar
  const thumb = (story, user) => {
    const fb = user.avatar_path ? esc(user.avatar_path) : '/icons/avatar-default.svg';
    if (story.media_path && story.media_type !== 'video') {
      return `<img src="${esc(story.media_path)}" alt="" onerror="this.src='${fb}'">`;
    }
    return `<img src="${fb}" alt="" onerror="this.src='/icons/avatar-default.svg'">`;
  };
  let html = `<div class="stories-bar">`;
  if (mine) {
    html += `<button class="story-simple" data-viewmine="1">
      <span class="ss-ring">${thumb(mine.stories[0], mine.user)}</span>
      <div class="sname">Tú</div>
      <span class="ss-add" id="add-more-story">＋</span>
    </button>`;
  } else {
    html += `<button class="story-simple" id="add-story">
      <span class="ss-ring add"><span class="ss-plus">＋</span></span>
      <div class="sname">Tu historia</div>
    </button>`;
  }
  for (const g of storyGroups.filter(g => g.user.id !== me.id)) {
    html += `<button class="story-simple" data-stories="${esc(g.user.username)}">
      <span class="ss-ring">${thumb(g.stories[0], g.user)}</span>
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
      <div class="who">${coloredName(p.author)}<small>${timeAgo(p.created_at)} · ${fmtDateTime(p.created_at)}</small></div>
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

  const openFilePicker = (useCamera) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData();
      fd.append('media', input.files[0]);
      try {
        toast('Subiendo historia…');
        await checkVideoDuration(fd);
        await compressFormImages(fd, 1280, 0.82);
        await apiForm('/api/stories', fd);
        toast('¡Historia publicada! ✨');
        viewFeed();
      } catch (e) { toast('Error: ' + e.message); }
    };
    input.click();
  };
  const askStorySource = (cb) => {
    // Hoja de opciones: Tirar foto o Galería
    const sheet = document.createElement('div');
    sheet.className = 'action-sheet-backdrop';
    sheet.innerHTML = `<div class="action-sheet">
      <button data-src="camera">📷 Tirar foto</button>
      <button data-src="gallery">🖼️ Elegir de galería</button>
      <button data-src="cancel" class="cancel">Cancelar</button>
    </div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener('click', e => {
      const btn = e.target.closest('[data-src]');
      if (!btn && e.target !== sheet) return;
      const src = btn ? btn.dataset.src : 'cancel';
      sheet.remove();
      if (src === 'cancel') return;
      cb(src === 'camera');
    });
  };
  const addBtn = $('#add-story');
  if (addBtn) addBtn.addEventListener('click', () => askStorySource(openFilePicker));
  const moreBtn = $('#add-more-story');
  if (moreBtn) moreBtn.addEventListener('click', e => { e.stopPropagation(); askStorySource(openFilePicker); });
  const mineCard = document.querySelector('[data-viewmine]');
  if (mineCard) mineCard.addEventListener('click', () => openStoryViewer(me.username));

  $$('#app [data-stories]').forEach(b =>
    b.addEventListener('click', () => openStoryViewer(b.dataset.stories)));

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
            <div>${coloredName(c.author)} ${esc(c.text)}<br><small style="color:var(--muted)">${timeAgo(c.created_at)}</small></div>
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
        <div style="display:flex;gap:8px;margin:8px 0">
          <button type="button" class="mini-btn" id="btn-cam">📷 Tomar foto</button>
          <button type="button" class="mini-btn" id="btn-gal">🖼️ Elegir de galería</button>
        </div>
        <input type="file" id="media-input" name="media" accept="image/*,video/*" class="hidden">
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
  const mediaInput = document.getElementById('media-input');
  document.getElementById('btn-cam').addEventListener('click', () => {
    mediaInput.setAttribute('capture', 'environment');
    mediaInput.click();
  });
  document.getElementById('btn-gal').addEventListener('click', () => {
    mediaInput.removeAttribute('capture');
    mediaInput.click();
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
      await checkVideoDuration(fd);
      await compressFormImages(fd, 1600, 0.82);
      await apiForm('/api/posts', fd);
      toast('¡Publicado! 🎉');
      location.hash = '#/feed';
    } catch (err) {
      const el = $('#err'); el.textContent = err.message; el.classList.remove('hidden');
    }
  });
}

// ---------- Chat tipo Messenger ----------
let chatPollTimer = null;
function stopChatPoll() { if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; } }

async function viewChatList() {
  lockZoom(false);
  stopChatPoll();
  setNav('chat');
  app.innerHTML = `${topbar('Chat')}<div class="loading">Cargando…</div>`;
  try {
    const { conversations } = await api('/api/chat/conversations');
    const items = conversations.map(c => `
      <div class="row" style="cursor:pointer">
        <div data-go="#/chat/${c.id}" style="display:flex;align-items:center;gap:10px;flex:1;cursor:pointer">
          ${avatarHTML(c.other)}
          <div class="grow">${coloredName(c.other)}
            <small>${c.lastMessage ? esc(c.lastMessage.text.slice(0, 60)) : 'Sin mensajes aún'}</small></div>
          ${c.unread ? `<span class="badge" style="position:static">${c.unread}</span>` : ''}
        </div>
        <button class="mini-btn" data-closechat="${c.id}" title="Cerrar conversación" style="color:#f87171">✕</button>
      </div>`).join('');
    app.innerHTML = `${topbar('Chat')}
      <div style="padding:12px">
        <button class="btn" id="btn-new-chat" style="width:100%">✏️ Nuevo mensaje</button>
        <div id="chat-list" style="margin-top:8px">
          ${items || '<p class="sub" style="text-align:center;padding:24px">Sin conversaciones.<br>Toca "Nuevo mensaje" para chatear con un familiar.</p>'}
        </div>
      </div>`;
    $('#btn-new-chat').onclick = () => openNewChatSheet();
    $$('#chat-list [data-closechat]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('¿Cerrar esta conversación? Desaparecerá de tu lista.')) return;
        try {
          await api(`/api/chat/conversations/${btn.dataset.closechat}`, { method: 'DELETE' });
          toast('Conversación cerrada');
          viewChatList();
        } catch (err) { toast(err.message); }
      });
    });
    chatPollTimer = setInterval(async () => {
      if (!location.hash.startsWith('#/chat') || location.hash.length > 6) return;
      try {
        const { conversations: fresh } = await api('/api/chat/conversations');
        const el = $('#chat-list');
        if (el && fresh.length !== conversations.length) viewChatList();
      } catch (e) {}
    }, 15000);
  } catch (err) { app.innerHTML = `${topbar('Chat')}<p class="sub" style="padding:24px">${esc(err.message)}</p>`; }
}

async function openNewChatSheet() {
  try {
    const { users } = await api('/api/users/admin/users').catch(() => ({ users: null }));
    let list;
    if (users) {
      list = users.filter(u => u.id !== me.id && !u.is_placeholder);
    } else {
      const t = await api('/api/tree');
      list = (t.users || []).filter(m => m.id !== me.id && !m.is_placeholder)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
    }
    openSheet(`<div class="sheet-body"><h3 style="margin-top:0">Nuevo mensaje</h3>
      <input id="chat-search" placeholder="🔍 Buscar familiar…" style="margin-bottom:8px">
      <div id="chat-users" style="max-height:50vh;overflow:auto"></div></div>`);
    const render = q => {
      const f = list.filter(u => !q || (u.name || '').toLowerCase().includes(q.toLowerCase()));
      $('#chat-users').innerHTML = f.map(u => `
        <div class="row" data-uid="${u.id}" style="cursor:pointer">${avatarHTML(u)}
          <div class="grow"><b>${esc(u.name)}</b></div></div>`).join('')
        || '<p class="sub">Sin resultados.</p>';
      $$('#chat-users [data-uid]').forEach(r => r.onclick = async () => {
        try {
          const { conversation } = await api('/api/chat/conversations', {
            method: 'POST', body: JSON.stringify({ user_id: +r.dataset.uid }) });
          closeSheet(); location.hash = '#/chat/' + conversation.id;
        } catch (e) { toast(e.message); }
      });
    };
    render('');
    $('#chat-search').oninput = e => render(e.target.value);
  } catch (e) { toast(e.message); }
}

function lockZoom(lock) {
  let vp = document.querySelector('meta[name=viewport]');
  if (!vp) return;
  if (lock) {
    if (!vp.dataset.orig) vp.dataset.orig = vp.content;
    vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  } else if (vp.dataset.orig) {
    vp.content = vp.dataset.orig;
  }
}

async function viewChatThread(cid) {
  stopChatPoll();
  setNav('chat');
  lockZoom(true);
  app.innerHTML = `${topbar('Chat')}<div class="loading">Cargando…</div>`;
  let other = null, lastId = 0, lastDate = '';
  const fmtTime = ts => new Date(ts + 'Z').toLocaleString('es', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = ts => new Date(ts + 'Z').toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const renderMsg = m => {
    const mine = m.sender_id === me.id;
    const d = fmtDate(m.created_at);
    let html = '';
    if (d !== lastDate) { html += `<div class="chat-date">${d}</div>`; lastDate = d; }
    let mediaHTML = '';
    if (m.media_path) {
      mediaHTML = m.media_type === 'video'
        ? `<video src="${esc(m.media_path)}" controls playsinline style="max-width:100%;border-radius:12px;margin-bottom:4px"></video>`
        : `<img src="${esc(m.media_path)}" style="max-width:100%;border-radius:12px;margin-bottom:4px" onclick="window.open('${esc(m.media_path)}','_blank')">`;
    }
    html += `<div class="msg ${mine ? 'mine' : 'theirs'}">
      ${mine ? '' : `<img class="msg-av" src="${other.avatar_path ? esc(other.avatar_path) : '/icons/avatar-default.svg'}" onerror="this.src='/icons/avatar-default.svg'">`}
      <div class="bubble">${mediaHTML}${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}
        <span class="bmeta">${fmtTime(m.created_at)}${mine ? ' <span class="ticks">✓✓</span>' : ''}</span>
      </div>
    </div>`;
    return html;
  };
  try {
    const data = await api(`/api/chat/conversations/${cid}/messages`);
    other = data.other;
    if (!other) { location.hash = '#/chat'; return; }
    app.innerHTML = `
      <div class="chat-view">
      <div class="chat-head2">
        <button class="icon-btn" data-go="#/chat">‹</button>
        <span class="ch-av">${avatarHTML(other, 'avatar sm')}<span class="online-dot"></span></span>
        <span class="ch-info"><b>${esc(other.name)}</b><small>En línea</small></span>
        <span class="ch-actions">
          <button class="icon-btn" title="Llamar">📞</button>
          <button class="icon-btn" title="Video">🎥</button>
          <button class="icon-btn" title="Más">⋮</button>
        </span>
      </div>
      <div id="chat-msgs" class="chat-msgs2"></div>
      <form id="f-chat" class="chat-form2">
        <div class="chat-input-wrap">
          <input id="chat-input" placeholder="Escribe un mensaje…" autocomplete="off" maxlength="2000">
        </div>
        <button class="round-btn send" type="submit" title="Enviar">➤</button>
      </form>
      </div>`;
    const box = $('#chat-msgs');
    const appendMsgs = msgs => {
      for (const m of msgs) {
        if (m.id > lastId) { lastId = m.id; box.insertAdjacentHTML('beforeend', renderMsg(m)); }
      }
      box.scrollTop = box.scrollHeight;
    };
    appendMsgs(data.messages);
    updateChatBadge();
    // Cerrar las notificaciones del sistema de esta conversación (ya leída)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg.active) reg.active.postMessage({ type: 'clear-notifications', tag: 'chat-' + cid });
      }).catch(() => {});
    }
    // Polling de mensajes nuevos cada 4 segundos
    chatPollTimer = setInterval(async () => {
      if (!location.hash.startsWith('#/chat/')) { stopChatPoll(); return; }
      try {
        const d = await api(`/api/chat/conversations/${cid}/messages?limit=20`);
        const fresh = d.messages.filter(m => m.id > lastId);
        if (fresh.length) {
          appendMsgs(fresh);
          updateChatBadge();
          // Si llegaron mensajes mientras leo aquí, cerrar sus notificaciones
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
              if (reg.active) reg.active.postMessage({ type: 'clear-notifications', tag: 'chat-' + cid });
            }).catch(() => {});
          }
        }
      } catch (e) {}
    }, 4000);
    $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
    $('#f-chat').addEventListener('submit', async e => {
      e.preventDefault();
      const inp = $('#chat-input');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      try {
        const { message } = await api(`/api/chat/conversations/${cid}/messages`, {
          method: 'POST', body: JSON.stringify({ text })
        });
        appendMsgs([message]);
      } catch (err) { toast(err.message); inp.value = text; }
    });
  } catch (err) {
    app.innerHTML = `${topbar('Chat')}<p class="sub" style="padding:24px">${esc(err.message)}</p>`;
  }
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
        ${isMine ? `<button id="btn-push">🔔 Activar notificaciones</button>` : ''}
        ${isMine ? `<button data-logout style="color:var(--danger)">🚪 Cerrar sesión</button>` : ''}
      </div>`;
    $$('#app [data-go]').forEach(b => b.addEventListener('click', () => location.hash = b.dataset.go));
    const pb = $('#btn-push');
    if (pb) {
      // Mostrar estado actual: activar o desactivar
      const updatePushBtn = async () => {
        try {
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.getSubscription();
          const active = sub && Notification.permission === 'granted';
          pb.textContent = active ? '🔕 Desactivar notificaciones' : '🔔 Activar notificaciones';
          pb.dataset.active = active ? '1' : '0';
        } catch { pb.textContent = '🔔 Activar notificaciones'; }
      };
      updatePushBtn();
      pb.addEventListener('click', async () => {
        if (pb.dataset.active === '1') {
          // Desactivar: eliminar suscripción
          try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              await fetch('/api/auth/push-unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint })
              });
              await sub.unsubscribe();
            }
            localStorage.removeItem('genloria_vapid_key');
            toast('Notificaciones desactivadas');
          } catch (e) { toast('Error al desactivar'); }
        } else {
          await requestPushPermission();
        }
        updatePushBtn();
      });
    }
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
      toast('Guardando…');
      const fd = await compressFormImages(new FormData(e.target), 800, 0.85);
      const { user } = await apiForm('/api/users/me', fd, 'PUT');
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
      await compressFormImages(fd, 1200, 0.85);
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
  const y = (person.birthdate || '').slice(0, 4);
  const avatar = person.avatar_path ? esc(person.avatar_path) : '/icons/avatar-default.svg';

  // Filas de información personal con iconos
  const infoRows = [];
  const irow = (icon, label, value) => {
    if (!value) return;
    infoRows.push(`<div class="pv-row"><span class="pv-ic">${icon}</span><span class="pv-lab">${label}</span><span class="pv-val">${value}</span></div>`);
  };
  const fmtD = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return d; } };
  if (person.nickname) irow('🏷️', 'Apodo', `«${esc(person.nickname)}»`);
  if (person.maiden_name) irow('🪪', 'Apellido de soltera', esc(person.maiden_name));
  if (person.sex) irow('👤', 'Sexo', { M: 'Hombre', F: 'Mujer', X: 'Otro' }[person.sex] || esc(person.sex));
  irow('📅', 'Nacimiento', [person.birthdate ? fmtD(person.birthdate) : '', person.birth_place ? esc(person.birth_place) : ''].filter(Boolean).join(' — '));
  irow('💧', 'Bautismo', [person.baptism_date ? fmtD(person.baptism_date) : '', person.baptism_place ? esc(person.baptism_place) : ''].filter(Boolean).join(' — '));
  if (person.is_deceased) {
    irow('🕊️', 'Fallecimiento', [person.death_date ? fmtD(person.death_date) : '', person.death_place ? esc(person.death_place) : ''].filter(Boolean).join(' — '));
    irow('📝', 'Causa', person.death_cause ? esc(person.death_cause) : '');
    irow('⚰️', 'Entierro', person.burial_place ? esc(person.burial_place) : '');
  }
  irow('📞', 'Teléfono', person.phone ? esc(person.phone) : '');
  if (person.bio) irow('📄', 'Sobre esta persona', esc(person.bio));
  irow('💼', 'Ocupación', person.occupation ? esc(person.occupation) : '');
  irow('🎓', 'Educación', person.education ? esc(person.education) : '');
  irow('⛪', 'Religión', person.religion ? esc(person.religion) : '');
  irow('🌐', 'Nacionalidad', person.nationality ? esc(person.nationality) : '');
  irow('🏠', 'Residencia', person.residence ? esc(person.residence) : '');
  irow('🎖️', 'Servicio militar', person.military_service ? esc(person.military_service) : '');
  if (person.notes) irow('📌', 'Notas y fuentes', esc(person.notes));
  if (person.username) irow('🔑', 'Cuenta GENLORIA', 'Tiene su propia cuenta');

  // Filas de familia
  const famRows = [];
  const frow = (icon, label, value) => {
    if (!value) return;
    famRows.push(`<div class="pv-row"><span class="pv-ic">${icon}</span><span class="pv-lab">${label}</span><span class="pv-val">${value}</span></div>`);
  };
  if (r.parents1.length) frow('👪', 'Padres', r.parents1.map(p => nm(p.id)).join(', '));
  if (r.partner) frow('❤️', 'Pareja', nm(r.partner.id) + (r.partner.marriage_date ? ` (matr. ${fmtD(r.partner.marriage_date)})` : ''));
  if (r.former.length) frow('💔', 'Parejas anteriores', r.former.map(nm).join(', '));
  if (r.children.length) frow('👨‍👩‍👧', 'Hijos', r.children.map(nm).join(', '));

  const canEdit = isAdmin || person.id === (me && me.id);

  return `
  <div class="sheet-body pv-sheet">
    <button class="pv-x" id="pv-close" aria-label="Cerrar">✕</button>
    <div class="pv-head">
      <div class="pv-photo-wrap">
        <img class="pv-photo" src="${avatar}" alt="${esc(person.name)}" onerror="this.src='/icons/avatar-default.svg'">
        ${canEdit ? `<button class="pv-cam" id="pv-photo" title="Cambiar foto">📷</button>` : ''}
      </div>
      <h2 class="pv-name">${esc(person.name)}${person.is_deceased ? ' ✝' : ''}</h2>
      ${y ? `<div class="pv-year"><span class="pv-line"></span>${y}<span class="pv-line"></span></div>` : ''}
      ${person.is_placeholder ? '<div style="margin-top:6px"><span class="chip">SOLO ÁRBOL</span></div>' : ''}
    </div>
    <div class="pv-actions">
      ${person.phone ? `<button class="pv-act" id="pv-call"><span>📞</span>Llamar</button>` : ''}
      ${person.username && person.id !== me.id ? `<button class="pv-act" id="pv-msg"><span>💬</span>Mensaje</button>` : ''}
      <button class="pv-act" id="pv-tree"><span>🌳</span>Ver en árbol</button>
      <button class="pv-act" id="pv-print"><span>🖨️</span>Imprimir</button>
    </div>
    ${infoRows.length ? `
    <div class="pv-card">
      <div class="pv-card-head"><span class="pv-card-ic">👤</span><b>Información personal</b>
        ${canEdit ? `<button class="pv-edit" id="pv-edit">✏️ Editar</button>` : `<button class="pv-edit" id="pv-suggest">✏️ Proponer</button>`}
      </div>
      ${infoRows.join('')}
    </div>` : ''}
    ${famRows.length ? `
    <div class="pv-card">
      <div class="pv-card-head"><span class="pv-card-ic">👪</span><b>Familia</b>
        ${canEdit ? `<button class="pv-edit" id="pv-edit2">✏️ Editar</button>` : ''}
      </div>
      ${famRows.join('')}
    </div>` : '<div class="pv-card"><p style="color:var(--muted);margin:0">Sin relaciones registradas.</p></div>'}
    <div class="pv-foot">
      ${canEdit ? `<button class="btn" id="pv-edit3" style="margin-top:0">✏️ Editar ficha</button>` : ''}
      <button class="btn secondary" id="pv-close2" style="margin-top:0">Cerrar</button>
    </div>
  </div>`;
}

function wirePersonView(person, t, isAdmin) {
  const doClose = () => closeSheet();
  $('#pv-close').onclick = doClose;
  const c2 = $('#pv-close2'); if (c2) c2.onclick = doClose;
  const doPrint = () => {
    const a = document.createElement('a');
    a.href = `/api/export/person/${person.id}.pdf`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const pr = $('#pv-print'); if (pr) pr.onclick = doPrint;
  const goEdit = () => openPersonSheet(person.id, 'edit');
  ['pv-edit', 'pv-edit2', 'pv-edit3'].forEach(id => { const b = $('#' + id); if (b) b.onclick = goEdit; });
  const sg = $('#pv-suggest');
  if (sg) sg.onclick = () => { closeSheet(); location.hash = `#/tree/suggest?uid=${person.id}`; };
  const call = $('#pv-call');
  if (call && person.phone) call.onclick = () => { location.href = 'tel:' + person.phone.replace(/[^+\d]/g, ''); };
  const msg = $('#pv-msg');
  if (msg) msg.onclick = async () => {
    try {
      const { conversation } = await api('/api/chat/conversations', {
        method: 'POST', body: JSON.stringify({ participant_ids: [person.id] })
      });
      closeSheet();
      location.hash = `#/chat/${conversation.id}`;
    } catch (e) { toast(e.message); }
  };
  const tree = $('#pv-tree');
  if (tree) tree.onclick = () => { closeSheet(); location.hash = '#/tree'; };
  const photo = $('#pv-photo');
  if (photo) photo.onclick = () => { closeSheet(); openPersonSheet(person.id, 'edit'); };
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

  // Centrar el árbol en la vista
  requestAnimationFrame(() => {
    const sc = $('#tree-scroll');
    const svg = $('#tree-svg');
    if (sc && svg) {
      const svgW = svg.getBoundingClientRect().width || layout.width;
      sc.scrollLeft = Math.max(0, (svgW - sc.clientWidth) / 2);
    }
  });

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
      ${avatarHTML(u)}<span class="grow">${coloredName(u)}${u.is_placeholder ? ' <span class="chip">SOLO ÁRBOL</span>' : ''}<small>${years}</small></span><span style="color:var(--muted)">›</span>
    </button>`;
  };
  let familyName = 'Mi familia';
  try { const { family } = await api('/api/auth/my-family'); familyName = family.name; } catch {}
  const isAdmin = me && me.role === 'admin';
  app.innerHTML = `
    ${topbar('Familia')}
    <div style="padding:16px 12px 0;text-align:center">
      <h2 style="margin:0;display:inline-block">${esc(familyName)}</h2>
      ${isAdmin ? `<button class="mini-btn" id="btn-famname" style="margin-left:8px" title="Cambiar nombre">✏️</button>` : ''}
    </div>
    <div style="padding:12px 12px 0"><button class="btn" id="btn-invite" style="width:100%">✉️ Invitar a un familiar</button></div>
    <div style="padding:12px 12px 0"><input type="search" id="fam-q" placeholder="🔍 Buscar familiar…" style="margin:0"></div>
    <div class="card" style="padding:0;overflow:hidden" id="fam-list">
      ${users.map(row).join('')}
    </div>
    <p style="text-align:center;color:var(--muted);font-size:.85rem">${users.length} persona(s) en la familia</p>`;
  const bfn = $('#btn-famname');
  if (bfn) bfn.onclick = async () => {
    const nuevo = prompt('Nombre de la familia:', familyName);
    if (!nuevo || !nuevo.trim() || nuevo.trim() === familyName) return;
    try {
      const r = await api('/api/auth/my-family', { method: 'PUT', body: JSON.stringify({ name: nuevo.trim() }) });
      toast('Nombre actualizado ✅');
      location.reload();
    } catch (e) { toast(e.message); }
  };
  $('#btn-invite').onclick = async () => {
    try {
      const { family } = await api('/api/auth/my-family');
      const text = `Únete a mi familia "${family.name}" en GENLORIA con el código: ${family.invite_code} — https://genloria.com/#/register`;
      if (navigator.share) { try { await navigator.share({ text }); } catch {} }
      else { try { await navigator.clipboard.writeText(text); toast('Invitación copiada 📋'); } catch {} }
    } catch (err) { toast(err.message); }
  };
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
      <button id="tab-users" class="${tab !== 'codes' && tab !== 'tree' && tab !== 'platform' && tab !== 'mail' ? 'active' : ''}">👥 Usuarios</button>
      <button id="tab-codes" class="${tab === 'codes' ? 'active' : ''}">🎟 Códigos</button>
      <button id="tab-tree" class="${tab === 'tree' ? 'active' : ''}">🌳 Árbol</button>
      <button id="tab-mail" class="${tab === 'mail' ? 'active' : ''}">📧 Correos</button>
      ${me.is_superadmin ? `<button id="tab-platform" class="${tab === 'platform' ? 'active' : ''}">🌐 Plataforma</button>` : ''}
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
        <div class="grow">${coloredName(u)}<small>${esc(u.email || '')}${u.role === 'admin' ? ' · ADMIN' : ''}</small></div>
        <input type="color" value="${u.color || userColorFor(u)}" data-coloruser="${u.id}" title="Color de ${esc(u.name)}" style="width:36px;height:28px;padding:0;border:0;background:none;cursor:pointer">
        ${u.id !== me.id ? `${u.role === 'admin'
          ? `<button class="mini-btn" data-role="${u.id}" data-newrole="member" title="Quitar administrador">⬇️ Quitar admin</button>`
          : `<button class="mini-btn" data-role="${u.id}" data-newrole="admin" title="Hacer administrador">⬆️ Hacer admin</button>`}
        <button class="mini-btn" data-recover="${u.id}">🔑 Código</button>
        <button class="mini-btn" data-deluser="${u.id}" data-name="${esc(u.name)}" style="color:#f87171">🗑️ Eliminar</button>` : ''}
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
    body.querySelectorAll('[data-deluser]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.name || 'este miembro';
        if (!confirm(`¿Eliminar a ${name}?\n\nSe borrará su cuenta, sus publicaciones, fotos, historias y sus parentescos en el árbol. Esta acción no se puede deshacer.`)) return;
        try {
          await api(`/api/users/admin/users/${btn.dataset.deluser}`, { method: 'DELETE' });
          toast(`${name} eliminado ✅`);
          viewAdmin();
        } catch (err) { toast(err.message); }
      });
    });
    body.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newRole = btn.dataset.newrole;
        const label = newRole === 'admin' ? 'hacer administrador' : 'quitarle el rol de administrador';
        if (!confirm(`¿Seguro que quieres ${label} a este miembro?`)) return;
        try {
          await api(`/api/users/admin/users/${btn.dataset.role}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
          });
          toast(newRole === 'admin' ? 'Ahora es administrador ✅' : 'Ya no es administrador ✅');
          viewAdmin();
        } catch (err) { toast(err.message); }
      });
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
    body.querySelectorAll('[data-coloruser]').forEach(inp => {
      inp.addEventListener('change', async () => {
        try {
          const fd = new FormData();
          fd.append('color', inp.value);
          await api(`/api/users/admin/users/${inp.dataset.coloruser}`, { method: 'PUT', body: fd });
          toast('Color actualizado ✓');
        } catch (err) { toast(err.message); }
      });
    });
  }
  function showCodes() {
    body.innerHTML = `
      <div id="fam-code-box"><p class="empty">Cargando código de tu familia…</p></div>
      <h3 style="margin-top:16px">Nuevo código de invitación</h3>
      <p class="sub" style="margin-top:-8px">Genera un código y compártelo con tu familiar. Con ese código creará su cuenta en la pantalla de registro.</p>
      <form id="f-newcode">
        <label>Código (vacío = aleatorio)</label><input type="text" name="code" placeholder="Ej: NAVIDAD-2026">
        <label>Usos máximos (0 = ilimitado)</label><input type="text" name="maxUses" value="0" inputmode="numeric">
        <button class="btn" type="submit">Generar código</button>
      </form>
      <h3>Códigos</h3>
      ${codes.map(c => `<div class="row">
        <div class="grow"><b>${esc(c.code)}</b><small>${c.used_count}${c.max_uses > 0 ? '/' + c.max_uses : ''} usados · ${c.active ? 'activo' : 'desactivado'}</small></div>
        ${c.active ? `<button class="mini-btn" data-share="${esc(c.code)}">📤 Enviar</button>
        <button class="mini-btn" data-copy="${esc(c.code)}">📋 Copiar</button>
        <button class="mini-btn danger" data-deact="${c.id}">Desactivar</button>` : ''}
      </div>`).join('') || '<p class="empty">Sin códigos</p>'}`;
    $('#f-newcode').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { inviteCode } = await api('/api/users/admin/invite-codes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: fd.get('code'), maxUses: fd.get('maxUses') })
        });
        toast('Código: ' + inviteCode.code); viewAdmin();
      } catch (err) { toast(err.message); }
    });
    // Código principal de la familia
    api('/api/auth/my-family').then(({ family }) => {
      const box = $('#fam-code-box');
      if (!box || !family) return;
      box.innerHTML = `<div class="card" style="border-color:var(--accent)">
        <b>🌳 ${esc(family.name)}</b><br>
        <small>Código de tu familia para invitar:</small>
        <div style="font-size:1.4rem;letter-spacing:.15em;margin:.3rem 0"><b>${esc(family.invite_code)}</b></div>
        <small>${family.memberCount} miembro(s)</small>
        <div style="margin-top:8px">
          <button class="mini-btn" id="fam-share">📤 Enviar</button>
          <button class="mini-btn" id="fam-copy">📋 Copiar</button>
        </div></div>`;
      $('#fam-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(family.invite_code); toast('Código copiado 📋'); }
        catch { toast('Código: ' + family.invite_code); }
      };
      $('#fam-share').onclick = async () => {
        const text = `Únete a mi familia "${family.name}" en GENLORIA con el código: ${family.invite_code} — https://genloria.com/#/register`;
        if (navigator.share) { try { await navigator.share({ text }); } catch {} }
        else { try { await navigator.clipboard.writeText(text); toast('Copiado 📋'); } catch {} }
      };
    }).catch(() => {});
    $$('[data-deact]', body).forEach(b => b.addEventListener('click', async () => {
      await api(`/api/users/admin/invite-codes/${b.dataset.deact}`, { method: 'DELETE' });
      viewAdmin();
    }));
    $$('[data-copy]', body).forEach(b => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Código copiado 📋'); }
      catch { toast('Código: ' + b.dataset.copy); }
    }));
    $$('[data-share]', body).forEach(b => b.addEventListener('click', async () => {
      const code = b.dataset.share;
      const text = `🌳 Únete a nuestra familia en GENLORIA\n\nTu código familiar es: ${code}\n\nEntra aquí: https://genloria.com\n\nGeneraciones conectadas. Historias que perduran.`;
      if (navigator.share) {
        try { await navigator.share({ title: 'Invitación a GENLORIA', text }); }
        catch (e) { /* el usuario canceló */ }
      } else {
        try { await navigator.clipboard.writeText(text); toast('Invitación copiada 📋 — pégala donde quieras enviarla'); }
        catch { toast(text); }
      }
    }));
  }
  function activateTab(name) {
    ['users', 'codes', 'tree', 'platform', 'mail'].forEach(t => {
      const el = $('#tab-' + t);
      if (el) el.classList.toggle('active', t === name);
    });
  }
  function showMail() {
    const withMail = users.filter(u => u.email && u.email.trim());
    body.innerHTML = `
      <h3 style="margin-top:0">📧 Correo de bienvenida</h3>
      <p class="sub">Envía el correo de bienvenida (diseño elegante) a cada miembro registrado de tu familia, personalizado con su nombre.</p>
      <div class="card" style="border-color:var(--accent)">
        <b>${withMail.length} miembro(s)</b> tienen correo registrado y lo recibirán.
      </div>
      <button class="btn" id="btn-broadcast" style="margin-top:12px">✉️ Enviar a todos ahora</button>
      <div id="broadcast-result" style="margin-top:12px"></div>`;
    $('#btn-broadcast').addEventListener('click', async () => {
      if (!withMail.length) { toast('No hay miembros con correo registrado.'); return; }
      if (!confirm(`¿Enviar el correo de bienvenida a ${withMail.length} miembro(s)?\n\nCada uno lo recibe con su propio nombre.`)) return;
      const btn = $('#btn-broadcast');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await api('/api/users/admin/broadcast-welcome', { method: 'POST' });
        $('#broadcast-result').innerHTML = `<div class="card" style="border-color:#2e7d32">
          <b>✅ Enviados: ${r.sent} de ${r.total}</b>
          ${r.failed ? `<br><small style="color:#f87171">Fallaron: ${r.failed} (${esc((r.failures || []).join(', '))})</small>` : ''}</div>`;
        toast('Correos enviados ✅');
      } catch (err) { toast(err.message); }
      btn.disabled = false; btn.textContent = '✉️ Enviar a todos ahora';
    });
  }
  $('#tab-users').addEventListener('click', () => { activateTab('users'); showUsers(); });
  $('#tab-codes').addEventListener('click', () => { activateTab('codes'); showCodes(); });
  $('#tab-tree').addEventListener('click', () => { activateTab('tree'); adminTreeTab(body); });
  $('#tab-mail').addEventListener('click', () => { activateTab('mail'); showMail(); });
  if (me.is_superadmin) $('#tab-platform').addEventListener('click', () => { activateTab('platform'); showPlatform(); });
  if (tab === 'tree') { activateTab('tree'); adminTreeTab(body); }
  else if (tab === 'mail') { activateTab('mail'); showMail(); }
  else if (tab === 'codes') { activateTab('codes'); showCodes(); }
  else if (tab === 'platform' && me.is_superadmin) { activateTab('platform'); showPlatform(); }
  else showUsers();
}

function showPlatform() {
  const body = $('#admin-body');
  body.innerHTML = '<div class="loading">Cargando estadísticas…</div>';
  api('/api/users/platform/stats').then(({ totalUsers, totalFamilies, totalPosts, perFamily, byDay }) => {
    const maxDay = Math.max(1, ...byDay.map(d => d.n));
    body.innerHTML = `
      <h3 style="margin-top:0">🌐 Toda la plataforma</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div class="card" style="text-align:center;margin:0"><div style="font-size:1.8rem"><b>${totalUsers}</b></div><small>personas registradas</small></div>
        <div class="card" style="text-align:center;margin:0"><div style="font-size:1.8rem"><b>${totalFamilies}</b></div><small>familias</small></div>
        <div class="card" style="text-align:center;margin:0"><div style="font-size:1.8rem"><b>${totalPosts}</b></div><small>publicaciones</small></div>
      </div>
      <h3>Registros últimos 30 días</h3>
      <div style="display:flex;align-items:flex-end;gap:2px;height:80px;margin-bottom:16px">
        ${byDay.map(d => `<div title="${d.day}: ${d.n}" style="flex:1;background:var(--accent);border-radius:2px;min-height:3px;height:${Math.round(d.n / maxDay * 76) + 3}px"></div>`).join('') || '<small>Sin datos</small>'}
      </div>
      <h3>Familias (${perFamily.length})</h3>
      ${perFamily.map(f => `<div class="row">
        <div class="grow"><b>${esc(f.name)}</b><small>${f.members} miembro(s) · ${f.admins} admin(s) · código: ${esc(f.invite_code)}</small></div>
      </div>`).join('')}
      <h3 style="margin-top:16px">Buscar persona</h3>
      <input type="search" id="plat-q" placeholder="🔍 Nombre o correo…" style="margin-bottom:8px">
      <div id="plat-results"></div>
      <div id="plat-recover"></div>`;
    $('#plat-q').addEventListener('input', async e => {
      const q = e.target.value.trim();
      if (q.length < 2) { $('#plat-results').innerHTML = ''; return; }
      try {
        const { users } = await api('/api/users/platform/users?q=' + encodeURIComponent(q));
        $('#plat-results').innerHTML = users.map(u => `<div class="row">${avatarHTML(u)}
          <div class="grow"><b>${esc(u.name)}</b><small>${esc(u.email || '')} · ${esc(u.family_name || 'Sin familia')}${u.role === 'admin' ? ' · ADMIN' : ''}</small></div>
          <button class="mini-btn" data-precover="${u.id}">🔑 Código</button>
        </div>`).join('') || '<p class="empty">Sin resultados</p>';
        $('#plat-results').querySelectorAll('[data-precover]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              const { name, code } = await api(`/api/users/admin/users/${btn.dataset.precover}/recovery-code`, { method: 'POST' });
              $('#plat-recover').innerHTML = `<div class="card" style="border-color:var(--accent)">
                <b>Código para ${esc(name)}:</b>
                <div style="font-size:1.6rem;letter-spacing:.2em;margin:.4rem 0"><b>${esc(code)}</b></div>
                <small>Válido por 24 horas, un solo uso.</small></div>`;
            } catch (err) { toast(err.message); }
          });
        });
      } catch (err) { toast(err.message); }
    });
  }).catch(err => { body.innerHTML = `<p class="empty">${esc(err.message)}</p>`; });
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

// ---------- Conoce GENLORIA (página pública) ----------
function viewConoce() {
  setNav(null);
  document.title = 'Conoce GENLORIA — Generaciones conectadas. Historias que perduran.';
  const letters = [
    ['G', 'Generaciones', 'Representa la conexión entre abuelos, padres, hijos, nietos y todas las generaciones que forman una familia. GENLORIA busca mantener vivos esos vínculos y permitir que cada generación conozca a las anteriores.', 'blue'],
    ['E', 'Encuentro', 'Simboliza el lugar donde las familias vuelven a encontrarse. No importa si sus integrantes viven en diferentes ciudades, países o continentes. GENLORIA ofrece un espacio digital donde pueden compartir sus vidas y mantenerse cerca.', 'blue'],
    ['N', 'Nexo', 'Representa la conexión que une a las personas mediante la tecnología. Cada familiar forma parte de una red de relaciones, recuerdos e historias que construyen una identidad común.', 'blue'],
    ['L', 'Legado', 'Simboliza todo aquello que una generación transmite a la siguiente. Fotografías, historias, enseñanzas, tradiciones, documentos y recuerdos que merecen conservarse. GENLORIA busca que ese legado permanezca accesible para quienes vendrán después.', 'green'],
    ['O', 'Origen', 'Representa nuestras raíces y la búsqueda de nuestra historia. Conocer de dónde venimos nos ayuda a comprender quiénes somos. A través del árbol genealógico, cada familia puede reconstruir su pasado y descubrir las conexiones entre sus antepasados.', 'green'],
    ['R', 'Raíces', 'Simboliza los vínculos familiares que nos sostienen y nos conectan. Así como las raíces de un árbol alimentan sus ramas, las generaciones anteriores forman la base de nuestra historia.', 'green'],
    ['I', 'Identidad', 'Representa aquello que hace única a cada familia. Sus apellidos, costumbres, tradiciones, experiencias, valores y recuerdos compartidos. Cada familia posee una identidad propia que merece ser respetada y conservada.', 'green'],
    ['A', 'Árbol', 'Representa el árbol genealógico, símbolo central de GENLORIA. Cada persona es parte de una estructura familiar que crece y se transforma con el paso de los años. Sus raíces representan el pasado, su tronco el presente y sus ramas las generaciones futuras.', 'green'],
  ];
  app.innerHTML = `
  <div class="conoce">
    <div class="conoce-hero">
      <img class="logo" src="/logo-genloria.png" alt="Logo oficial de GENLORIA">
      <h1>GENLORIA</h1>
      <p class="slogan">Generaciones conectadas. Historias que perduran.</p>
      <div class="conoce-cta">
        <button class="btn" data-go="#/register">Crear mi familia</button>
        <button class="btn-ghost" data-go="#/login">Iniciar sesión</button>
      </div>
    </div>

    <div class="conoce-sec reveal">
      <h2>Bienvenidos a <span class="em">GENLORIA</span></h2>
      <p>Cada familia tiene una historia. Una historia que comienza mucho antes de nosotros y continúa escribiéndose con cada nueva generación.</p>
      <p>Nuestros abuelos guardan recuerdos, nuestros padres transmiten enseñanzas y nuestros hijos representan el futuro de un legado que merece permanecer vivo.</p>
      <p>Pero con el paso del tiempo, las familias crecen, se dispersan por diferentes ciudades y países, y muchos de esos momentos especiales quedan olvidados entre fotografías, conversaciones y recuerdos.</p>
      <p><b>GENLORIA nace con una misión:</b> mantener unidas a las familias, sin importar la distancia, y conservar sus historias para las generaciones futuras.</p>
      <p>Más que una red social, GENLORIA es un hogar digital privado donde cada familia puede compartir su presente, descubrir su pasado y construir su legado.</p>
    </div>

    <div class="conoce-sec reveal">
      <h2>¿Qué es <span class="em">GENLORIA</span>?</h2>
      <p>GENLORIA es una plataforma social familiar privada que combina las funciones de una red social moderna con un árbol genealógico interactivo.</p>
      <p>Cualquier persona puede registrarse gratuitamente en GENLORIA y crear su propio espacio familiar privado. Para formar parte de una familia ya existente, es necesario recibir una invitación de uno de sus miembros autorizados.</p>
      <p>Cada familia dispone de su propio espacio digital, donde sus miembros autorizados pueden:</p>
      <div class="conoce-feats">
        <div class="conoce-feat"><span class="fi">📸</span><small>Compartir fotografías, videos e historias familiares.</small></div>
        <div class="conoce-feat"><span class="fi">💬</span><small>Comentar y reaccionar a las publicaciones.</small></div>
        <div class="conoce-feat"><span class="fi">🌳</span><small>Construir tu árbol genealógico con padres, abuelos, bisabuelos, antepasados y nuevas generaciones, incluyendo familiares vivos o fallecidos, incluso si nunca han tenido una cuenta en GENLORIA.</small></div>
        <div class="conoce-feat"><span class="fi">🧬</span><small>Descubrir relaciones de parentesco entre generaciones.</small></div>
        <div class="conoce-feat"><span class="fi">📖</span><small>Crear perfiles y biografías de familiares.</small></div>
        <div class="conoce-feat"><span class="fi">🕯️</span><small>Preservar recuerdos de antepasados y seres queridos.</small></div>
        <div class="conoce-feat"><span class="fi">✉️</span><small>Invitar a otros familiares a su espacio privado.</small></div>
        <div class="conoce-feat"><span class="fi">🔒</span><small>Cada familia controla quién accede a su contenido.</small></div>
      </div>
      <p style="margin-top:14px"><b>Tu familia. Tu espacio. Tu historia.</b></p>
      <p style="margin-top:8px"><small>Las personas representadas en el árbol genealógico no necesitan registrarse en GENLORIA. Solo los usuarios autorizados pueden acceder al espacio social privado de su familia.</small></p>
    </div>

    <div class="conoce-sec reveal">
      <h2>¿Qué significa <span class="em">GENLORIA</span>?</h2>
      <p>GENLORIA es un nombre original de marca creado para representar la unión entre generaciones, la memoria familiar y la tecnología. Cada una de sus ocho letras representa un valor fundamental de nuestra filosofía.</p>
      <div class="letter-cards">
        ${letters.map(([L, t, d, c]) => `<div class="letter-card"><span class="L ${c}">${L}</span><div><b>${t}</b><small>${d}</small></div></div>`).join('')}
      </div>
    </div>

    <div class="conoce-sec reveal">
      <h2><span class="em">GEN</span> + <span class="em">LORIA</span>: nuestro nombre en dos ideas</h2>
      <p>Las ocho letras anteriores se resumen en dos partes:</p>
      <div class="conoce-split">
        <div class="box"><span class="tag">GEN</span><b>Generaciones y genealogía</b><small>Representa a las personas, los vínculos familiares y la conexión entre generaciones.</small></div>
        <div class="box"><span class="tag">LORIA</span><b>Legado, Origen, Raíces, Identidad y Árbol</b><small>Representa la historia familiar, su memoria y la continuidad de su legado.</small></div>
      </div>
      <p style="margin-top:14px">Juntas, estas ideas forman GENLORIA: una identidad que une familia, historia y tecnología.</p>
    </div>

    <div class="conoce-sec reveal">
      <h2>Nuestro símbolo: <span class="em">el árbol de las generaciones</span></h2>
      <p>El logo de GENLORIA representa visualmente nuestra misión.</p>
      <div class="conoce-feats">
        <div class="conoce-feat"><span class="fi">🌳</span><small><b>El árbol dorado:</b> simboliza el legado familiar, la fortaleza de nuestras raíces y la continuidad entre generaciones.</small></div>
        <div class="conoce-feat"><span class="fi">👥</span><small><b>Los perfiles humanos:</b> representan a cada integrante de la familia, desde los antepasados hasta los nuevos descendientes.</small></div>
        <div class="conoce-feat"><span class="fi">🍃</span><small><b>Las hojas verdes:</b> simbolizan la vida, el crecimiento, la esperanza y las nuevas generaciones.</small></div>
        <div class="conoce-feat"><span class="fi">💠</span><small><b>Las conexiones azules luminosas:</b> representan la tecnología, la comunicación y los vínculos que unen a los familiares en una red digital.</small></div>
      </div>
      <p style="margin-top:14px">Cada elemento del logo transmite un mismo mensaje: <b>la tecnología conecta a las personas, pero la familia es lo que les da raíces.</b></p>
    </div>

    <div class="conoce-sec reveal">
      <h2>Nuestra <span class="em">misión</span> y <span class="em">visión</span></h2>
      <p><b>Misión:</b> conectar familias a través de una plataforma privada, accesible e intuitiva, que permita compartir experiencias, fortalecer los vínculos entre generaciones y preservar la memoria familiar mediante la tecnología.</p>
      <p><b>Visión:</b> convertir GENLORIA en un espacio digital de referencia para las familias de todo el mundo, donde cada generación pueda conocer su historia, compartir su presente y dejar un legado para el futuro.</p>
      <h2 style="margin-top:20px">Nuestros <span class="em">valores</span></h2>
      <div class="conoce-values">
        <div class="conoce-value"><b>Familia</b><small>Creemos en la importancia de mantener vivos los vínculos entre generaciones.</small></div>
        <div class="conoce-value"><b>Privacidad</b><small>Cada familia debe controlar quién accede a sus recuerdos y conversaciones.</small></div>
        <div class="conoce-value"><b>Identidad</b><small>Cada familia posee una historia única.</small></div>
        <div class="conoce-value"><b>Memoria</b><small>Valoramos la conservación de fotografías, historias y testimonios.</small></div>
        <div class="conoce-value"><b>Conexión</b><small>Utilizamos la tecnología para acercar a las personas.</small></div>
        <div class="conoce-value"><b>Legado</b><small>Trabajamos para que las historias familiares se transmitan de generación en generación.</small></div>
      </div>
    </div>

    <div class="conoce-sec reveal">
      <h2>Una red social <span class="em">diferente</span></h2>
      <p>Las redes sociales tradicionales están diseñadas para conectar personas con el mundo. GENLORIA tiene un propósito diferente: <b>conectar a las personas con quienes forman parte de su historia.</b></p>
      <p>Cada familia cuenta con su propio espacio privado e independiente, con acceso controlado mediante invitaciones. Solo los miembros autorizados pueden ver y compartir el contenido de su familia.</p>
      <p>Aquí, lo importante no es conseguir seguidores ni hacer publicaciones virales. Lo importante es compartir un cumpleaños, recordar a un abuelo, conocer a un primo lejano, descubrir una fotografía antigua o escuchar una historia que nunca antes habíamos conocido.</p>
      <p>GENLORIA está pensada para que esos pequeños momentos familiares tengan un lugar especial.</p>
    </div>

    <div class="conoce-quote reveal">
      <p>"Imagina que dentro de cincuenta años uno de tus descendientes pueda explorar su árbol genealógico, conocer los nombres de sus antepasados, descubrir fotografías familiares y leer historias de personas que nunca llegó a conocer. Ese es el legado que GENLORIA aspira a ayudar a construir."</p>
      <p class="sig">GENLORIA — Generaciones conectadas. Historias que perduran.<br>Una creación de Nilltrom.</p>
    </div>

    <div class="conoce-sec" style="text-align:center">
      <p style="max-width:640px;margin:0 auto 18px">Tu historia familiar merece un lugar especial. Comienza hoy a conectar generaciones, compartir recuerdos y construir un legado que perdure.</p>
      <div class="conoce-cta">
        <button class="btn" data-go="#/register">Crear mi familia</button>
        <button class="btn-ghost" data-go="#/login" style="border-color:var(--border);color:var(--text)">← Volver</button>
      </div>
    </div>
    <p class="conoce-foot">© 2026 GENLORIA · Generaciones conectadas. Historias que perduran.</p>
  </div>`;
  // Animación suave al desplazar
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.08 });
  $$('.conoce .reveal').forEach(el => io.observe(el));
}

async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    me = user;
    if (me) ensurePushSubscription();
  } catch { me = null; }

  async function route() {
    const h = location.hash || '#/feed';
    // Restaurar zoom si se sale del chat
    if (!h.startsWith('#/chat/')) lockZoom(false);
    if (!me && h !== '#/login' && h !== '#/register' && h !== '#/recover' && h !== '#/conoce') { location.hash = '#/login'; return; }
    if (me && (h === '#/login' || h === '#/register' || h === '#/recover')) { location.hash = '#/feed'; return; }
    if (h === '#/login') return viewLogin();
    if (h === '#/conoce') return viewConoce();
    if (h === '#/register') return viewRegister();
    if (h === '#/recover') return viewRecover();
    if (h === '#/feed') return viewFeed();
    if (h === '#/new') return viewNew();
    if (h === '#/tree' || h.startsWith('#/tree?')) return viewTree();
    if (h.startsWith('#/tree/suggest')) return viewSuggest();
    if (h === '#/family') return viewFamily();
    if (h === '#/chat') return viewChatList();
    if (h.startsWith('#/chat/')) return viewChatThread(h.slice(7));
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
