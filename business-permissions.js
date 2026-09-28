import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();

export const PERMISSION_KEYS = [
  'DASHBOARD','REVIEWS','AI','QR','MENU','CUSTOMERS',
  'WHATSAPP','ANALYTICS','BILLING','ORDERS','PRICING','STAFF','SETTINGS'
];

export const DEFAULT_PERMISSIONS = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));

const permissionColumnReady = prisma.$executeRawUnsafe(
  'ALTER TABLE "BusinessMember" ADD COLUMN IF NOT EXISTS "permissions" JSONB NOT NULL DEFAULT \'{}\'::jsonb'
).catch(() => 0);

async function currentUser(req) {
  const token = getCookie(req, 'rp_session');
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: true }
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

function normalizePermissions(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, source[k] === true]));
}

async function businessIdForRequest(req) {
  const direct = req.params?.businessId || req.body?.businessId || req.query?.businessId;
  if (direct) return String(direct);

  const path = req.path;

  const reviewMatch = path.match(/^\/api\/reviews\/([^/]+)/);
  if (reviewMatch) {
    const row = await prisma.review.findUnique({ where: { id: reviewMatch[1] }, select: { businessId: true } });
    return row?.businessId || null;
  }

  const menuMatch = path.match(/^\/api\/menus\/([^/]+)/);
  if (menuMatch) {
    const row = await prisma.menu.findUnique({ where: { id: menuMatch[1] }, select: { businessId: true } });
    if (row) return row.businessId;
    const item = await prisma.menuItem.findUnique({
      where: { id: menuMatch[1] },
      select: { menu: { select: { businessId: true } } }
    });
    return item?.menu?.businessId || null;
  }

  const customerMatch = path.match(/^\/api\/customers\/([^/]+)/);
  if (customerMatch) {
    const row = await prisma.customer.findUnique({ where: { id: customerMatch[1] }, select: { businessId: true } });
    return row?.businessId || null;
  }

  const qrMatch = path.match(/^\/api\/qr\/([^/]+)/);
  if (qrMatch && !path.endsWith('/scan')) {
    const row = await prisma.smartQr.findUnique({ where: { id: qrMatch[1] }, select: { businessId: true } });
    return row?.businessId || null;
  }

  const orderMatch = path.match(/^\/api\/.*orders\/([^/]+)/);
  if (orderMatch) {
    const row = await prisma.order.findUnique({ where: { id: orderMatch[1] }, select: { businessId: true } });
    return row?.businessId || null;
  }

  return null;
}

function permissionForPath(path, method) {
  if (path.includes('/staff') || path.includes('/members')) return 'STAFF';
  if (path.includes('/billing') || path === '/api/billing-pos') return 'BILLING';
  if (path.includes('/orders')) return 'ORDERS';
  if (path.includes('/analytics')) return 'ANALYTICS';
  if (path.includes('/ai-settings') || (path.startsWith('/api/reviews/') && path.includes('ai-'))) return 'AI';
  if (path.includes('/reviews') || path.startsWith('/api/reviews') || path.includes('/google/')) return 'REVIEWS';
  if (path.includes('/qr') || path.startsWith('/api/qr')) return 'QR';
  if (path.includes('/menus') || path.startsWith('/api/menus')) return 'MENU';
  if (path.includes('/customers') || path.startsWith('/api/customers')) return 'CUSTOMERS';
  if (path.includes('/whatsapp')) return 'WHATSAPP';
  if (path.includes('/plan-requests') || path === '/api/plans' || path.includes('/entitlements')) return 'PRICING';
  if (path.includes('/dashboard')) return 'DASHBOARD';
  if (path.includes('/settings')) return 'SETTINGS';
  return null;
}

function adminFeatureForPath(path) {
  if (
    path === '/api/google/status' ||
    path.startsWith('/auth/google') ||
    path.includes('/google/') ||
    (path.startsWith('/api/reviews/') && path.endsWith('/publish'))
  ) return 'GOOGLE';
  if (path.includes('/whatsapp') || path.includes('/campaigns')) return 'WHATSAPP';
  if (
    path.includes('/ai-settings') ||
    path.endsWith('/analyze') ||
    path.endsWith('/ai-reply') ||
    path.includes('/ai-')
  ) return 'AI';
  if (path.includes('/reviews') || path.startsWith('/api/reviews')) return 'REVIEWS';
  if (path.includes('/orders')) return 'ORDERS';
  if (path.includes('/billing') || path === '/api/billing-pos') return 'BILLING';
  if (path.includes('/menus') || path.startsWith('/api/menus')) return 'MENU';
  if (path.includes('/qr') || path.startsWith('/api/qr')) return 'QR';
  return null;
}

async function businessIdForFeature(req, user) {
  const direct = await businessIdForRequest(req);
  if (direct) return direct;
  const business = await prisma.business.findFirst({
    where: { members: { some: { userId: user.id } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  });
  return business?.id || null;
}

async function enforceAdminFeature(req, res, user) {
  const feature = adminFeatureForPath(req.path);
  if (!feature) return true;
  const businessId = await businessIdForFeature(req, user);
  if (!businessId) return true;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { adminFeatureFlags: true }
  });
  if (!business) return true;

  const flags = business.adminFeatureFlags && typeof business.adminFeatureFlags === 'object'
    ? business.adminFeatureFlags
    : {};

  if (flags[feature] === false) {
    res.status(403).json({
      error: 'This feature has been disabled by the platform administrator.',
      feature,
      featureDisabled: true
    });
    return false;
  }
  return true;
}

export async function businessPermissionMiddleware(req, res, next) {
  try {
    const googleAuthPath = req.path === '/auth/google' || req.path === '/auth/google/callback';
    if ((!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/') || req.path.startsWith('/api/admin/') ||
        req.path === '/api/whatsapp/webhook' || req.path === '/api/plans') && !googleAuthPath) return next();

    const needed = permissionForPath(req.path, req.method);
    const adminFeature = adminFeatureForPath(req.path);
    if (!needed && !adminFeature) return next();

    const user = await currentUser(req);
    if (!user) return next();

    if (['ADMIN','SUPER_ADMIN'].includes(user.role)) return next();

    if (!(await enforceAdminFeature(req, res, user))) return;

    await permissionColumnReady;
    const businessId = await businessIdForRequest(req);
    if (!businessId) return next();

    await permissionColumnReady;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT role, permissions FROM "BusinessMember" WHERE "userId"=$1 AND "businessId"=$2 LIMIT 1`,
      user.id, businessId
    );
    const member = rows[0];
    if (!member) return res.status(403).json({ error: 'Business access denied' });
    if (member.role === 'OWNER') return next();

    const permissions = normalizePermissions(member.permissions);
    if (!permissions[needed]) {
      return res.status(403).json({ error: 'This access has not been granted by the business owner.' });
    }

    next();
  } catch (error) {
    next(error);
  }
}

export { prisma as permissionsPrisma, normalizePermissions };
