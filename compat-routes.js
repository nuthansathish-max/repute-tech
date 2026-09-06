import express from 'express';
import { aiReviewAnalysis } from './aiProvider.js';

// Compatibility layer for the current frontend and the canonical API in server (1).js.
// It is loaded before bootstrap/server so these aliases are attached to the same Express app.
const originalPost = express.application.post;

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
      (req, _res, next) => {
        const name = String(req.body?.name || '').trim();
        const slug = String(req.body?.slug || '').trim().toLowerCase();
        if (!name || !slug) return next(Object.assign(new Error('QR name and slug are required'), { status: 400 }));
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
        const businessName = String(req.body?.businessName || 'your business').trim() || 'your business';
        const rating = Math.min(5, Math.max(1, Number(req.body?.rating || 3)));
        const review = {
          id: `assistant-${Date.now()}`,
          businessId: String(req.body?.businessId || 'assistant'),
          authorName: String(req.body?.authorName || 'Customer'),
          rating: Number.isInteger(rating) ? rating : 3,
          text
        };
        const result = await aiReviewAnalysis(review, businessName, String(req.body?.tone || 'WARM'));
        return res.json({ reply: result.reply, analysis: result, provider: result.provider });
      } catch (e) { return next(e); }
    });
  }

  return result;
};

// The compatibility layer itself does not listen on a port.
