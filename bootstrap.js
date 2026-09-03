import 'dotenv/config';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, randomToken, tokenHash, setSessionCookie, getCookie, encrypt } from './auth.js';
import { googleAuthUrl, exchangeCode, googleUser, oauthState } from './google.js';
import { createTenantGuard } from './tenantAuth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPut = express.application.put;
const originalPatch = express.application.patch;

function slugify(value){return String(value||'business').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'business';}
async function ensureBusiness(user){
  const existing=await prisma.businessMember.findFirst({where:{userId:user.id},include:{business:true}});
  if(existing) return existing.business;
  const base=slugify(user.name); const slug=`${base}-${randomToken().slice(0,8)}`;
  return prisma.business.create({data:{name:`${user.name}'s Business`,type:'OTHER',slug,members:{create:{userId:user.id,role:'OWNER'}}}});
}
async function startSession(user){
  const token=randomToken();
  await prisma.session.create({data:{tokenHash:tokenHash(token),userId:user.id,expiresAt:new Date(Date.now()+14*864e5)}});
  return token;
}
function sessionCookie(token){const parts=[`rp_session=${token}`,`Max-Age=${14*86400}`,'Path=/','HttpOnly','SameSite=Lax'];if(process.env.NODE_ENV==='production')parts.push('Secure');return parts.join('; ');}
function clearOAuthCookie(){return `rp_oauth_state=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`;}
async function sessionUser(req){
  const token=getCookie(req,'rp_session'); if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date()){if(s)await prisma.session.delete({where:{id:s.id}}).catch(()=>{});return null;}
  return s.user;
}
const tenantGuard=createTenantGuard({prisma,sessionUser});
const guardHandlers=(handlers)=>[tenantGuard,...handlers];

express.application.get=function(path,...handlers){
  if(path==='/api/auth/config-status') return originalGet.call(this,path,async(_req,res)=>{
    res.json({ok:true,google:{clientIdConfigured:Boolean(String(process.env.GOOGLE_CLIENT_ID||'').trim()),clientSecretConfigured:Boolean(String(process.env.GOOGLE_CLIENT_SECRET||'').trim()),redirectUriConfigured:Boolean(String(process.env.GOOGLE_REDIRECT_URI||'').trim()),redirectUri:String(process.env.GOOGLE_REDIRECT_URI||'').trim()||null},databaseConfigured:Boolean(String(process.env.DATABASE_URL||'').trim()),sessionSecretConfigured:Boolean(String(process.env.SESSION_SECRET||'').trim()),nodeEnv:process.env.NODE_ENV||'development'});
  });
  if(path==='/auth/google') return originalGet.call(this,path,async(_req,res,next)=>{try{
    const state=oauthState();
    res.setHeader('Set-Cookie',`rp_oauth_state=${encodeURIComponent(state)}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);
    res.redirect(googleAuthUrl(state));
  }catch(e){next(e)}});
  if(path==='/auth/google/callback') return originalGet.call(this,path,async(req,res,next)=>{try{
    const state=String(req.query.state||''); const cookieState=getCookie(req,'rp_oauth_state');
    if(!state||!cookieState||state!==cookieState)return res.status(400).send('Invalid or expired Google OAuth state.');
    if(!req.query.code)return res.status(400).send('Google authorization code is missing.');
    const token=await exchangeCode(String(req.query.code)); const profile=await googleUser(token.access_token);
    const email=String(profile.email||'').toLowerCase(); if(!email)return res.status(400).send('Google account email was not provided.');
    let user=await prisma.user.findUnique({where:{email}});
    if(!user) user=await prisma.user.create({data:{name:profile.name||email.split('@')[0],email,passwordHash:null,role:'OWNER'}});
    const business=await ensureBusiness(user);
    await prisma.googleConnection.create({data:{userId:user.id,businessId:business.id,accessTokenEnc:encrypt(token.access_token),refreshTokenEnc:token.refresh_token?encrypt(token.refresh_token):undefined,expiresAt:token.expires_in?new Date(Date.now()+token.expires_in*1000):undefined,scope:token.scope}});
    const sessionToken=await startSession(user); res.setHeader('Set-Cookie',[sessionCookie(sessionToken),clearOAuthCookie()]); res.redirect('/?google=connected');
  }catch(e){next(e)}});
  return originalGet.call(this,path,...guardHandlers(handlers));
};

express.application.post=function(path,...handlers){
  if(path==='/api/auth/signup') return originalPost.call(this,path,async(req,res,next)=>{try{
    const schema=z.object({name:z.string().trim().min(2,'Name must be at least 2 characters').max(80),email:z.string().trim().email('Enter a valid email address'),password:z.string().min(8,'Password must be at least 8 characters').max(200)});
    const p=schema.safeParse(req.body);
    if(!p.success){const first=p.error.issues[0];return res.status(400).json({error:first?.message||'Invalid signup details',fields:p.error.flatten().fieldErrors});}
    const email=p.data.email.toLowerCase();
    if(await prisma.user.findUnique({where:{email}}))return res.status(409).json({error:'Email already registered'});
    const user=await prisma.user.create({data:{name:p.data.name,email,passwordHash:hashPassword(p.data.password),role:'OWNER'}});
    await ensureBusiness(user); const sessionToken=await startSession(user); setSessionCookie(res,sessionToken);
    res.status(201).json({user:{id:user.id,name:user.name,email:user.email,role:user.role}});
  }catch(e){next(e)}});
  return originalPost.call(this,path,...guardHandlers(handlers));
};

express.application.put=function(path,...handlers){return originalPut.call(this,path,...guardHandlers(handlers));};
express.application.patch=function(path,...handlers){return originalPatch.call(this,path,...guardHandlers(handlers));};

await import('./server.js');
