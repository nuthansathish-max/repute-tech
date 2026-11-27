import express from 'express';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash, randomToken, hashPassword, setSessionCookie } from './auth.js';
import { ADMIN_PERMISSION_KEYS, ensureAdminAccessTables, getAdminAccessForUser } from './admin-access.js';
import { sendAdminInvitationEmail } from './admin-invitation-email.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPatch = express.application.patch;
let installed = false;
const newId = () => crypto.randomUUID();
const normalizeEmail = value => String(value || '').trim().toLowerCase();

async function getSessionUser(req, cookieName) {
  const token = getCookie(req, cookieName);
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  return session && session.expiresAt > new Date() ? session.user : null;
}
async function requireSuperAdmin(req, res) {
  const user = await getSessionUser(req, 'rp_admin_session');
  if (!user) { res.status(401).json({ error: 'Admin sign-in required.' }); return null; }
  const access = await getAdminAccessForUser(prisma, user.id);
  if (access?.role !== 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Super Admin permission required.' }); return null;
  }
  return user;
}
async function audit(actor, action, entity, id, metadata) {
  return prisma.auditLog.create({ data: { actorUserId: actor, action, entity, entityId: id || null, metadata: metadata || {} } });
}
function getInviteUrl(token) {
  const base = String(process.env.APP_BASE_URL || process.env.FRONTEND_URL || '').trim();
  if (!base) throw new Error('APP_BASE_URL is not configured');
  const url = new URL(base);
  if (url.protocol !== 'https:') throw new Error('APP_BASE_URL must use HTTPS');
  url.pathname = '/admin-invite'; url.search = ''; url.hash = '';
  url.searchParams.set('token', token);
  return url.toString();
}
async function createInvitation(actor, email, name, replaceId) {
  await ensureAdminAccessTables(prisma);
  email = normalizeEmail(email); name = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { const e = new Error('Enter a valid email address.'); e.status = 400; throw e; }
  if (name.length < 2 || name.length > 80) { const e = new Error('Name must be between 2 and 80 characters.'); e.status = 400; throw e; }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && await getAdminAccessForUser(prisma, existing.id)) { const e = new Error('This account already has Admin access.'); e.status = 409; throw e; }

  const token = randomToken(), digest = tokenHash(token), id = newId();
  const expiresAt = new Date(Date.now() + 86400000);
  await prisma.$transaction(async tx => {
    if (replaceId) {
      const revoked = await tx.$queryRawUnsafe(
        'UPDATE "AdminInvitation" SET "status"=\'REVOKED\',"revokedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\' RETURNING "id"',
        replaceId
      );
      if (!revoked?.length) { const e = new Error('Pending invitation not found.'); e.status = 409; throw e; }
    } else {
      await tx.$executeRawUnsafe(
        'UPDATE "AdminInvitation" SET "status"=\'EXPIRED\',"updatedAt"=CURRENT_TIMESTAMP WHERE LOWER("email")=$1 AND "status"=\'PENDING\' AND "expiresAt"<=CURRENT_TIMESTAMP',
        email
      );
      const pending = await tx.$queryRawUnsafe('SELECT "id" FROM "AdminInvitation" WHERE LOWER("email")=$1 AND "status"=\'PENDING\' LIMIT 1', email);
      if (pending?.length) { const e = new Error('A pending invitation already exists. Use Resend instead.'); e.status = 409; throw e; }
    }
    await tx.$executeRawUnsafe(
      'INSERT INTO "AdminInvitation" ("id","email","name","tokenHash","status","invitedByUserId","expiresAt") VALUES ($1,$2,$3,$4,\'PENDING\',$5,$6)',
      id, email, name, digest, actor.id, expiresAt
    );
    await tx.auditLog.create({ data: { actorUserId: actor.id, action: replaceId ? 'ADMIN_INVITATION_RESENT' : 'ADMIN_INVITATION_CREATED', entity: 'AdminInvitation', entityId: id, metadata: { email, expiresAt: expiresAt.toISOString() } } });
  });

  try {
    const sent = await sendAdminInvitationEmail({ to: email, name, inviteUrl: getInviteUrl(token), expiresAt });
    return { id, email, expiresAt, emailId: sent.id };
  } catch (error) {
    await prisma.$executeRawUnsafe(
      'UPDATE "AdminInvitation" SET "status"=\'REVOKED\',"revokedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\'',
      id
    ).catch(() => {});
    await audit(actor.id, 'ADMIN_INVITATION_EMAIL_FAILED', 'AdminInvitation', id, { email }).catch(() => {});
    throw error;
  }
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function invitePage() {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accept Admin invitation</title>',
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f6fb;color:#182033;font:14px system-ui}.card{width:min(440px,92vw);padding:28px;background:#fff;border:1px solid #ddd9ff;border-radius:16px}h1{font-size:23px}p{color:#687386;line-height:1.5}label{display:block;margin:16px 0 6px;font-weight:650}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d9deea;border-radius:9px;font:inherit}button{width:100%;padding:12px;margin-top:18px;border:0;border-radius:9px;background:#5146e5;color:white;font-weight:750}#message{min-height:20px;margin-top:12px;color:#b42318}</style></head><body>',
    '<main class="card"><h1>Repute Tech Admin invitation</h1><p>Create a password to accept. If you already have a Repute Tech account, sign in to that account using the invited email before accepting so your business access remains unchanged.</p>',
    '<label>Password (at least 12 characters)</label><input id="password" type="password" minlength="12" autocomplete="new-password"><label>Confirm password</label><input id="confirm" type="password" minlength="12" autocomplete="new-password"><button id="accept">Accept invitation</button><div id="message" role="alert"></div><p>Invitation links expire after 24 hours and can only be used once.</p></main>',
    '<script>const token=new URLSearchParams(location.search).get("token")||"";document.getElementById("accept").onclick=async()=>{const m=document.getElementById("message"),p=document.getElementById("password").value,c=document.getElementById("confirm").value,b=document.getElementById("accept");m.textContent="";if(p.length&&p.length<12){m.textContent="Use at least 12 characters.";return}if(p!==c){m.textContent="Passwords do not match.";return}b.disabled=true;try{const r=await fetch("/api/admin/invitations/accept",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,password:p})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Invitation could not be accepted.");m.style.color="#087e61";m.textContent="Invitation accepted. Redirecting…";setTimeout(()=>location.href="/admin-login",900)}catch(e){m.textContent=e.message;b.disabled=false}};</script></body></html>'
  ].join('');
}
function managementPage() {
  const keys = JSON.stringify(ADMIN_PERMISSION_KEYS);
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Access · reputetechs.in</title>',
    '<style>*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#182033;font:13px system-ui}.wrap{max-width:1000px;margin:28px auto;padding:0 15px}.panel{background:white;border:1px solid #ddd9ff;border-radius:14px;padding:18px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field{display:grid;gap:6px}input{padding:10px;border:1px solid #d9deea;border-radius:8px;font:inherit}button{padding:9px 12px;border:1px solid #d9deea;border-radius:8px;background:white;font-weight:700;cursor:pointer}.primary{background:#5146e5;color:white;border-color:#5146e5}.danger{color:#b42318;border-color:#fecaca}.item{padding:12px 0;border-bottom:1px solid #edf0f5;display:flex;justify-content:space-between;gap:10px;align-items:center}.muted{color:#687386}.permissions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.permissions label{display:flex;gap:7px;align-items:center}@media(max-width:650px){.grid{grid-template-columns:1fr}.item{align-items:flex-start;flex-direction:column}}</style></head><body><main class="wrap">',
    '<header class="panel"><h1>Admin Access Management</h1><div class="muted">Invite administrators and manage individual payment permissions.</div></header>',
    '<section class="panel"><h2>Invite an Admin</h2><div class="grid"><label class="field">Full name<input id="name" maxlength="80"></label><label class="field">Email<input id="email" type="email"></label></div><p><button class="primary" id="send">Send secure invitation</button></p><div id="status" class="muted" role="status"></div></section>',
    '<section class="panel"><h2>Pending invitations</h2><div id="invites" class="muted">Loading…</div></section><section class="panel"><h2>Admin accounts</h2><div id="admins" class="muted">Loading…</div></section></main>',
    '<script>const keys='+keys+';const status=document.getElementById("status");async function api(url,opt={}){const r=await fetch(url,{credentials:"include",headers:{"Content-Type":"application/json"},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d}function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]))}async function load(){try{const d=await api("/api/admin/access");document.getElementById("invites").innerHTML=d.invitations.length?d.invitations.map(x=>"<div class=item><div><b>"+esc(x.name)+"</b><div class=muted>"+esc(x.email)+" · "+new Date(x.expiresAt).toLocaleString()+"</div></div><div><button data-resend="+esc(x.id)+">Resend</button> <button class=danger data-revoke="+esc(x.id)+">Revoke</button></div></div>").join(""):"No pending invitations.";document.getElementById("admins").innerHTML=d.admins.length?d.admins.map(x=>"<div class=item><div><b>"+esc(x.name)+"</b><div class=muted>"+esc(x.email)+" · "+esc(x.role)+" · "+(x.isActive?"Active":"Inactive")+"</div></div><div><button data-perms="+esc(x.userId)+">Permissions</button> <button class=danger data-toggle="+esc(x.userId)+" data-active="+x.isActive+">"+(x.isActive?"Deactivate":"Reactivate")+"</button></div></div>").join(""):"No Admin access records."}catch(e){status.textContent=e.message}}document.getElementById("send").onclick=async()=>{status.textContent="Sending…";try{await api("/api/admin/invitations",{method:"POST",body:JSON.stringify({name:document.getElementById("name").value,email:document.getElementById("email").value})});status.textContent="Invitation email sent.";await load()}catch(e){status.textContent=e.message}};document.addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;try{if(b.dataset.revoke){await api("/api/admin/invitations/"+b.dataset.revoke+"/revoke",{method:"POST"});await load()}else if(b.dataset.resend){await api("/api/admin/invitations/"+b.dataset.resend+"/resend",{method:"POST"});status.textContent="A new invitation email was sent.";await load()}else if(b.dataset.toggle){await api("/api/admin/access/"+b.dataset.toggle+"/status",{method:"PATCH",body:JSON.stringify({isActive:b.dataset.active!=="true"})});await load()}else if(b.dataset.perms){const x=await api("/api/admin/access/"+b.dataset.perms+"/permissions");const box=document.createElement("section");box.className="panel";box.innerHTML="<h3>Payment permissions · "+esc(x.email)+"</h3><div class=permissions>"+keys.map(k=>"<label><input type=checkbox value="+k+" "+(x.permissions.includes(k)?"checked":"")+">"+k+"</label>").join("")+"</div><button id=save class=primary>Save</button> <button id=close>Close</button>";document.querySelector(".wrap").appendChild(box);box.querySelector("#close").onclick=()=>box.remove();box.querySelector("#save").onclick=async()=>{const permissions=[...box.querySelectorAll("input:checked")].map(i=>i.value);await api("/api/admin/access/"+b.dataset.perms+"/permissions",{method:"PATCH",body:JSON.stringify({permissions})});box.remove();status.textContent="Permissions saved.";await load()}}}catch(err){status.textContent=err.message}});load();</script></body></html>'
  ].join('');
}

