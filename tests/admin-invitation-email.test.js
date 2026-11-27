import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAdminInvitationEmail } from '../admin-invitation-email.js';

const base = {
  to: 'new-admin@example.com',
  name: 'New Admin',
  inviteUrl: 'https://reputetechs.in/admin-invite/opaque-token',
  expiresAt: new Date('2026-11-28T10:00:00Z')
};
const env = { RESEND_API_KEY: 're_test_secret', RESEND_FROM: 'Repute Tech <admin@reputetechs.in>' };

test('sends an invitation using configured Resend credentials and sender', async () => {
  let request;
  const result = await sendAdminInvitationEmail(base, {
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: 'email_test_123' }) };
    }
  });
  assert.deepEqual(result, { id: 'email_test_123' });
  assert.equal(request.url, 'https://api.resend.com/emails');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test_secret');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, [base.to]);
  assert.equal(body.from, env.RESEND_FROM);
  assert.match(body.text, /https:\/\/reputetechs\.in\/admin-invite\/opaque-token/);
});

test('requires API key and verified sender configuration', async () => {
  await assert.rejects(
    sendAdminInvitationEmail(base, { env: { RESEND_FROM: env.RESEND_FROM }, fetchImpl: async () => ({}) }),
    /RESEND_API_KEY/
  );
  await assert.rejects(
    sendAdminInvitationEmail(base, { env: { RESEND_API_KEY: env.RESEND_API_KEY }, fetchImpl: async () => ({}) }),
    /RESEND_FROM/
  );
});

test('rejects non-HTTPS invitation links', async () => {
  await assert.rejects(
    sendAdminInvitationEmail({ ...base, inviteUrl: 'http://reputetechs.in/invite' }, { env, fetchImpl: async () => ({}) }),
    /HTTPS/
  );
});

test('escapes recipient-controlled HTML and reports provider failures safely', async () => {
  let sentBody;
  await sendAdminInvitationEmail({ ...base, name: '<Admin>' }, {
    env,
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: 'email_test_456' }) };
    }
  });
  assert.match(sentBody.html, /&lt;Admin&gt;/);

  await assert.rejects(
    sendAdminInvitationEmail(base, {
      env,
      fetchImpl: async () => ({ ok: false, json: async () => ({ message: 'domain not verified' }) })
    }),
    /domain not verified/
  );
});
