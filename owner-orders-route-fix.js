import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';
import { aiReviewAnalysis } from './aiProvider.js';

const prisma = new PrismaClient();
const originalListen = express.application.listen;
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPatch = express.application.patch;
let registered = false;

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date())return null;
  return s.user;
}

async function businessAccess(req,businessId){
  const user=await userFrom(req);
  if(!user)return {error:'Authentication required',status:401};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
  if(!business)return {error:'Business access denied',status:403};
  return {user,business};
}

function register(app){
  if(registered)return;
  registered=true;

  originalGet.call(app,'/api/businesses/:businessId/orders',async(req,res,next)=>{
    try{
      const a=await businessAccess(req,req.params.businessId);
      if(a.error)return res.status(a.status).json({error:a.error});
      const status=String(req.query.status||'');
      const where={businessId:a.business.id,...(status?{status}:{})};
      const orders=await prisma.order.findMany({
        where,
        include:{items:true,menu:{select:{id:true,name:true}},customer:{select:{id:true,name:true,phone:true}}},
        orderBy:{createdAt:'desc'},
        take:100
      });
      return res.json(orders);
    }catch(e){next(e)}
  });

  // Standalone AI Assistant endpoint used by the AI Assistant page.
  // Keep this separate from review-record routes so pasted review text can
  // generate a suggestion without creating or modifying a database review.
  originalPost.call(app,'/api/reviews/ai-reply',async(req,res,next)=>{
    try{
      const user=await userFrom(req);
      if(!user)return res.status(401).json({error:'Authentication required'});
      const text=String(req.body?.text||'').trim();
      if(!text)return res.status(400).json({error:'Review text is required'});
      const ratingRaw=Number(req.body?.rating||3);
      const rating=Number.isInteger(ratingRaw)?Math.min(5,Math.max(1,ratingRaw)):3;
      const businessName=String(req.body?.businessName||'your business').trim().slice(0,120)||'your business';
      const review={authorName:String(req.body?.authorName||'Customer').trim().slice(0,80)||'Customer',rating,text};
      const result=await aiReviewAnalysis(review,businessName,String(req.body?.tone||'WARM'));
      return res.json({provider:result.provider||'local',sentiment:result.sentiment,topics:result.topics,confidence:result.confidence,reply:result.reply});
    }catch(e){next(e)}
  });

  originalPatch.call(app,'/api/orders/:id/status',async(req,res,next)=>{
    try{
      const order=await prisma.order.findUnique({where:{id:req.params.id}});
      if(!order)return res.status(404).json({error:'Order not found'});
      const a=await businessAccess(req,order.businessId);
      if(a.error)return res.status(a.status).json({error:a.error});
      const status=String(req.body?.status||'');
      if(!['PENDING','ACCEPTED','CANCELLED'].includes(status))return res.status(400).json({error:'Invalid order status. Use PENDING, ACCEPTED or CANCELLED.'});
      if(status==='ACCEPTED'&&order.status==='CANCELLED')return res.status(400).json({error:'Cancelled orders cannot be accepted'});
      if(status==='CANCELLED'&&order.status==='ACCEPTED')return res.status(400).json({error:'Accepted orders cannot be cancelled'});
      const updated=await prisma.order.update({where:{id:order.id},data:{status},include:{items:true}});
      return res.json({ok:true,order:updated});
    }catch(e){next(e)}
  });
}

express.application.listen=function ownerOrdersRouteListen(...args){
  register(this);
  return originalListen.apply(this,args);
};
