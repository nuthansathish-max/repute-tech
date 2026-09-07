// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
//
// IMPORTANT: compatibility modules that register routes by wrapping
// express.application.listen() must be imported AFTER we install the native
// listen implementation below. Importing them first would cause their route
// installers to be replaced before the canonical server starts.
import express from 'express';
import http from 'node:http';

// Always make app.listen() return a real Node HTTP server. The canonical
// server calls server.on(...) and server.close(...), so returning the Express
// app here breaks production startup. Keeping this implementation installed
// before the compatibility imports also lets those modules safely chain their
// route installers onto this native listener.
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

await import('./server (1).js');
