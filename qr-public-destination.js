import express from 'express';
import { PrismaClient } from '@prisma/client';

// QR codes must always point to the public customer hub, never to the
// authenticated business dashboard. This compatibility layer also repairs
// older QR records that were created with a dashboard destination.
const prisma = new PrismaClient();
const previousPost = express.application.post;

function publicBaseUrl() {
  return String(
    process.env.PUBLIC_APP_URL ||
    process.env.FRONTEND_ORIGIN ||
    'https://repute-tech-in.onrender.com'
  ).replace(/\/$/, '');
}

async function repairExistingQrDestinations() {
  const base = publicBaseUrl();
  const rows = await prisma.smartQr.findMany({
    select: { id: true, slug: true, destination: true }
  });

  for (const qr of rows) {
    const url = `${base}/q/${encodeURIComponent(qr.slug)}`;
    const destination = (qr.destination && typeof qr.destination === 'object') ? qr.destination : {};
    if (destination.url !== url) {
      await prisma.smartQr.update({
        where: { id: qr.id },
        data: { destination: { ...destination, url } }
      }).catch(() => {});
    }
  }
}

// Repair old records once when the server starts.
await repairExistingQrDestinations().catch(() => {});

if (!express.application.__qrPublicDestinationPostPatched) {
  express.application.__qrPublicDestinationPostPatched = true;

  express.application.post = function patchedQrPublicDestinationPost(path, ...handlers) {
    if (path === '/api/qr' && handlers.length) {
      return previousPost.call(this, path, async (req, res, next) => {
        try {
          const body = req.body || {};
          const slug = String(body.slug || '').trim();
          if (slug) {
            const destination = (body.destination && typeof body.destination === 'object') ? body.destination : {};
            req.body = {
              ...body,
              destination: {
                ...destination,
                url: `${publicBaseUrl()}/q/${encodeURIComponent(slug)}`
              }
            };
          }
          return handlers[0](req, res, next);
        } catch (error) {
          return next(error);
        }
      }, ...handlers.slice(1));
    }
    return previousPost.call(this, path, ...handlers);
  };
}
