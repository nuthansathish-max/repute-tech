import 'dotenv/config';
import http from 'node:http';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';
import { aiReviewAnalysis } from './aiProvider.js';
import { whatsappConfigured, sendText } from './whatsapp.js';
import QRCode from 'qrcode';

const PUBLIC_PORT = Number(process.env.PORT || 10000);
const INNER_PORT = PUBLIC_PORT + 1;

function tuneDatabaseUrl(value){
  const raw=String(value||'').trim();
  if(!raw)return raw;
  try{
    const u=new URL(raw);
    if(!u.searchParams.has('connection_limit'))u.searchParams.set('connection_limit','3');
    if(!u.searchParams.has('pool_timeout'))u.searchParams.set('pool_timeout','20');
    return u.toString();
  }catch{return raw}
}

process.env.DATABASE_URL=tuneDatabaseUrl(process.env.DATABASE_URL);
process.env.PORT = String(INNER_PORT);
await import('./bootstrap.js');

const prisma = new PrismaClient();

const DEFAULT_PLANS = [
  {code:'STARTER',name:'Starter',price:199,billingInterval:'MONTH',description:'Essential reputation tools for small local businesses',features:['Reviews','AI reply suggestions','Smart QR','Basic analytics']},
  {code:'GROWTH',name:'Growth',price:499,billingInterval:'MONTH',description:'Growth tools for active local businesses',features:['Everything in Starter','Digital menu','Customer CRM','WhatsApp marketing']},
  {code:'PRO',name:'Pro',price:999,billingInterval:'MONTH',description:'Advanced automation for growing businesses',features:['Everything in Growth','Advanced analytics','AI insights','Higher usage limits']},
  {code:'HIGH_TRAFFIC',name:'High Traffic',price:1999,billingInterval:'MONTH',description:'For theatres, grocery stores, supermarkets and high-traffic shops',features:['Everything in Pro','High-volume usage','Priority support','Multi-location ready']},
  {code:'ALL_IN_ONE_YEARLY',name:'All-in-One Yearly',price:8999,billingInterval:'YEAR',description:'All features in one yearly package',features:['Everything in High Traffic','All features','Best yearly value','Priority support']}
];

async function ensurePlans(){
  const count=await prisma.planCatalog.count();
  if(count>0)return;
  for(const p of DEFAULT_PLANS) await prisma.planCatalog.create({data:p});
}

function cookie(req, name){ return getCookie(req, name); }
async function userFrom(req){
  const token=cookie(req,'rp_session');
  if(!token) return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date()) return null;
  return s.user;
}
async function businessFor(req, businessId){
  const user=await userFrom(req); if(!user) return {error:'Authentication required',status:401};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
  if(!business) return {error:'Business access denied',status:403};
  return {user,business};
}
async function body(req){
  const chunks=[]; for await(const c of req) chunks.push(c); const raw=Buffer.concat(chunks).toString('utf8');
  if(!raw) return {}; try{return JSON.parse(raw)}catch{return {}};
}
function json(res,status,data){const out=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(out)}

function publicOrigin(req){
  const proto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim() || (req.socket.encrypted?'https':'http');
  return `${proto}://${req.headers.host||'localhost'}`;
}

async function qrPayload(qr, origin){
  const url=`${origin}/q/${encodeURIComponent(qr.slug)}`;
  let qrImageUrl=null;
  try{qrImageUrl=await QRCode.toDataURL(url,{width:320,margin:2,errorCorrectionLevel:'M'});}catch{}
  return {...qr,qrUrl:url,qrImageUrl};
}

