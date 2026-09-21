import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalPost=express.application.post;
let installed=false;

function dayStart(){
  const d=new Date();
  d.setHours(0,0,0,0);
  return d;
}

async function sessionUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},select:{user:true,expiresAt:true}}).catch(()=>null);
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}

async function canAccess(req,businessId){
  const u=await sessionUser(req);
  if(!u)return {status:401,error:'Authentication required'};
  const b=await prisma.business.findFirst({
    where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(u.role)?{}:{members:{some:{userId:u.id}}})},
    select:{id:true}
  });
  return b?{user:u}:{status:403,error:'Business access denied'};
}

async function closedToday(businessId){
  return prisma.auditLog.findFirst({
    where:{action:'BILLING_DAY_CLOSED',entity:'Business',entityId:String(businessId),createdAt:{gte:dayStart()}},
    orderBy:{createdAt:'desc'}
  }).catch(()=>null);
}

function guard(handler){
  return async(req,res,next)=>{
    try{
      const a=await canAccess(req,req.params.businessId);
      if(a.error)return res.status(a.status).json({error:a.error});
      const closed=await closedToday(req.params.businessId);
      if(closed)return res.status(409).json({error:'Today is already closed. New billing is not allowed.',closedAt:closed.createdAt});
      return handler(req,res,next);
    }catch(e){next(e)}
  };
}

function closeOnce(handler){
  return async(req,res,next)=>{
    try{
      const a=await canAccess(req,req.params.businessId);
      if(a.error)return res.status(a.status).json({error:a.error});
      const closed=await closedToday(req.params.businessId);
      if(closed){
        const orders=await prisma.order.findMany({where:{businessId:String(req.params.businessId),createdAt:{gte:dayStart()},paymentStatus:'PAID'},select:{total:true}});
        const revenue=orders.reduce((s,o)=>s+Number(o.total||0),0);
        return res.json({ok:true,alreadyClosed:true,closedAt:closed.createdAt,paidBills:orders.length,revenue:Number(revenue.toFixed(2))});
      }
      return handler(req,res,next);
    }catch(e){next(e)}
  };
}

function install(){
  if(installed)return;
  installed=true;
  express.application.post=function(path,...handlers){
    if(path==='/api/businesses/:businessId/billing/bills'){
      handlers=[guard(handlers[0]),...handlers.slice(1)];
    }else if(path==='/api/businesses/:businessId/billing/settle/:orderId'){
      handlers=[guard(handlers[0]),...handlers.slice(1)];
    }else if(path==='/api/businesses/:businessId/billing/close-day'){
      handlers=[closeOnce(handlers[0]),...handlers.slice(1)];
    }
    return originalPost.call(this,path,...handlers);
  };
}

install();
