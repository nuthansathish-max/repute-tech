// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register QR history and public customer-hub routing before the canonical server routes.
await import('./qr-history.js');
await import('./public-qr.js');
await import('./server (1).js');
