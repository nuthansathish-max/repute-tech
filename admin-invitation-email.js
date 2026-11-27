const RESEND_API_URL = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function requiredEnv(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Email configuration missing: ${key}`);
  }
  return value.trim();
}

/**
 * Send one Admin invitation through Resend.
 * Credentials and sender identity are supplied only through environment variables.
 * This function never logs the invitation URL, token, recipient, or API key.
 */
export async function sendAdminInvitationEmail(
  { to, name, inviteUrl, expiresAt },
  { env = process.env, fetchImpl = globalThis.fetch } = {}
) {
  const apiKey = requiredEnv(env, 'RESEND_API_KEY');
  const from = requiredEnv(env, 'RESEND_FROM');
  const replyTo = requiredEnv(env, 'RESEND_REPLY_TO');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    throw new Error('A valid reply-to email address is required');
  }

  if (typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error('A valid invitation recipient email is required');
  }
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('An invitation recipient name is required');
  }
  let parsedInviteUrl;
  try {
    parsedInviteUrl = new URL(inviteUrl);
  } catch {
    throw new Error('A valid invitation URL is required');
  }
  if (parsedInviteUrl.protocol !== 'https:') {
    throw new Error('Invitation links must use HTTPS');
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('A valid invitation expiry date is required');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Email transport is unavailable');
  }

  const safeName = escapeHtml(name.trim());
  const safeUrl = escapeHtml(parsedInviteUrl.toString());
  const expiryText = expiresAt.toUTCString();
  const response = await fetchImpl(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      reply_to: replyTo,
      to: [to.trim()],
      subject: 'Your Repute Tech Admin invitation',
      text: `Hello ${name.trim()},\n\nYou have been invited to access the Repute Tech Admin dashboard. Accept your invitation using this secure link:\n${parsedInviteUrl.toString()}\n\nThis link expires on ${expiryText}. If you were not expecting this invitation, you can ignore this email.`,
      html: `<p>Hello ${safeName},</p><p>You have been invited to access the Repute Tech Admin dashboard.</p><p><a href="${safeUrl}">Accept your Admin invitation</a></p><p>This link expires on ${escapeHtml(expiryText)}. If you were not expecting this invitation, you can ignore this email.</p>`
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = typeof payload.message === 'string'
      ? payload.message.slice(0, 300)
      : 'Resend rejected the email request';
    throw new Error(`Admin invitation email failed: ${providerMessage}`);
  }
  if (!payload || typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Resend returned no email ID');
  }
  return { id: payload.id };
}