function install(app) {
  if (installed) return;
  installed = true;
  originalGet.call(app, '/admin-invite', (req, res) => { res.set('Cache-Control', 'no-store'); res.type('html').send(invitePage()); });
  originalGet.call(app, '/admin-access', async (req, res, next) => {
    try { const actor = await requireSuperAdmin(req, res); if (!actor) return; res.set('Cache-Control', 'no-store'); res.type('html').send(managementPage()); }
    catch (e) { next(e); }
  });
  originalGet.call(app, '/api/admin/access', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      await ensureAdminAccessTables(prisma);
      const invitations = await prisma.$queryRawUnsafe('SELECT "id","email","name","expiresAt","createdAt" FROM "AdminInvitation" WHERE "status"=\'PENDING\' AND "expiresAt">CURRENT_TIMESTAMP ORDER BY "createdAt" DESC');
      const admins = await prisma.$queryRawUnsafe('SELECT a."userId",a."role",a."isActive",u."name",u."email" FROM "AdminAccess" a JOIN "User" u ON u."id"=a."userId" ORDER BY a."createdAt" DESC');
      res.json({ invitations, admins });
    } catch (e) { next(e); }
  });
  originalPost.call(app, '/api/admin/invitations', async (req, res, next) => {
    try { const actor = await requireSuperAdmin(req, res); if (!actor) return; const result = await createInvitation(actor, req.body?.email, req.body?.name); res.status(201).json({ ok: true, invitation: result }); }
    catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Invitation email could not be sent. Check email configuration.' }); }
  });
  originalPost.call(app, '/api/admin/invitations/:id/resend', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      const old = await prisma.$queryRawUnsafe('SELECT "email","name" FROM "AdminInvitation" WHERE "id"=$1 AND "status"=\'PENDING\' LIMIT 1', req.params.id);
      if (!old?.length) return res.status(404).json({ error: 'Pending invitation not found.' });
      const result = await createInvitation(actor, old[0].email, old[0].name, req.params.id);
      res.json({ ok: true, invitation: result });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Invitation email could not be resent.' }); }
  });
  originalPost.call(app, '/api/admin/invitations/:id/revoke', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      const rows = await prisma.$queryRawUnsafe('UPDATE "AdminInvitation" SET "status"=\'REVOKED\',"revokedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\' RETURNING "email"', req.params.id);
      if (!rows?.length) return res.status(404).json({ error: 'Pending invitation not found.' });
      await audit(actor.id, 'ADMIN_INVITATION_REVOKED', 'AdminInvitation', req.params.id, { email: rows[0].email });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  originalPost.call(app, '/api/admin/invitations/accept', async (req, res, next) => {
    try {
      const token = String(req.body?.token || ''), password = String(req.body?.password || '');
      if (!/^[a-f0-9]{64}$/i.test(token) || password.length > 200) return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
      await ensureAdminAccessTables(prisma);
      const digest = tokenHash(token);
      const found = await prisma.$queryRawUnsafe('SELECT "id","email","name","invitedByUserId" FROM "AdminInvitation" WHERE "tokenHash"=$1 AND "status"=\'PENDING\' AND "expiresAt">CURRENT_TIMESTAMP LIMIT 1', digest);
      const invite = found?.[0];
      if (!invite) return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
      const existing = await prisma.user.findUnique({ where: { email: invite.email } });
      const signedIn = await getSessionUser(req, 'rp_session');
      if (existing && (!signedIn || signedIn.id !== existing.id)) return res.status(401).json({ error: 'Sign in to your existing account using the invited email, then accept again.' });
      if (!existing && password.length < 12) return res.status(400).json({ error: 'Use a password with at least 12 characters.' });
      const user = await prisma.$transaction(async tx => {
        const used = await tx.$queryRawUnsafe('UPDATE "AdminInvitation" SET "status"=\'ACCEPTED\',"acceptedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "tokenHash"=$2 AND "status"=\'PENDING\' AND "expiresAt">CURRENT_TIMESTAMP RETURNING "id"', invite.id, digest);
        if (!used?.length) return null;
        let account = existing;
        if (!account) account = await tx.user.create({ data: { email: invite.email, name: invite.name, passwordHash: hashPassword(password), role: 'OWNER' } });
        await tx.$executeRawUnsafe('UPDATE "AdminInvitation" SET "acceptedUserId"=$1 WHERE "id"=$2', account.id, invite.id);
        await tx.$executeRawUnsafe('INSERT INTO "AdminAccess" ("id","userId","role","isActive","grantedByUserId") VALUES ($1,$2,\'ADMIN\',TRUE,$3) ON CONFLICT ("userId") DO UPDATE SET "role"=\'ADMIN\',"isActive"=TRUE,"grantedByUserId"=EXCLUDED."grantedByUserId","updatedAt"=CURRENT_TIMESTAMP WHERE "AdminAccess"."role"=\'ADMIN\'', newId(), account.id, invite.invitedByUserId);
        await tx.$executeRawUnsafe('DELETE FROM "AdminPermission" WHERE "adminAccessId" IN (SELECT "id" FROM "AdminAccess" WHERE "userId"=$1 AND "role"=\'ADMIN\')', account.id);
        const access = await tx.$queryRawUnsafe('SELECT "id" FROM "AdminAccess" WHERE "userId"=$1 AND "isActive"=TRUE LIMIT 1', account.id);
        if (!access?.length) throw new Error('Admin access could not be created.');
        await tx.auditLog.create({ data: { actorUserId: account.id, action: 'ADMIN_INVITATION_ACCEPTED', entity: 'AdminInvitation', entityId: invite.id, metadata: { invitedByUserId: invite.invitedByUserId } } });
        return account;
      });
      if (!user) return res.status(400).json({ error: 'This invitation is invalid or has expired.' });
      if (!existing) { const sessionToken = randomToken(); await prisma.session.create({ data: { tokenHash: tokenHash(sessionToken), userId: user.id, expiresAt: new Date(Date.now() + 14 * 864e5) } }); setSessionCookie(res, sessionToken); }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  originalGet.call(app, '/api/admin/access/:userId/permissions', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      const access = await getAdminAccessForUser(prisma, req.params.userId);
      if (!access) return res.status(404).json({ error: 'Admin account not found.' });
      const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { email: true } });
      res.json({ email: user?.email, permissions: access.permissions });
    } catch (e) { next(e); }
  });
  originalPatch.call(app, '/api/admin/access/:userId/permissions', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      const requested = req.body?.permissions;
      if (!Array.isArray(requested) || requested.some(p => !ADMIN_PERMISSION_KEYS.includes(p))) return res.status(400).json({ error: 'Choose valid permissions.' });
      const rows = await prisma.$queryRawUnsafe('SELECT "id","role" FROM "AdminAccess" WHERE "userId"=$1 LIMIT 1', req.params.userId);
      if (!rows?.length) return res.status(404).json({ error: 'Admin account not found.' });
      if (rows[0].role === 'SUPER_ADMIN') return res.status(409).json({ error: 'Super Admin permissions are controlled by secure owner provisioning.' });
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('DELETE FROM "AdminPermission" WHERE "adminAccessId"=$1', rows[0].id);
        for (const p of [...new Set(requested)]) await tx.$executeRawUnsafe('INSERT INTO "AdminPermission" ("id","adminAccessId","permission","grantedByUserId") VALUES ($1,$2,$3,$4)', newId(), rows[0].id, p, actor.id);
        await tx.auditLog.create({ data: { actorUserId: actor.id, action: 'ADMIN_PERMISSIONS_UPDATED', entity: 'AdminAccess', entityId: rows[0].id, metadata: { userId: req.params.userId, permissions: [...new Set(requested)] } } });
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  originalPatch.call(app, '/api/admin/access/:userId/status', async (req, res, next) => {
    try {
      const actor = await requireSuperAdmin(req, res); if (!actor) return;
      if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'Choose an active status.' });
      const rows = await prisma.$queryRawUnsafe('UPDATE "AdminAccess" SET "isActive"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$1 AND "role"=\'ADMIN\' RETURNING "id"', req.params.userId, req.body.isActive);
      if (!rows?.length) return res.status(404).json({ error: 'Admin account not found.' });
      await audit(actor.id, req.body.isActive ? 'ADMIN_ACCESS_REACTIVATED' : 'ADMIN_ACCESS_DEACTIVATED', 'AdminAccess', rows[0].id, { userId: req.params.userId });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
express.application.get = function(path, ...handlers) { install(this); return originalGet.call(this, path, ...handlers); };
express.application.post = function(path, ...handlers) { install(this); return originalPost.call(this, path, ...handlers); };
express.application.patch = function(path, ...handlers) { install(this); return originalPatch.call(this, path, ...handlers); };
