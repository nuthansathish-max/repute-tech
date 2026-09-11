// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
import express from 'express';
import http from 'node:http';
express.application.listen=function(...args){const server=http.createServer(this);return server.listen(...args)};
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
await import('./server (1).js');
