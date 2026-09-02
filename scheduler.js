import { syncLocationReviews, mockSyncLocationReviews } from './reviewPipeline.js';

export function startReviewSyncScheduler({ prisma }) {
  const minutes = Number(process.env.REVIEW_SYNC_INTERVAL_MINUTES || 30);
  const intervalMs = Math.max(5, minutes) * 60 * 1000;
  const run = async () => {
    const locations = await prisma.location.findMany({ where: { googleLocationId: { not: null }, googleAccountId: { not: null } }, include: { business: true } });
    for (const location of locations) {
      try {
        const connection = await prisma.googleConnection.findFirst({ where: { businessId: location.businessId }, orderBy: { createdAt: 'desc' } }) || await prisma.googleConnection.findFirst({ where: { user: { memberships: { some: { businessId: location.businessId } } } }, orderBy: { createdAt: 'desc' } });
        if (!connection && process.env.MOCK_GOOGLE_REVIEWS !== 'true') continue;
        const result = process.env.MOCK_GOOGLE_REVIEWS === 'true' ? await mockSyncLocationReviews({ prisma, businessId: location.businessId, location }) : await syncLocationReviews({ prisma, businessId: location.businessId, location, connection });
        const members = await prisma.businessMember.findMany({ where: { businessId: location.businessId } });
        for (const m of members) {
          if (result.imported > 0) await prisma.notification.create({ data: { userId: m.userId, businessId: location.businessId, type: 'NEW_REVIEWS', title: `${result.imported} new review${result.imported === 1 ? '' : 's'}`, message: `${location.name} was synced successfully.` } });
        }
      } catch (err) {
        await prisma.reviewSyncLog.create({ data: { businessId: location.businessId, locationId: location.id, status: 'FAILED', error: String(err.message || err) } }).catch(() => {});
      }
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { runNow: run, intervalMinutes: minutes };
}
