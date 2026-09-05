import './db-pool.js';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';
import http from 'node:http';

const prisma = new PrismaClient();
let ready = false;

async function ensureNotificationTable(){
  if(ready) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Notification" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL,"businessId" TEXT,"type" TEXT NOT NULL,"title" TEXT NOT NULL,"message" TEXT NOT NULL,"readAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "Notification" ("userId","readAt","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Notification_businessId_createdAt_idx" ON "Notification" ("businessId","createdAt")`);
  ready = true;
}
await ensureNotificationTable().catch(e=>console.error('notification table setup',e));

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token) return null;
  const s=await prisma.session.findUnique({where:{tokenHash:token},include:{user:true}}).catch(()=>null);
  if(!s || s.expiresAt<new Date()) return null;
  return s.user;
}

async function accessibleBusinessIds(user){
  if(!user) return [];
  if(['ADMIN','SUPER_ADMIN'].includes(user.role)){
    const rows=await prisma.business.findMany({select:{id:true}}).catch(()=>[]);
    return rows.map(x=>x.id);
  }
  const rows=await prisma.businessMember.findMany({where:{userId:user.id},select:{businessId:true}}).catch(()=>[]);
  return rows.map(x=>x.businessId);
}

const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
const readBody=async req=>{const chunks=[];for await(const c of req)chunks.push(c);try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return {}}};

export async function notifyUser(userId,{businessId=null,type='INFO',title,message}){
  try{
    await ensureNotificationTable();
    return await prisma.notification.create({data:{userId,businessId,type,title,message}});
  }catch(e){console.error('notification create',e);return null}
}

export async function notifyBusiness(businessId,{type='INFO',title,message}){
  try{
    await ensureNotificationTable();
    const members=await prisma.businessMember.findMany({where:{businessId},select:{userId:true}});
    const unique=[...new Set(members.map(x=>x.userId))];
    if(!unique.length)return [];
    return await prisma.$transaction(unique.map(userId=>prisma.notification.create({data:{userId,businessId,type,title,message}})));
  }catch(e){console.error('business notification create',e);return []}
}

async function handleNotification(req,res){
  await ensureNotificationTable();
  const user=await userFrom(req);
  if(!user)return json(res,401,{error:'Authentication required'});
  const businessIds=await accessibleBusinessIds(user);
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const m=u.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
  if(req.method==='GET' && u.pathname==='/api/notifications'){
    const limit=Math.min(50,Math.max(1,Number(u.searchParams.get('limit')||30)));
    const rows=await prisma.notification.findMany({where:{userId:user.id,OR:[{businessId:null},{businessId:{in:businessIds}}]},orderBy:{createdAt:'desc'},take:limit});
    const unread=rows.filter(x=>!x.readAt).length;
    return json(res,200,{notifications:rows,unread});
  }
  if(req.method==='PATCH' && u.pathname==='/api/notifications/read-all'){
    await prisma.notification.updateMany({where:{userId:user.id,readAt:null,OR:[{businessId:null},{businessId:{in:businessIds}}]},data:{readAt:new Date()}});
    return json(res,200,{ok:true});
  }
  if(req.method==='PATCH' && m){
    const id=decodeURIComponent(m[1]);
    const row=await prisma.notification.findFirst({where:{id,userId:user.id,OR:[{businessId:null},{businessId:{in:businessIds}}]}});
    if(!row)return json(res,404,{error:'Notification not found'});
    await prisma.notification.update({where:{id},data:{readAt:new Date()}});
    return json(res,200,{ok:true});
  }
  if(req.method==='POST' && u.pathname==='/api/notifications/test'){
    const b=await readBody(req); const businessId=String(b.businessId||'').trim();
    if(!businessId || (!businessIds.includes(businessId) && !['ADMIN','SUPER_ADMIN'].includes(user.role)))return json(res,403,{error:'Business access denied'});
    await notifyUser(user.id,{businessId,type:'TEST',title:'Notifications are working',message:'Repute-Tech notification center is connected and ready.'});
    return json(res,201,{ok:true});
  }
  return false;
}

const original=http.createServer;
http.createServer=function(listener,...args){
  return original.call(http,async(req,res)=>{
    const p=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
    try{
      if(p==='/api/notifications' || p==='/api/notifications/read-all' || /^\/api\/notifications\/[^/]+\/read$/.test(p) || p==='/api/notifications/test'){
        return handleNotification(req,res);
      }
      const end=res.end;
      res.end=function(chunk,encoding,callback){
        if(typeof chunk==='string' && chunk.includes('</body>') && chunk.includes('repute-tech.in')){
          const script=`<script src="/notifications-ui.js"></script>`;
          chunk=chunk.replace('</body>',script+'</body>');
        }
        return end.call(this,chunk,encoding,callback);
      };
      return listener(req,res);
    }catch(e){console.error('notification preload',e);if(!res.headersSent)json(res,500,{error:'Notification service error'})}
  },...args);
};
