import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword, randomToken, tokenHash, setSessionCookie, clearSessionCookie, getCookie, encrypt } from './auth.js';
import { googleAuthUrl, exchangeCode, googleUser, googleAccounts, googleLocations, oauthState } from './google.js';
import { syncLocationReviews, mockSyncLocationReviews, analyzeAndDraft, publishGoogleReply } from './reviewPipeline.js';
import { startReviewSyncScheduler } from './scheduler.js';
import { aiReviewAnalysis } from './aiProvider.js';
import { whatsappConfigured, verifyMetaWebhook, verifyMetaSignature, sendText, sendTemplate } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const app = express();
import customerJourneyRouter from './customerJourney.js';
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:process.env.FRONTEND_ORIGIN||true,credentials:true}));
// Meta WhatsApp webhook: verification uses GET, event delivery uses POST with raw-body signature validation.
app.get('/api/whatsapp/webhook',(req,res)=>{
  const challenge=verifyMetaWebhook(req.query['hub.mode'],req.query['hub.verify_token'],req.query['hub.challenge']);
  if(challenge) return res.status(200).send(challenge);
  return res.sendStatus(403);
});
app.post('/api/whatsapp/webhook',express.raw({type:'application/json',limit:'2mb'}),async(req,res)=>{
  try{
    const signature=String(req.get('x-hub-signature-256')||'');
    if(!verifyMetaSignature(req.body,signature)) return res.sendStatus(401);
    const payload=JSON.parse(req.body.toString('utf8'));
    for(const entry of (payload.entry||[])) for(const change of (entry.changes||[])){
      const value=change.value||{};
      for(const status of (value.statuses||[])){
        const update={};
        if(status.status==='sent') update.status='SENT';
        if(status.status==='delivered') update.status='DELIVERED';
        if(status.status==='read') update.status='READ';
        if(status.status==='failed') { update.status='FAILED'; update.errorCode=String(status.errors?.[0]?.code||'UNKNOWN'); update.errorMessage=status.errors?.[0]?.title||'WhatsApp delivery failed'; }
        if(Object.keys(update).length){
          if(update.status==='DELIVERED') update.deliveredAt=new Date();
          if(update.status==='READ') update.readAt=new Date();
          await prisma.campaignMessage.updateMany({where:{providerMessageId:String(status.id)},data:update});
          const msg=await prisma.campaignMessage.findFirst({where:{providerMessageId:String(status.id)}});
          if(msg) await prisma.customerInteraction.create({data:{customerId:msg.customerId,type:`WHATSAPP_${update.status}`,channel:'WHATSAPP',metadata:{messageId:msg.id}}}).catch(()=>{});
        }
      }
    }
    res.sendStatus(200);
  }catch(e){ console.error('WhatsApp webhook error',e); res.sendStatus(400); }
});
app.use(express.json({limit:'1mb'}));
app.use(morgan('dev'));

app.get('/health', (_req,res)=>res.json({ok:true,service:'repute-tech.in-api',version:'1.9.6'}));

async function sessionUser(req){
  const token=getCookie(req,'rp_session'); if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date()){if(s)await prisma.session.delete({where:{id:s.id}}).catch(()=>{});return null;}
  return s.user;
}
async function auth(req,res,next){try{const user=await sessionUser(req);if(!user)return res.status(401).json({error:'Authentication required'});req.user=user;next();}catch(e){next(e)}}
function signedState(userId){const raw=`${userId}.${Date.now()}`;const sig=tokenHash(raw);return Buffer.from(`${raw}.${sig}`).toString('base64url')}
function verifyState(state){const raw=Buffer.from(state,'base64url').toString();const parts=raw.split('.');if(parts.length!==3)return null;const [userId,ts,sig]=parts;if(Date.now()-Number(ts)>10*60*1000)return null;if(sig!==tokenHash(`${userId}.${ts}`))return null;return userId}

