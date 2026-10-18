// push.js — Notificaciones push via Web Push (VAPID)
const webpush = require('web-push');
const db = require('./db');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BBbtH81eXxtuGQyhdPjxDH0NWsfyDMbo19zNNjnj_hKA4PEAtxaLyLhIInWr4Qt-TAlSOAntzDVdMjYkMhM6lQw';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'kMncyQ4sEnsHY4U0gMlqh15cllbvSVDOnZCgilfw5hE';

webpush.setVapidDetails('mailto:admin@genloria.com', VAPID_PUBLIC, VAPID_PRIVATE);

function getVapidPublicKey() {
  return VAPID_PUBLIC;
}

// Envía push a un usuario (todas sus suscripciones)
async function sendPushToUser(userId, payload) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  const data = JSON.stringify(payload);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        data
      );
    } catch (e) {
      // Suscripción inválida/expirada → eliminarla
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
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
