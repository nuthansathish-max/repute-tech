import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const previousListen = express.application.listen;
const originalGet = express.application.get;
const originalPost = express.application.post;

const esc = (v) => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const orderNumber = () => `RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

async function load(slug){
  const qr = await prisma.smartQr.findUnique({ where:{slug:String(slug||'')}, include:{business:true} });
  if(!qr?.business || !qr.isActive) return null;
  const menus = await prisma.menu.findMany({
    where:{businessId:qr.businessId,isPublished:true},
    orderBy:{createdAt:'desc'},
    include:{items:{where:{available:true},orderBy:{name:'asc'}}}
  });
  const items = menus.flatMap(menu => menu.items.map(item => ({
    id:item.id,name:item.name,description:item.description||'',price:Number(item.price),
    category:item.category||'',menuId:menu.id,menuName:menu.name
  })));
  return {qr,menus,items};
}

function page(data,slug){
  const {business,menus,items} = {business:data.qr.business,menus:data.menus,items:data.items};
  const safe = JSON.stringify(items).replace(/</g,'\\u003c');
  const cats = JSON.stringify(['All',...menus.map(m=>m.name)]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111827"><title>${esc(business.name)} · Order</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif}.app{max-width:900px;margin:auto;padding:14px 14px 105px}.hero{background:linear-gradient(135deg,#111827,#4338ca);color:#fff;border-radius:24px;padding:22px}.ey{font-size:10px;letter-spacing:.13em;text-transform:uppercase;opacity:.7}.hero h1{margin:6px 0}.hero p{margin:0;color:#e5e7eb}.filters{display:flex;gap:8px;overflow:auto;padding:14px 0}.f{border:1px solid #ddd;background:#fff;border-radius:999px;padding:9px 13px;font-weight:800;white-space:nowrap}.f.on{background:#111827;color:#fff}.grid{display:grid;gap:11px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:15px;display:flex;justify-content:space-between;gap:12px}.meta{min-width:0}.tag{display:inline-block;font-size:10px;font-weight:800;color:#4338ca;background:#eef2ff;border-radius:99px;padding:5px 8px;margin-bottom:7px}.name{font-size:16px;font-weight:850}.desc{font-size:12px;color:#667085;margin:5px 0}.price{font-weight:900}.acts{display:flex;align-items:center;gap:7px}.btn{width:38px;height:38px;border:0;border-radius:11px;background:#eef2ff;color:#4338ca;font-size:20px;font-weight:900}.qty{min-width:18px;text-align:center;font-weight:900}.bar{position:fixed;bottom:0;left:0;right:0;background:rgba(255,255,255,.96);border-top:1px solid #e5e7eb;padding:10px 14px}.cart{display:flex;justify-content:space-between;align-items:center;width:min(900px,100%);margin:auto;border:0;border-radius:14px;background:#111827;color:#fff;padding:14px 16px;font-weight:850}.sheet{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:20;align-items:flex-end}.sheet.show{display:flex}.modal{background:#fff;width:100%;max-height:90vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px}.head{display:flex;justify-content:space-between}.close{border:0;border-radius:10px;padding:9px 11px;font-weight:800}.row{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #eee}.field{width:100%;padding:12px;border:1px solid #d9dde5;border-radius:11px;margin-top:9px;font:inherit}.submit{width:100%;padding:13px;border:0;border-radius:12px;background:#4338ca;color:#fff;font-weight:850;margin-top:12px}.msg{font-size:12px;color:#667085;margin-top:9px}@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:24px}}</style></head><body><main class="app"><header class="hero"><div class="ey">Repute-Tech · Digital ordering</div><h1>${esc(business.name)}</h1><p>All available items are shown here. Add items from different menus to the same cart.</p></header><div id="filters" class="filters"></div><section id="grid" class="grid"></section></main><div class="bar"><button id="cart" class="cart"><span>View cart</span><b id="summary">0 items · ₹0.00</b></button></div><div id="sheet" class="sheet"><section class="modal"><div class="head"><div><div class="ey" style="color:#4338ca">Checkout</div><h2 style="margin:4px 0">Your order</h2></div><button id="close" class="close">Close</button></div><div id="rows"></div><div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;margin-top:14px"><span>Total</span><span>₹<span id="total">0.00</span></span></div><input id="name" class="field" placeholder="Your name" maxlength="80"><input id="phone" class="field" placeholder="Phone number (optional)" maxlength="30"><textarea id="notes" class="field" rows="3" maxlength="500" placeholder="Table number or special instructions"></textarea><button id="submit" class="submit">Place order</button><div id="msg" class="msg"></div></section></div><script>const ITEMS=${safe},CATS=${cats},SLUG=${JSON.stringify(slug)},cart=new Map();let active='All';const $=id=>document.getElementById(id),money=n=>Number(n).toFixed(2);function filters(){if(CATS.length<2){$('filters').style.display='none';return}$('filters').innerHTML=CATS.map(c=>'<button class="f '+(c===active?'on':'')+'" onclick="pick('+JSON.stringify(c)+')">'+c+'</button>').join('')}function pick(c){active=c;filters();render()}function render(){const list=active==='All'?ITEMS:ITEMS.filter(i=>i.menuName===active);$('grid').innerHTML=list.length?list.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div class="meta">'+(i.menuName?'<span class="tag">'+i.menuName+'</span>':'')+'<div class="name">'+i.name+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<span class="price">₹'+money(i.price)+'</span></div><div class="acts"><button class="btn" onclick="change('+JSON.stringify(i.id)+',-1)">−</button><span class="qty">'+q+'</span><button class="btn" onclick="change('+JSON.stringify(i.id)+',1)">+</button></div></article>'}).join(''):'<div class="card">No available items.</div>';let count=0,total=0;for(const [id,q] of cart){const i=ITEMS.find(x=>x.id===id);if(i){count+=q;total+=i.price*q}}$('summary').textContent=count+' item'+(count===1?'':'s')+' · ₹'+money(total)}function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);if(q)cart.set(id,q);else cart.delete(id);render()}function showCart(){if(!cart.size){alert('Add an item first.');return}let total=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;total+=line;return '<div class="row"><span>'+i.name+' × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(total);$('sheet').classList.add('show')}$('cart').onclick=showCart;$('close').onclick=()=>$('sheet').classList.remove('show');$('sheet').onclick=e=>{if(e.target.id==='sheet')$('sheet').classList.remove('show')};$('submit').onclick=async()=>{const name=$('name').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:SLUG,customerName:name,customerPhone:$('phone').value.trim(),notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');$('sheet').classList.remove('show');alert('Order '+j.order.orderNumber+' placed successfully.');cart.clear();render()}catch(e){$('msg').textContent=e.message;$('submit').disabled=false}};filters();render();</script></body></html>`;
}