const signupSchema=z.object({name:z.string().min(2).max(80),email:z.string().email(),password:z.string().min(8).max(200)});
app.post('/api/auth/signup',async(req,res,next)=>{try{const p=signupSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});const email=p.data.email.toLowerCase();const exists=await prisma.user.findUnique({where:{email}});if(exists)return res.status(409).json({error:'Email already registered'});const user=await prisma.user.create({data:{name:p.data.name,email,passwordHash:hashPassword(p.data.password)}});const token=randomToken();await prisma.session.create({data:{tokenHash:tokenHash(token),userId:user.id,expiresAt:new Date(Date.now()+14*864e5)}});setSessionCookie(res,token);res.status(201).json({user:{id:user.id,name:user.name,email:user.email,role:user.role}})}catch(e){next(e)}});
app.post('/api/auth/login',async(req,res,next)=>{try{const p=z.object({email:z.string().email(),password:z.string().min(1)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid login'});const user=await prisma.user.findUnique({where:{email:p.data.email.toLowerCase()}});if(!user?.passwordHash||!verifyPassword(p.data.password,user.passwordHash))return res.status(401).json({error:'Invalid email or password'});const token=randomToken();await prisma.session.create({data:{tokenHash:tokenHash(token),userId:user.id,expiresAt:new Date(Date.now()+14*864e5)}});setSessionCookie(res,token);res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role}})}catch(e){next(e)}});
app.post('/api/auth/logout',async(req,res,next)=>{try{const token=getCookie(req,'rp_session');if(token)await prisma.session.deleteMany({where:{tokenHash:tokenHash(token)}});clearSessionCookie(res);res.json({ok:true})}catch(e){next(e)}});
app.get('/api/auth/me',async(req,res,next)=>{try{const user=await sessionUser(req);if(!user)return res.status(401).json({error:'Not signed in'});res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role}})}catch(e){next(e)}});

app.get('/auth/google',auth,(req,res,next)=>{try{res.redirect(googleAuthUrl(signedState(req.user.id)))}catch(e){next(e)}});
app.get('/auth/google/callback',async(req,res,next)=>{try{const userId=verifyState(String(req.query.state||''));if(!userId)return res.status(400).send('Invalid or expired Google OAuth state.');const token=await exchangeCode(String(req.query.code||''));const profile=await googleUser(token.access_token);await prisma.googleConnection.create({data:{userId,accessTokenEnc:encrypt(token.access_token),refreshTokenEnc:token.refresh_token?encrypt(token.refresh_token):undefined,expiresAt:token.expires_in?new Date(Date.now()+token.expires_in*1000):undefined,scope:token.scope}});const accounts=await googleAccounts(token.access_token);const first=accounts.accounts?.[0];let locations=[];if(first)locations=(await googleLocations(token.access_token,first.name)).locations||[];res.redirect(`/settings?google=connected&accounts=${encodeURIComponent(JSON.stringify({profile,accounts:accounts.accounts||[],locations}))}`)}catch(e){next(e)}});

app.get('/api/google/status',auth,async(req,res,next)=>{try{const c=await prisma.googleConnection.findFirst({where:{userId:req.user.id},orderBy:{createdAt:'desc'}});res.json({connected:!!c,expiresAt:c?.expiresAt||null,scope:c?.scope||null})}catch(e){next(e)}});

app.get('/api/businesses',auth,async (req,res,next)=>{try{const where=req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}};res.json(await prisma.business.findMany({where,include:{locations:true,subscription:true}}));}catch(e){next(e)}});
app.get('/api/businesses/:businessId/dashboard',auth,async (req,res,next)=>{try{
 const {businessId}=req.params; const allowed=await prisma.business.findFirst({where:{id:businessId,...(req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}})}});if(!allowed)return res.status(404).json({error:'Business not found'});
 const [business,reviews,customers,qr,campaigns,totalReviews]=await Promise.all([prisma.business.findUnique({where:{id:businessId},include:{locations:true,subscription:true}}),prisma.review.findMany({where:{businessId},orderBy:{createdAt:'desc'},take:10}),prisma.customer.count({where:{businessId}}),prisma.smartQr.aggregate({where:{businessId},_sum:{scanCount:true}}),prisma.campaign.aggregate({where:{businessId},_sum:{sentCount:true,deliveredCount:true}}),prisma.review.count({where:{businessId}})]);
 const avg=reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:0;const positive=reviews.filter(r=>r.rating>=4).length;res.json({business,recentReviews:reviews,metrics:{reviewCount:totalReviews,averageRating:Number(avg.toFixed(1)),customers,qrScans:qr._sum.scanCount??0,messagesSent:campaigns._sum.sentCount??0,messagesDelivered:campaigns._sum.deliveredCount??0,positiveRate:reviews.length?Math.round(positive/reviews.length*100):0}});
}catch(e){next(e)}});

app.get('/api/businesses/:businessId/reviews',auth,async (req,res,next)=>{try{res.json(await prisma.review.findMany({where:{businessId:req.params.businessId},orderBy:{createdAt:'desc'},take:100}));}catch(e){next(e)}});
const reviewSchema=z.object({businessId:z.string(),locationId:z.string().optional(),authorName:z.string().min(1),rating:z.number().int().min(1).max(5),text:z.string().optional(),googleReviewId:z.string().optional()});
app.post('/api/reviews',auth,async(req,res,next)=>{try{const p=reviewSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.status(201).json(await prisma.review.create({data:p.data}));}catch(e){next(e)}});
app.post('/api/reviews/:id/analyze',auth,async(req,res,next)=>{try{const r=await prisma.review.findUnique({where:{id:req.params.id},include:{business:true}});if(!r)return res.status(404).json({error:'Review not found'});const result=await aiReviewAnalysis(r,r.business.name,req.body?.tone||'WARM'); const updated=await prisma.review.update({where:{id:r.id},data:{sentiment:result.sentiment,topics:result.topics,aiReply:result.reply,replyStatus:'PENDING_APPROVAL'}}); res.json({review:updated,analysis:result});}catch(e){next(e)}});
app.post('/api/reviews/:id/ai-reply',auth,async(req,res,next)=>{try{const r=await prisma.review.findUnique({where:{id:req.params.id},include:{business:true}});if(!r)return res.status(404).json({error:'Review not found'});const result=await aiReviewAnalysis(r,r.business.name,req.body?.tone||'WARM'); const updated=await prisma.review.update({where:{id:r.id},data:{sentiment:result.sentiment,topics:result.topics,aiReply:result.reply,replyStatus:'PENDING_APPROVAL'}}); res.json({review:updated,analysis:result});}catch(e){next(e)}});
app.post('/api/reviews/:id/approve',auth,async(req,res,next)=>{try{const r=await prisma.review.findUnique({where:{id:req.params.id}});if(!r)return res.status(404).json({error:'Review not found'});res.json(await prisma.review.update({where:{id:r.id},data:{replyStatus:'APPROVED'}}));}catch(e){next(e)}});
app.post('/api/reviews/:id/publish',auth,async(req,res,next)=>{try{const review=await prisma.review.findUnique({where:{id:req.params.id}});if(!review)return res.status(404).json({error:'Review not found'});if(review.replyStatus!=='APPROVED')return res.status(400).json({error:'Reply must be approved before publishing'});if(!req.body?.confirm)return res.status(400).json({error:'Owner confirmation is required before publishing to Google'});const connection=await prisma.googleConnection.findFirst({where:{userId:req.user.id},orderBy:{createdAt:'desc'}});if(!connection)return res.status(400).json({error:'Google is not connected'});const result=await publishGoogleReply({prisma,review,connection,replyText:req.body.replyText||review.aiReply});await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'PUBLISH_GOOGLE_REPLY',entity:'Review',entityId:review.id}});res.json({ok:true,result});}catch(e){next(e)}});
app.post('/api/businesses/:businessId/google/sync',auth,async(req,res,next)=>{try{const business=await prisma.business.findFirst({where:{id:req.params.businessId,...(req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}})},include:{locations:true}});if(!business)return res.status(404).json({error:'Business not found'});const locationId=req.body?.locationId||business.locations[0]?.id;if(!locationId)return res.status(400).json({error:'No location found'});const location=business.locations.find(l=>l.id===locationId);if(!location)return res.status(404).json({error:'Location not found'});let result;if(process.env.MOCK_GOOGLE_REVIEWS==='true'){result=await mockSyncLocationReviews({prisma,businessId:business.id,location});}else{const connection=await prisma.googleConnection.findFirst({where:{userId:req.user.id,businessId:business.id},orderBy:{createdAt:'desc'}})||await prisma.googleConnection.findFirst({where:{userId:req.user.id},orderBy:{createdAt:'desc'}});if(!connection)return res.status(400).json({error:'Connect Google first'});result=await syncLocationReviews({prisma,businessId:business.id,location,connection});}await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'SYNC_GOOGLE_REVIEWS',entity:'Location',entityId:location.id,metadata:result}});res.json({ok:true,location,result});}catch(e){next(e)}});
app.get('/api/businesses/:businessId/google/sync-history',auth,async(req,res,next)=>{try{res.json(await prisma.reviewSyncLog.findMany({where:{businessId:req.params.businessId},orderBy:{createdAt:'desc'},take:20}));}catch(e){next(e)}});

