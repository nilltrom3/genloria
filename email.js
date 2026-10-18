// email.js — Envío de correos transaccionales via Resend.
// Requiere RESEND_API_KEY en variables de entorno. Si no está configurada,
// los envíos se omiten en silencio (la app sigue funcionando sin correos).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'GENLORIA <bienvenido@genloria.com>';

function configured() {
  return !!RESEND_API_KEY;
}

async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log('[email] RESEND_API_KEY no configurada — correo omitido para', to);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log('[email] Error Resend:', res.status, JSON.stringify(data).slice(0, 200));
      return { ok: false, error: data };
    }
    console.log('[email] Enviado a', to, 'id', data.id);
    return { ok: true, id: data.id };
  } catch (e) {
    console.log('[email] Excepción enviando a', to, e.message);
    return { ok: false, error: e.message };
  }
}

const BRAND_HEAD = `
  <div style="background:#0b2b4f;padding:28px 24px;text-align:center;">
    <div style="font-size:26px;font-weight:bold;color:#d4a017;letter-spacing:2px;">GENLORIA</div>
    <div style="color:#ffffff;font-size:13px;margin-top:6px;">Generaciones conectadas. Historias que perduran.</div>
  </div>`;
const BRAND_FOOT = `
  <div style="padding:18px 24px;text-align:center;color:#888;font-size:12px;">
    Una creación de Nilltrom · genloria.com
  </div>`;

function welcomeEmail(name, familyName) {
  const safeName = String(name || 'familiar').replace(/[<>&"]/g, '');
  const safeFam = String(familyName || 'tu familia').replace(/[<>&"]/g, '');
  return {
    subject: `¡Bienvenido a GENLORIA, ${safeName}! 🌳`,
    html: `<!DOCTYPE html><html><body style="margin:0;font-family:Arial,sans-serif;background:#f4f4f4;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;">
        ${BRAND_HEAD}
        <div style="padding:28px 24px;color:#333;font-size:15px;line-height:1.6;">
          <p>Hola <b>${safeName}</b>,</p>
          <p>¡Te damos la bienvenida a <b>GENLORIA</b>! 🎉</p>
          <p>Ya eres parte de <b>${safeFam}</b>. Aquí podrás:</p>
          <ul>
            <li>📸 Compartir fotos y recuerdos con tu familia</li>
            <li>🌳 Explorar tu árbol genealógico</li>
            <li>📖 Guardar las historias de tus generaciones</li>
            <li>💬 Conversar en privado con tus familiares</li>
          </ul>
          <p style="text-align:center;margin:28px 0;">
            <a href="https://genloria.com" style="background:#d4a017;color:#0b2b4f;font-weight:bold;
               padding:14px 32px;border-radius:8px;text-decoration:none;">Entrar a GENLORIA</a>
          </p>
          <p>Porque el mejor legado que podemos dejar es que nuestra historia nunca sea olvidada.</p>
        </div>
        ${BRAND_FOOT}
      </div>
    </body></html>`
  };
}

module.exports = { configured, sendEmail, welcomeEmail, EMAIL_FROM };
