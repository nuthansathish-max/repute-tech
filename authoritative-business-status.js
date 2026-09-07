import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPatch = express.application.patch;
const originalPost = express.application.post;
const originalPut = express.application.put;
let installed = false;
let installing = false;

async function currentUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const session=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt<new Date())return null;
  return session.user;
}

async function businessFor(req,businessId=null){
  const user=await currentUser(req);
  if(!user)return {status:401,error:'Authentication required'};
  const where=businessId
    ? {id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}
    : (['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}});
  const business=await prisma.business.findFirst({where,orderBy:{createdAt:'asc'}});
  if(!business)return {status:404,error:'No business found'};
  return {user,business,status:200};
}

async function setStatus(req,res,next,businessId=null){
  try{
    const a=await businessFor(req,businessId);
    if(!a.business)return res.status(a.status).json({error:a.error});
    if(typeof req.body?.isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});
    const updated=await prisma.business.update({where:{id:a.business.id},data:{isOpen:req.body.isOpen}});
    res.json({ok:true,businessId:updated.id,businessName:updated.name,isOpen:Boolean(updated.isOpen)});
  }catch(e){next(e)}
}

function install(app){
  if(installed || installing)return;
  installing=true;
  originalGet.call(app,'/api/business/status',async(req,res,next)=>{
    try{const a=await businessFor(req);if(!a.business)return res.status(a.status).json({error:a.error});res.json({businessId:a.business.id,businessName:a.business.name,name:a.business.name,isOpen:Boolean(a.business.isOpen)});}catch(e){next(e)}
  });
  originalPatch.call(app,'/api/business/status',(req,res,next)=>setStatus(req,res,next));
  originalPost.call(app,'/api/business/status',(req,res,next)=>setStatus(req,res,next));
  originalPut.call(app,'/api/business/status',(req,res,next)=>setStatus(req,res,next));
  originalGet.call(app,'/api/businesses/:businessId/status',async(req,res,next)=>{
    try{const a=await businessFor(req,req.params.businessId);if(!a.business)return res.status(a.status).json({error:a.error});res.json({businessId:a.business.id,isOpen:Boolean(a.business.isOpen)});}catch(e){next(e)}
  });
  originalPatch.call(app,'/api/businesses/:businessId/status',(req,res,next)=>setStatus(req,res,next,req.params.businessId));
  originalPost.call(app,'/api/businesses/:businessId/status',(req,res,next)=>setStatus(req,res,next,req.params.businessId));
  originalPut.call(app,'/api/businesses/:businessId/status',(req,res,next)=>setStatus(req,res,next,req.params.businessId));
  installed=true;
  installing=false;
}

express.application.get=function(path,...handlers){
  if(handlers.length===0)return originalGet.call(this,path);
  install(this);
  return originalGet.call(this,path,...handlers);
};
express.application.patch=function(path,...handlers){install(this);return originalPatch.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
express.application.put=function(path,...handlers){install(this);return originalPut.call(this,path,...handlers)};