app.get('/api/businesses/:businessId/qr',auth,async(req,res,next)=>{try{res.json(await prisma.smartQr.findMany({where:{businessId:req.params.businessId},orderBy:{name:'asc'}}));}catch(e){next(e)}});
app.post('/api/qr',auth,async(req,res,next)=>{try{const s=z.object({businessId:z.string(),name:z.string().min(1),slug:z.string().min(2),destination:z.record(z.any())});const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.status(201).json(await prisma.smartQr.create({data:p.data}));}catch(e){next(e)}});
app.post('/api/qr/:id/scan',async(req,res,next)=>{try{res.json(await prisma.smartQr.update({where:{id:req.params.id},data:{scanCount:{increment:1}}}));}catch(e){next(e)}});
app.get('/api/businesses/:businessId/campaigns',auth,async(req,res,next)=>{try{res.json(await prisma.campaign.findMany({where:{businessId:req.params.businessId},orderBy:{scheduledAt:'desc'}}));}catch(e){next(e)}});
app.post('/api/campaigns',auth,async(req,res,next)=>{try{const s=z.object({businessId:z.string(),name:z.string().min(1),message:z.string().min(1),scheduledAt:z.string().datetime().optional()});const p=s.safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.status(201).json(await prisma.campaign.create({data:{businessId:p.data.businessId,name:p.data.name,message:p.data.message,scheduledAt:p.data.scheduledAt?new Date(p.data.scheduledAt):undefined}}));}catch(e){next(e)}});


// Google location management
app.post('/api/businesses/:businessId/google/import-locations',auth,async(req,res,next)=>{try{
 const business=await prisma.business.findFirst({where:{id:req.params.businessId,...(req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}})}}); if(!business)return res.status(404).json({error:'Business not found'});
 const connection=await prisma.googleConnection.findFirst({where:{userId:req.user.id},orderBy:{createdAt:'desc'}}); if(!connection)return res.status(400).json({error:'Connect Google first'});
 const access=await (await import('./reviewPipeline.js')).getValidGoogleAccessToken(prisma,connection);
 const accounts=await googleAccounts(access); const account=(accounts.accounts||[])[0]; if(!account)return res.status(400).json({error:'No Google Business account found'});
 const locations=(await googleLocations(access,account.name)).locations||[]; const saved=[];
 for(const g of locations){ const googleId=g.name?.split('/').pop(); if(!googleId)continue; const loc=await prisma.location.upsert({where:{id: `${business.id}-${googleId}`},create:{id:`${business.id}-${googleId}`,businessId:business.id,name:g.title||'Google location',address:g.storefrontAddress?.addressLines?.join(', ')||null,googleLocationId:googleId,googleAccountId:account.name},update:{name:g.title||'Google location',address:g.storefrontAddress?.addressLines?.join(', ')||null,googleLocationId:googleId,googleAccountId:account.name}}); saved.push(loc); }
 await prisma.googleConnection.update({where:{id:connection.id},data:{businessId:business.id,googleAccountId:account.name}});
 res.json({ok:true,account,locations:saved});
}catch(e){next(e)}});


