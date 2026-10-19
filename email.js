// email.js — Envío de correos transaccionales via Resend.
// Requiere RESEND_API_KEY en variables de entorno. Si no está configurada,
// los envíos se omiten en silencio (la app sigue funcionando sin correos).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'GENLORIA <bienvenido@genloria.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'info@genloria.com';

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
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, reply_to: REPLY_TO })
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
        <div style="background:#0b2b4f;padding:30px 24px;text-align:center;">
          <div style="font-size:28px;font-weight:bold;color:#d4a017;letter-spacing:3px;">GENLORIA</div>
          <div style="color:#ffffff;font-size:13px;margin-top:8px;letter-spacing:1px;">Generaciones conectadas. Historias que perduran.</div>
          <div style="width:60px;height:3px;background:#d4a017;margin:16px auto 0;"></div>
        </div>
        <div style="padding:30px 26px;background:#ffffff;font-size:15px;line-height:1.7;color:#333;">
          <p>Estimado/a <b>${safeName}</b>,</p>
          <p>Es un honor darle la bienvenida a <b>GENLORIA</b>, el espacio privado donde su familia preservará su historia para las futuras generaciones.</p>
          <p>Usted ahora forma parte de <b>${safeFam}</b>, donde podrá:</p>
          <ul style="color:#0b2b4f;">
            <li>Explorar su árbol genealógico interactivo</li>
            <li>Compartir fotografías y recuerdos familiares</li>
            <li>Preservar las historias de sus seres queridos</li>
            <li>Conversar en privado con sus familiares</li>
          </ul>
          <p style="text-align:center;margin:30px 0;">
            <a href="https://genloria.com" style="background:#0b2b4f;color:#d4a017;font-weight:bold;padding:14px 36px;border-radius:8px;text-decoration:none;font-size:16px;">Entrar a GENLORIA</a>
          </p>
          <p>Atentamente,<br><b>El equipo de GENLORIA</b></p>
        </div>
        <div style="padding:16px;background:#f7f7f7;text-align:center;color:#999;font-size:12px;">Una creación de Nilltrom · genloria.com</div>
      </div>
    </body></html>`
  };
}

module.exports = { configured, sendEmail, welcomeEmail, EMAIL_FROM };
