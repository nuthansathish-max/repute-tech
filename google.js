import crypto from 'node:crypto';
import { encrypt, requireEnv } from './auth.js';

const scopes=['openid','email','profile','https://www.googleapis.com/auth/business.manage'];
function env(name){
  return requireEnv(name).trim().replace(/^['\"]|['\"]$/g,'');
}
export function googleAuthUrl(state){
  const params=new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),redirect_uri:env('GOOGLE_REDIRECT_URI'),response_type:'code',scope:scopes.join(' '),access_type:'offline',prompt:'consent',state});
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
export async function exchangeCode(code){
  const body=new URLSearchParams({code,client_id:env('GOOGLE_CLIENT_ID'),client_secret:env('GOOGLE_CLIENT_SECRET'),redirect_uri:env('GOOGLE_REDIRECT_URI'),grant_type:'authorization_code'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!r.ok)throw new Error(`Google token exchange failed: ${await r.text()}`);
  return r.json();
}
export async function googleUser(accessToken){
  const r=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${accessToken}`}});
  if(!r.ok)throw new Error(`Google userinfo failed: ${await r.text()}`);return r.json();
}
export async function googleAccounts(accessToken){
  const r=await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts',{headers:{authorization:`Bearer ${accessToken}`}});
  if(!r.ok)throw new Error(`Google accounts failed: ${await r.text()}`);return r.json();
}
export async function googleLocations(accessToken,accountName){
  const r=await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name,title,storefrontAddress,websiteUri,phoneNumbers`,{headers:{authorization:`Bearer ${accessToken}`}});
  if(!r.ok)throw new Error(`Google locations failed: ${await r.text()}`);return r.json();
}
export function oauthState(){return crypto.randomBytes(24).toString('base64url');}
export { encrypt };
