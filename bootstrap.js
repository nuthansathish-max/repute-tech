import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, randomToken, tokenHash, setSessionCookie, getCookie, encrypt } from './auth.js';
import { googleAuthUrl, exchangeCode, googleUser, oauthState } from './google.js';
import { createTenantGuard } from './tenantAuth.js';
import { analyzeReview, generateReply } from './ai.js';
import { syncLocationReviews, mockSyncLocationReviews } from './reviewPipeline.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPut = express.application.put;
const originalPatch = express.application.patch;
const originalUse = express.application.use;

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

// Inject the feature enhancement bundle into the existing UI without replacing the original design.
express.application.use=function(...args){
  if(!this.__reputeEnhancementMiddleware){
    this.__reputeEnhancementMiddleware=true;
    originalUse.call(this,async(req,res,next)=>{
      const originalSendFile=res.sendFile?.bind(res);
      if(originalSendFile){
        res.sendFile=async(file,...rest)=>{
          try{
            if(String(file).endsWith('index.html')){
              const html=await fs.readFile(file,'utf8');
              const enhanced=html.replace('</body>','<script src="/app-enhancements.js"></script></body>');
              res.type('html').send(enhanced);
              return;
            }
          }catch(e){return next(e)}
          return originalSendFile(file,...rest);
        };
      }
      next();
    });
  }
  return originalUse.call(this,...args);
};

express.application.get=function(path,...handlers){
  // Express itself calls app.get('setting') with no route handlers when res.json/res.send reads application settings.
  if(handlers.length===0) return originalGet.call(this,path);
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

  if(path==='/api/businesses/:businessId/campaigns') return originalGet.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const business=await prisma.business.findFirst({where:{id:req.params.businessId,...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
    if(!business)return res.status(403).json({error:'Business access denied'});
    res.json(await prisma.campaign.findMany({where:{businessId:business.id},orderBy:{scheduledAt:'desc'}}));
  }catch(e){next(e)}});

  if(path==='/qr/:slug') return originalGet.call(this,path,async(req,res)=>res.redirect(`/public/qr/${encodeURIComponent(req.params.slug)}`));
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

  if(path==='/api/reviews/ai-reply') return originalPost.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const text=String(req.body?.text||'').trim(); if(!text)return res.status(400).json({error:'Review text is required'});
    const tone=String(req.body?.tone||'WARM').toUpperCase();
    const review={authorName:String(req.body?.authorName||'there').trim().slice(0,80)||'there',rating:Number(req.body?.rating||3),text};
    const analysis=analyzeReview(review);
    const reply=generateReply(review,{tone,businessName:String(req.body?.businessName||'your business').trim().slice(0,120)||'your business'});
    return res.json({provider:'local',sentiment:analysis.sentiment,topics:analysis.topics,confidence:analysis.confidence,reply});
  }catch(e){next(e)}});

  if(path==='/api/businesses/:businessId/qr') return originalPost.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const businessId=String(req.params.businessId); const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId}}});
    if(!member && !['ADMIN','SUPER_ADMIN'].includes(user.role))return res.status(403).json({error:'Business access denied'});
    const p=z.object({name:z.string().trim().min(1).max(100),slug:z.string().trim().min(2).max(100).regex(/^[a-z0-9-]+$/i,'Slug may contain only letters, numbers and hyphens')}).safeParse(req.body);
    if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||'Invalid QR details'});
    const existing=await prisma.smartQr.findFirst({where:{businessId,slug:p.data.slug}}); if(existing)return res.status(409).json({error:'That QR slug already exists'});
    const origin=`${req.protocol}://${req.get('host')}`;
    const destination={type:'review-hub',url:`${origin}/qr/${encodeURIComponent(p.data.slug)}`};
    const qr=await prisma.smartQr.create({data:{businessId,name:p.data.name,slug:p.data.slug,destination}});
    return res.status(201).json({...qr,qrUrl:destination.url,qrImageUrl:`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(destination.url)}`});
  }catch(e){next(e)}});

  if(path==='/api/businesses/:businessId/menus') return originalPost.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const businessId=String(req.params.businessId);
    const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId}}});
    if(!member && !['ADMIN','SUPER_ADMIN'].includes(user.role))return res.status(403).json({error:'Business access denied'});
    const p=z.object({name:z.string().trim().min(1).max(120),published:z.boolean().optional(),isPublished:z.boolean().optional()}).safeParse(req.body);
    if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||'Invalid menu details'});
    const menu=await prisma.menu.create({data:{businessId,name:p.data.name,isPublished:p.data.isPublished??p.data.published??false}});
    return res.status(201).json(menu);
  }catch(e){next(e)}});

  if(path==='/api/businesses/:businessId/campaigns') return originalPost.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const businessId=String(req.params.businessId);
    const business=await prisma.business.findFirst({where:{id:businessId,...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
    if(!business)return res.status(403).json({error:'Business access denied'});
    const p=z.object({name:z.string().trim().min(1).max(120),message:z.string().trim().min(1).max(4000),scheduledAt:z.string().datetime().optional()}).safeParse(req.body);
    if(!p.success)return res.status(400).json({error:p.error.issues[0]?.message||'Invalid campaign details'});
    const campaign=await prisma.campaign.create({data:{businessId,name:p.data.name,message:p.data.message,scheduledAt:p.data.scheduledAt?new Date(p.data.scheduledAt):undefined}});
    return res.status(201).json(campaign);
  }catch(e){next(e)}});

  if(path==='/api/businesses/:businessId/reviews/sync') return originalPost.call(this,path,async(req,res,next)=>{try{
    const user=await sessionUser(req); if(!user)return res.status(401).json({error:'Authentication required'});
    const business=await prisma.business.findFirst({where:{id:req.params.businessId,...(['SUPER_ADMIN','ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})},include:{locations:true}});
    if(!business)return res.status(404).json({error:'Business not found'});
    const locationId=req.body?.locationId||business.locations[0]?.id;
    if(!locationId)return res.status(400).json({error:'No location found'});
    const location=business.locations.find(l=>l.id===locationId); if(!location)return res.status(404).json({error:'Location not found'});
    let result;
    if(process.env.MOCK_GOOGLE_REVIEWS==='true') result=await mockSyncLocationReviews({prisma,businessId:business.id,location});
    else {
      const connection=await prisma.googleConnection.findFirst({where:{userId:user.id,businessId:business.id},orderBy:{createdAt:'desc'}})||await prisma.googleConnection.findFirst({where:{userId:user.id},orderBy:{createdAt:'desc'}});
      if(!connection)return res.status(400).json({error:'Connect Google first'});
      result=await syncLocationReviews({prisma,businessId:business.id,location,connection});
    }
    await prisma.auditLog.create({data:{actorUserId:user.id,action:'SYNC_GOOGLE_REVIEWS',entity:'Location',entityId:location.id,metadata:result}});
    return res.json({ok:true,location,result});
  }catch(e){next(e)}});

  // WhatsApp endpoints used by the enhanced dashboard UI.
  if(path==='/api/whatsapp/campaigns/preview' || path==='/api/whatsapp/campaigns/send' || path==='/api/whatsapp/connection') return originalPost.call(this,path,...handlers);

  // Admin-compatible plan request listing used by the dashboard.
  if(path==='/api/admin/plan-requests') return originalPost.call(this,path,...handlers);
  return originalPost.call(this,path,...guardHandlers(handlers));
};

express.application.put=function(path,...handlers){return originalPut.call(this,path,...guardHandlers(handlers));};
express.application.patch=function(path,...handlers){return originalPatch.call(this,path,...guardHandlers(handlers));};

await import('./server.js');
