import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPatch = express.application.patch;
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

function install(app){
  if(installed || installing)return;
  installing=true;
  originalGet.call(app,'/api/business/status',async(req,res,next)=>{
    try{const a=await businessFor(req);if(!a.business)return res.status(a.status).json({error:a.error});res.json({businessId:a.business.id,businessName:a.business.name,name:a.business.name,isOpen:Boolean(a.business.isOpen)});}catch(e){next(e)}
  });
  originalPatch.call(app,'/api/business/status',async(req,res,next)=>{
    try{const a=await businessFor(req);if(!a.business)return res.status(a.status).json({error:a.error});if(typeof req.body?.isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});const updated=await prisma.business.update({where:{id:a.business.id},data:{isOpen:req.body.isOpen}});res.json({ok:true,businessId:updated.id,businessName:updated.name,isOpen:Boolean(updated.isOpen)});}catch(e){next(e)}
  });
  originalGet.call(app,'/api/businesses/:businessId/status',async(req,res,next)=>{
    try{const a=await businessFor(req,req.params.businessId);if(!a.business)return res.status(a.status).json({error:a.error});res.json({businessId:a.business.id,isOpen:Boolean(a.business.isOpen)});}catch(e){next(e)}
  });
  originalPatch.call(app,'/api/businesses/:businessId/status',async(req,res,next)=>{
    try{const a=await businessFor(req,req.params.businessId);if(!a.business)return res.status(a.status).json({error:a.error});if(typeof req.body?.isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});const updated=await prisma.business.update({where:{id:a.business.id},data:{isOpen:req.body.isOpen}});res.json({ok:true,businessId:updated.id,isOpen:Boolean(updated.isOpen)});}catch(e){next(e)}
  });
  installed=true;
  installing=false;
}

express.application.get=function(path,...handlers){
  install(this);
  return originalGet.call(this,path,...handlers);
};
express.application.patch=function(path,...handlers){
  install(this);
  return originalPatch.call(this,path,...handlers);
};
