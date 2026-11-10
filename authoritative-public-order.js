import express from 'express';
import { PrismaClient } from '@prisma/client';
import { isPlanFeatureEnabled } from './feature-entitlements.js';

const prisma = new PrismaClient();
let installed = false;
let installing = false;

const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const orderNumber=()=>`RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

async function load(slug){
  const qr=await prisma.smartQr.findUnique({where:{slug:String(slug||'')},include:{business:true}});
  if(!qr?.business||!qr.isActive)return null;
  const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
  const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),category:item.category||'',menuId:menu.id,menuName:menu.name,imageUrl:item.imageUrl||''})));
  return {qr,menus,items};
}

function page(data,slug){
  const business=data.qr.business;
  const items=JSON.stringify(data.items).replace(/</g,'\\u003c');
  const menus=JSON.stringify(data.menus.map(m=>m.name));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(business.name)} · Order</title><style>
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at 90% 0%,#e9eddf 0,transparent 36%),#f6f3e9;color:#292b25;font-family:"DM Sans",Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.app{max-width:900px;margin:auto;padding:18px 14px 120px}
.hero{background:linear-gradient(135deg,#e9eddf 0%,#f2f0e4 58%,#e3e9dc 100%);color:#303b2e;border:1px solid #e0e5d7;border-radius:26px;padding:25px 22px;box-shadow:0 14px 34px rgba(71,86,62,.09)}
.hero small{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#52694f;opacity:.82}
.hero h1{margin:8px 0 10px;font-family:Manrope,"DM Sans",sans-serif;font-size:clamp(27px,7vw,36px);line-height:1.12;letter-spacing:-.035em}
.hero p{margin:0;color:#606b59;line-height:1.55;font-size:15px;max-width:540px}
.filters{display:flex;gap:9px;overflow:auto;padding:15px 0}
.filter{border:1px solid #e1e4d8;background:#fffefa;color:#66745f;border-radius:999px;padding:10px 15px;font-weight:800;white-space:nowrap;cursor:pointer;touch-action:manipulation}
.active{background:#71866c;color:#fff;border-color:#52694f;box-shadow:0 5px 12px rgba(82,105,79,.16)}
.grid{display:grid;gap:11px}
.card{background:#fffefa;border:1px solid #e6e8de;border-radius:19px;padding:15px;display:flex;justify-content:space-between;gap:12px;box-shadow:0 6px 20px rgba(71,86,62,.045)}
.item-media{display:flex;gap:12px;align-items:flex-start;min-width:0}
.item-image{width:72px;height:72px;object-fit:cover;border-radius:14px;background:#e8eee4;display:block}
.tag{display:inline-block;background:#e8eee4;color:#52694f;border-radius:99px;padding:5px 8px;font-size:10px;font-weight:800}
.name{font-weight:850;margin:5px 0;color:#292b25}
.desc{font-size:12px;color:#77796f}
.price{font-weight:900;margin-top:7px;color:#303b2e}
.acts{display:flex;align-items:center;gap:7px}
.btn{width:42px;height:42px;border:1px solid #dce5d6;border-radius:12px;background:#edf2e9;color:#52694f;font-size:20px;font-weight:900;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.bar{position:fixed;bottom:0;left:0;right:0;padding:10px 14px;background:rgba(255,254,250,.96);backdrop-filter:blur(14px);border-top:1px solid #e5e7dc;z-index:5}
.cart{width:min(900px,100%);margin:auto;border:1px solid #52694f;border-radius:16px;background:linear-gradient(135deg,#71866c,#52694f);color:#fff;padding:15px;font-weight:850;cursor:pointer;touch-action:manipulation;box-shadow:0 9px 22px rgba(82,105,79,.2)}
.sheet{display:none;position:fixed;inset:0;background:rgba(35,40,31,.48);align-items:flex-end;z-index:10}
.sheet.show{display:flex}
.modal{background:#fffefa;width:100%;max-height:90vh;overflow:auto;border:1px solid #e8e7de;border-radius:24px 24px 0 0;padding:18px}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #efeee8}
.field{width:100%;padding:12px;border:1px solid #e1e4d8;border-radius:12px;margin-top:9px;font:inherit;background:#fff;color:#292b25}
.submit{width:100%;padding:13px;border:0;border-radius:13px;background:linear-gradient(135deg,#71866c,#52694f);color:#fff;font-weight:850;margin-top:10px;box-shadow:0 7px 17px rgba(82,105,79,.16)}
.close{border:1px solid #dfe5d8;background:#edf2e9;color:#52694f;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer;touch-action:manipulation}
.success{display:none;position:fixed;inset:0;background:#f6f3e9;z-index:20;overflow:auto}
.success.show{display:block}
.success-wrap{max-width:620px;margin:auto;padding:18px 14px 36px}
.success-card{background:#fffefa;border:1px solid #e6e8de;border-radius:24px;padding:22px;box-shadow:0 12px 35px rgba(71,86,62,.09)}
.success-icon{width:72px;height:72px;border-radius:50%;background:#e3ecdd;color:#52694f;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:900;margin:4px auto 16px}
.success h1{text-align:center;margin:0 0 8px;font-size:28px;color:#303b2e}
.success-sub{text-align:center;color:#77796f;margin:0 0 22px}
.success-order{background:#edf2e9;border:1px solid #dfe7d9;border-radius:16px;padding:15px;text-align:center;margin-bottom:18px}
.success-order small{display:block;color:#66745f;font-weight:700;margin-bottom:4px}
.success-order strong{font-size:22px;color:#303b2e}
.success-total{display:flex;justify-content:space-between;font-size:18px;font-weight:850;padding:14px 0;border-bottom:1px solid #efeee8}
.success-items{margin-top:6px}
.success-item{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #efeee8}
.success-item span:last-child{font-weight:800;white-space:nowrap}
.status-box{margin-top:20px;border:1px solid #e6e8de;border-radius:16px;padding:16px;background:#fff}
.status-title{font-weight:850;margin-bottom:12px;color:#303b2e}
.status-line{display:flex;gap:12px;align-items:flex-start}
.status-dot{width:13px;height:13px;border-radius:50%;background:#71866c;margin-top:4px;flex:none}
.status-line strong{display:block;color:#303b2e}
.status-line span{font-size:12px;color:#77796f}
.payment-box{margin-top:14px;background:#f2f0e4;border-radius:14px;padding:14px;color:#52694f}
.payment-box strong{display:block}
.success-actions{display:grid;gap:10px;margin-top:20px}
.success-actions button{width:100%;padding:14px;border:0;border-radius:13px;font-weight:850;font-size:15px;cursor:pointer;touch-action:manipulation}
.primary-action{background:#71866c;color:#fff}
.secondary-action{background:#edf2e9;color:#52694f}
@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:24px}}
@media(max-width:420px){.success-wrap{padding:12px 10px 28px}.success-card{padding:18px}.success h1{font-size:25px}}
</style></head><body><main class="app"><header class="hero"><small>reputetechs.in · Digital ordering</small><h1>${esc(business.name)}</h1><p>Where elegance meets excellence, and every moment feels extraordinary.</p></header><div id="filters" class="filters"></div><section id="grid" class="grid"></section></main><div class="bar"><button id="cart" class="cart" type="button">View cart · <span id="summary">0 items · ₹0.00</span></button></div><div id="sheet" class="sheet"><section class="modal"><div style="display:flex;justify-content:space-between"><h2>Your order</h2><button id="close" class="close" type="button">Close</button></div><div id="rows"></div><h3>Total: ₹<span id="total">0.00</span></h3><input id="name" class="field" placeholder="Your name"><input id="phone" class="field" placeholder="Phone number" required inputmode="tel"><textarea id="notes" class="field" rows="3" placeholder="Seat no / Table no / Instructions"></textarea><button id="submit" class="submit" type="button">Place order</button><div id="msg" class="desc"></div></section></div><div id="success" class="success"><div class="success-wrap"><section class="success-card"><div class="success-icon">✓</div><h1>Order placed successfully</h1><p class="success-sub">Thank you, <span id="successName"></span>. Your order has been received.</p><div class="success-order"><small>ORDER NUMBER</small><strong id="successNumber">—</strong></div><div class="success-total"><span>Total</span><span>₹<span id="successTotal">0.00</span></span></div><div id="successItems" class="success-items"></div><div class="status-box"><div class="status-title">Order status</div><div class="status-line"><div class="status-dot"></div><div><strong>Order received</strong><span>Your order is now pending with the business.</span></div></div></div><div class="payment-box"><strong>Payment</strong><span>Pay at store · Unpaid</span></div><div id="successNotes" class="payment-box" style="display:none"></div><div class="success-actions"><button id="orderMore" class="primary-action" type="button">Order more items</button><button id="done" class="secondary-action" type="button">Done</button></div></section></div></div><script>
const ITEMS=${items},MENUS=${menus},SLUG=${JSON.stringify(slug)},cart=new Map();
let active='All';
const $=id=>document.getElementById(id),money=n=>Number(n).toFixed(2);
function filters(){
  $('filters').innerHTML=['All',...MENUS].map(x=>'<button type="button" class="filter '+(x===active?'active':'')+'" data-menu="'+encodeURIComponent(x)+'">'+x+'</button>').join('');
}
function render(){
  const list=active==='All'?ITEMS:ITEMS.filter(x=>x.menuName===active);
  $('grid').innerHTML=list.length?list.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div class="item-media">'+(i.imageUrl?'<img class="item-image" src="'+i.imageUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'" alt="'+i.name.replace(/"/g,'&quot;')+'" loading="lazy">':'')+'<div><span class="tag">'+i.menuName+'</span><div class="name">'+i.name+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<div class="price">₹'+money(i.price)+'</div></div><div class="acts"><button type="button" class="btn" data-item="'+encodeURIComponent(i.id)+'" data-delta="-1" aria-label="Remove one">−</button><b>'+q+'</b><button type="button" class="btn" data-item="'+encodeURIComponent(i.id)+'" data-delta="1" aria-label="Add one">+</button></div></article>'}).join(''):'<div class="card">No available items.</div>';
  let c=0,t=0;for(const[id,q]of cart){const i=ITEMS.find(x=>x.id===id);if(i){c+=q;t+=i.price*q;}}
  $('summary').textContent=c+' item'+(c===1?'':'s')+' · ₹'+money(t);
}
function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);if(q)cart.set(id,q);else cart.delete(id);render();}
function openCart(){if(!cart.size){alert('Add an item first.');return;}let t=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;t+=line;return '<div class="row"><span>'+i.name+' × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(t);$('sheet').classList.add('show');}
function showSuccess(order){
  $('sheet').classList.remove('show');
  $('successName').textContent=order.customerName||$('name').value.trim()||'Customer';
  $('successNumber').textContent=order.orderNumber||'—';
  $('successTotal').textContent=money(order.total||0);
  $('successItems').innerHTML=(Array.isArray(order.items)?order.items:[]).map(i=>'<div class="success-item"><span>'+i.itemName+' × '+i.quantity+'</span><span>₹'+money(i.lineTotal)+'</span></div>').join('');
  const notes=String(order.notes||'').trim();
  if(notes){$('successNotes').style.display='block';$('successNotes').innerHTML='<strong>Instructions</strong><span>'+notes.replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]))+'</span>'}else{$('successNotes').style.display='none';$('successNotes').textContent=''}
  $('success').classList.add('show');
}
$('filters').addEventListener('click',e=>{const b=e.target.closest('[data-menu]');if(!b)return;active=decodeURIComponent(b.dataset.menu||'All');filters();render();});
$('grid').addEventListener('click',e=>{const b=e.target.closest('[data-item]');if(!b)return;e.preventDefault();change(decodeURIComponent(b.dataset.item||''),Number(b.dataset.delta||0));});
$('cart').addEventListener('click',openCart);
$('close').addEventListener('click',()=>$('sheet').classList.remove('show'));
$('sheet').addEventListener('click',e=>{if(e.target===$('sheet'))$('sheet').classList.remove('show');});
$('orderMore').addEventListener('click',()=>{$('success').classList.remove('show');window.scrollTo({top:0,behavior:'smooth'});});
$('done').addEventListener('click',()=>{$('success').classList.remove('show');});
$('submit').addEventListener('click',async()=>{const name=$('name').value.trim(),phone=$('phone').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}if(!phone){$('msg').textContent='Please enter your phone number.';$('phone').focus();return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:SLUG,customerName:name,customerPhone:phone,notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');cart.clear();render();showSuccess(j.order)}catch(e){$('msg').textContent=e.message}finally{$('submit').disabled=false}});
filters();render();
</script></body></html>`;
}

