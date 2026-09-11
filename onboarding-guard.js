import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
let installed=false;

async function user(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}
async function hasBusiness(u){
  if(!u)return false;
  return !!(await prisma.businessMember.findFirst({where:{userId:u.id},select:{id:true}}));
}
function install(app){
  if(installed)return;
  installed=true;
  originalGet.call(app,'/',async(req,res,next)=>{
    try{
      const u=await user(req);
      if(u && !(await hasBusiness(u)))return res.redirect('/business-setup');
      next();
    }catch(e){next(e)}
  });
  originalGet.call(app,'/business-setup',async(req,res,next)=>{
    try{
      const u=await user(req);
      if(!u)return res.redirect('/');
      if(await hasBusiness(u))return res.redirect('/');
      next();
    }catch(e){next(e)}
  });
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
