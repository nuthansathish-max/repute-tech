import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const previousPost = express.application.post;
const previousGet = express.application.get;

function publicBaseUrl() {
  return String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_ORIGIN || 'https://repute-tech-in.onrender.com').replace(/\/$/, '');
}

async function repairExistingQrDestinations() {
  const base = publicBaseUrl();
  const rows = await prisma.smartQr.findMany({ select: { id: true, slug: true, destination: true } });
  for (const qr of rows) {
    const url = `${base}/public/qr/${encodeURIComponent(qr.slug)}`;
    const destination = qr.destination && typeof qr.destination === 'object' ? qr.destination : {};
    if (destination.url !== url) {
      await prisma.smartQr.update({ where: { id: qr.id }, data: { destination: { ...destination, url } } }).catch(() => {});
    }
  }
}

await repairExistingQrDestinations().catch(() => {});

// /q/:slug is reserved for QR scans. Always hand it to the dedicated public
// customer endpoint, bypassing any legacy authenticated dashboard handler.
if (!express.application.__qrPublicDestinationGetPatched) {
  express.application.__qrPublicDestinationGetPatched = true;
  express.application.get = function patchedQrPublicDestinationGet(path, ...handlers) {
    if (path === '/q/:slug') {
      return previousGet.call(this, path, (req, res) => {
        const slug = encodeURIComponent(String(req.params.slug || '').trim());
        if (!slug) return res.status(404).send('QR code not found');
        return res.redirect(302, `/public/qr/${slug}`);
      }, ...handlers);
    }
    return previousGet.call(this, path, ...handlers);
  };
}

if (!express.application.__qrPublicDestinationPostPatched) {
  express.application.__qrPublicDestinationPostPatched = true;
  express.application.post = function patchedQrPublicDestinationPost(path, ...handlers) {
    if (path === '/api/qr' && handlers.length) {
      return previousPost.call(this, path, async (req, res, next) => {
        try {
          const body = req.body || {};
          const slug = String(body.slug || '').trim();
          if (slug) {
            const destination = body.destination && typeof body.destination === 'object' ? body.destination : {};
            req.body = { ...body, destination: { ...destination, url: `${publicBaseUrl()}/public/qr/${encodeURIComponent(slug)}` } };
          }
          return handlers[0](req, res, next);
        } catch (error) { return next(error); }
      }, ...handlers.slice(1));
    }
    return previousPost.call(this, path, ...handlers);
  };
}
