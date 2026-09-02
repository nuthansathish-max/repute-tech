import crypto from 'node:crypto';

const secret = process.env.SESSION_SECRET || 'dev-only-change-me';
export const SESSION_DAYS = 14;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'), Buffer.from(expected,'hex'));
}
export function randomToken() { return crypto.randomBytes(32).toString('hex'); }
export function tokenHash(token) { return crypto.createHmac('sha256', secret).update(token).digest('hex'); }
export function setSessionCookie(res, token, maxAgeDays=SESSION_DAYS) {
  const parts=[`rp_session=${token}`,`Max-Age=${maxAgeDays*86400}`,'Path=/','HttpOnly','SameSite=Lax'];
  if (process.env.NODE_ENV==='production') parts.push('Secure');
  res.setHeader('Set-Cookie',parts.join('; '));
}
export function clearSessionCookie(res){res.setHeader('Set-Cookie','rp_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');}
export function getCookie(req,name){const raw=req.headers.cookie||'';for(const p of raw.split(';')){const [k,...v]=p.trim().split('=');if(k===name)return decodeURIComponent(v.join('='));}return null;}
export function requireEnv(name){if(!process.env[name]) throw new Error(`${name} is not configured`);return process.env[name];}

export function encrypt(value) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decrypt(payload) {
  const [ivB64,tagB64,dataB64]=String(payload).split('.');
  const key=crypto.createHash('sha256').update(secret).digest();
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivB64,'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64,'base64url')),decipher.final()]).toString('utf8');
}
