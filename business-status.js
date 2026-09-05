import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalListen = express.application.listen;
let registered = false;

async function currentUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const session=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt<new Date())return null;
  return session.user;
}

async function currentBusiness(req){
  const user=await currentUser(req);
  if(!user)return {user:null,business:null,status:401,error:'Authentication required'};
  const business=await prisma.business.findFirst({
    where:['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}},
    orderBy:{createdAt:'asc'}
  });
  if(!business)return {user,business:null,status:404,error:'No business found'};
  return {user,business,status:200};
}

async function access(req,businessId){
  const user=await currentUser(req);
  if(!user)return {user:null,business:null,status:401,error:'Authentication required'};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
  if(!business)return {user,business:null,status:403,error:'Business access denied'};
  return {user,business,status:200};
}

express.application.listen=function(...args){
  if(!registered){
    registered=true;
    this.get('/api/business/status',async(req,res,next)=>{
      try{
        const a=await currentBusiness(req);
        if(!a.business)return res.status(a.status).json({error:a.error});
        res.json({businessId:a.business.id,name:a.business.name,isOpen:Boolean(a.business.isOpen)});
      }catch(e){next(e)}
    });
    this.patch('/api/business/status',async(req,res,next)=>{
      try{
        const a=await currentBusiness(req);
        if(!a.business)return res.status(a.status).json({error:a.error});
        const isOpen=req.body?.isOpen;
        if(typeof isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});
        const updated=await prisma.business.update({where:{id:a.business.id},data:{isOpen}});
        await prisma.auditLog.create({data:{actorUserId:a.user.id,action:isOpen?'BUSINESS_OPENED':'BUSINESS_CLOSED',entity:'Business',entityId:updated.id,metadata:{isOpen}}}).catch(()=>{});
        res.json({ok:true,businessId:updated.id,name:updated.name,isOpen:Boolean(updated.isOpen)});
      }catch(e){next(e)}
    });
    this.get('/api/businesses/:businessId/status',async(req,res,next)=>{
      try{
        const a=await access(req,req.params.businessId);
        if(!a.business)return res.status(a.status).json({error:a.error});
        res.json({businessId:a.business.id,isOpen:Boolean(a.business.isOpen)});
      }catch(e){next(e)}
    });
    this.patch('/api/businesses/:businessId/status',async(req,res,next)=>{
      try{
        const a=await access(req,req.params.businessId);
        if(!a.business)return res.status(a.status).json({error:a.error});
        const isOpen=req.body?.isOpen;
        if(typeof isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});
        const updated=await prisma.business.update({where:{id:a.business.id},data:{isOpen}});
        await prisma.auditLog.create({data:{actorUserId:a.user.id,action:isOpen?'BUSINESS_OPENED':'BUSINESS_CLOSED',entity:'Business',entityId:updated.id,metadata:{isOpen}}}).catch(()=>{});
        res.json({ok:true,businessId:updated.id,isOpen:Boolean(updated.isOpen)});
      }catch(e){next(e)}
    });
  }
  return originalListen.apply(this,args);
};
