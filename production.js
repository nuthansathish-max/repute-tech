import 'dotenv/config';

function tuneDatabaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  try {
    const u = new URL(raw);

    if (!u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', '3');
    }

    if (!u.searchParams.has('pool_timeout')) {
      u.searchParams.set('pool_timeout', '20');
    }

    return u.toString();
  } catch {
    return raw;
  }
}

process.env.DATABASE_URL = tuneDatabaseUrl(process.env.DATABASE_URL);

// Load API compatibility aliases before bootstrap imports the Express server.
// This keeps older frontend action URLs working while the canonical API remains unchanged.
await import('./compat-routes.js');

// Keep Render's PORT unchanged.
// bootstrap.js -> server.js will create the single Express listener.
await import('./bootstrap.js');
