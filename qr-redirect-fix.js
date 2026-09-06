import express from 'express';
import { PrismaClient } from '@prisma/client';

// Final public QR guard: a QR slug must never expose the authenticated business dashboard.
// QR scanners should always land on the customer hub, regardless of the stored destination URL.
const prisma = new PrismaClient();
const previousGet = express.application.get;

if (!express.application.__qrRedirectGuardPatched) {
  express.application.__qrRedirectGuardPatched = true;
  express.application.get = function qrRedirectGuardGet(path, ...handlers) {
    if (path === '/q/:slug') {
      const guarded = async (req, res, next) => {
        try {
          const slug = String(req.params.slug || '').trim();
          if (!slug) return res.status(404).send('QR code not found');
          const qr = await prisma.smartQr.findFirst({ where: { slug }, select: { id: true, isActive: true } });
          if (!qr || qr.isActive === false) return res.status(404).send('QR code not found');
          // Public customer-hub route is registered by public-qr.js. Calling next() here
          // prevents any older dashboard/destination handler from winning for /q/:slug.
          return next();
        } catch (e) {
          return next(e);
        }
      };
      return previousGet.call(this, path, guarded, ...handlers);
    }
    return previousGet.call(this, path, ...handlers);
  };
}
