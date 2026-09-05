import { PrismaClient } from '@prisma/client';
import './business-status.js';
import http from 'node:http';

const schemaPrisma=new PrismaClient();
await schemaPrisma.$executeRawUnsafe(`ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true`);
await schemaPrisma.$disconnect();

const { publicHub } = await import('./public-hub.js');
const { publicOrder, publicOrderStatus } = await import('./public-order.js');
const original=http.createServer;
http.createServer=function(listener,...args){
  return original.call(http,async(req,res)=>{
    const p=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
    try{
      let m=p.match(/^\/q\/([^/]+)\/order$/);
      if(req.method==='GET'&&m)return publicOrder(req,res,decodeURIComponent(m[1]));
      m=p.match(/^\/q\/([^/]+)\/order-status\/([^/]+)$/);
      if(req.method==='GET'&&m)return publicOrderStatus(req,res,decodeURIComponent(m[1]),decodeURIComponent(m[2]));
      m=p.match(/^\/q\/([^/]+)$/);
      if(req.method==='GET'&&m)return publicHub(req,res,decodeURIComponent(m[1]));
      return listener(req,res);
    }catch(e){console.error('order preload',e);if(!res.headersSent){res.writeHead(500,{'content-type':'text/plain'});res.end('Public service error')}}
  },...args);
};
