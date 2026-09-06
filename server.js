// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register QR history, public customer-hub routing, menu-specific ordering,
// and public QR destinations before the canonical server routes.
await import('./qr-history.js');
await import('./public-qr.js');
await import('./menu-order-route.js');
await import('./qr-public-destination.js');
await import('./server (1).js');