// Smart QR public customer hub + scan analytics
app.get('/q/:slug', async (req,res,next)=>{try{const qr=await prisma.smartQr.findUnique({where:{slug:req.params.slug},include:{business:true}});if(!qr||!qr.isActive)return res.status(404).send('QR not found');await prisma.smartQr.update({where:{id:qr.id},data:{scanCount:{increment:1}}});await prisma.qrScan.create({data:{qrId:qr.id,source:String(req.query.source||'direct'),userAgent:req.get('user-agent')||null,referrer:req.get('referer')||null}});res.redirect(qr.destination?.menuUrl||qr.destination?.feedbackUrl||qr.destination?.googleReviewUrl||'/');}catch(e){next(e)}});
app.get('/api/businesses/:businessId/qr/:qrId/analytics',auth,async(req,res,next)=>{try{const qr=await prisma.smartQr.findFirst({where:{id:req.params.qrId,businessId:req.params.businessId}});if(!qr)return res.status(404).json({error:'QR not found'});const since=new Date(Date.now()-30*864e5);const scans=await prisma.qrScan.findMany({where:{qrId:qr.id,scannedAt:{gte:since}},orderBy:{scannedAt:'asc'}});const byDay={};for(const x of scans){const d=x.scannedAt.toISOString().slice(0,10);byDay[d]=(byDay[d]||0)+1}res.json({qr,periodDays:30,total:scans.length,daily:Object.entries(byDay).map(([date,count])=>({date,count}))});}catch(e){next(e)}});

// Digital menu CRUD
app.get('/api/businesses/:businessId/menus',auth,async(req,res,next)=>{try{res.json(await prisma.menu.findMany({where:{businessId:req.params.businessId},include:{items:true},orderBy:{createdAt:'desc'}}));}catch(e){next(e)}});
app.post('/api/menus',auth,async(req,res,next)=>{try{const p=z.object({businessId:z.string(),name:z.string().min(1),isPublished:z.boolean().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});const menu=await prisma.menu.create({data:p.data});res.status(201).json(menu);}catch(e){next(e)}});
app.post('/api/menus/:menuId/items',auth,async(req,res,next)=>{try{const p=z.object({name:z.string().min(1),description:z.string().optional(),price:z.coerce.number().nonnegative(),imageUrl:z.string().url().optional(),available:z.boolean().optional(),category:z.string().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.status(201).json(await prisma.menuItem.create({data:{menuId:req.params.menuId,...p.data}}));}catch(e){next(e)}});
app.patch('/api/menus/:menuId',auth,async(req,res,next)=>{try{const p=z.object({name:z.string().min(1).optional(),isPublished:z.boolean().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.json(await prisma.menu.update({where:{id:req.params.menuId},data:p.data,include:{items:true}}));}catch(e){next(e)}});
app.get('/m/:menuId',async(req,res,next)=>{try{const menu=await prisma.menu.findFirst({where:{id:req.params.menuId,isPublished:true},include:{business:true,items:{where:{available:true},orderBy:{category:'asc'}}}});if(!menu)return res.status(404).send('Menu not found');res.json({business:menu.business.name,menu:menu.name,items:menu.items});}catch(e){next(e)}});

// Customer CRM + consent-safe interactions
app.get('/api/businesses/:businessId/customers',auth,async(req,res,next)=>{try{const q=String(req.query.q||'').trim();res.json(await prisma.customer.findMany({where:{businessId:req.params.businessId,...(q?{OR:[{name:{contains:q,mode:'insensitive'}},{phone:{contains:q}},{email:{contains:q,mode:'insensitive'}}]}:{})},include:{consents:true},orderBy:{lastInteractionAt:'desc'},take:200}));}catch(e){next(e)}});
app.post('/api/customers',auth,async(req,res,next)=>{try{const p=z.object({businessId:z.string(),name:z.string().optional(),phone:z.string().optional(),email:z.string().email().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.status(201).json(await prisma.customer.create({data:p.data}));}catch(e){next(e)}});
app.post('/api/customers/:customerId/consent',auth,async(req,res,next)=>{try{const p=z.object({type:z.enum(['WHATSAPP_MARKETING','EMAIL_MARKETING']),granted:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});res.json(await prisma.consent.upsert({where:{customerId_type:{customerId:req.params.customerId,type:p.data.type}},create:{customerId:req.params.customerId,type:p.data.type,granted:p.data.granted,grantedAt:p.data.granted?new Date():null},update:{granted:p.data.granted,grantedAt:p.data.granted?new Date():undefined,revokedAt:p.data.granted?null:new Date()}}));}catch(e){next(e)}});
app.post('/api/customers/:customerId/interactions',auth,async(req,res,next)=>{try{const p=z.object({type:z.string().min(1),channel:z.string().optional(),metadata:z.record(z.any()).optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});const interaction=await prisma.customerInteraction.create({data:{customerId:req.params.customerId,...p.data}});await prisma.customer.update({where:{id:req.params.customerId},data:{lastInteractionAt:new Date()}});res.status(201).json(interaction);}catch(e){next(e)}});
// Analytics
app.get('/api/businesses/:businessId/analytics',auth,async(req,res,next)=>{try{
 const businessId=req.params.businessId; const allowed=await prisma.business.findFirst({where:{id:businessId,...(req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}})}}); if(!allowed)return res.status(404).json({error:'Business not found'});
 const days=Math.min(365,Math.max(7,Number(req.query.days||30))); const since=new Date(Date.now()-days*864e5);
 const reviews=await prisma.review.findMany({where:{businessId,createdAt:{gte:since}},select:{rating:true,sentiment:true,topics:true,createdAt:true}});
 const byDay={}; for(let i=days-1;i>=0;i--){const d=new Date(Date.now()-i*864e5).toISOString().slice(0,10);byDay[d]={date:d,reviews:0,ratingTotal:0};}
 for(const r of reviews){const d=r.createdAt.toISOString().slice(0,10);if(byDay[d]){byDay[d].reviews++;byDay[d].ratingTotal+=r.rating;}}
 const topicCounts={}; for(const r of reviews)for(const t of r.topics||[])topicCounts[t]=(topicCounts[t]||0)+1;
 const sentiments={positive:0,neutral:0,negative:0}; for(const r of reviews)if(r.sentiment)sentiments[r.sentiment.toLowerCase()]++;
 res.json({periodDays:days,totalReviews:reviews.length,averageRating:reviews.length?Number((reviews.reduce((a,r)=>a+r.rating,0)/reviews.length).toFixed(2)):0,sentiments,topTopics:Object.entries(topicCounts).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([topic,count])=>({topic,count})),daily:Object.values(byDay).map(x=>({...x,averageRating:x.reviews?Number((x.ratingTotal/x.reviews).toFixed(2)):0}))});
}catch(e){next(e)}});

// Notifications
app.get('/api/notifications',auth,async(req,res,next)=>{try{res.json(await prisma.notification.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:50}));}catch(e){next(e)}});
app.post('/api/notifications/:id/read',auth,async(req,res,next)=>{try{const n=await prisma.notification.findFirst({where:{id:req.params.id,userId:req.user.id}});if(!n)return res.status(404).json({error:'Notification not found'});res.json(await prisma.notification.update({where:{id:n.id},data:{readAt:new Date()}}));}catch(e){next(e)}});

// Admin monitoring
app.get('/api/admin/overview',auth,async(req,res,next)=>{try{if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role))return res.status(403).json({error:'Admin access required'});const [businesses,users,reviews,customers,campaigns,syncs]=await Promise.all([prisma.business.count(),prisma.user.count(),prisma.review.count(),prisma.customer.count(),prisma.campaign.count(),prisma.reviewSyncLog.findMany({orderBy:{createdAt:'desc'},take:10,include:{}})]);res.json({businesses,users,reviews,customers,campaigns,recentSyncs:syncs});}catch(e){next(e)}});
app.post('/api/admin/sync-now',auth,async(req,res,next)=>{try{if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role))return res.status(403).json({error:'Admin access required'});const result=await scheduler.runNow();res.json({ok:true,result});}catch(e){next(e)}});

