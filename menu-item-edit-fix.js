import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalPatch=express.application.patch;
const originalPut=express.application.put;
const originalPost=express.application.post;
const installed=new WeakSet();

async function sessionUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}

async function menuAccess(req,menuId){
  const user=await sessionUser(req);
  if(!user)return {error:'Authentication required',status:401};
  const menu=await prisma.menu.findUnique({where:{id:String(menuId)},select:{id:true,businessId:true}});
  if(!menu)return {error:'Menu not found',status:404};
  const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId:menu.businessId}},select:{id:true}});
  if(!member&&!['ADMIN','SUPER_ADMIN'].includes(user.role))return {error:'Business access denied',status:403};
  return {user,menu};
}

function install(app){
  if(!app||installed.has(app))return;
  installed.add(app);

  originalPatch.call(app,'/api/menus/:menuId',async(req,res,next)=>{
    try{
      const access=await menuAccess(req,req.params.menuId);
      if(access.error)return res.status(access.status).json({error:access.error});
      const body=req.body||{};
      const data={};
      if(body.name!==undefined)data.name=String(body.name).trim();
      if(body.isPublished!==undefined)data.isPublished=Boolean(body.isPublished);
      if(body.published!==undefined&&body.isPublished===undefined)data.isPublished=Boolean(body.published);
      if(body.name!==undefined&&!data.name)return res.status(400).json({error:'Enter a menu name'});
      const updated=await prisma.menu.update({where:{id:access.menu.id},data});
      return res.json(updated);
    }catch(e){next(e)}
  });

  const updateMenuItem=async(req,res,next)=>{
    try{
      const access=await menuAccess(req,req.params.menuId);
      if(access.error)return res.status(access.status).json({error:access.error});
      const item=await prisma.menuItem.findFirst({where:{id:String(req.params.itemId),menuId:access.menu.id}});
      if(!item)return res.status(404).json({error:'Menu item not found'});
      const body=req.body||{};
      const data={};
      if(body.name!==undefined)data.name=String(body.name).trim();
      if(body.price!==undefined)data.price=Number(body.price);
      if(body.category!==undefined)data.category=String(body.category||'').trim()||null;
      if(body.description!==undefined)data.description=String(body.description||'').trim()||null;
      if(!data.name&&body.name!==undefined)return res.status(400).json({error:'Enter an item name'});
      if(data.price!==undefined&&(!Number.isFinite(data.price)||data.price<0))return res.status(400).json({error:'Enter a valid price'});
      const updated=await prisma.menuItem.update({where:{id:item.id},data});
      return res.json(updated);
    }catch(e){next(e)}
  };
  originalPatch.call(app,'/api/menus/:menuId/items/:itemId',updateMenuItem);
  originalPut.call(app,'/api/menus/:menuId/items/:itemId',updateMenuItem);

  originalPost.call(app,'/api/businesses/:businessId/menus/:menuId/items',async(req,res,next)=>{
    try{
      const user=await sessionUser(req);
      if(!user)return res.status(401).json({error:'Authentication required'});
      const businessId=String(req.params.businessId);
      const menu=await prisma.menu.findFirst({where:{id:String(req.params.menuId),businessId},select:{id:true}});
      if(!menu)return res.status(404).json({error:'Menu not found'});
      const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId}},select:{id:true}});
      if(!member&&!['ADMIN','SUPER_ADMIN'].includes(user.role))return res.status(403).json({error:'Business access denied'});
      const body=req.body||{};
      const name=String(body.name||'').trim();
      const price=Number(body.price);
      if(!name)return res.status(400).json({error:'Enter an item name'});
      if(!Number.isFinite(price)||price<0)return res.status(400).json({error:'Enter a valid price'});
      const item=await prisma.menuItem.create({data:{menuId:menu.id,name,price,category:String(body.category||'').trim()||null,description:String(body.description||'').trim()||null}});
      return res.status(201).json(item);
    }catch(e){next(e)}
  });
}

express.application.patch=function(path,...handlers){install(this);return originalPatch.call(this,path,...handlers)};
express.application.put=function(path,...handlers){install(this);return originalPut.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
