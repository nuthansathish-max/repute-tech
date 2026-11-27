import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_PERMISSION_KEYS,
  resolveAdminAccess,
  hasAdminPermission,
  createAdminInvitationToken
} from '../admin-access.js';

test('inactive or unsupported Admin access records are rejected', () => {
  assert.equal(resolveAdminAccess(null), null);
  assert.equal(resolveAdminAccess({ id: 'a', userId: 'u', role: 'ADMIN', isActive: false }), null);
  assert.equal(resolveAdminAccess({ id: 'a', userId: 'u', role: 'OWNER', isActive: true }), null);
});

test('new Admin access has no permissions unless explicitly granted', () => {
  const access = resolveAdminAccess({ id: 'a', userId: 'u', role: 'ADMIN', isActive: true });
  assert.deepEqual(access.permissions, []);
  assert.equal(hasAdminPermission(access, 'PAYMENTS_VIEW'), false);
});

test('Admin permissions are restricted to the supported permission keys', () => {
  const access = resolveAdminAccess(
    { id: 'a', userId: 'u', role: 'ADMIN', isActive: true },
    ['PAYMENTS_VIEW', 'NOT_A_PERMISSION', 'PAYMENTS_REFUND', 'PAYMENTS_VIEW']
  );
  assert.deepEqual(access.permissions.sort(), ['PAYMENTS_REFUND', 'PAYMENTS_VIEW']);
  assert.equal(hasAdminPermission(access, 'PAYMENTS_REFUND'), true);
  assert.equal(hasAdminPermission(access, 'PAYMENTS_APPROVE'), false);
});

test('Super Admin receives the complete permission set', () => {
  const access = resolveAdminAccess({ id: 's', userId: 'u', role: 'SUPER_ADMIN', isActive: true });
  assert.deepEqual([...access.permissions].sort(), [...ADMIN_PERMISSION_KEYS].sort());
  for (const permission of ADMIN_PERMISSION_KEYS) assert.equal(hasAdminPermission(access, permission), true);
});

test('invitation token generator returns a 256-bit token and stores only its digest', () => {
  const result = createAdminInvitationToken(value => 'digest:' + value);
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.equal(result.tokenDigest, 'digest:' + result.token);
});
