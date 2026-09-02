# repute-tech.in

Node.js/Express + Prisma/PostgreSQL application for the repute-tech.in reputation platform.

## Billing model

This version uses **manual plan approval only**. There is no Razorpay, Stripe, checkout, webhook, or online payment integration.

Flow: business owner views plans → submits a plan request → platform admin approves or rejects → approved request can be published → the selected plan is activated with `provider=manual`.

## Production environment

Required:
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — long random secret
- `NODE_ENV=production`

Optional integrations:
- Google Business Profile: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- AI replies: `OPENAI_API_KEY`, `OPENAI_MODEL`
- WhatsApp Cloud API: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_GRAPH_VERSION`

`MOCK_GOOGLE_REVIEWS` should be `false` when real Google integration is configured.

## Deploy

Use a Node.js host that supports a persistent Express server and PostgreSQL. For Render, leave Root Directory empty, build with `npm install --include=dev && npm run build`, and start with `npm start`. The server listens on the host-provided `PORT` (default 4000).

The frontend is served by the same Express application, so `/api/*` requests stay on the same domain.
