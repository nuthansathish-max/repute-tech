import './db-pool.js';
import './order-hardening.js';
import './business-status.js';
import './order-status-fix.js';
import http from 'node:http';
import { PrismaClient } from '@prisma/client';

const schemaPrisma=new PrismaClient();
await schemaPrisma.$executeRawUnsafe(`ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true`);
await schemaPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderReview" ("id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL UNIQUE,"businessId" TEXT NOT NULL,"rating" INTEGER NOT NULL,"text" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
await schemaPrisma.$disconnect();

const { publicOrder, publicOrderStatus } = await import('./public-order.js');
const prisma=new PrismaClient();
const original=http.createServer;
const readBody=async req=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString('utf8');try{return JSON.parse(raw||'{}')}catch{return {}}};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
const id=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;

async function saveOrderReview(req,res){
  const body=await readBody(req);
  const slug=String(body.slug||'').trim();
  const orderNumber=String(body.orderNumber||'').trim();
  const rating=Number(body.rating||0);
  const text=String(body.text||'').trim().slice(0,2000);
  if(!slug||!orderNumber||!Number.isInteger(rating)||rating<1||rating>5)return json(res,400,{error:'Choose a rating from 1 to 5.'});
  const qr=await prisma.smartQr.findUnique({where:{slug}});
  if(!qr||!qr.isActive)return json(res,404,{error:'Customer hub not found.'});
  const order=await prisma.order.findFirst({where:{businessId:qr.businessId,orderNumber}});
  if(!order)return json(res,404,{error:'Order not found.'});
  if(order.status!=='DELIVERED')return json(res,409,{error:'Feedback can be submitted after the order is delivered.'});
  await prisma.$executeRawUnsafe(`INSERT INTO "OrderReview" ("id","orderId","businessId","rating","text") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("orderId") DO UPDATE SET "rating"=EXCLUDED."rating","text"=EXCLUDED."text"`,id(),order.id,qr.businessId,rating,text||null);
  return json(res,200,{ok:true});
}

function withPhoneValidationPage(res){
  const end=res.end;
  res.end=function(chunk,encoding,callback){
    if(typeof chunk==='string' && chunk.includes('id="phone"')){
      chunk=chunk
        .replace('maxlength="20" inputmode="tel"','maxlength="10" minlength="10" inputmode="numeric" autocomplete="tel" pattern="[6-9][0-9]{9}"')
        .replace('maxlength="30" placeholder="Phone number (optional)"','maxlength="10" minlength="10" inputmode="numeric" autocomplete="tel" pattern="[6-9][0-9]{9}" placeholder="Phone number"')
        .replace('if(!/^[0-9+()\\-\\s]{7,20}$/.test(phone))','if(!/^[6-9][0-9]{9}$/.test(phone))')
        .replace("if(!/^[6-9][0-9]{9}$/.test(phone)){$('msg').textContent='Please enter a valid phone number.';return}","if(!/^[6-9][0-9]{9}$/.test(phone)){$('msg').textContent='Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';return}");
    }
    return end.call(this,chunk,encoding,callback);
  };
}

http.createServer=function(listener,...args){
  return original.call(http,async(req,res)=>{
    const p=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
    try{
      if(req.method==='GET'&&/^\/q\/[^/]+\/order$/.test(p)){
        const m=p.match(/^\/q\/([^/]+)\/order$/);
        withPhoneValidationPage(res);
        return publicOrder(req,res,decodeURIComponent(m[1]));
      }
      if(req.method==='GET'&&/^\/q\/[^/]+\/order-status\/[^/]+$/.test(p)){
        const m=p.match(/^\/q\/([^/]+)\/order-status\/([^/]+)$/);
        return publicOrderStatus(req,res,decodeURIComponent(m[1]),decodeURIComponent(m[2]));
      }
      if(req.method==='POST'&&p==='/api/public/order-review')return saveOrderReview(req,res);
      return listener(req,res);
    }catch(e){console.error('order preload',e);if(!res.headersSent)json(res,500,{error:'Public service error'})}
  },...args);
};