// v1.4 business management, AI settings, entitlements and public customer hub
const businessAccess = async (req, businessId) => prisma.business.findFirst({
  where: { id: businessId, ...(req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN' ? {} : { members: { some: { userId: req.user.id } } }) }
});

app.get('/api/me/businesses', auth, async (req,res,next)=>{try{
  const businesses = await prisma.business.findMany({where:req.user.role==='SUPER_ADMIN'||req.user.role==='ADMIN'?{}:{members:{some:{userId:req.user.id}}},include:{locations:true,subscription:true},orderBy:{name:'asc'}});
  res.json(businesses);
}catch(e){next(e)}});

app.get('/api/business/:businessId/members', auth, async (req,res,next)=>{try{
  const b=await businessAccess(req,req.params.businessId); if(!b)return res.status(404).json({error:'Business not found'});
  const members=await prisma.businessMember.findMany({where:{businessId:b.id},include:{user:{select:{id:true,name:true,email:true,role:true,createdAt:true}}}}); res.json(members);
}catch(e){next(e)}});

app.post('/api/business/:businessId/members', auth, async (req,res,next)=>{try{
  if(!['ADMIN','SUPER_ADMIN','OWNER','MANAGER'].includes(req.user.role))return res.status(403).json({error:'Insufficient permission'});
  const b=await businessAccess(req,req.params.businessId); if(!b)return res.status(404).json({error:'Business not found'});
  const p=z.object({email:z.string().email(),name:z.string().min(1).max(80),role:z.enum(['MANAGER','STAFF'])}).safeParse(req.body); if(!p.success)return res.status(400).json({error:p.error.flatten()});
  let u=await prisma.user.findUnique({where:{email:p.data.email}}); if(!u) u=await prisma.user.create({data:{email:p.data.email,name:p.data.name,role:p.data.role}});
  const m=await prisma.businessMember.upsert({where:{userId_businessId:{userId:u.id,businessId:b.id}},create:{userId:u.id,businessId:b.id,role:p.data.role},update:{role:p.data.role}});
  await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'UPSERT_BUSINESS_MEMBER',entity:'BusinessMember',entityId:m.id,metadata:{businessId:b.id,userId:u.id,role:p.data.role}}});
  res.status(201).json(m);
}catch(e){next(e)}});

app.get('/api/business/:businessId/ai-settings', auth, async (req,res,next)=>{try{
  const b=await businessAccess(req,req.params.businessId); if(!b)return res.status(404).json({error:'Business not found'});
  res.json({tone:b.aiTone,language:b.aiLanguage,instructions:b.aiInstructions||'',autoDraft:b.aiAutoDraft,requireApproval:b.aiRequireApproval});
}catch(e){next(e)}});
app.put('/api/business/:businessId/ai-settings', auth, async (req,res,next)=>{try{
  const b=await businessAccess(req,req.params.businessId); if(!b)return res.status(404).json({error:'Business not found'});
  const p=z.object({tone:z.string().min(2).max(60),language:z.string().min(2).max(40),instructions:z.string().max(2000),autoDraft:z.boolean(),requireApproval:z.boolean()}).safeParse(req.body); if(!p.success)return res.status(400).json({error:p.error.flatten()});
  const updated=await prisma.business.update({where:{id:b.id},data:{aiTone:p.data.tone,aiLanguage:p.data.language,aiInstructions:p.data.instructions,aiAutoDraft:p.data.autoDraft,aiRequireApproval:p.data.requireApproval}});
  await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'UPDATE_AI_SETTINGS',entity:'Business',entityId:b.id,metadata:p.data}});
  res.json({tone:updated.aiTone,language:updated.aiLanguage,instructions:updated.aiInstructions||'',autoDraft:updated.aiAutoDraft,requireApproval:updated.aiRequireApproval});
}catch(e){next(e)}});

