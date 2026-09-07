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

// Register QR history, public customer-hub routing, menu-link normalization,
// business open/closed status, owner management, unified customer ordering,
// and the customer order helpers before the canonical server.
//
// Do not load qr-public-destination.js: that legacy compatibility layer
// intercepts /q/:slug and redirects it to /public/qr/:slug. /q/:slug is owned
// by public-qr.js.
await import('./qr-history.js');
await import('./public-menu-links.js');
await import('./public-qr.js');
await import('./business-status.js');
await import('./menu-order-route.js');
await import('./customer-order-and-owner-management.js');
await import('./public-all-order-route.js');

// customer-order-and-owner-management.js currently wraps listen with an
// async installer. Adapt that return value back to the synchronous HTTP-server
// interface expected by server (1).js.
await import('./listen-compat.js');

await import('./server (1).js');
