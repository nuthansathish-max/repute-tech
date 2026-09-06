// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register QR history, public customer-hub routing, menu-link normalization,
// ordering, owner menu/QR management, and the final combined customer-order route.
//
// IMPORTANT: do not load qr-public-destination.js here. That legacy compatibility
// layer intercepts /q/:slug and redirects it to /public/qr/:slug, where the
// canonical server can return the dashboard/API response instead of the public
// customer hub. /q/:slug is now owned by public-qr.js.
await import('./qr-history.js');
await import('./public-menu-links.js');
await import('./public-qr.js');
await import('./menu-order-route.js');
await import('./public-order-enhancement.js');
await import('./customer-order-and-owner-management.js');
await import('./listen-return-fix.js');
// Register this last in the listen chain so its /q/:slug/order and
// /api/public/orders handlers are appended after the older compatibility routes.
await import('./public-all-order-route.js');
await import('./server (1).js');
