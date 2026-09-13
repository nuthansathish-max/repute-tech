import express from 'express';
import { PrismaClient } from '@prisma/client';
import { sendText, whatsappConfigured } from './whatsapp.js';

const prisma = new PrismaClient();
const originalRoute = express.application.route;
let installed = false;

function wrapOrderResponse(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = payload => {
    if (res.statusCode >= 200 && res.statusCode < 300 && payload?.order?.orderNumber) {
      const phone = String(req.body?.customerPhone || '').trim();
      const name = String(req.body?.customerName || '').trim() || 'Customer';
      const order = payload.order;

      if (req.body?.whatsappMarketingConsent === true && order.customerId) {
        prisma.consent.upsert({
          where: { customerId_type: { customerId: order.customerId, type: 'WHATSAPP_MARKETING' } },
          update: { granted: true, grantedAt: new Date(), revokedAt: null },
          create: { customerId: order.customerId, type: 'WHATSAPP_MARKETING', granted: true, grantedAt: new Date() }
        }).catch(() => {});
      }

      if (phone && whatsappConfigured()) {
        const message = `Hi ${name}, your order ${order.orderNumber} has been received. Total: ₹${Number(order.total || 0).toFixed(2)}. Thank you!`;
        sendText(phone, message).catch(() => {});
      }
    }
    return originalJson(payload);
  };
  next();
}

function install() {
  if (installed) return;
  installed = true;

  express.application.route = function(path) {
    const route = originalRoute.call(this, path);

    if (path === '/api/public/orders') {
      const originalPost = route.post.bind(route);
      route.post = function(...handlers) {
        if (handlers.length > 1) {
          return originalPost(handlers[0], wrapOrderResponse, ...handlers.slice(1));
        }
        return originalPost(...handlers);
      };
    }

    if (path === '/q/:slug/order') {
      const originalRouteGet = route.get.bind(route);
      route.get = function(...handlers) {
        const patched = handlers.map(handler => async (req, res, next) => {
          const send = res.send.bind(res);
          res.send = body => {
            if (typeof body === 'string' && body.includes('id="phone"') && !body.includes('whatsappMarketingConsent')) {
              const checkbox = `<label style="display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:13px;color:#374151;line-height:1.4"><input id="whatsappMarketingConsent" type="checkbox" style="margin-top:3px;width:16px;height:16px"><span>I agree to receive WhatsApp notifications about my order and offers from this business.</span></label>`;
              body = body.replace('<button id="submit" class="submit" type="button">Place order</button>', checkbox + '<button id="submit" class="submit" type="button">Place order</button>');
              body = body.replace("notes:$('notes').value.trim(),items", "notes:$('notes').value.trim(),whatsappMarketingConsent:$('whatsappMarketingConsent')?.checked===true,items");
            }
            return send(body);
          };
          return handler(req, res, next);
        });
        return originalRouteGet(...patched);
      };
    }

    return route;
  };
}

install();
