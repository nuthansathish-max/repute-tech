// Compatibility entrypoint for production.js/bootstrap.js.
// The existing Express server is kept in server (1).js.
// Register the complete QR-history endpoint before the canonical server routes.
await import('./qr-history.js');
await import('./server (1).js');