function escHtml(value){return String(value??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}

async function publicCustomerHub(res, req, slug){
  const qr=await prisma.smartQr.findUnique({where:{slug},include:{business:{include:{menus:{include:{items:true},where:{isPublished:true},orderBy:{createdAt:'desc'}}}}}});
  if(!qr) return res.statusCode=404, res.end('Customer hub not found');
  await prisma.smartQr.update({where:{id:qr.id},data:{scanCount:{increment:1}}}).catch(()=>{});
  const business=qr.business;
  const menus=business.menus||[];
  const orderUrl=`/q/${encodeURIComponent(slug)}/order`;
  const menuHtml=menus.length?menus.map(menu=>`<section class="menu"><div class="menuHead"><div><div class="eyebrow">DIGITAL MENU</div><h2>${escHtml(menu.name)}</h2></div><span class="menuCount">${menu.items?.length||0} items</span></div>${menu.items?.length?menu.items.map(item=>`<article class="item"><div class="itemMain"><div class="itemTitle"><strong>${escHtml(item.name)}</strong>${item.category?`<span class="cat">${escHtml(item.category)}</span>`:''}</div>${item.description?`<p>${escHtml(item.description)}</p>`:''}</div><b class="price">₹${escHtml(item.price)}</b></article>`).join(''):'<p class="muted">No items added yet.</p>'}</section>`).join(''):'<div class="empty"><div class="emptyIcon">☰</div><h2>Menu coming soon</h2><p>This business has not published its digital menu yet.</p></div>';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#5146e5"><title>${escHtml(business.name)} · Customer Menu</title><style>*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#f4f6ff 0,#f8f9fc 44%,#fff 100%);color:#171a2b;font-family:Inter,system-ui,-apple-system,sans-serif}.wrap{max-width:820px;margin:0 auto;padding:18px 14px 54px}.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#0f1429 0%,#2b2b67 52%,#5146e5 100%);color:#fff;border-radius:26px;padding:28px 22px 24px;box-shadow:0 16px 40px rgba(31,41,95,.2)}.hero:after{content:'';position:absolute;width:190px;height:190px;border-radius:50%;right:-70px;top:-85px;background:rgba(255,255,255,.08)}.brand{font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.72;margin-bottom:12px}.hero h1{position:relative;margin:0 0 8px;font-size:30px;line-height:1.1}.hero p{position:relative;margin:0;color:#dfe3ff;line-height:1.5;max-width:600px}.cta{display:inline-flex;align-items:center;justify-content:center;margin-top:18px;text-decoration:none;background:#fff;color:#171a2b;border-radius:13px;padding:12px 16px;font-weight:850;box-shadow:0 7px 18px rgba(0,0,0,.15)}.hint{font-size:12px;color:#667085;margin:14px 3px 0}.menu,.empty{background:rgba(255,255,255,.97);border:1px solid #e4e7f0;border-radius:20px;padding:18px;margin-top:14px;box-shadow:0 7px 24px rgba(16,24,40,.055)}.menuHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:5px}.eyebrow{font-size:10px;letter-spacing:.1em;color:#5146e5;font-weight:800}.menu h2{margin:3px 0 0;font-size:20px}.menuCount{font-size:11px;color:#667085;background:#f2f4f7;padding:6px 9px;border-radius:999px;white-space:nowrap}.item{display:flex;justify-content:space-between;gap:18px;padding:15px 2px;border-bottom:1px solid #eef0f4}.item:last-child{border-bottom:0}.itemMain{min-width:0}.itemTitle{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.item strong{font-size:15px}.item p{margin:6px 0 0;color:#667085;font-size:13px;line-height:1.45}.price{white-space:nowrap;font-size:16px}.cat{display:inline-block;padding:4px 7px;border-radius:999px;background:#eef2ff;color:#5146e5;font-size:10px;font-weight:700}.empty{text-align:center;padding:34px 20px}.emptyIcon{width:48px;height:48px;margin:auto;border-radius:15px;display:grid;place-items:center;background:#eef2ff;color:#5146e5;font-size:22px}.empty h2{margin:12px 0 5px}.empty p,.muted{color:#667085;font-size:13px}.footer{text-align:center;color:#98a2b3;font-size:11px;margin-top:18px}@media(max-width:560px){.hero h1{font-size:25px}.hero{padding:24px 18px}.menu{padding:16px}.cta{width:100%}}</style></head><body><main class="wrap"><header class="hero"><div class="brand">Repute-Tech · Smart Customer Hub</div><h1>Welcome to ${escHtml(business.name)}</h1><p>Browse the latest menu and order directly from your phone. Payment is collected manually at the store.</p><a class="cta" href="${orderUrl}">View menu &amp; order <span style="margin-left:7px">→</span></a></header><div class="hint">Scan complete · You can browse the menu below before ordering.</div>${menuHtml}<div class="footer">Powered by repute-tech.in</div></main></body></html>`;
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);
}

