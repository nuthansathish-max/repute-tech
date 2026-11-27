import express from 'express';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';
import { getAdminAccessForUser, getAdminAccessStatusForUser, hasAdminPermission } from './admin-access.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
let installed = false;

const ID = () => crypto.randomUUID();
const MAX_PROOF_BYTES = 600 * 1024;
let setupPromise;

async function ensureTables() {
  if (!setupPromise) setupPromise = (async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SubscriptionUpiSettings" (
      "id" TEXT PRIMARY KEY,
      "upiId" TEXT NOT NULL DEFAULT '',
      "accountName" TEXT NOT NULL DEFAULT '',
      "qrDataUrl" TEXT,
      "instructions" TEXT NOT NULL DEFAULT '',
      "updatedByUserId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "SubscriptionPaymentSubmission" (
      "id" TEXT PRIMARY KEY,
      "planRequestId" TEXT NOT NULL REFERENCES "PlanRequest"("id") ON DELETE CASCADE,
      "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
      "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
      "utr" TEXT NOT NULL,
      "proofDataUrl" TEXT,
      "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPROVED','REJECTED')),
      "reviewNote" TEXT,
      "reviewedByUserId" TEXT,
      "reviewedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "SubscriptionPaymentSubmission_status_created_idx" ON "SubscriptionPaymentSubmission" ("status","createdAt" DESC)');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "SubscriptionPaymentSubmission_business_idx" ON "SubscriptionPaymentSubmission" ("businessId","createdAt" DESC)');
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPaymentSubmission_one_open_per_plan" ON "SubscriptionPaymentSubmission" ("planRequestId") WHERE "status" IN ('PENDING','APPROVED')`);
  })().catch(error => { setupPromise = null; throw error; });
  return setupPromise;
}

async function currentUser(req) {
  const token = getCookie(req, 'rp_session');
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

async function adminAllowed(user, permission) {
  const status = await getAdminAccessStatusForUser(prisma, user.id);
  if (status && !status.isActive) return false;
  const access = await getAdminAccessForUser(prisma, user.id);
  if (access) return hasAdminPermission(access, permission);
  return false;
}

async function businessForOwner(userId, businessId) {
  return prisma.business.findFirst({
    where: { id: businessId, members: { some: { userId } } },
    select: { id: true, name: true }
  });
}

function imageDataUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Payment proof must be a PNG, JPG or WEBP image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) throw new Error('Payment proof image must be 600 KB or smaller.');
  return value;
}

