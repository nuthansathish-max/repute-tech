import { PrismaClient } from '@prisma/client';
import './business-status.js';
import './order-status-fix.js';
import http from 'node:http';

const schemaPrisma=new PrismaClient();
await schemaPrisma.$executeRawUnsafe(`ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT true`);
await schemaPrisma.$disconnect();

const { publicOrder, publicOrderStatus } = await import('./public-order.js');
const menuPrisma=new PrismaClient();
const original=http.createServer;
const escapeScript="window.esc=window.ecs=function(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#039;'}[c])};";
const customerOrderEnhancement=`<script>${escapeScript}(function(){const b=document.getElementById('submit');if(b&&!b.dataset.reputeGuarded){b.dataset.reputeGuarded='1';const old=b.onclick;let locked=false;b.onclick=async function(e){if(locked)return;locked=true;try{await old.call(this,e)}finally{if(!document.querySelector('.success'))locked=false}}}const observer=new MutationObserver(()=>{const ok=document.querySelector('.success');if(ok&&!ok.querySelector('.orderAgain')){const a=document.createElement('button');a.className='track orderAgain';a.type='button';a.textContent='Order again';a.style.marginLeft='8px';a.onclick=()=>location.reload();ok.appendChild(a)}});observer.observe(document.body,{childList:true,subtree:true})})();</script>`;

async function repairMenuOrderPage(slug,html){
  try{
    const qr=await menuPrisma.smartQr.findUnique({where:{slug:String(slug)}});
    if(!qr)return html;
    const menus=await menuPrisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},include:{items:true},orderBy:{updatedAt:'desc'}});
    const chosen=menus.find(m=>m.items?.length) || menus[0];
    if(!chosen)return html;
    const items=(chosen.items||[]).filter(x=>x.available!==false).map(x=>({id:x.id,name:x.name,description:x.description||'',price:Number(x.price),category:x.category||''}));
    const data=JSON.stringify(items).replace(/</g,'\\u003c');
    let out=html.replace(/const ITEMS=.*?,SLUG=/,`const ITEMS=${data},SLUG=`);
    out=out.replace(/\nconst ITEMS=/,`\nconst ITEMS=`);
    out=out.replace(/menuId:\"[^\"]+\"/g,`menuId:${JSON.stringify(chosen.id)}`);
    return out;
  }catch(e){console.error('menu order repair',e);return html}
}

http.createServer=function(listener,...args){
  return original.call(http,async(req,res)=>{
    const p=new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname;
    try{
      if(req.method==='GET'&&/^\/q\/[^/]+\/order$/.test(p)){
        const end=res.end.bind(res);
        const m=p.match(/^\/q\/([^/]+)\/order$/);
        res.end=async(chunk,...rest)=>{
          if(typeof chunk==='string'){
            chunk=await repairMenuOrderPage(decodeURIComponent(m[1]),chunk);
            chunk=chunk.replace('<script>\nconst ITEMS=',`<script>\n${escapeScript}const ITEMS=`).replace('</body></html>',customerOrderEnhancement+'</body></html>');
          }
          return end(chunk,...rest);
        };
        return publicOrder(req,res,decodeURIComponent(m[1]));
      }
      if(req.method==='GET'&&/^\/q\/[^/]+\/order-status\/[^/]+$/.test(p)){
        const end=res.end.bind(res);
        res.end=(chunk,...rest)=>{if(typeof chunk==='string'&&chunk.includes('>DELIVERED<'))chunk=chunk.replace('background:#f59e0b','background:#16a34a').replace('This order has been cancelled by the business.','Your order has been delivered. Thank you!');return end(chunk,...rest)};
        const m=p.match(/^\/q\/([^/]+)\/order-status\/([^/]+)$/);return publicOrderStatus(req,res,decodeURIComponent(m[1]),decodeURIComponent(m[2]));
      }
      return listener(req,res);
    }catch(e){console.error('order preload',e);if(!res.headersSent){res.writeHead(500,{'content-type':'text/plain'});res.end('Public service error')}}
  },...args);
};
