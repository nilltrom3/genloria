// push.js — Notificaciones push via Web Push (VAPID)
const webpush = require('web-push');
const db = require('./db');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@genloria.com', VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn('[push] VAPID keys no configuradas — notificaciones push desactivadas');
}

function getVapidPublicKey() {
  return VAPID_PUBLIC || '';
}

// Envía push a un usuario (todas sus suscripciones)
async function sendPushToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) {
    console.log(`[push] Sin suscripciones para usuario ${userId}`);
    return;
  }
  const data = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        data,
        { urgency: 'high', TTL: 3600 }
      );
      console.log(`[push] Enviado a usuario ${userId} (${s.endpoint.slice(0,50)}...)`);
    } catch (e) {
      console.log(`[push] Error enviando a usuario ${userId}: ${e.statusCode} ${e.message}`);
      // Suscripción inválida/expirada o clave VAPID desactualizada → eliminarla
      // (el cliente se re-suscribe solo al abrir la app)
      if (e.statusCode === 404 || e.statusCode === 410 || e.statusCode === 403) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        console.log(`[push] Suscripción obsoleta eliminada (usuario ${userId})`);
      }
    }
  }
}

// Envía push a todos los miembros de una familia (excepto el autor)
async function sendPushToFamily(familyId, excludeUserId, payload) {
  const members = db.prepare(
    'SELECT id FROM users WHERE family_id = ? AND id != ? AND is_placeholder = 0'
  ).all(familyId, excludeUserId);
  for (const m of members) {
    sendPushToUser(m.id, payload).catch(() => {});
  }
}

module.exports = { getVapidPublicKey, sendPushToUser, sendPushToFamily };

// Envía un push de prueba a UNA suscripción y reporta el resultado SIN borrarla.
// Devuelve { ok:true } o { ok:false, status, message }.
async function testPushToSubscription(sub) {
  const payload = JSON.stringify({
    title: '🔔 Prueba GENLORIA',
    body: 'Si ves esta notificación, todo funciona en este dispositivo.',
    tag: 'genloria-test',
    url: '/'
  });
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { urgency: 'high', TTL: 60 }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, status: e.statusCode || 0, message: String(e.message || e).slice(0, 160) };
  }
}

module.exports.testPushToSubscription = testPushToSubscription;
