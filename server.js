// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
//
// Install a native listener before loading compatibility modules so their
// route installers can safely chain onto it.
import express from 'express';
import http from 'node:http';

express.application.listen = function(...args){
  const server = http.createServer(this);
  return server.listen(...args);
};

// Register authoritative routes through Express method hooks. These routes
// attach to the canonical app as soon as it starts registering its routes,
// rather than depending on fragile listen() ordering.
await import('./authoritative-business-status.js');
await import('./authoritative-public-order.js');

// Register QR history, public customer-hub routing, menu-link normalization,
// business open/closed compatibility, owner management, and customer helpers.
// Do not load qr-public-destination.js: /q/:slug is owned by public-qr.js.
await import('./qr-history.js');
await import('./public-menu-links.js');
await import('./public-google-review-link.js');
await import('./public-qr.js');
await import('./business-status.js');
await import('./menu-order-route.js');
await import('./customer-order-and-owner-management.js');

// IMPORTANT: do not load public-all-order-route.js here. It registers a legacy
// customer order page which can override the authoritative all-menus page.
// The authoritative-public-order.js module above owns /q/:slug/order and
// /api/public/orders.

// Some legacy compatibility modules wrap listen with async installers.
// Adapt their Promise result back to the synchronous HTTP-server interface.
await import('./listen-compat.js');

// Keep the legacy route compatibility layer loaded, but the authoritative
// all-menus route above is registered before it and therefore wins.
await import('./final-order-route.js');

// Register only the business-owner Orders API here. The public customer-order
// routes remain owned by authoritative-public-order.js above.
await import('./owner-orders-route-fix.js');

await import('./server (1).js');