const planFeatures = {
  STARTER:['Reviews','AI reply drafts','Smart QR'],
  GROWTH:['Reviews','AI replies','Smart QR','Digital Menu','Customer CRM'],
  PRO:['Reviews','AI replies','Smart QR','Digital Menu','Customer CRM','WhatsApp campaigns','Analytics'],
  HIGH_TRAFFIC:['Reviews','AI replies','Smart QR','Digital Menu','Customer CRM','WhatsApp campaigns','Analytics','Multi-location'],
  ALL_IN_ONE_YEARLY:['Reviews','AI replies','Smart QR','Digital Menu','Customer CRM','WhatsApp campaigns','Analytics','Multi-location','Priority support']
};
function hasFeature(sub, feature){ return !!sub && !!(planFeatures[sub.plan]||[]).includes(feature); }
app.get('/api/business/:businessId/entitlements',auth,async(req,res,next)=>{try{
  const b=await businessAccess(req,req.params.businessId); if(!b)return res.status(404).json({error:'Business not found'}); const sub=await prisma.subscription.findUnique({where:{businessId:b.id}});
  res.json({plan:sub?.plan||null,status:sub?.status||'NONE',features:Object.fromEntries([...new Set(Object.values(planFeatures).flat())].map(f=>[f,hasFeature(sub,f)]))});
}catch(e){next(e)}});

app.get('/api/notifications',auth,async(req,res,next)=>{try{const rows=await prisma.notification.findMany({where:{userId:req.user.id},orderBy:{createdAt:'desc'},take:50});res.json(rows);}catch(e){next(e)}});
app.post('/api/notifications/:id/read',auth,async(req,res,next)=>{try{const row=await prisma.notification.updateMany({where:{id:req.params.id,userId:req.user.id},data:{readAt:new Date()}});res.json({ok:row.count===1});}catch(e){next(e)}});

// Public customer hub: intentionally contains no authenticated business data.
app.get('/public/qr/:slug',async(req,res,next)=>{try{
  const qr=await prisma.smartQr.findUnique({where:{slug:req.params.slug},include:{business:{include:{menus:{where:{isPublished:true},include:{items:true}}}}}}); if(!qr||!qr.isActive)return res.status(404).json({error:'QR not found'});
  await prisma.$transaction([prisma.qrScan.create({data:{qrId:qr.id,source:String(req.query.source||'direct'),userAgent:req.get('user-agent')||null,referrer:req.get('referer')||null}}),prisma.smartQr.update({where:{id:qr.id},data:{scanCount:{increment:1}}})]);
  res.json({business:{id:qr.business.id,name:qr.business.name,type:qr.business.type,logoUrl:qr.business.logoUrl,phone:qr.business.phone,website:qr.business.website},destination:qr.destination,menus:qr.business.menus});
}catch(e){next(e)}});

app.get('/public/menu/:menuId',async(req,res,next)=>{try{const menu=await prisma.menu.findFirst({where:{id:req.params.menuId,isPublished:true},include:{business:{select:{id:true,name:true,logoUrl:true,phone:true}},items:{where:{available:true},orderBy:{category:'asc'}}}});if(!menu)return res.status(404).json({error:'Menu not found'});res.json(menu);}catch(e){next(e)}});

// WhatsApp Business campaign foundation (consent required; provider adapter is configured by env)
app.get('/api/businesses/:businessId/whatsapp/campaigns',auth,async(req,res,next)=>{try{const rows=await prisma.campaign.findMany({where:{businessId:req.params.businessId},orderBy:{scheduledAt:'desc'}});res.json(rows);}catch(e){next(e)}});
app.post('/api/whatsapp/campaigns/preview',auth,async(req,res,next)=>{try{const p=z.object({businessId:z.string(),message:z.string().min(1),customerIds:z.array(z.string()).min(1)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});const customers=await prisma.customer.findMany({where:{id:{in:p.data.customerIds},businessId:p.data.businessId},include:{consents:true}});const eligible=customers.filter(c=>c.phone&&c.consents.some(x=>x.type==='WHATSAPP_MARKETING'&&x.granted));res.json({eligibleCount:eligible.length,excludedCount:customers.length-eligible.length,eligible:eligible.map(c=>({id:c.id,name:c.name,phone:c.phone}))});}catch(e){next(e)}});
app.post('/api/whatsapp/campaigns/send',auth,async(req,res,next)=>{try{
  const p=z.object({businessId:z.string(),name:z.string().min(1),message:z.string().min(1),customerIds:z.array(z.string()).min(1),templateName:z.string().optional(),templateLanguage:z.string().default('en_US')}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.flatten()});
  const allowed=await prisma.business.findFirst({where:{id:p.data.businessId,...(['SUPER_ADMIN','ADMIN'].includes(req.user.role)?{}:{members:{some:{userId:req.user.id}}})}});
  if(!allowed)return res.status(403).json({error:'Business access denied'});
  const customers=await prisma.customer.findMany({where:{id:{in:p.data.customerIds},businessId:p.data.businessId},include:{consents:true}});
  const eligible=customers.filter(c=>c.phone&&c.consents.some(x=>x.type==='WHATSAPP_MARKETING'&&x.granted));
  const campaign=await prisma.campaign.create({data:{businessId:p.data.businessId,name:p.data.name,message:p.data.message,status:whatsappConfigured()?'SENDING':'SIMULATED',sentCount:0,deliveredCount:0,failedCount:0}});
  let sent=0,failed=0;
  for(const c of eligible){
    const msg=await prisma.campaignMessage.create({data:{campaignId:campaign.id,customerId:c.id,toPhone:c.phone,status:'QUEUED'}});
    try{
      const result=p.data.templateName
        ? await sendTemplate(c.phone,p.data.templateName,p.data.templateLanguage)
        : await sendText(c.phone,p.data.message);
      const providerMessageId=result?.messages?.[0]?.id||null;
      await prisma.campaignMessage.update({where:{id:msg.id},data:{status:'SENT',providerMessageId,sentAt:new Date()}});
      await prisma.customerInteraction.create({data:{customerId:c.id,type:'CAMPAIGN_SENT',channel:'WHATSAPP',metadata:{campaignId:campaign.id,messageId:msg.id}}});
      sent++;
    }catch(err){
      await prisma.campaignMessage.update({where:{id:msg.id},data:{status:'FAILED',errorMessage:String(err.message||err)}});
      failed++;
    }
  }
  const updated=await prisma.campaign.update({where:{id:campaign.id},data:{status:failed&&sent?'PARTIAL':failed?'FAILED':'SENT',sentCount:sent,failedCount:failed}});
  res.status(201).json({campaign:updated,providerConfigured:whatsappConfigured(),eligibleCount:eligible.length,excludedCount:customers.length-eligible.length});
}catch(e){next(e)}});

