import { PrismaClient } from '@prisma/client';
import { ensureAdminAccessTables } from '../admin-access.js';

const prisma = new PrismaClient();

async function main() {
  if (process.env.ADMIN_SUPER_ADMIN_BOOTSTRAP_CONFIRM !== 'YES') {
    throw new Error('Set ADMIN_SUPER_ADMIN_BOOTSTRAP_CONFIRM=YES to confirm this one-time operation.');
  }
  const emails = [...new Set(String(process.env.ADMIN_SUPER_ADMIN_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
  if (emails.length !== 2 || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('ADMIN_SUPER_ADMIN_EMAILS must contain exactly two valid, comma-separated account emails.');
  }

  await ensureAdminAccessTables(prisma);
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
  const found = new Set(users.map(user => user.email.toLowerCase()));
  const missing = emails.filter(email => !found.has(email));
  if (missing.length) {
    throw new Error('Bootstrap stopped: one or more specified accounts do not exist. No accounts were changed.');
  }

  await prisma.$transaction(async tx => {
    for (const user of users) {
      const rows = await tx.$queryRawUnsafe(
        'INSERT INTO "AdminAccess" ("id","userId","role","isActive","grantedByUserId") VALUES ($1,$2,\'SUPER_ADMIN\',TRUE,NULL) ON CONFLICT ("userId") DO UPDATE SET "role"=\'SUPER_ADMIN\',"isActive"=TRUE,"updatedAt"=CURRENT_TIMESTAMP RETURNING "id"',
        cryptoId(), user.id
      );
      const accessId = rows[0].id;
      await tx.$executeRawUnsafe('DELETE FROM "AdminPermission" WHERE "adminAccessId"=$1', accessId);
      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: 'ADMIN_SUPER_ADMIN_BOOTSTRAPPED',
          entity: 'AdminAccess',
          entityId: accessId,
          metadata: { accountEmail: user.email, method: 'explicit_environment_bootstrap' }
        }
      });
    }
  });
  process.stdout.write('Admin Super Admin bootstrap completed for the two configured accounts. Existing User roles, passwords, and business memberships were preserved.\n');
}

function cryptoId() {
  return requireUuid();
}
function requireUuid() {
  return globalThis.crypto.randomUUID();
}

main().catch(error => {
  process.stderr.write('Admin Super Admin bootstrap failed: ' + String(error?.message || error) + '\n');
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