function install(app){
  originalGet.call(app,'/q/:slug/order',async(req,res)=>{
    try{const data=await load(req.params.slug);if(!data)return res.status(404).send('Order menu not found');if(!data.items.length)return res.status(404).send('No published menu items available');res.type('html').send(page(data,req.params.slug));}
    catch(e){console.error('[public-all-order-route]',e);res.status(500).send('Unable to load order menu');}
  });
  originalPost.call(app,'/api/public/orders',async(req,res)=>{
    try{
      const slug=String(req.body?.slug||'').trim();
      const name=String(req.body?.customerName||'').trim();
      const phone=String(req.body?.customerPhone||'').trim();
      const notes=String(req.body?.notes||'').trim();
      const raw=Array.isArray(req.body?.items)?req.body.items:[];
      if(!slug||name.length<2||name.length>80||!raw.length)return res.status(400).json({error:'Name and at least one item are required'});
      const data=await load(slug);if(!data)return res.status(404).json({error:'Menu not found'});
      const wanted=new Map();for(const x of raw){const id=String(x?.menuItemId||'');const q=Math.floor(Number(x?.quantity));if(id&&q>0&&q<=50)wanted.set(id,(wanted.get(id)||0)+q)}
      const chosen=data.items.filter(i=>wanted.has(i.id));if(!chosen.length)return res.status(400).json({error:'No available items selected'});
      const orderItems=chosen.map(i=>{const quantity=wanted.get(i.id),unitPrice=i.price;return {menuItemId:i.id,itemName:i.name,quantity,unitPrice,lineTotal:Number((unitPrice*quantity).toFixed(2))}});
      const total=Number(orderItems.reduce((s,i)=>s+i.lineTotal,0).toFixed(2));
      let customer=phone?await prisma.customer.findFirst({where:{businessId:data.qr.businessId,phone}}):null;
      if(!customer)customer=await prisma.customer.create({data:{businessId:data.qr.businessId,name,phone,lastInteractionAt:new Date()}});else await prisma.customer.update({where:{id:customer.id},data:{name,lastInteractionAt:new Date()}});
      const primaryMenuId=chosen[0].menuId;
      const order=await prisma.order.create({data:{businessId:data.qr.businessId,menuId:primaryMenuId,customerId:customer.id,orderNumber:orderNumber(),customerName:name,customerPhone:phone,fulfilmentType:'IN_STORE',status:'PENDING',paymentStatus:'UNPAID',paymentMethod:'MANUAL',notes,total,items:{create:orderItems}},include:{items:true}});
      await prisma.customerInteraction.create({data:{customerId:customer.id,type:'ORDER_PLACED',channel:'DIGITAL_MENU',metadata:{orderId:order.id,orderNumber:order.orderNumber,total}}}).catch(()=>{});
      res.status(201).json({ok:true,order});
    }catch(e){console.error('[public-all-order-route POST]',e);res.status(500).json({error:'Unable to place order'});}
  });
}

express.application.listen = function(...args){
  const server = previousListen.apply(this,args);
  try{install(this);}catch(e){console.error('[public-all-order-route install]',e)}
  return server;
};