app.get('/api/whatsapp/status/:businessId',auth,async(req,res,next)=>{try{
  const business=await prisma.business.findFirst({where:{id:req.params.businessId,...(['SUPER_ADMIN','ADMIN'].includes(req.user.role)?{}:{members:{some:{userId:req.user.id}}})},include:{whatsappConnection:true}});
  if(!business)return res.status(404).json({error:'Business not found'});
  res.json({configured:whatsappConfigured(),connection:business.whatsappConnection});
}catch(e){next(e)}});

app.post('/api/whatsapp/connection',auth,async(req,res,next)=>{try{
  const p=z.object({businessId:z.string(),phoneNumberId:z.string().optional(),wabaId:z.string().optional(),displayPhone:z.string().optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.flatten()});
  const business=await prisma.business.findFirst({where:{id:p.data.businessId,...(['SUPER_ADMIN','ADMIN'].includes(req.user.role)?{}:{members:{some:{userId:req.user.id}}})}});
  if(!business)return res.status(403).json({error:'Business access denied'});
  const connection=await prisma.whatsAppConnection.upsert({where:{businessId:business.id},create:{businessId:business.id,phoneNumberId:p.data.phoneNumberId,status:whatsappConfigured()?'CONNECTED':'CONFIG_PENDING',wabaId:p.data.wabaId,displayPhone:p.data.displayPhone,connectedAt:new Date()},update:{phoneNumberId:p.data.phoneNumberId,wabaId:p.data.wabaId,displayPhone:p.data.displayPhone,status:whatsappConfigured()?'CONNECTED':'CONFIG_PENDING',connectedAt:new Date()}});
  await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'WHATSAPP_CONNECTION_UPDATED',entity:'WhatsAppConnection',entityId:connection.id,metadata:{businessId:business.id}}});
  res.json(connection);
}catch(e){next(e)}});


// Plans and manual approval workflow. No payment provider is connected.
app.get('/api/plans',async(_req,res,next)=>{try{res.json(await prisma.planCatalog.findMany({where:{active:true},orderBy:{price:'asc'}}));}catch(e){next(e)}});
app.get('/api/admin/plans',auth,async(req,res,next)=>{try{if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role))return res.status(403).json({error:'Admin access required'});res.json(await prisma.planCatalog.findMany({orderBy:{price:'asc'}}));}catch(e){next(e)}});
app.put('/api/admin/plans/:code',auth,async(req,res,next)=>{try{if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role))return res.status(403).json({error:'Admin access required'});const p=z.object({name:z.string().min(2).max(80),price:z.number().nonnegative(),billingInterval:z.enum(['MONTH','YEAR']),description:z.string().max(500).optional(),features:z.array(z.string()).default([]),active:z.boolean().default(true)}).safeParse(req.body);if(!p.success)return res.status(400).json({error:p.error.flatten()});const existing=await prisma.planCatalog.findUnique({where:{code:req.params.code}});if(!existing)return res.status(404).json({error:'Plan not found'});const updated=await prisma.planCatalog.update({where:{code:req.params.code},data:p.data});await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'UPDATE_PLAN',entity:'PlanCatalog',entityId:updated.id,metadata:p.data}});res.json(updated);}catch(e){next(e)}});

app.post('/api/plan-requests',auth,async(req,res,next)=>{try{
  const p=z.object({businessId:z.string(),planCode:z.string(),ownerName:z.string().min(2).max(100),contact:z.string().min(3).max(120)}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:p.error.flatten()});
  const business=await businessAccess(req,p.data.businessId); if(!business)return res.status(403).json({error:'Business access denied'});
  const plan=await prisma.planCatalog.findUnique({where:{code:p.data.planCode}}); if(!plan||!plan.active)return res.status(400).json({error:'Plan unavailable'});
  const existing=await prisma.planRequest.findFirst({where:{businessId:business.id,status:'PENDING'}});
  if(existing)return res.status(409).json({error:'A plan request is already pending',request:existing});
  const request=await prisma.planRequest.create({data:{businessId:business.id,userId:req.user.id,planCode:plan.code,planName:plan.name,price:plan.price,billingInterval:plan.billingInterval,ownerName:p.data.ownerName,contact:p.data.contact,status:'PENDING',paymentStatus:'MANUAL'}});
  await prisma.notification.create({data:{userId:req.user.id,businessId:business.id,type:'PLAN_REQUEST_SUBMITTED',title:'Plan request submitted',message:`Your ${plan.name} request is waiting for platform approval.`}});
  res.status(201).json({ok:true,request});
}catch(e){next(e)}});

