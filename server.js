// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register QR history, public customer-hub routing, menu-link normalization,
// owner management, unified customer ordering, and the customer order helpers
// before the canonical server.
//
// IMPORTANT: do not load qr-public-destination.js here. That legacy compatibility
// layer intercepts /q/:slug and redirects it to /public/qr/:slug, where the
// canonical server can return the dashboard/API response instead of the public
// customer hub. /q/:slug is now owned by public-qr.js.
await import('./qr-history.js');
await import('./public-menu-links.js');
await import('./public-qr.js');
await import('./menu-order-route.js');
await import('./customer-order-and-owner-management.js');
await import('./public-all-order-route.js');

// Some compatibility modules wrap Express's listen() method. One of those
// wrappers returns the Express app instead of the native http.Server, which
// makes server (1).js fail at server.on(...). Before loading the canonical
// server, use the native Node HTTP implementation directly so app.listen()
// always returns a real http.Server.
import express from 'express';
import http from 'node:http';
express.application.listen = function(...args){
  const server = http.createServer(this);
  return server.listen(...args);
};

await import('./server (1).js');
