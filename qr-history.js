import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

// The QR list endpoint is intentionally kept here as a compatibility override.
// Every displayed/downloaded QR must encode the public customer hub URL.
const prisma = new PrismaClient();
const previousGet = express.application.get;

async function sessionUser(req) {
  const token = getCookie(req, 'rp_session');
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true }
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

express.application.get = function qrHistoryGet(path, ...handlers) {
  if (path !== '/api/businesses/:businessId/qr' || handlers.length === 0) {
    return previousGet.call(this, path, ...handlers);
  }

  return previousGet.call(this, path, async (req, res, next) => {
    try {
      const user = await sessionUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });

      const businessId = String(req.params.businessId);
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role);
      const business = await prisma.business.findFirst({
        where: {
          id: businessId,
          ...(isAdmin ? {} : { members: { some: { userId: user.id } } })
        }
      });
      if (!business) return res.status(403).json({ error: 'Business access denied' });

      const rows = await prisma.smartQr.findMany({
        where: { businessId },
        orderBy: { id: 'desc' }
      });

      const result = rows.map(qr => {
        // Never trust the stored destination here. Older QR records may contain
        // an authenticated dashboard URL. The QR shown to the owner must always
        // encode the public customer hub.
        const destinationUrl = `${req.protocol}://${req.get('host')}/q/${encodeURIComponent(qr.slug)}`;
        return {
          ...qr,
          destination: { ...(qr.destination || {}), url: destinationUrl },
          qrUrl: destinationUrl,
          qrImageUrl: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(destinationUrl)}`
        };
      });

      return res.json(result);
    } catch (error) {
      return next(error);
    }
  });
};
