# Repute Tech v1.9.5

Render Web Service settings:
- Runtime: Node
- Root Directory: leave empty
- Build Command: `npm install --include=dev && npm run build`
- Start Command: `npm start`

Required Render environment variables:
- `DATABASE_URL` = Supabase **Session Pooler** PostgreSQL connection string (port 5432)
- `SESSION_SECRET` = long random secret
- `NODE_ENV` = `production`

Optional: Google Business Profile, OpenAI, and WhatsApp environment variables listed in README.

This version starts Express immediately so Render can detect the web port. Prisma schema generation/database push happens during the build instead of blocking server startup.

Billing is manual approval only; there is no Razorpay, Stripe, checkout, webhook, or online payment integration.
