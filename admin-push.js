import webpush from 'web-push';
import crypto from 'node:crypto';

const tablePromises = new WeakMap();
const activeDispatchers = new WeakSet();

export function adminPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function adminPushPublicKey() {
  return adminPushConfigured() ? process.env.VAPID_PUBLIC_KEY : '';
}

export async function ensureAdminPushTables(prisma) {
  let pending = tablePromises.get(prisma);
  if (!pending) {
    pending = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminPushSubscription" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "endpoint" TEXT NOT NULL UNIQUE,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "expirationTime" BIGINT,
        "userAgent" TEXT,
        "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminPushSubscription_user_enabled_idx" ON "AdminPushSubscription" ("userId","enabled")');
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminPushDelivery" (
        "id" TEXT PRIMARY KEY,
        "eventKey" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "endpoint" TEXT NOT NULL,
        "p256dh" TEXT NOT NULL,
        "auth" TEXT NOT NULL,
        "payload" JSONB NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastError" TEXT,
        "acceptedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("eventKey","endpoint")
      )`);
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminPushDelivery_retry_idx" ON "AdminPushDelivery" ("status","nextAttemptAt")');
    })().catch(error => {
      tablePromises.delete(prisma);
      throw error;
    });
    tablePromises.set(prisma, pending);
  }
  return pending;
}

export function normalizeAdminPushPayload(event) {
  const rawUrl = String(event.url || '/admin-panel');
  let url = '/admin-panel';
  try {
    const parsed = new URL(rawUrl, 'https://reputetechs.in');
    if (parsed.origin === 'https://reputetechs.in') url = parsed.pathname + parsed.search;
  } catch {}
  return {
    title: String(event.title || 'Repute Tech alert').slice(0, 100),
    body: String(event.body || 'An important platform update needs your attention.').slice(0, 220),
    category: String(event.category || 'PLATFORM').slice(0, 40),
    tag: String(event.eventKey || 'repute-tech-alert').slice(0, 180),
    url
  };
}

export async function dispatchAdminPushQueue(prisma, limit = 12) {
  if (!adminPushConfigured()) return { processed: 0, configured: false };
  if (activeDispatchers.has(prisma)) return { processed: 0, busy: true, configured: true };
  activeDispatchers.add(prisma);
  try {
  await ensureAdminPushTables(prisma);
  await prisma.$executeRawUnsafe(
    `UPDATE "AdminPushDelivery" SET "status"='PENDING',"updatedAt"=CURRENT_TIMESTAMP
      WHERE "status"='SENDING' AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`
  );
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:root@reputetechs.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  const rows = await prisma.$queryRawUnsafe(
    `WITH due AS (
       SELECT "id" FROM "AdminPushDelivery"
        WHERE "status" IN ('PENDING','FAILED') AND "nextAttemptAt" <= CURRENT_TIMESTAMP
        ORDER BY "createdAt" ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE "AdminPushDelivery" AS delivery
        SET "status"='SENDING',"updatedAt"=CURRENT_TIMESTAMP
       FROM due
      WHERE delivery."id"=due."id"
      RETURNING delivery."id",delivery."userId",delivery."endpoint",delivery."p256dh",delivery."auth",delivery."payload",delivery."attempts"`,
    Math.max(1, Math.min(30, Number(limit) || 12))
  );
  let processed = 0;
  for (const row of rows) {
    const attempts = Number(row.attempts || 0) + 1;
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(row.payload),
        { TTL: 120, urgency: 'high' }
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "AdminPushDelivery"
            SET "status"='ACCEPTED',"attempts"=$1,"lastError"=NULL,
                "acceptedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$2`,
        attempts, row.id
      );
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      const expired = statusCode === 404 || statusCode === 410;
      const terminal = expired || attempts >= 8;
      const delaySeconds = Math.min(3600, 15 * (2 ** Math.min(attempts - 1, 8)));
      await prisma.$executeRawUnsafe(
        `UPDATE "AdminPushDelivery"
            SET "status"=$1,"attempts"=$2,"lastError"=$3,
                "nextAttemptAt"=CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
                "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$5`,
        expired ? 'EXPIRED' : (terminal ? 'GAVE_UP' : 'FAILED'),
        attempts,
        String(error?.message || error).slice(0, 500),
        delaySeconds,
        row.id
      );
      if (expired) {
        await prisma.$executeRawUnsafe('DELETE FROM "AdminPushSubscription" WHERE "endpoint"=$1', row.endpoint);
      }
    }
    processed += 1;
  }
  return { processed, configured: true };
  } finally {
    activeDispatchers.delete(prisma);
  }
}

export async function queueAdminPushEvent(prisma, event, options = {}) {
  if (!adminPushConfigured()) return { queued: 0, skipped: 'Push server keys are not configured.' };
  await ensureAdminPushTables(prisma);
  const eventKey = String(event.eventKey || crypto.randomUUID()).slice(0, 240);
  const payload = normalizeAdminPushPayload({ ...event, eventKey });
  const userId = options.userId ? String(options.userId) : null;
  const subscriptions = await prisma.$queryRawUnsafe(
    `SELECT subscription."userId",subscription."endpoint",subscription."p256dh",subscription."auth"
       FROM "AdminPushSubscription" AS subscription
       JOIN "User" AS account ON account."id"=subscription."userId"
      WHERE subscription."enabled"=TRUE
        AND account."role"::text IN ('ADMIN','SUPER_ADMIN')
        AND ($1::text IS NULL OR subscription."userId"=$1)`,
    userId
  );
  for (const sub of subscriptions) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AdminPushDelivery"
        ("id","eventKey","userId","endpoint","p256dh","auth","payload")
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT ("eventKey","endpoint") DO NOTHING`,
      crypto.randomUUID(), eventKey, sub.userId, sub.endpoint, sub.p256dh, sub.auth, JSON.stringify(payload)
    );
  }
  const queued = subscriptions.length;
  if (queued) dispatchAdminPushQueue(prisma, Math.min(queued, 12)).catch(error => {
    console.error('Admin push immediate dispatch failed:', error?.message || error);
  });
  return { queued, eventKey };
}
