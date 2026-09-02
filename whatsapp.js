import crypto from 'node:crypto';

const graphVersion = process.env.META_GRAPH_VERSION || 'v23.0';
const accessToken = () => process.env.WHATSAPP_ACCESS_TOKEN || '';
const phoneNumberId = () => process.env.WHATSAPP_PHONE_NUMBER_ID || '';

export function whatsappConfigured() {
  return Boolean(accessToken() && phoneNumberId());
}

export function verifyMetaWebhook(mode, verifyToken, challenge) {
  if (mode === 'subscribe' && verifyToken && challenge && verifyToken === (process.env.WHATSAPP_VERIFY_TOKEN || '')) {
    return String(challenge);
  }
  return null;
}

export function verifyMetaSignature(rawBody, signature) {
  const secret = process.env.META_APP_SECRET || '';
  if (!secret || !Buffer.isBuffer(rawBody) || !signature?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const supplied = signature.slice(7);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function graphRequest(body) {
  if (!whatsappConfigured()) throw new Error('WhatsApp Cloud API is not configured');
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp API request failed (${response.status})`);
  return data;
}

export async function sendText(to, text) {
  return graphRequest({ messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'text', text: { preview_url: false, body: String(text) } });
}

export async function sendTemplate(to, templateName, language = 'en_US') {
  return graphRequest({ messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to), type: 'template', template: { name: String(templateName), language: { code: String(language || 'en_US') } } });
}
