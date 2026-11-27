import crypto from 'node:crypto';

export const ADMIN_PERMISSION_KEYS = Object.freeze([
  'PAYMENTS_VIEW',
  'PAYMENTS_CONFIGURE_UPI',
  'PAYMENTS_CONFIGURE_GATEWAY',
  'PAYMENTS_VERIFY',
  'PAYMENTS_APPROVE',
  'PAYMENTS_REFUND',
  'SUBSCRIPTIONS_ACTIVATE',
  'PAYMENTS_EXPORT',
  'PAYMENT_PERMISSIONS_MANAGE'
]);

const SUPER_ADMIN_PERMISSIONS = new Set(ADMIN_PERMISSION_KEYS);

let tableSetupPromise = null;

/**
 * Additive, idempotent setup for the separate Admin access store.
 * This deliberately does not modify User.role or BusinessMember records.
 */
export async function ensureAdminAccessTables(prisma) {
  if (!tableSetupPromise) {
    tableSetupPromise = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminAccess" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
        "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN','SUPER_ADMIN')),
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "grantedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminPermission" (
        "id" TEXT PRIMARY KEY,
        "adminAccessId" TEXT NOT NULL REFERENCES "AdminAccess"("id") ON DELETE CASCADE,
        "permission" TEXT NOT NULL,
        "grantedByUserId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("adminAccessId","permission")
      )`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminInvitation" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','ACCEPTED','EXPIRED','REVOKED')),
        "invitedByUserId" TEXT NOT NULL,
        "acceptedUserId" TEXT,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "acceptedAt" TIMESTAMP(3),
        "revokedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminPermission_access_idx" ON "AdminPermission" ("adminAccessId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminInvitation_email_status_idx" ON "AdminInvitation" (LOWER("email"),"status")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminInvitation_expiry_idx" ON "AdminInvitation" ("status","expiresAt")');
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "AdminInvitation_one_pending_per_email"
        ON "AdminInvitation" (LOWER("email")) WHERE "status"='PENDING'`);
      return true;
    })().catch(error => {
      tableSetupPromise = null;
      throw error;
    });
  }
  return tableSetupPromise;
}

/** Resolve an access row into a safe, normalized permission snapshot. */
export function resolveAdminAccess(record, permissions = []) {
  if (!record || record.isActive !== true) return null;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(record.role)) return null;
  const granted = record.role === 'SUPER_ADMIN'
    ? [...SUPER_ADMIN_PERMISSIONS]
    : [...new Set(permissions.filter(value => ADMIN_PERMISSION_KEYS.includes(value)))];
  return Object.freeze({
    id: record.id,
    userId: record.userId,
    role: record.role,
    permissions: Object.freeze(granted)
  });
}

export function hasAdminPermission(access, permission) {
  if (!access || !ADMIN_PERMISSION_KEYS.includes(permission)) return false;
  return access.role === 'SUPER_ADMIN' || access.permissions.includes(permission);
}

/** Read the separate Admin grant; legacy User.role is intentionally ignored. */
export async function getAdminAccessForUser(prisma, userId) {
  await ensureAdminAccessTables(prisma);
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "id","userId","role","isActive" FROM "AdminAccess" WHERE "userId"=$1 LIMIT 1',
    userId
  );
  const record = rows?.[0];
  if (!record || record.isActive !== true) return null;
  if (record.role === 'SUPER_ADMIN') return resolveAdminAccess(record);
  const grants = await prisma.$queryRawUnsafe(
    'SELECT "permission" FROM "AdminPermission" WHERE "adminAccessId"=$1',
    record.id
  );
  return resolveAdminAccess(record, (grants || []).map(row => row.permission));
}

/** Generate a cryptographically random invitation token; persist only this HMAC digest. */
export function createAdminInvitationToken(tokenHash) {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenDigest: tokenHash(token) };
}