async function handle(req,res){
  const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const p=u.pathname;
  try{
    const qrMatch=p.match(/^\/(?:q|qr)\/([^/]+)$/);
    if(req.method==='GET' && qrMatch){
      return publicCustomerHub(res,req,decodeURIComponent(qrMatch[1]));
    }

    if(req.method==='POST' && p==='/api/reviews/ai-reply'){
      const user=await userFrom(req); if(!user)return json(res,401,{error:'Authentication required'});
      const b=await body(req); const text=String(b.text||'').trim(); if(!text)return json(res,400,{error:'Review text is required'});
      const review={authorName:String(b.authorName||'Customer'),rating:Number(b.rating||3),text};
      const result=await aiReviewAnalysis(review,String(b.businessName||'your business'),String(b.tone||'WARM'));
      return json(res,200,{provider:result.provider||'local',sentiment:result.sentiment,topics:result.topics,confidence:result.confidence,reply:result.reply});
    }

    let m=p.match(/^\/api\/businesses\/([^/]+)\/(qr|menus)$/);
    if(m){
      const access=await businessFor(req,m[1]); if(access.error)return json(res,access.status,{error:access.error});
      if(req.method==='GET'){
        if(m[2]==='qr'){
          const rows=await prisma.smartQr.findMany({where:{businessId:m[1]},orderBy:{name:'asc'}});
          return json(res,200,await Promise.all(rows.map(q=>qrPayload(q,publicOrigin(req)))));
        }
        return json(res,200,await prisma.menu.findMany({where:{businessId:m[1]},include:{items:true},orderBy:{createdAt:'desc'}}));
      }
      if(req.method==='POST' && m[2]==='qr'){
        const b=await body(req); const name=String(b.name||'').trim(); const slug=String(b.slug||'').trim().toLowerCase();
        if(!name||!/^[a-z0-9-]{2,100}$/.test(slug))return json(res,400,{error:'Enter a valid QR name and slug (letters, numbers and hyphens)'});
        if(await prisma.smartQr.findUnique({where:{slug}}))return json(res,409,{error:'That QR slug already exists. Choose another slug.'});
        const origin=publicOrigin(req);
        const url=`${origin}/q/${encodeURIComponent(slug)}`;
        const qr=await prisma.smartQr.create({data:{businessId:m[1],name,slug,destination:{type:'customer-hub',url}}});
        return json(res,201,await qrPayload(qr,origin));
      }
      if(req.method==='POST' && m[2]==='menus'){
        const b=await body(req); const name=String(b.name||'').trim(); if(!name)return json(res,400,{error:'Enter a menu name'});
        return json(res,201,await prisma.menu.create({data:{businessId:m[1],name,isPublished:Boolean(b.published??b.isPublished)}}));
      }
    }

    m=p.match(/^\/api\/menus\/([^/]+)\/items$/);
    if(m && req.method==='POST'){
      const menu=await prisma.menu.findUnique({where:{id:m[1]}}); if(!menu)return json(res,404,{error:'Menu not found'});
      const access=await businessFor(req,menu.businessId); if(access.error)return json(res,access.status,{error:access.error});
      const b=await body(req); const name=String(b.name||'').trim(); const price=Number(b.price); if(!name||!Number.isFinite(price)||price<0)return json(res,400,{error:'Enter a valid item name and price'});
      return json(res,201,await prisma.menuItem.create({data:{menuId:menu.id,name,price,category:String(b.category||'').trim()||null,description:String(b.description||'').trim()||null}}));
    }

    if(req.method==='GET' && p.match(/^\/api\/whatsapp\/status\/([^/]+)$/)){
      const id=p.split('/').pop(); const access=await businessFor(req,id); if(access.error)return json(res,access.status,{error:access.error});
      const c=await prisma.whatsAppConnection.findUnique({where:{businessId:id}});
      return json(res,200,{configured:whatsappConfigured(),connected:Boolean(c&&c.status==='CONNECTED'),status:c?.status||'DISCONNECTED',displayPhone:c?.displayPhone||null});
    }

    if(req.method==='POST' && (p==='/api/whatsapp/campaigns/preview' || p==='/api/whatsapp/campaigns/send')){
      const b=await body(req); const access=await businessFor(req,b.businessId); if(access.error)return json(res,access.status,{error:access.error});
      const ids=Array.isArray(b.customerIds)?b.customerIds.map(String):[];
      const customers=await prisma.customer.findMany({where:{businessId:access.business.id,id:{in:ids}},include:{consents:true}});
      const eligible=customers.filter(c=>c.phone&&c.consents.some(x=>x.type==='WHATSAPP_MARKETING'&&x.granted));
      if(p.endsWith('/preview'))return json(res,200,{eligibleCount:eligible.length,excludedCount:Math.max(0,customers.length-eligible.length),eligible:eligible.map(c=>({id:c.id,name:c.name,phone:c.phone}))});
      const name=String(b.name||'').trim(), message=String(b.message||'').trim(); if(!name||!message)return json(res,400,{error:'Enter campaign name and message'});
      const campaign=await prisma.campaign.create({data:{businessId:access.business.id,name,message,status:'PROCESSING'}});
      let sent=0,failed=0;
      for(const c of eligible){
        const msg=await prisma.campaignMessage.create({data:{campaignId:campaign.id,customerId:c.id,toPhone:c.phone,status:'QUEUED'}});
        try{const r=await sendText(c.phone,message); await prisma.campaignMessage.update({where:{id:msg.id},data:{status:'SENT',providerMessageId:r.messages?.[0]?.id||null,sentAt:new Date()}});sent++;}
        catch(e){failed++;await prisma.campaignMessage.update({where:{id:msg.id},data:{status:'FAILED',errorMessage:e.message}});}
      }
      const updated=await prisma.campaign.update({where:{id:campaign.id},data:{status:failed&&sent===0?'FAILED':'SENT',sentCount:sent,failedCount:failed}});
      return json(res,200,{campaign:updated,eligibleCount:eligible.length,sentCount:sent,failedCount:failed});
    }

    if(req.method==='GET' && p==='/api/admin/plan-requests'){
      const user=await userFrom(req); if(!user)return json(res,401,{error:'Authentication required'});
      if(!['ADMIN','SUPER_ADMIN'].includes(user.role))return json(res,403,{error:'Admin access required'});
      return json(res,200,await prisma.planRequest.findMany({include:{business:{select:{id:true,name:true,slug:true}},user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:'desc'}}));
    }

    if(req.method==='GET' && p==='/api/plans'){
      await ensurePlans();
      return json(res,200,await prisma.planCatalog.findMany({where:{active:true},orderBy:{price:'asc'}}));
    }

    if(req.method==='POST' && p==='/api/plan-requests'){
      const b=await body(req); const access=await businessFor(req,b.businessId); if(access.error)return json(res,access.status,{error:access.error});
      await ensurePlans();
      const plan=await prisma.planCatalog.findUnique({where:{code:String(b.planCode||'')}}); if(!plan||!plan.active)return json(res,400,{error:'Plan unavailable'});
      const existing=await prisma.planRequest.findFirst({where:{businessId:access.business.id,status:'PENDING'}}); if(existing)return json(res,409,{error:'A plan request is already pending',request:existing});
      const request=await prisma.planRequest.create({data:{businessId:access.business.id,userId:access.user.id,planCode:plan.code,planName:plan.name,price:plan.price,billingInterval:plan.billingInterval,ownerName:String(b.ownerName||access.user.name),contact:String(b.contact||access.user.email),status:'PENDING',paymentStatus:'MANUAL'}});
      return json(res,201,{ok:true,request});
    }

    return proxy(req,res,u);
  }catch(e){ console.error('production gateway error',e); return json(res,500,{error:e.message||'Internal server error'}); }
}

function proxy(req,res,u){
  const headers={...req.headers,host:`127.0.0.1:${INNER_PORT}`};
  const pr=http.request({hostname:'127.0.0.1',port:INNER_PORT,path:u.pathname+u.search,method:req.method,headers},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});
  pr.on('error',e=>{if(!res.headersSent)json(res,502,{error:'Upstream service unavailable',detail:e.message});else res.destroy(e)});
  req.pipe(pr);
}

const publicServer=http.createServer(handle);
publicServer.listen(PUBLIC_PORT,()=>console.log(`production gateway listening on port ${PUBLIC_PORT}`));
process.on('SIGTERM',async()=>{publicServer.close();await prisma.$disconnect()});
process.on('SIGINT',async()=>{publicServer.close();await prisma.$disconnect()});
