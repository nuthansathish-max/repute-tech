import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let installed = false;
let installing = false;

const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const orderNumber=()=>`RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

async function load(slug){
  const qr=await prisma.smartQr.findUnique({where:{slug:String(slug||'')},include:{business:true}});
  if(!qr?.business||!qr.isActive)return null;
  const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
  const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),category:item.category||'',menuId:menu.id,menuName:menu.name})));
  return {qr,menus,items};
}

function page(data,slug){
  const business=data.qr.business;
  const items=JSON.stringify(data.items).replace(/</g,'\\u003c');
  const menus=JSON.stringify(data.menus.map(m=>m.name));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(business.name)} · Order</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:system-ui,-apple-system,sans-serif}.app{max-width:900px;margin:auto;padding:14px 14px 100px}.hero{background:linear-gradient(135deg,#111827,#4338ca);color:#fff;border-radius:22px;padding:20px}.hero h1{margin:5px 0}.filters{display:flex;gap:8px;overflow:auto;padding:14px 0}.filter{border:1px solid #ddd;background:#fff;border-radius:999px;padding:9px 13px;font-weight:700;white-space:nowrap}.active{background:#111827;color:#fff}.grid{display:grid;gap:10px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:17px;padding:14px;display:flex;justify-content:space-between;gap:12px}.tag{display:inline-block;background:#eef2ff;color:#4338ca;border-radius:99px;padding:4px 7px;font-size:10px;font-weight:800}.name{font-weight:850;margin:5px 0}.desc{font-size:12px;color:#667085}.price{font-weight:900;margin-top:7px}.acts{display:flex;align-items:center;gap:7px}.btn{width:38px;height:38px;border:0;border-radius:11px;background:#eef2ff;color:#4338ca;font-size:20px;font-weight:900}.bar{position:fixed;bottom:0;left:0;right:0;padding:10px 14px;background:#fff;border-top:1px solid #ddd}.cart{width:min(900px,100%);margin:auto;border:0;border-radius:14px;background:#111827;color:#fff;padding:14px;font-weight:850}.sheet{display:none;position:fixed;inset:0;background:#0008;align-items:flex-end;z-index:10}.sheet.show{display:flex}.modal{background:#fff;width:100%;max-height:90vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px}.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #eee}.field{width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;margin-top:9px;font:inherit}.submit{width:100%;padding:13px;border:0;border-radius:12px;background:#4338ca;color:#fff;font-weight:850;margin-top:10px}@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:22px}}</style></head><body><main class="app"><header class="hero"><small>Repute-Tech · Digital ordering</small><h1>${esc(business.name)}</h1><p>All published menus are available in one order page.</p></header><div id="filters" class="filters"></div><section id="grid" class="grid"></section></main><div class="bar"><button id="cart" class="cart">View cart · <span id="summary">0 items · ₹0.00</span></button></div><div id="sheet" class="sheet"><section class="modal"><div style="display:flex;justify-content:space-between"><h2>Your order</h2><button id="close">Close</button></div><div id="rows"></div><h3>Total: ₹<span id="total">0.00</span></h3><input id="name" class="field" placeholder="Your name"><input id="phone" class="field" placeholder="Phone number (optional)"><textarea id="notes" class="field" rows="3" placeholder="Table number or special instructions"></textarea><button id="submit" class="submit">Place order</button><div id="msg" class="desc"></div></section></div><script>const ITEMS=${items},MENUS=${menus},SLUG=${JSON.stringify(slug)},cart=new Map();let active='All';const $=id=>document.getElementById(id),money=n=>Number(n).toFixed(2);function filters(){$('filters').innerHTML=['All',...MENUS].map(x=>'<button class="filter '+(x===active?'active':'')+'" onclick="pick('+JSON.stringify(x)+')">'+x+'</button>').join('')}function pick(x){active=x;filters();render()}function render(){const list=active==='All'?ITEMS:ITEMS.filter(x=>x.menuName===active);$('grid').innerHTML=list.length?list.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div><span class="tag">'+i.menuName+'</span><div class="name">'+i.name+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<div class="price">₹'+money(i.price)+'</div></div><div class="acts"><button class="btn" onclick="change('+JSON.stringify(i.id)+',-1)">−</button><b>'+(q||0)+'</b><button class="btn" onclick="change('+JSON.stringify(i.id)+',1)">+</button></div></article>'}).join(''):'<div class="card">No available items.</div>';let c=0,t=0;for(const[id,q]of cart){const i=ITEMS.find(x=>x.id===id);if(i){c+=q;t+=i.price*q}}$('summary').textContent=c+' item'+(c===1?'':'s')+' · ₹'+money(t)}function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);q?cart.set(id,q):cart.delete(id);render()}function openCart(){if(!cart.size)return alert('Add an item first.');let t=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;t+=line;return '<div class="row"><span>'+i.name+' × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(t);$('sheet').classList.add('show')}$('cart').onclick=openCart;$('close').onclick=()=>$('sheet').classList.remove('show');$('submit').onclick=async()=>{const name=$('name').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:SLUG,customerName:name,customerPhone:$('phone').value.trim(),notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');$('msg').textContent='Order '+j.order.orderNumber+' placed successfully.';cart.clear();render()}catch(e){$('msg').textContent=e.message;$('submit').disabled=false}};filters();render();</script></body></html>`;
}