app.get('/api/plan-requests',auth,async(req,res,next)=>{try{
  const where=['ADMIN','SUPER_ADMIN'].includes(req.user.role)?{}:{userId:req.user.id};
  res.json(await prisma.planRequest.findMany({where,include:{business:{select:{id:true,name:true,slug:true}},user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:'desc'}}));
}catch(e){next(e)}});

async function requireAdmin(req,res){if(!['ADMIN','SUPER_ADMIN'].includes(req.user.role)){res.status(403).json({error:'Admin access required'});return false}return true}
app.post('/api/admin/plan-requests/:id/approve',auth,async(req,res,next)=>{try{
  if(!(await requireAdmin(req,res)))return;
  const request=await prisma.planRequest.findUnique({where:{id:req.params.id}}); if(!request)return res.status(404).json({error:'Plan request not found'});
  if(request.status!=='PENDING')return res.status(400).json({error:`Request is already ${request.status}`});
  const updated=await prisma.$transaction(async tx=>{
    const r=await tx.planRequest.update({where:{id:request.id},data:{status:'APPROVED',approvedAt:new Date(),approvedByUserId:req.user.id}});
    await tx.notification.create({data:{userId:r.userId,businessId:r.businessId,type:'PLAN_REQUEST_APPROVED',title:'Plan approved',message:`Your ${r.planName} plan has been approved and is ready to be published.`}});
    await tx.auditLog.create({data:{actorUserId:req.user.id,action:'APPROVE_PLAN_REQUEST',entity:'PlanRequest',entityId:r.id,metadata:{businessId:r.businessId,planCode:r.planCode}}});
    return r;
  });
  res.json({ok:true,request:updated});
}catch(e){next(e)}});

app.post('/api/admin/plan-requests/:id/reject',auth,async(req,res,next)=>{try{
  if(!(await requireAdmin(req,res)))return;
  const request=await prisma.planRequest.findUnique({where:{id:req.params.id}}); if(!request)return res.status(404).json({error:'Plan request not found'});
  if(request.status!=='PENDING')return res.status(400).json({error:`Request is already ${request.status}`});
  const reason=String(req.body?.reason||'').trim().slice(0,500)||null;
  const updated=await prisma.planRequest.update({where:{id:request.id},data:{status:'REJECTED',rejectedAt:new Date(),rejectionReason:reason}});
  await prisma.notification.create({data:{userId:request.userId,businessId:request.businessId,type:'PLAN_REQUEST_REJECTED',title:'Plan request rejected',message:reason?`Your ${request.planName} request was rejected: ${reason}`:`Your ${request.planName} request was rejected.`}});
  await prisma.auditLog.create({data:{actorUserId:req.user.id,action:'REJECT_PLAN_REQUEST',entity:'PlanRequest',entityId:request.id,metadata:{reason}}});
  res.json({ok:true,request:updated});
}catch(e){next(e)}});

app.post('/api/admin/plan-requests/:id/publish',auth,async(req,res,next)=>{try{
  if(!(await requireAdmin(req,res)))return;
  const request=await prisma.planRequest.findUnique({where:{id:req.params.id}}); if(!request)return res.status(404).json({error:'Plan request not found'});
  if(request.status!=='APPROVED')return res.status(400).json({error:'Only approved requests can be published'});
  const updated=await prisma.$transaction(async tx=>{
    const r=await tx.planRequest.update({where:{id:request.id},data:{status:'PUBLISHED',publishedAt:new Date(),publishedByUserId:req.user.id}});
    await tx.subscription.upsert({where:{businessId:r.businessId},create:{businessId:r.businessId,plan:r.planCode,status:'ACTIVE',monthlyPrice:r.price,billingInterval:r.billingInterval,provider:'manual'},update:{plan:r.planCode,status:'ACTIVE',monthlyPrice:r.price,billingInterval:r.billingInterval,provider:'manual',providerPlanId:null,providerSubscriptionId:null}});
    await tx.notification.create({data:{userId:r.userId,businessId:r.businessId,type:'PLAN_PUBLISHED',title:'Plan activated',message:`Your ${r.planName} plan is now active.`}});
    await tx.auditLog.create({data:{actorUserId:req.user.id,action:'PUBLISH_PLAN_REQUEST',entity:'PlanRequest',entityId:r.id,metadata:{businessId:r.businessId,planCode:r.planCode}}});
    return r;
  });
  res.json({ok:true,request:updated});
}catch(e){next(e)}});



// Customer journey routes must be registered before the final middleware and server startup.
app.use('/api/customer', customerJourneyRouter);

// Final middleware and server startup must be registered after every route.
const frontend=__dirname;
app.use(express.static(frontend));
app.get('/{*splat}',(req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(path.join(frontend,'index.html')));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:err.message||'Internal server error'})});

const scheduler=startReviewSyncScheduler({prisma});
const port=Number(process.env.PORT||4000);
const server=app.listen(port,()=>console.log(`repute-tech.in running on port ${port}`));
server.on('error',err=>console.error('Server error',err));

process.on('SIGTERM',async()=>{server.close();await prisma.$disconnect();});
process.on('SIGINT',async()=>{server.close();await prisma.$disconnect();});