function install(app) {
  if (installed) return;
  installed = true;

  originalGet.call(app, '/api/subscription-payment/instructions', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const businessId = String(req.query.businessId || '').trim();
      if (!businessId || !(await businessForOwner(user.id, businessId))) return res.status(403).json({ error: 'Business access denied' });
      await ensureTables();
      const rows = await prisma.$queryRawUnsafe('SELECT "upiId","accountName","qrDataUrl","instructions" FROM "SubscriptionUpiSettings" WHERE "id"=$1 LIMIT 1', 'default');
      let submission = null;
      const planRequestId = String(req.query.planRequestId || '').trim();
      if (planRequestId) {
        const owned = await prisma.planRequest.findFirst({ where:{ id:planRequestId, businessId, userId:user.id }, select:{ id:true, status:true, paymentStatus:true } });
        if (!owned) return res.status(404).json({ error:'Subscription request not found.' });
        if (owned.status !== 'APPROVED' || owned.paymentStatus === 'PAID') return res.status(409).json({ error:'UPI payment instructions are available only for approved, unpaid subscription requests.' });
        const existing = await prisma.$queryRawUnsafe('SELECT "status","reviewNote","createdAt" FROM "SubscriptionPaymentSubmission" WHERE "planRequestId"=$1 ORDER BY "createdAt" DESC LIMIT 1', planRequestId);
        submission = existing[0] || null;
      }
      res.json({ settings: rows[0] || { upiId:'', accountName:'', qrDataUrl:null, instructions:'' }, submission });
    } catch(e) { next(e); }
  });

  originalGet.call(app, '/api/admin/subscription-upi-settings', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await adminAllowed(user, 'PAYMENTS_VIEW')) && !(await adminAllowed(user, 'PAYMENTS_CONFIGURE_UPI'))) return res.status(403).json({ error: 'Payment view or UPI configuration permission required.' });
      await ensureTables();
      const rows = await prisma.$queryRawUnsafe('SELECT "upiId","accountName","qrDataUrl","instructions" FROM "SubscriptionUpiSettings" WHERE "id"=$1 LIMIT 1', 'default');
      res.json({ settings: rows[0] || { upiId:'', accountName:'', qrDataUrl:null, instructions:'' } });
    } catch(e) { next(e); }
  });

  originalPost.call(app, '/api/admin/subscription-upi-settings', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await adminAllowed(user, 'PAYMENTS_CONFIGURE_UPI'))) return res.status(403).json({ error: 'UPI settings permission required.' });
      await ensureTables();
      const upiId = String(req.body?.upiId || '').trim();
      const accountName = String(req.body?.accountName || '').trim();
      const instructions = String(req.body?.instructions || '').trim();
      const qrDataUrl = req.body?.qrDataUrl ? imageDataUrl(req.body.qrDataUrl) : null;
      if (!/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,100}$/.test(upiId)) return res.status(400).json({ error: 'Enter a valid UPI ID.' });
      if (!accountName || accountName.length > 100) return res.status(400).json({ error: 'Enter an account display name up to 100 characters.' });
      if (instructions.length > 500) return res.status(400).json({ error: 'Instructions must be 500 characters or less.' });
      await prisma.$executeRawUnsafe(`INSERT INTO "SubscriptionUpiSettings" ("id","upiId","accountName","qrDataUrl","instructions","updatedByUserId")
        VALUES ('default',$1,$2,$3,$4,$5)
        ON CONFLICT ("id") DO UPDATE SET "upiId"=EXCLUDED."upiId","accountName"=EXCLUDED."accountName",
        "qrDataUrl"=COALESCE(EXCLUDED."qrDataUrl","SubscriptionUpiSettings"."qrDataUrl"),
        "instructions"=EXCLUDED."instructions","updatedByUserId"=EXCLUDED."updatedByUserId","updatedAt"=CURRENT_TIMESTAMP`,
        upiId, accountName, qrDataUrl, instructions, user.id);
      await prisma.auditLog.create({ data: { actorUserId:user.id, action:'SUBSCRIPTION_UPI_SETTINGS_UPDATED', entity:'SubscriptionUpiSettings', entityId:'default', metadata:{ upiId, accountName, qrImageUpdated:Boolean(qrDataUrl), instructions } } });
      res.json({ ok:true });
    } catch(e) { if (/Payment proof|600 KB/.test(String(e.message))) return res.status(400).json({error:e.message}); next(e); }
  });

  originalPost.call(app, '/api/subscription-payment-submissions', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const planRequestId = String(req.body?.planRequestId || '').trim();
      const utr = String(req.body?.utr || '').trim();
      const businessId = String(req.body?.businessId || '').trim();
      if (!planRequestId || !businessId || utr.length < 6 || utr.length > 120) return res.status(400).json({ error: 'Enter the business, subscription request and valid UTR/reference number.' });
      const proofDataUrl = imageDataUrl(req.body?.proofDataUrl);
      const business = await businessForOwner(user.id, businessId);
      if (!business) return res.status(403).json({ error: 'Business access denied' });
      await ensureTables();
      const request = await prisma.planRequest.findFirst({ where:{ id:planRequestId, businessId, userId:user.id }, select:{ id:true, status:true, paymentStatus:true } });
      if (!request) return res.status(404).json({ error: 'Subscription request not found.' });
      if (request.status !== 'APPROVED' || request.paymentStatus === 'PAID') return res.status(409).json({ error: 'Payment can be submitted only for an approved, unpaid subscription request.' });
      const duplicate = await prisma.$queryRawUnsafe('SELECT "id" FROM "SubscriptionPaymentSubmission" WHERE "planRequestId"=$1 AND "status" IN (\'PENDING\',\'APPROVED\') LIMIT 1', planRequestId);
      if (duplicate.length) return res.status(409).json({ error: 'A payment submission is already under review for this subscription.' });
      const id = ID();
      await prisma.$executeRawUnsafe(`INSERT INTO "SubscriptionPaymentSubmission" ("id","planRequestId","businessId","userId","utr","proofDataUrl")
        VALUES ($1,$2,$3,$4,$5,$6)`, id, planRequestId, businessId, user.id, utr, proofDataUrl);
      await prisma.auditLog.create({ data:{ actorUserId:user.id, action:'SUBSCRIPTION_PAYMENT_SUBMITTED', entity:'SubscriptionPaymentSubmission', entityId:id, metadata:{ businessId, planRequestId, utr, proofAttached:Boolean(proofDataUrl) } } });
      res.status(201).json({ ok:true, submissionId:id, status:'PENDING' });
    } catch(e) { if (/Payment proof|600 KB/.test(String(e.message))) return res.status(400).json({error:e.message}); next(e); }
  });

  originalGet.call(app, '/api/admin/subscription-payment-submissions', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await adminAllowed(user, 'PAYMENTS_VIEW'))) return res.status(403).json({ error: 'Payment view permission required.' });
      await ensureTables();
      const status = ['PENDING','APPROVED','REJECTED'].includes(String(req.query.status||'').toUpperCase()) ? String(req.query.status).toUpperCase() : 'PENDING';
      const rows = await prisma.$queryRawUnsafe(`SELECT s."id",s."planRequestId",s."businessId",s."userId",s."utr",s."status",s."reviewNote",s."reviewedAt",s."createdAt",
        b."name" AS "businessName",u."name" AS "ownerName",u."email" AS "ownerEmail",p."planName",p."price",p."billingInterval"
        FROM "SubscriptionPaymentSubmission" s JOIN "Business" b ON b."id"=s."businessId"
        JOIN "User" u ON u."id"=s."userId" JOIN "PlanRequest" p ON p."id"=s."planRequestId"
        WHERE s."status"=$1 ORDER BY s."createdAt" DESC LIMIT 200`, status);
      res.json({ submissions:rows });
    } catch(e) { next(e); }
  });

  originalGet.call(app, '/api/admin/subscription-payment-submissions/:id/proof', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await adminAllowed(user, 'PAYMENTS_VIEW'))) return res.status(403).json({ error: 'Payment view permission required.' });
      await ensureTables();
      const rows = await prisma.$queryRawUnsafe('SELECT "proofDataUrl" FROM "SubscriptionPaymentSubmission" WHERE "id"=$1 LIMIT 1', req.params.id);
      if (!rows[0]) return res.status(404).json({ error: 'Payment submission not found.' });
      if (!rows[0].proofDataUrl) return res.status(404).json({ error: 'No payment proof was attached.' });
      res.json({ proofDataUrl: rows[0].proofDataUrl });
    } catch(e) { next(e); }
  });

  originalPost.call(app, '/api/admin/subscription-payment-submissions/:id/review', async (req,res,next) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!(await adminAllowed(user, 'PAYMENTS_VERIFY'))) return res.status(403).json({ error: 'Payment verification permission required.' });
      const status = String(req.body?.status||'').toUpperCase();
      const note = String(req.body?.note||'').trim().slice(0,500);
      if (!['APPROVED','REJECTED'].includes(status)) return res.status(400).json({ error: 'Choose approve or reject.' });
      if (status === 'APPROVED' && !(await adminAllowed(user, 'PAYMENTS_APPROVE'))) return res.status(403).json({ error: 'Payment approval permission required.' });
      await ensureTables();
      const rows = await prisma.$queryRawUnsafe('SELECT * FROM "SubscriptionPaymentSubmission" WHERE "id"=$1 LIMIT 1', req.params.id);
      const submission = rows[0];
      if (!submission) return res.status(404).json({ error: 'Payment submission not found.' });
      if (submission.status !== 'PENDING') return res.status(409).json({ error: 'This payment submission has already been reviewed.' });
      const request = await prisma.planRequest.findUnique({ where:{id:submission.planRequestId} });
      if (!request || request.paymentStatus === 'PAID') return res.status(409).json({ error: 'Subscription payment is already recorded or request is unavailable.' });
      await prisma.$transaction(async tx => {
        const changed = await tx.$executeRawUnsafe('UPDATE "SubscriptionPaymentSubmission" SET "status"=$2,"reviewNote"=$3,"reviewedByUserId"=$4,"reviewedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\'', submission.id, status, note || null, user.id);
        if (changed !== 1) throw new Error('This payment submission has already been reviewed.');
        if (status === 'APPROVED') {
          await tx.planRequest.update({ where:{id:request.id}, data:{paymentStatus:'PAID',paidAt:new Date()} });
        }
        await tx.auditLog.create({ data:{ actorUserId:user.id, action:status==='APPROVED'?'SUBSCRIPTION_PAYMENT_MANUALLY_APPROVED':'SUBSCRIPTION_PAYMENT_REJECTED', entity:'SubscriptionPaymentSubmission', entityId:submission.id, metadata:{ businessId:submission.businessId, planRequestId:submission.planRequestId, utr:submission.utr, note:note||null, amount:request.price.toString() } } });
      });
      res.json({ ok:true, status });
    } catch(e) { next(e); }
  });
}

express.application.get = function(path,...handlers) { install(this); return originalGet.call(this,path,...handlers); };
express.application.post = function(path,...handlers) { install(this); return originalPost.call(this,path,...handlers); };
