import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalListen = express.application.listen;
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPatch = express.application.patch;
let registered = false;
let tablesReady = false;

async function ensureOrderTables(){
  if(tablesReady) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Order" ("id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"menuId" TEXT,"customerId" TEXT,"orderNumber" TEXT NOT NULL UNIQUE,"customerName" TEXT NOT NULL,"customerPhone" TEXT,"fulfilmentType" TEXT NOT NULL DEFAULT 'IN_STORE',"status" TEXT NOT NULL DEFAULT 'PENDING',"paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',"paymentMethod" TEXT NOT NULL DEFAULT 'MANUAL',"notes" TEXT,"total" DECIMAL(10,2) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderItem" ("id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL,"menuItemId" TEXT,"itemName" TEXT NOT NULL,"quantity" INTEGER NOT NULL,"unitPrice" DECIMAL(10,2) NOT NULL,"lineTotal" DECIMAL(10,2) NOT NULL)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_businessId_status_createdAt_idx" ON "Order" ("businessId","status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem" ("orderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_customerId_createdAt_idx" ON "Order" ("customerId","createdAt")`);
  tablesReady = true;
}

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token) return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date()) return null;
  return s.user;
}

async function access(req,businessId){
  const user=await userFrom(req);
  if(!user) return {error:'Authentication required',status:401};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
  if(!business) return {error:'Business access denied',status:403};
  return {user,business};
}

function orderNumber(){return `RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;}
function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
function forwardedOrigin(req){
  const proto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim() || (req.socket.encrypted?'https':'http');
  return `${proto}://${req.get('host')}`;
}

function publicOrderPage(business,menu,slug){
  const items=(menu.items||[]).filter(x=>x.available).map(x=>({id:x.id,name:x.name,description:x.description||'',price:Number(x.price),category:x.category||''}));
  const safe=JSON.stringify(items).replace(/</g,'\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>${esc(business.name)} · Order</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif}.app{max-width:900px;margin:auto;padding:14px 14px 120px}.top{background:linear-gradient(135deg,#111827,#4338ca 70%,#6366f1);color:#fff;border-radius:26px;padding:22px;box-shadow:0 18px 40px rgba(31,41,95,.2);position:relative;overflow:hidden}.top:after{content:'';position:absolute;width:180px;height:180px;border-radius:50%;right:-70px;top:-80px;background:rgba(255,255,255,.09)}.eyebrow{font-size:10px;letter-spacing:.13em;text-transform:uppercase;opacity:.72}.top h1{margin:7px 0 6px;font-size:28px;position:relative}.top p{margin:0;color:#e5e7eb;line-height:1.5;position:relative}.trust{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px;position:relative}.trust span{font-size:11px;padding:7px 9px;border-radius:999px;background:rgba(255,255,255,.12)}.toolbar{display:flex;gap:8px;overflow:auto;padding:14px 0 5px}.filter{border:1px solid #e1e4ea;background:#fff;border-radius:999px;padding:9px 13px;font-weight:750;white-space:nowrap}.filter.active{background:#111827;color:#fff;border-color:#111827}.grid{display:grid;gap:11px;margin-top:12px}.card{background:#fff;border:1px solid #e6e8ef;border-radius:19px;padding:15px;display:flex;gap:12px;justify-content:space-between;box-shadow:0 6px 20px rgba(16,24,40,.045)}.info{min-width:0}.cat{display:inline-block;font-size:10px;font-weight:800;color:#4338ca;background:#eef2ff;border-radius:999px;padding:5px 8px;margin-bottom:7px}.name{font-weight:850;font-size:16px}.desc{margin:5px 0 8px;color:#667085;font-size:12.5px;line-height:1.45}.price{font-weight:900}.actions{display:flex;align-items:center;gap:7px;align-self:center}.circle{width:38px;height:38px;border:0;border-radius:12px;background:#eef2ff;color:#4338ca;font-size:20px;font-weight:900}.circle:active{transform:scale(.96)}.count{min-width:20px;text-align:center;font-weight:850}.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-top:1px solid #e5e7eb;z-index:20}.cartBtn{width:min(900px,100%);margin:auto;display:flex;justify-content:space-between;align-items:center;border:0;border-radius:15px;background:#111827;color:#fff;padding:13px 15px;font-size:15px;font-weight:850}.cartBtn small{font-weight:650;color:#d1d5db}.sheet{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:flex-end;z-index:30}.sheet.show{display:flex}.modal{background:#fff;width:100%;max-height:88vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px 16px calc(24px + env(safe-area-inset-bottom))}.modalHead{display:flex;justify-content:space-between;align-items:center}.close{border:0;background:#f2f4f7;border-radius:10px;padding:9px 11px;font-weight:800}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #eef0f4}.field{width:100%;border:1px solid #dfe3eb;border-radius:12px;padding:12px;font:inherit;margin-top:9px}.submit{width:100%;border:0;border-radius:13px;padding:13px;background:#4338ca;color:#fff;font-weight:850;font-size:15px;margin-top:12px}.submit:disabled{opacity:.65}.note{font-size:12px;color:#667085;line-height:1.45}.success{background:#ecfdf3;border:1px solid #bbf7d0;border-radius:16px;padding:16px;color:#166534}.track{display:inline-block;margin-top:10px;background:#166534;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800}.empty{text-align:center;background:#fff;border:1px dashed #d9dde7;border-radius:18px;padding:28px;color:#667085}@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:24px}}</style></head><body><main class="app"><header class="top"><div class="eyebrow">Repute-Tech · Smart digital menu</div><h1>${esc(business.name)}</h1><p>${esc(menu.name)} · Choose your items, place your order, and pay manually at the store.</p><div class="trust"><span>✓ Fresh menu</span><span>✓ In-store payment</span><span>✓ Simple checkout</span></div></header><div id="filters" class="toolbar"></div><div id="grid" class="grid"></div></main><div class="bar"><button id="cartBtn" class="cartBtn"><span>View cart</span><strong id="cartLabel">0 items · ₹0.00</strong></button></div><div id="sheet" class="sheet"><section class="modal"><div class="modalHead"><div><div class="eyebrow" style="color:#4338ca">Checkout</div><h2 style="margin:3px 0">Your order</h2></div><button id="close" class="close">Close</button></div><div id="rows"></div><div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;margin-top:13px"><span>Total</span><span>₹<span id="total">0.00</span></span></div><input id="name" class="field" maxlength="80" placeholder="Your name"><input id="phone" class="field" maxlength="30" placeholder="Phone number (optional)"><textarea id="notes" class="field" maxlength="500" rows="3" placeholder="Table number or special instructions (optional)"></textarea><button id="submit" class="submit">Place order</button><p class="note">Payment is collected manually at the store. Your order starts as <b>PENDING</b>; the business can accept or cancel it.</p><div id="msg" class="note"></div></section></div><script>
const ITEMS=${safe},SLUG=${JSON.stringify(slug)},cart=new Map();const $=x=>document.getElementById(x);const cats=['All',...new Set(ITEMS.map(x=>x.category).filter(Boolean))];let active='All';
function money(n){return Number(n).toFixed(2)}
function renderFilters(){if(cats.length<=1){$('filters').style.display='none';return}$('filters').innerHTML=cats.map(c=>'<button class="filter '+(c===active?'active':'')+'" onclick="setCat('+JSON.stringify(c)+')">'+c+'</button>').join('')}
function setCat(c){active=c;renderFilters();render()}
function render(){const visible=active==='All'?ITEMS:ITEMS.filter(x=>x.category===active);$('grid').innerHTML=visible.length?visible.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div class="info">'+(i.category?'<span class="cat">'+i.category+'</span>':'')+'<div class="name">'+i.name+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<span class="price">₹'+money(i.price)+'</span></div><div class="actions"><button class="circle" aria-label="Remove one" onclick="change('+JSON.stringify(i.id)+',-1)">−</button><span class="count">'+q+'</span><button class="circle" aria-label="Add one" onclick="change('+JSON.stringify(i.id)+',1)">+</button></div></article>'}).join(''):'<div class="empty">No items are available right now.</div>';let count=0,total=0;for(const [id,q] of cart){const i=ITEMS.find(x=>x.id===id);if(i){count+=q;total+=i.price*q}}$('cartLabel').textContent=count+' item'+(count===1?'':'s')+' · ₹'+money(total)}
function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);if(q)cart.set(id,q);else cart.delete(id);render()}
function openCart(){if(!cart.size){alert('Add an item first.');return}$('sheet').classList.add('show');renderCart()}
function renderCart(){let total=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;total+=line;return '<div class="row"><span>'+i.name+' × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(total)}
$('cartBtn').onclick=openCart;$('close').onclick=()=>$('sheet').classList.remove('show');$('sheet').onclick=e=>{if(e.target.id==='sheet')$('sheet').classList.remove('show')};
$('submit').onclick=async()=>{const name=$('name').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing your order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({menuId:${JSON.stringify(menu.id)},customerName:name,customerPhone:$('phone').value.trim(),notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');document.querySelector('.modal').innerHTML='<div class="success"><div class="eyebrow" style="color:#166534">Order received</div><h2 style="margin:4px 0 7px">Order placed ✓</h2><p>Order <b>'+j.order.orderNumber+'</b> has been sent to the business.</p><p>Payment is collected manually at the store.</p><a class="track" href="/q/'+encodeURIComponent(SLUG)+'/order-status/'+encodeURIComponent(j.order.orderNumber)+'">Track order</a></div>';cart.clear();render()}catch(e){$('msg').textContent=e.message;$('submit').disabled=false}};renderFilters();render();
</script></body></html>`;
}

function statusPage(order,business,slug){
  const colors={PENDING:'#f59e0b',ACCEPTED:'#16a34a',CANCELLED:'#dc2626'};const status=order.status;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="12"><meta name="theme-color" content="#111827"><title>${esc(business.name)} · Order ${esc(order.orderNumber)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif}.wrap{max-width:560px;margin:auto;padding:18px 14px 40px}.hero{background:linear-gradient(135deg,#111827,#4338ca);color:#fff;border-radius:24px;padding:22px;box-shadow:0 16px 34px rgba(31,41,95,.18)}.eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.7}.hero h1{margin:6px 0 3px}.pill{display:inline-block;padding:7px 11px;border-radius:999px;color:#fff;font-weight:850;font-size:12px;margin-top:11px}.card{background:#fff;border:1px solid #e6e8ef;border-radius:20px;padding:18px;margin-top:13px;box-shadow:0 7px 22px rgba(16,24,40,.05)}.line{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eef0f4}.line:last-of-type{border-bottom:0}.muted{color:#667085;font-size:13px;line-height:1.5}.total{font-size:21px;font-weight:900;margin:14px 0}.back{display:inline-block;margin-top:12px;text-decoration:none;background:#111827;color:#fff;padding:11px 14px;border-radius:11px;font-weight:800}</style></head><body><main class="wrap"><div class="hero"><div class="eyebrow">Repute-Tech · Order tracking</div><h1>${esc(business.name)}</h1><div>${esc(order.orderNumber)}</div><span class="pill" style="background:${colors[status]||'#4338ca'}">${esc(status)}</span></div><div class="card"><p class="muted">Order details</p>${order.items.map(i=>'<div class="line"><span>'+esc(i.itemName)+' × '+i.quantity+'</span><b>₹'+Number(i.lineTotal).toFixed(2)+'</b></div>').join('')}<div class="line total"><span>Total</span><span>₹${Number(order.total).toFixed(2)}</span></div><p class="muted">Payment: ${esc(order.paymentStatus==='PAID'?'Received manually':'Pay manually at the store')}</p><p class="muted">${status==='PENDING'?'Your order is waiting for the business to accept or cancel it.':status==='ACCEPTED'?'Your order has been accepted by the business.':'This order has been cancelled by the business.'}</p><a class="back" href="/q/${encodeURIComponent(slug)}/order">Back to menu</a></div></main></body></html>`;
}

function registerOrderRoutes(app){
  if(registered) return;
  registered=true;

  originalGet.call(app,'/q/:slug/order',async(req,res,next)=>{
    try{
      await ensureOrderTables();
      const qr=await prisma.smartQr.findUnique({where:{slug:String(req.params.slug||'')},include:{business:true}});
      if(!qr||!qr.isActive)return res.status(404).send('Order menu not found');
      const menu=await prisma.menu.findFirst({where:{businessId:qr.businessId,isPublished:true},include:{items:true},orderBy:{createdAt:'desc'}});
      if(!menu)return res.status(404).send('No published menu available');
      res.type('html').send(publicOrderPage(qr.business,menu,qr.slug));
    }catch(e){next(e)}
  });

  originalGet.call(app,'/q/:slug/order-status/:orderNumber',async(req,res,next)=>{
    try{
      await ensureOrderTables();
      const qr=await prisma.smartQr.findUnique({where:{slug:String(req.params.slug||'')},include:{business:true}});
      if(!qr)return res.status(404).send('Customer hub not found');
      const order=await prisma.order.findFirst({where:{businessId:qr.businessId,orderNumber:String(req.params.orderNumber||'')},include:{items:true}});
      if(!order)return res.status(404).send('Order not found');
      res.type('html').send(statusPage(order,qr.business,qr.slug));
    }catch(e){next(e)}
  });

  originalGet.call(app,'/api/businesses/:businessId/orders',async(req,res,next)=>{
    try{
      await ensureOrderTables();
      const a=await access(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});
      const status=String(req.query.status||'');
      const where={businessId:a.business.id,...(status?{status}:{})};
      res.json(await prisma.order.findMany({where,include:{items:true,menu:{select:{id:true,name:true}},customer:{select:{id:true,name:true,phone:true}}},orderBy:{createdAt:'desc'},take:100}));
    }catch(e){next(e)}
  });

  originalPost.call(app,'/api/public/orders',async(req,res,next)=>{
    try{
      await ensureOrderTables();
      const b=req.body||{};
      const menuId=String(b.menuId||'');
      const customerName=String(b.customerName||'').trim();
      const customerPhone=String(b.customerPhone||'').trim()||null;
      const notes=String(b.notes||'').trim()||null;
      const rawItems=Array.isArray(b.items)?b.items:[];
      if(!menuId||customerName.length<2||customerName.length>80||rawItems.length<1)return res.status(400).json({error:'Name, menu and at least one item are required'});
      const menu=await prisma.menu.findFirst({where:{id:menuId,isPublished:true},include:{business:true,items:true}});
      if(!menu)return res.status(404).json({error:'Menu not found'});
      const requested=new Map();
      for(const x of rawItems){const id=String(x.menuItemId||''),q=Math.floor(Number(x.quantity));if(id&&q>0&&q<=50)requested.set(id,(requested.get(id)||0)+q)}
      const chosen=menu.items.filter(i=>i.available&&requested.has(i.id));
      if(!chosen.length)return res.status(400).json({error:'No available items selected'});
      const items=chosen.map(i=>{const quantity=requested.get(i.id),unitPrice=Number(i.price);return {menuItemId:i.id,itemName:i.name,quantity,unitPrice,lineTotal:Number((unitPrice*quantity).toFixed(2))}});
      const total=Number(items.reduce((s,i)=>s+i.lineTotal,0).toFixed(2));
      let customer=customerPhone?await prisma.customer.findFirst({where:{businessId:menu.businessId,phone:customerPhone}}):null;
      if(!customer)customer=await prisma.customer.create({data:{businessId:menu.businessId,name:customerName,phone:customerPhone,lastInteractionAt:new Date()}});
      else await prisma.customer.update({where:{id:customer.id},data:{name:customerName,lastInteractionAt:new Date()}});
      const order=await prisma.order.create({data:{businessId:menu.businessId,menuId:menu.id,customerId:customer.id,orderNumber:orderNumber(),customerName,customerPhone,fulfilmentType:'IN_STORE',status:'PENDING',paymentStatus:'UNPAID',paymentMethod:'MANUAL',notes,total,items:{create:items}},include:{items:true}});
      await prisma.customerInteraction.create({data:{customerId:customer.id,type:'ORDER_PLACED',channel:'DIGITAL_MENU',metadata:{orderId:order.id,orderNumber:order.orderNumber,total}}}).catch(()=>{});
      return res.status(201).json({ok:true,order});
    }catch(e){next(e)}
  });

  originalPatch.call(app,'/api/orders/:id/status',async(req,res,next)=>{
    try{
      await ensureOrderTables();
      const order=await prisma.order.findUnique({where:{id:req.params.id}});if(!order)return res.status(404).json({error:'Order not found'});
      const a=await access(req,order.businessId);if(a.error)return res.status(a.status).json({error:a.error});
      const status=String(req.body?.status||'');
      if(!['PENDING','ACCEPTED','CANCELLED'].includes(status))return res.status(400).json({error:'Invalid order status. Use PENDING, ACCEPTED or CANCELLED.'});
      if(status==='ACCEPTED'&&order.status==='CANCELLED')return res.status(400).json({error:'Cancelled orders cannot be accepted'});
      if(status==='CANCELLED'&&order.status==='ACCEPTED')return res.status(400).json({error:'Accepted orders cannot be cancelled'});
      const updated=await prisma.order.update({where:{id:order.id},data:{status},include:{items:true}});
      res.json({ok:true,order:updated});
    }catch(e){next(e)}
  });
}

express.application.listen=function(...args){registerOrderRoutes(this);return originalListen.apply(this,args)};
