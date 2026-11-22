import express from 'express';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash, randomToken, encrypt, decrypt, setSessionCookie, verifyPassword } from './auth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
let installed = false;

export async function ensureAdminTwoFactorTables() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminTwoFactor" (
    "userId" TEXT PRIMARY KEY,
    "secretEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "recoveryHashes" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "lastUsedStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe('ALTER TABLE "AdminTwoFactor" ADD COLUMN IF NOT EXISTS "lastUsedStep" BIGINT');
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminTwoFactorChallenge" (
    "tokenHash" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function getAdminTwoFactor(userId) {
  await ensureAdminTwoFactorTables();
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "enabled" FROM "AdminTwoFactor" WHERE "userId"=$1 LIMIT 1', userId
  );
  return rows?.[0] || null;
}

export async function startAdminTwoFactorChallenge(userId, res) {
  await ensureAdminTwoFactorTables();
  const token = randomToken();
  await prisma.$executeRawUnsafe('DELETE FROM "AdminTwoFactorChallenge" WHERE "userId"=$1', userId);
  await prisma.$executeRawUnsafe(
    'INSERT INTO "AdminTwoFactorChallenge" ("tokenHash","userId","expiresAt") VALUES ($1,$2,$3)',
    tokenHash(token), userId, new Date(Date.now() + 5 * 60 * 1000)
  );
  const parts = [`rp_admin_2fa_challenge=${token}`, 'Max-Age=300', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const out = [];
  for (const char of String(input).toUpperCase().replace(/=+$/g, '')) {
    const n = alphabet.indexOf(char); if (n < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; value &= (1 << bits) - 1; }
  }
  return Buffer.from(out);
}
function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1000000).padStart(6, '0');
}
function matchingAdminTotpStep(secret, code) {
  const candidate = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return null;
  const now = Date.now();
  for (const step of [-1, 0, 1]) {
    const counter = Math.floor(now / 30000) + step;
    const expected = totp(secret, counter * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return counter;
  }
  return null;
}
export function verifyAdminTotp(secret, code) {
  return matchingAdminTotpStep(secret, code) !== null;
}
function recoveryHash(code) { return tokenHash('admin-2fa-recovery:' + String(code).toUpperCase()); }
function recoveryList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch {} }
  return [];
}
function newRecoveryCodes() {
  return Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return raw.slice(0, 5) + '-' + raw.slice(5);
  });
}
async function adminSession(req) {
  const token = getCookie(req, 'rp_session');
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) return null;
  return session.user;
}
async function requireAdmin(req, res) {
  const user = await adminSession(req);
  if (!user) { res.status(401).json({ error: 'Admin sign-in required' }); return null; }
  return user;
}
function clearChallengeCookie(res) {
  const parts = ['rp_admin_2fa_challenge=', 'Max-Age=0', 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

const loginPage = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin verification · reputetechs.in</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f2fb;color:#172033;font:14px Inter,system-ui,sans-serif}.card{width:min(420px,92vw);box-sizing:border-box;background:#fff;border:1px solid #d8d0ff;border-radius:16px;padding:28px;box-shadow:0 12px 40px #28205a18}h1{font-size:22px;margin:0 0 8px}.muted{color:#667085;line-height:1.6}input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #d0d5dd;border-radius:9px;font:inherit;margin:14px 0}button{width:100%;padding:13px;border:0;border-radius:9px;background:#5146e5;color:white;font-weight:700;cursor:pointer}#message{min-height:20px;color:#b42318;margin-top:12px;font-size:13px}</style></head><body><main class="card"><h1>Two-factor verification</h1><p class="muted">Enter the 6-digit code from your authenticator app. You can also use one unused recovery code.</p><input id="code" autocomplete="one-time-code" inputmode="text" maxlength="12" placeholder="6-digit code or recovery code"><button id="verify">Verify and continue</button><div id="message" role="alert"></div></main><script>
document.getElementById('verify').onclick=async()=>{const b=document.getElementById('verify'),m=document.getElementById('message');b.disabled=true;m.textContent='';try{const r=await fetch('/api/auth/2fa/verify-login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Verification failed');const a=await fetch('/api/admin/session',{method:'POST',credentials:'include'});const ad=await a.json().catch(()=>({}));if(!a.ok)throw new Error(ad.error||'Admin session could not be created');location.href='/admin-panel'}catch(e){m.textContent=e.message;b.disabled=false}};document.getElementById('code').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('verify').click()});
</script></body></html>`;

const dashboardScript = () => `let me=null,recoveryCodes=[];
const el=id=>document.getElementById(id);
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function load(){try{const d=await api('/api/admin/two-factor');me=d.currentUser;el('total').textContent=d.admins.length;el('enabled').textContent=d.admins.filter(x=>x.enabled).length;el('pending').textContent=d.admins.filter(x=>!x.enabled).length;el('admins').innerHTML=d.admins.map(a=>'<tr><td>'+escapeHtml(a.name||a.email)+'<br><span class="muted">'+escapeHtml(a.email)+'</span></td><td>'+escapeHtml(a.role)+'</td><td><span class="pill '+(a.enabled?'on':'')+'">'+(a.enabled?'Enabled':'Not enabled')+'</span></td><td>'+(a.userId===me.id?'Your account':a.enabled?'Enrolled':'Awaiting enrollment')+'</td></tr>').join('')||'<tr><td colspan="4">No platform administrators found.</td></tr>';el('myStatus').textContent=me.enabled?'2FA is enabled for your account. Authenticator verification is required at the next login.': '2FA is not enabled for your account yet.';el('startSetup').style.display=me.enabled?'none':'inline-block';el('disable').style.display=me.enabled?'inline-block':'none';}catch(e){el('message').textContent=e.message;el('message').className='error'}}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
el('refresh').onclick=load;
el('startSetup').onclick=async()=>{try{const d=await api('/api/admin/two-factor/setup',{});el('qr').src=d.qrDataUrl;el('secret').textContent=d.secret;el('setup').classList.add('show');el('setupMessage').textContent='Scan the code, then confirm with your authenticator app.'}catch(e){el('message').textContent=e.message;el('message').className='error'}};
el('confirm').onclick=async()=>{try{const d=await api('/api/admin/two-factor/enable',{code:el('confirmCode').value});recoveryCodes=d.recoveryCodes;el('codes').innerHTML=recoveryCodes.map(x=>'<div>'+escapeHtml(x)+'</div>').join('');el('recovery').style.display='block';el('setup').classList.remove('show');el('myStatus').textContent='2FA enabled. Save your recovery codes now.';el('startSetup').style.display='none';el('disable').style.display='inline-block';el('message').textContent='Enrollment successful. Please save your recovery codes.';}catch(e){el('setupMessage').textContent=e.message;el('setupMessage').className='error'}};
el('disable').onclick=()=>{el('disableBox').style.display='block'};
el('confirmDisable').onclick=async()=>{try{await api('/api/admin/two-factor/disable',{password:el('disablePassword').value,code:el('disableCode').value});el('disableMessage').textContent='2FA disabled. Please sign in again.';el('disableMessage').className='notice';setTimeout(()=>location.href='/admin-login',900)}catch(e){el('disableMessage').textContent=e.message;el('disableMessage').className='error'}};
el('copyCodes').onclick=async()=>{try{await navigator.clipboard.writeText(recoveryCodes.join(String.fromCharCode(10)));el('message').textContent='Recovery codes copied.'}catch{el('message').textContent='Copy unavailable; please save the codes manually.'}};
load();`;

const dashboardPage = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Two-Factor Authentication · reputetechs.in</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#172033;background:#f4f6fb}*{box-sizing:border-box}body{margin:0;padding:24px}.wrap{max-width:1050px;margin:auto}.head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.head h1{margin:0;font-size:25px}.muted{color:#667085;line-height:1.6}.card{background:white;border:1px solid #d9d1ff;border-radius:13px;padding:18px;margin-top:16px;box-shadow:0 2px 8px #24204d08}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.metric{font-size:27px;font-weight:800;margin-top:6px}.btn{border:0;border-radius:9px;padding:11px 15px;background:#5146e5;color:#fff;font-weight:700;cursor:pointer}.btn.secondary{background:#eef0f6;color:#283247}.btn.danger{background:#c93645}.btn:disabled{opacity:.55;cursor:not-allowed}input{padding:11px;border:1px solid #cfd5e1;border-radius:8px;font:inherit;max-width:320px;width:100%}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:11px;border-bottom:1px solid #edf0f5;font-size:13px}th{color:#667085}.pill{display:inline-block;padding:5px 9px;border-radius:99px;background:#fff0e8;color:#a63e16;font-weight:700;font-size:11px}.pill.on{background:#e8f8f1;color:#087b59}.setup{display:none;margin-top:14px}.setup.show{display:block}.qr{max-width:220px;border:1px solid #eaecf0;padding:8px;border-radius:10px}.codes{background:#f6f4ff;border:1px solid #d8d0ff;border-radius:9px;padding:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font:700 14px ui-monospace,monospace}.notice{margin-top:12px;color:#087b59;white-space:pre-line}.error{color:#b42318}.actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:600px){body{padding:14px}table{min-width:560px}.tablewrap{overflow:auto}.codes{grid-template-columns:1fr}}</style></head><body><main class="wrap">
<div class="head"><div><h1>🔐 Two-Factor Authentication</h1><p class="muted">Protect platform administrator accounts with authenticator-app verification.</p></div><div class="actions"><button class="btn secondary" onclick="location.href='/admin-panel'">← Admin dashboard</button><button class="btn secondary" id="refresh">Refresh</button></div></div>
<section class="grid"><div class="card"><div class="muted">Platform administrators</div><div class="metric" id="total">—</div></div><div class="card"><div class="muted">2FA enabled</div><div class="metric" id="enabled">—</div></div><div class="card"><div class="muted">Awaiting setup</div><div class="metric" id="pending">—</div></div></section>
<section class="card"><h2 style="margin:0 0 8px;font-size:17px">Administrator enrollment</h2><p class="muted">Each administrator enrols their own authenticator app. Once enabled, the next login requires a valid authenticator code or an unused recovery code. Existing sessions are revoked when enrollment is enabled.</p><div class="tablewrap"><table><thead><tr><th>Administrator</th><th>Role</th><th>2FA status</th><th>Enrollment</th></tr></thead><tbody id="admins"><tr><td colspan="4">Loading…</td></tr></tbody></table></div></section>
<section class="card"><h2 style="margin:0 0 8px;font-size:17px">My account security</h2><div id="myStatus" class="muted">Loading account status…</div><div class="actions" style="margin-top:14px"><button class="btn" id="startSetup">Set up authenticator</button><button class="btn danger" id="disable" style="display:none">Disable my 2FA</button></div>
<div class="setup" id="setup"><p class="muted">1. Scan this QR code with Google Authenticator, Microsoft Authenticator, 1Password, or another TOTP app. If scanning is unavailable, enter the secret manually.</p><img class="qr" id="qr" alt="Authenticator setup QR code"><p><strong>Manual setup key</strong><br><code id="secret" style="overflow-wrap:anywhere"></code></p><p class="muted">2. Enter the current 6-digit code from the app to confirm enrollment.</p><input id="confirmCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit authenticator code"> <button class="btn" id="confirm">Confirm and enable 2FA</button><div id="setupMessage" class="notice"></div></div>
<div id="recovery" style="display:none;margin-top:18px"><h3 style="font-size:15px">Save your recovery codes</h3><p class="muted">These codes are shown only once. Store them somewhere safe. Each code can be used once if you lose access to your authenticator.</p><div id="codes" class="codes"></div><button class="btn secondary" id="copyCodes" style="margin-top:12px">Copy recovery codes</button><p class="notice">After saving these codes, sign in again. Your existing admin sessions have been revoked to activate 2FA protection.</p></div>
<div id="disableBox" style="display:none;margin-top:14px"><p class="muted">Confirm your password and enter an authenticator or unused recovery code to disable 2FA.</p><input id="disablePassword" type="password" autocomplete="current-password" placeholder="Current password"><br><br><input id="disableCode" placeholder="Authenticator or recovery code"><br><br><button class="btn danger" id="confirmDisable">Confirm disable</button><div id="disableMessage" class="notice"></div></div>
</section><div id="message" class="muted" style="margin-top:12px"></div></main><script src="/admin-two-factor-ui.js" defer></script><noscript><p class="error">JavaScript must be enabled to load administrator security status.</p></noscript></body></html>`;

