import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import webpush from 'web-push';
import { normalizeAdminPushPayload } from '../admin-push.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const admin = read('../admin-management.js');

test('push payloads cannot navigate outside the Repute Tech origin', () => {
  const external = normalizeAdminPushPayload({
    title: 'External URL test',
    body: 'Safe fallback',
    url: 'https://attacker.example/phishing'
  });
  assert.equal(external.url, '/admin-panel');

  const internal = normalizeAdminPushPayload({
    title: 'Internal URL test',
    url: '/admin-panel?section=notifications'
  });
  assert.equal(internal.url, '/admin-panel?section=notifications');
});

test('push payload text is bounded before delivery', () => {
  const payload = normalizeAdminPushPayload({
    title: 'T'.repeat(150),
    body: 'B'.repeat(300)
  });
  assert.equal(payload.title.length, 100);
  assert.equal(payload.body.length, 220);
});

test('Web Push dependency accepts a generated VAPID key pair', () => {
  const keys = webpush.generateVAPIDKeys();
  assert.ok(keys.publicKey);
  assert.ok(keys.privateKey);
  assert.doesNotThrow(() => webpush.setVapidDetails(
    'mailto:root@reputetechs.in',
    keys.publicKey,
    keys.privateKey
  ));
});

test('all four alert summary cards remain present and clickable', () => {
  for (const type of ['ALL', 'HIGH', 'MEDIUM', 'SOURCES']) {
    assert.match(admin, new RegExp('data-alert-metric="' + type + '"'));
  }
  assert.match(admin, /closest\?\.\('\[data-alert-metric\]'\)/);
  assert.match(admin, /alertTotal/);
  assert.match(admin, /alertHigh/);
  assert.match(admin, /alertMedium/);
  assert.match(admin, /alertSources/);
});

test('alert status, severity, category, search and saved handling remain wired', () => {
  for (const status of ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL']) {
    assert.match(admin, new RegExp('value="' + status + '"'));
  }
  assert.match(admin, /id="alertsSearch"/);
  assert.match(admin, /id="alertsSeverity"/);
  assert.match(admin, /id="alertsCategory"/);
  assert.match(admin, /id="alertsStatus"/);
  assert.match(admin, /data-alert-assignee/);
  assert.match(admin, /data-alert-status/);
  assert.match(admin, /data-alert-notes/);
  assert.match(admin, /data-alert-save/);
  assert.match(admin, /api\('\/admin\/alert-actions'/);
  assert.match(admin, /data-alert-note/);
  assert.match(admin, /alertSourceDetails/);
});

test('device push settings and protected API routes are present', () => {
  for (const id of ['adminPushEnable', 'adminPushTest', 'adminPushDisable']) {
    assert.match(admin, new RegExp('id="' + id + '"'));
  }
  for (const route of [
    '/api/admin/push-config',
    '/api/admin/push-subscriptions',
    '/api/admin/push-unsubscribe',
    '/api/admin/push-test'
  ]) {
    assert.ok(admin.includes(route), 'missing route ' + route);
  }
  assert.match(admin, /serviceWorker\.register\('\/admin-push-sw\.js'/);
});

test('push event hooks cover business, order, subscription, payment, review, webhook and integration alerts', () => {
  const business = read('../business-account-flow.js');
  const orders = read('../customer-order-and-owner-management.js');
  const server = read('../server (1).js');
  const scheduler = read('../scheduler.js');
  for (const [source, marker] of [
    [business, 'NEW_BUSINESS:'],
    [orders, 'NEW_ORDER:'],
    [server, 'PLAN_REQUEST_SUBMITTED:'],
    [server, 'PLAN_REQUEST_APPROVED:'],
    [server, 'PLAN_REQUEST_PUBLISHED:'],
    [server, 'WHATSAPP_CONNECTION_UPDATED:'],
    [server, 'GOOGLE_REVIEWS_SYNCED:'],
    [scheduler, 'NEW_REVIEWS_SYNCED:'],
    [scheduler, 'REVIEW_SYNC_FAILED:'],
    [scheduler, 'TRIAL_ENDING_24H:'],
    [admin, 'WEBHOOK_FAILED:'],
    [admin, 'PLAN_PAYMENT_STATUS:'],
    [admin, 'BUSINESS_CLOSED:'],
    [admin, 'BUSINESS_FEATURE_DISABLED:']
  ]) {
    assert.ok(source.includes(marker), 'missing event hook ' + marker);
  }
});
