import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
const originalPost=express.application.post;
const originalPut=express.application.put;
const originalDelete=express.application.delete;
let installed=false;

async function currentUser(req){
  const token=getCookie(req,'rp_session'); if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null; return s.user;
}
async function access(req,businessId){
  const user=await currentUser(req);
  if(!user)return {status:401,error:'Authentication required'};
  const member=await prisma.businessMember.findFirst({where:{businessId,userId:user.id}});
  if(!member)return {status:403,error:'Business access denied'};
  if(!['OWNER','MANAGER'].includes(member.role))return {status:403,error:'Staff management requires Owner or Manager access'};
  return {user,member};
}
function install(app){
 if(installed)return; installed=true;
 originalGet.call(app,'/api/businesses/:businessId/staff',async(req,res,next)=>{try{
  const a=await access(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});
  const rows=await prisma.businessMember.findMany({where:{businessId:req.params.businessId,role:{in:['MANAGER','STAFF']}},include:{user:true},orderBy:{user:{name:'asc'}}});
  res.json(rows.map(m=>({id:m.id,userId:m.userId,name:m.user.name,email:m.user.email,role:m.role})));
 }catch(e){next(e)}});
 originalPost.call(app,'/api/businesses/:businessId/staff',async(req,res,next)=>{try{
  const a=await access(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});
  if(a.member.role!=='OWNER')return res.status(403).json({error:'Only the business owner can add staff'});
  const email=String(req.body?.email||'').trim().toLowerCase(),role=String(req.body?.role||'STAFF').toUpperCase();
  if(!email)return res.status(400).json({error:'Enter the staff member email'});
  if(!['MANAGER','STAFF'].includes(role))return res.status(400).json({error:'Invalid staff role'});
  const user=await prisma.user.findUnique({where:{email}});
  if(!user)return res.status(404).json({error:'No Repute Tech account exists for this email. Ask the person to create an account first, then add them here.'});
  if(['ADMIN','SUPER_ADMIN'].includes(user.role))return res.status(400).json({error:'Admin accounts cannot be added as business staff'});
  const existing=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId:req.params.businessId}}});
  if(existing)return res.status(409).json({error:'This user is already a member of this business'});
  await prisma.businessMember.create({data:{userId:user.id,businessId:req.params.businessId,role}});
  await prisma.user.update({where:{id:user.id},data:{role}});
  res.json({ok:true});
 }catch(e){next(e)}});
 originalPut.call(app,'/api/businesses/:businessId/staff/:memberId',async(req,res,next)=>{try{
  const a=await access(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});
  if(a.member.role!=='OWNER')return res.status(403).json({error:'Only the business owner can change staff'});
  const m=await prisma.businessMember.findFirst({where:{id:req.params.memberId,businessId:req.params.businessId,role:{in:['MANAGER','STAFF']}},include:{user:true}});
  if(!m)return res.status(404).json({error:'Staff member not found'});
  const role=String(req.body?.role||m.role).toUpperCase();
  if(!['MANAGER','STAFF'].includes(role))return res.status(400).json({error:'Invalid staff role'});
  await prisma.businessMember.update({where:{id:m.id},data:{role}});
  await prisma.user.update({where:{id:m.userId},data:{role}});
  res.json({ok:true});
 }catch(e){next(e)}});
 originalDelete.call(app,'/api/businesses/:businessId/staff/:memberId',async(req,res,next)=>{try{
  const a=await access(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});
  if(a.member.role!=='OWNER')return res.status(403).json({error:'Only the business owner can remove staff'});
  const m=await prisma.businessMember.findFirst({where:{id:req.params.memberId,businessId:req.params.businessId,role:{in:['MANAGER','STAFF']}}});
  if(!m)return res.status(404).json({error:'Staff member not found'});
  await prisma.businessMember.delete({where:{id:m.id}});
  res.json({ok:true});
 }catch(e){next(e)}});
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
express.application.put=function(path,...handlers){install(this);return originalPut.call(this,path,...handlers)};
express.application.delete=function(path,...handlers){install(this);return originalDelete.call(this,path,...handlers)};