function install(app){
  if(installed||installing)return;
  installing=true;
  app.route('/q/:slug/order').get(async(req,res,next)=>{try{const data=await load(req.params.slug);if(!data)return res.status(404).send('Order menu not found');if(!data.items.length)return res.status(404).send('No published menu items available');res.type('html').send(page(data,req.params.slug));}catch(e){next(e)}});
  app.route('/api/public/orders').post(async(req,res,next)=>{try{
    const slug=String(req.body?.slug||'').trim(),name=String(req.body?.customerName||'').trim(),phone=String(req.body?.customerPhone||'').trim()||null,notes=String(req.body?.notes||'').trim()||null,raw=Array.isArray(req.body?.items)?req.body.items:[];
    if(!slug||name.length<2||name.length>80||!raw.length)return res.status(400).json({error:'Name and at least one item are required'});
    const data=await load(slug);if(!data)return res.status(404).json({error:'Menu not found'});
    const wanted=new Map();for(const x of raw){const id=String(x?.menuItemId||''),q=Math.floor(Number(x?.quantity));if(id&&q>0&&q<=50)wanted.set(id,(wanted.get(id)||0)+q)}
    const chosen=data.items.filter(i=>wanted.has(i.id));if(!chosen.length)return res.status(400).json({error:'No available items selected'});
    const orderItems=chosen.map(i=>{const quantity=wanted.get(i.id);return {menuItemId:i.id,itemName:i.name,quantity,unitPrice:i.price,lineTotal:Number((i.price*quantity).toFixed(2))}});
    const total=Number(orderItems.reduce((s,i)=>s+i.lineTotal,0).toFixed(2));
    let customer=phone?await prisma.customer.findFirst({where:{businessId:data.qr.businessId,phone}}):null;
    if(!customer)customer=await prisma.customer.create({data:{businessId:data.qr.businessId,name,phone,lastInteractionAt:new Date()}});else await prisma.customer.update({where:{id:customer.id},data:{name,lastInteractionAt:new Date()}});
    const order=await prisma.order.create({data:{businessId:data.qr.businessId,menuId:chosen[0].menuId,customerId:customer.id,orderNumber:orderNumber(),customerName:name,customerPhone:phone,fulfilmentType:'IN_STORE',status:'PENDING',paymentStatus:'UNPAID',paymentMethod:'MANUAL',notes,total,items:{create:orderItems}},include:{items:true}});
    await prisma.customerInteraction.create({data:{customerId:customer.id,type:'ORDER_PLACED',channel:'DIGITAL_MENU',metadata:{orderId:order.id,orderNumber:order.orderNumber,total}}}).catch(()=>{});
    res.status(201).json({ok:true,order});
  }catch(e){next(e)}});
  installed=true;
  installing=false;
}

const originalRoute=express.application.route;
express.application.get=function(path,...handlers){install(this);return express.application.route===originalRoute?originalRoute.call(this,path).get(...handlers):this};
express.application.post=function(path,...handlers){install(this);return express.application.route===originalRoute?originalRoute.call(this,path).post(...handlers):this};
