import './db-pool.js';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

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
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}}).catch(()=>null);
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
    const chunks=[];for await(const c of req)chunks.push(c);
    let b={};try{b=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}
    const businessId=String(b.businessId||'').trim();
    if(!businessId || (!businessIds.includes(businessId) && !['ADMIN','SUPER_ADMIN'].includes(user.role)))return json(res,403,{error:'Business access denied'});
    await notifyUser(user.id,{businessId,type:'TEST',title:'Notifications are working',message:'Repute-Tech notification center is connected and ready.'});
    return json(res,201,{ok:true});
  }
  return false;
}

async function eventFromResponse(req,p,statusCode,chunk){
  if(statusCode<200 || statusCode>=300)return;
  try{
    const raw=Buffer.isBuffer(chunk)?chunk.toString('utf8'):String(chunk||'');
    const data=JSON.parse(raw||'{}');
    if(req.method==='POST' && p==='/api/public/orders' && data?.order?.businessId){
      const order=data.order;
      await notifyBusiness(order.businessId,{type:'ORDER_NEW',title:'New order received',message:`Order #${order.orderNumber} from ${order.customerName||'customer'} is waiting for action.`});
      return;
    }
    if(req.method==='POST' && p==='/api/public/order-review'){
      const chunks=req.__reputeNotificationBody||[];
      let body={};
      try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{}
      const slug=String(body.slug||'').trim();
      const orderNumber=String(body.orderNumber||'').trim();
      if(!slug||!orderNumber)return;
      const qr=await prisma.smartQr.findUnique({where:{slug},select:{businessId:true}});
      if(!qr)return;
      await notifyBusiness(qr.businessId,{type:'REVIEW',title:'New customer feedback',message:`Order #${orderNumber} received a ${Number(body.rating)||0}-star customer rating.`});
    }
  }catch(e){console.error('notification event',e)}
}

const original=http.createServer;
http.createServer=function(listener,...args){
  return original.call(http,async(req,res)=>{
    const p=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
    if(req.method==='POST' && (p==='/api/public/orders' || p==='/api/public/order-review')){
      req.__reputeNotificationBody=[];
      req.on('data',c=>req.__reputeNotificationBody.push(Buffer.from(c)));
    }
    try{
      if(p==='/api/notifications' || p==='/api/notifications/read-all' || /^\/api\/notifications\/[^/]+\/read$/.test(p) || p==='/api/notifications/test'){
        return handleNotification(req,res);
      }
      if(req.method==='GET' && p==='/notifications-ui.js'){
        const file=path.join(process.cwd(),'notifications-ui.js');
        const js=await fs.readFile(file,'utf8');
        res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store'});
        return res.end(js);
      }
      const end=res.end;
      res.end=function(chunk,encoding,callback){
        if(typeof chunk==='string' && chunk.includes('</body>') && !chunk.includes('/notifications-ui.js')){
          chunk=chunk.replace('</body>','<script src="/notifications-ui.js"></script></body>');
        }
        const result=end.call(this,chunk,encoding,callback);
        eventFromResponse(req,p,res.statusCode,chunk).catch(()=>{});
        return result;
      };
      return listener(req,res);
    }catch(e){console.error('notification preload',e);if(!res.headersSent)json(res,500,{error:'Notification service error'})}
  },...args);
};
