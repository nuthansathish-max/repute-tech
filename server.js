// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register QR history, public customer-hub routing, menu-link normalization,
// owner management, unified customer ordering, and owner notifications before the canonical server.
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
await import('./server (1).js');
