import express from 'express';
import { PrismaClient } from '@prisma/client';
import { aiReviewAnalysis } from './aiProvider.js';

// Compatibility layer for the current frontend and the canonical API in server (1).js.
// It is loaded before bootstrap/server so these aliases are attached to the same Express app.
const originalPost = express.application.post;
const prisma = new PrismaClient();

function allowedBusiness(req, businessId) {
  return prisma.business.findFirst({
    where: {
      id: businessId,
      ...(req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'ADMIN'
        ? {}
        : { members: { some: { userId: req.user?.id } } })
    }
  });
}

express.application.post = function patchedPost(path, ...handlers) {
  const result = originalPost.call(this, path, ...handlers);

  // Legacy frontend route -> canonical POST /api/qr.
  if (path === '/api/qr') {
    const authHandler = handlers[0];
    const routeHandlers = handlers.slice(1);
    originalPost.call(
      this,
      '/api/businesses/:businessId/qr',
      authHandler,
      async (req, res, next) => {
        try {
          const business = await allowedBusiness(req, req.params.businessId);
          if (!business) return res.status(404).json({ error: 'Business not found' });
          const name = String(req.body?.name || '').trim();
          const slug = String(req.body?.slug || '').trim().toLowerCase();
          if (!name || !slug) return res.status(400).json({ error: 'QR name and slug are required' });
          req.body = {
            businessId: req.params.businessId,
            name,
            slug,
            destination: {
              type: 'CUSTOMER_HUB',
              url: `${req.protocol}://${req.get('host')}/public/qr/${encodeURIComponent(slug)}`
            }
          };
          return next();
        } catch (e) { return next(e); }
      },
      ...routeHandlers
    );
  }

  // Legacy standalone AI assistant route. It generates a reply without creating a fake review record.
  if (path === '/api/reviews/:id/ai-reply') {
    const authHandler = handlers[0];
    originalPost.call(this, '/api/reviews/ai-reply', authHandler, async (req, res, next) => {
      try {
        const text = String(req.body?.text || '').trim();
        if (!text) return res.status(400).json({ error: 'Review text is required' });
        const requestedBusinessId = String(req.body?.businessId || '').trim();
        let business = requestedBusinessId ? await allowedBusiness(req, requestedBusinessId) : null;
        if (!business) {
          business = await prisma.business.findFirst({
            where: req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'ADMIN'
              ? {}
              : { members: { some: { userId: req.user?.id } } },
            orderBy: { createdAt: 'asc' }
          });
        }
        if (!business) return res.status(404).json({ error: 'Business not found' });

        const rating = Math.min(5, Math.max(1, Number(req.body?.rating || 3)));
        const review = {
          id: `assistant-${Date.now()}`,
          businessId: business.id,
          authorName: String(req.body?.authorName || 'Customer'),
          rating: Number.isInteger(rating) ? rating : 3,
          text
        };
        const result = await aiReviewAnalysis(review, business.name, String(req.body?.tone || 'WARM'));
        return res.json({ reply: result.reply, analysis: result, provider: result.provider });
      } catch (e) { return next(e); }
    });
  }

  return result;
};

// The compatibility layer itself does not listen on a port.