function install(app){
  if(installed||installing)return;
  installing=true;
  app.route('/q/:slug/order').get(async(req,res,next)=>{try{const data=await load(req.params.slug);if(!data)return res.status(404).send('Order menu not found');if(!data.items.length)return res.status(404).send('No published menu items available');res.type('html').send(page(data,req.params.slug));}catch(e){next(e)}});
  // Parse the public checkout JSON at the route itself. This route is installed
  // before server (1).js adds the application's global express.json() middleware,
  // so relying only on the later global parser leaves req.body empty.
  app.route('/api/public/orders').post(express.json({limit:'1mb'}),async(req,res,next)=>{try{
    const slug=String(req.body?.slug||'').trim(),name=String(req.body?.customerName||'').trim(),phone=String(req.body?.customerPhone||'').trim()||null,notes=String(req.body?.notes||'').trim()||null,raw=Array.isArray(req.body?.items)?req.body.items:[];
    if(!slug||name.length<2||name.length>80||!phone||raw.length===0)return res.status(400).json({error:'Name, phone number and at least one item are required'});
    const data=await load(slug);if(!data)return res.status(404).json({error:'Menu not found'});
    if(!(await isPlanFeatureEnabled(data.qr.businessId,'ORDERS')))return res.status(403).json({error:'Online ordering is disabled for this business plan.',feature:'ORDERS',featureDisabled:true});
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
const originalGet=express.application.get;
const originalPost=express.application.post;
express.application.get=function(path,...handlers){
  if(handlers.length===0)return originalGet.call(this,path);
  install(this);
  return originalRoute.call(this,path).get(...handlers);
};
express.application.post=function(path,...handlers){
  install(this);
  return originalRoute.call(this,path).post(...handlers);
};