function install(app) {
  if (installed) return;
  installed = true;
  originalGet.call(app, '/admin-2fa-login', (_req, res) => res.type('html').send(loginPage()));
  originalGet.call(app, '/admin-two-factor-ui.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-store').send(dashboardScript()));
  originalGet.call(app, '/admin-two-factor', async (req, res, next) => {
    try { if (!await adminSession(req)) return res.redirect('/admin-login'); res.set('Cache-Control', 'no-store'); res.type('html').send(dashboardPage()); }
    catch (e) { next(e); }
  });
  originalPost.call(app, '/api/auth/2fa/verify-login', async (req, res, next) => {
    try {
      await ensureAdminTwoFactorTables();
      const token = getCookie(req, 'rp_admin_2fa_challenge');
      if (!token) return res.status(401).json({ error: 'Your verification session expired. Please sign in again.' });
      const key = tokenHash(token);
      const rows = await prisma.$queryRawUnsafe('SELECT "userId","attempts","expiresAt" FROM "AdminTwoFactorChallenge" WHERE "tokenHash"=$1 LIMIT 1', key);
      const challenge = rows?.[0];
      if (!challenge || challenge.expiresAt < new Date() || Number(challenge.attempts) >= 5) {
        await prisma.$executeRawUnsafe('DELETE FROM "AdminTwoFactorChallenge" WHERE "tokenHash"=$1', key);
        clearChallengeCookie(res);
        return res.status(401).json({ error: 'Verification session expired. Please sign in again.' });
      }
      const recordRows = await prisma.$queryRawUnsafe('SELECT "secretEnc","recoveryHashes","enabled" FROM "AdminTwoFactor" WHERE "userId"=$1 LIMIT 1', challenge.userId);
      const record = recordRows?.[0];
      if (!record?.enabled) return res.status(401).json({ error: 'Two-factor authentication is not enabled for this account. Sign in again.' });
      const code = String(req.body?.code || '').trim();
      let secret = '';
      try { secret = decrypt(record.secretEnc); } catch { return res.status(500).json({ error: 'Authenticator configuration could not be read. Contact support.' }); }
      const matchedStep = matchingAdminTotpStep(secret, code);
      const candidateRecoveryHash = recoveryHash(code);
      const isRecoveryCandidate = recoveryList(record.recoveryHashes).includes(candidateRecoveryHash);
      if (matchedStep === null && !isRecoveryCandidate) {
        await prisma.$executeRawUnsafe('UPDATE "AdminTwoFactorChallenge" SET "attempts"="attempts"+1 WHERE "tokenHash"=$1', key);
        return res.status(401).json({ error: 'Invalid code. Check your authenticator or recovery code and try again.' });
      }
      const consumedChallenge = await prisma.$queryRawUnsafe('DELETE FROM "AdminTwoFactorChallenge" WHERE "tokenHash"=$1 RETURNING "tokenHash"', key);
      if (!consumedChallenge?.length) {
        clearChallengeCookie(res);
        return res.status(401).json({ error: 'This verification request has already been used. Please sign in again.' });
      }
      if (matchedStep !== null) {
        const consumedStep = await prisma.$executeRawUnsafe(
          'UPDATE "AdminTwoFactor" SET "lastUsedStep"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$2 AND ("lastUsedStep" IS NULL OR "lastUsedStep" < $1)',
          BigInt(matchedStep), challenge.userId
        );
        if (!consumedStep) {
          clearChallengeCookie(res);
          return res.status(401).json({ error: 'That authenticator code has already been used. Wait for the next code and sign in again.' });
        }
      } else {
        const consumedRecovery = await prisma.$executeRawUnsafe(
          'UPDATE "AdminTwoFactor" SET "recoveryHashes"="recoveryHashes" - $1,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$2 AND "recoveryHashes" ? $1',
          candidateRecoveryHash, challenge.userId
        );
        if (!consumedRecovery) {
          clearChallengeCookie(res);
          return res.status(401).json({ error: 'That recovery code has already been used. Please sign in again.' });
        }
      }
      const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
      if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return res.status(403).json({ error: 'Admin access is no longer available for this account.' });
            const sessionToken = randomToken();
      await prisma.session.create({ data: { tokenHash: tokenHash(sessionToken), userId: user.id, expiresAt: new Date(Date.now() + 14 * 864e5) } });
      setSessionCookie(res, sessionToken);
      clearChallengeCookie(res);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (e) { next(e); }
  });
  originalGet.call(app, '/api/admin/two-factor', async (req, res, next) => {
    try {
      const user = await requireAdmin(req, res); if (!user) return;
      await ensureAdminTwoFactorTables();
      const admins = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: 'asc' } });
      const ids = admins.map(x => x.id);
      const rows = ids.length ? await prisma.$queryRawUnsafe('SELECT "userId","enabled" FROM "AdminTwoFactor" WHERE "userId" = ANY($1::text[])', ids) : [];
      const map = new Map(rows.map(x => [x.userId, Boolean(x.enabled)]));
      res.set('Cache-Control', 'no-store');
      res.json({ currentUser: { id: user.id, enabled: map.get(user.id) || false }, admins: admins.map(x => ({ userId: x.id, name: x.name, email: x.email, role: x.role, enabled: map.get(x.id) || false })) });
    } catch (e) { next(e); }
  });
  originalPost.call(app, '/api/admin/two-factor/setup', async (req, res, next) => {
    try {
      const user = await requireAdmin(req, res); if (!user) return;
      await ensureAdminTwoFactorTables();
      const existing = await prisma.$queryRawUnsafe('SELECT "enabled" FROM "AdminTwoFactor" WHERE "userId"=$1 LIMIT 1', user.id);
      if (existing?.[0]?.enabled) return res.status(409).json({ error: '2FA is already enabled for your account.' });
      const secret = base32Encode(crypto.randomBytes(20));
      await prisma.$executeRawUnsafe(
        `INSERT INTO "AdminTwoFactor" ("userId","secretEnc","enabled","recoveryHashes") VALUES ($1,$2,FALSE,'[]'::jsonb)
         ON CONFLICT ("userId") DO UPDATE SET "secretEnc"=$2,"enabled"=FALSE,"recoveryHashes"='[]'::jsonb,"lastUsedStep"=NULL,"updatedAt"=CURRENT_TIMESTAMP`,
        user.id, encrypt(secret)
      );
      const label = encodeURIComponent('reputetechs.in:' + user.email);
      const uri = 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=' + encodeURIComponent('reputetechs.in') + '&algorithm=SHA1&digits=6&period=30';
      const qrDataUrl = await QRCode.toDataURL(uri, { width: 240, margin: 2 });
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, secret, qrDataUrl });
    } catch (e) { next(e); }
  });
  originalPost.call(app, '/api/admin/two-factor/enable', async (req, res, next) => {
    try {
      const user = await requireAdmin(req, res); if (!user) return;
      await ensureAdminTwoFactorTables();
      const rows = await prisma.$queryRawUnsafe('SELECT "secretEnc","enabled" FROM "AdminTwoFactor" WHERE "userId"=$1 LIMIT 1', user.id);
      if (!rows?.[0] || rows[0].enabled) return res.status(400).json({ error: 'Start a new authenticator setup first.' });
      const secret = decrypt(rows[0].secretEnc);
      const matchedStep = matchingAdminTotpStep(secret, req.body?.code);
      if (matchedStep === null) return res.status(400).json({ error: 'That code is not valid. Check your authenticator app and try again.' });
      const recoveryCodes = newRecoveryCodes();
      const hashes = recoveryCodes.map(recoveryHash);
      await prisma.$executeRawUnsafe('UPDATE "AdminTwoFactor" SET "enabled"=TRUE,"recoveryHashes"=$1::jsonb,"lastUsedStep"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=$3', JSON.stringify(hashes), BigInt(matchedStep), user.id);
      // Revoke sessions created before 2FA was enabled so an old admin cookie cannot bypass the new login check.
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.create({ data: { actorUserId: user.id, action: 'ADMIN_2FA_ENABLED', entity: 'User', entityId: user.id } }).catch(() => {});
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, recoveryCodes });
    } catch (e) { next(e); }
  });
  originalPost.call(app, '/api/admin/two-factor/disable', async (req, res, next) => {
    try {
      const user = await requireAdmin(req, res); if (!user) return;
      const current = await prisma.user.findUnique({ where: { id: user.id } });
      if (!current?.passwordHash || !verifyPassword(String(req.body?.password || ''), current.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
      await ensureAdminTwoFactorTables();
      const rows = await prisma.$queryRawUnsafe('SELECT "secretEnc","recoveryHashes","enabled" FROM "AdminTwoFactor" WHERE "userId"=$1 LIMIT 1', user.id);
      if (!rows?.[0]?.enabled) return res.status(400).json({ error: '2FA is not enabled for your account.' });
      const secret = decrypt(rows[0].secretEnc);
      const code = String(req.body?.code || '').trim();
      let valid = verifyAdminTotp(secret, code), usedHash = null;
      const hashes = recoveryList(rows[0].recoveryHashes);
      if (!valid) { const h = recoveryHash(code); if (hashes.includes(h)) { valid = true; usedHash = h; } }
      if (!valid) return res.status(401).json({ error: 'Authenticator or recovery code is incorrect.' });
      await prisma.$executeRawUnsafe('DELETE FROM "AdminTwoFactor" WHERE "userId"=$1', user.id);
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.create({ data: { actorUserId: user.id, action: 'ADMIN_2FA_DISABLED', entity: 'User', entityId: user.id } }).catch(() => {});
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
}
express.application.get = function(path, ...handlers) { install(this); return originalGet.call(this, path, ...handlers); };
express.application.post = function(path, ...handlers) { install(this); return originalPost.call(this, path, ...handlers); };

// Export deterministic primitives for RFC 6238 regression tests.
export { base32Encode, base32Decode, totp };
