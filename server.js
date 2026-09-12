// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
import express from 'express';
import http from 'node:http';
express.application.listen=function(...args){const server=http.createServer(this);return server.listen(...args)};
await import('./order-hardening.js');
await import('./advanced-analytics.js');
await import('./authoritative-business-status.js');
await import('./authoritative-public-order.js');
await import('./business-account-flow.js');
await import('./onboarding-guard.js');
await import('./qr-history.js');
await import('./public-menu-links.js');
await import('./public-google-review-link.js');
await import('./public-qr.js');
await import('./business-status.js');
await import('./menu-order-route.js');
await import('./customer-order-and-owner-management.js');
await import('./listen-compat.js');
await import('./final-order-route.js');
await import('./owner-orders-route-fix.js');

// Narrow navigation fix: make the existing Analytics sidebar item open the new
// Advanced Analytics page. No QR, Reviews, Orders, or dashboard logic is changed.
const analyticsNavOriginalGet=express.application.get;
express.application.get=function(path,...handlers){
  if(path==='/' && handlers.length){
    handlers=handlers.map(handler=>async(req,res,next)=>{
      const send=res.send.bind(res);
      res.send=function(body){
        if(typeof body==='string' && body.includes('data-page="analytics"') && !body.includes('reputeAnalyticsNavFix')){
          body=body.replace('</body>',`<script id="reputeAnalyticsNavFix">document.addEventListener('click',function(e){const el=e.target.closest('[data-page="analytics"]');if(!el)return;e.preventDefault();e.stopImmediatePropagation();location.href='/analytics'});</script></body>`);
        }
        return send(body);
      };
      return handler(req,res,next);
    });
  }
  return analyticsNavOriginalGet.call(this,path,...handlers);
};

await import('./server (1).js');
