import { syncLocationReviews, mockSyncLocationReviews } from './reviewPipeline.js';

export function startReviewSyncScheduler({ prisma }) {
  const parsedMinutes = Number(process.env.REVIEW_SYNC_INTERVAL_MINUTES || 30);
  const minutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0 ? Math.max(5, parsedMinutes) : 30;
  const intervalMs = minutes * 60 * 1000;
  let running = false;

  const run = async () => {
    // Prevent overlapping sync jobs when a previous run takes longer than the interval.
    if (running) return { skipped: true, reason: 'sync-already-running' };
    running = true;

    try {
      const locations = await prisma.location.findMany({
        where: { googleLocationId: { not: null }, googleAccountId: { not: null } },
        include: { business: true }
      });

      let imported = 0;
      let failed = 0;

      for (const location of locations) {
        try {
          const connection = await prisma.googleConnection.findFirst({
            where: { businessId: location.businessId },
            orderBy: { createdAt: 'desc' }
          }) || await prisma.googleConnection.findFirst({
            where: { user: { memberships: { some: { businessId: location.businessId } } } },
            orderBy: { createdAt: 'desc' }
          });

          if (!connection && process.env.MOCK_GOOGLE_REVIEWS !== 'true') continue;

          const result = process.env.MOCK_GOOGLE_REVIEWS === 'true'
            ? await mockSyncLocationReviews({ prisma, businessId: location.businessId, location })
            : await syncLocationReviews({ prisma, businessId: location.businessId, location, connection });

          const count = Number(result?.imported || 0);
          imported += count;

          if (count > 0) {
            const members = await prisma.businessMember.findMany({
              where: { businessId: location.businessId }
            });

            for (const m of members) {
              await prisma.notification.create({
                data: {
                  userId: m.userId,
                  businessId: location.businessId,
                  type: 'NEW_REVIEWS',
                  title: `${count} new review${count === 1 ? '' : 's'}`,
                  message: `${location.name} was synced successfully.`
                }
              });
            }
          }
        } catch (err) {
          failed += 1;
          await prisma.reviewSyncLog.create({
            data: {
              businessId: location.businessId,
              locationId: location.id,
              status: 'FAILED',
              error: String(err?.message || err)
            }
          }).catch(() => {});
        }
      }

      return { skipped: false, locations: locations.length, imported, failed };
    } finally {
      running = false;
    }
  };

  // Run once on startup so the dashboard does not wait for the first interval.
  run().catch(() => {});

  const timer = setInterval(() => {
    run().catch(() => {});
  }, intervalMs);
  timer.unref?.();

  return { runNow: run, intervalMinutes: minutes };
}
