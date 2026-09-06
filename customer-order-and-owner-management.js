import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const previousListen = express.application.listen;
const originalGet = express.application.get;
const originalPost = express.application.post;
const originalPut = express.application.put;
const originalPatch = express.application.patch;
const originalDelete = express.application.delete;
const originalSend = express.response.send;
let registered = false;

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date())return null;
  return s.user;
}

async function businessAccess(req,businessId){
  const user=await userFrom(req);
  if(!user)return {error:'Authentication required',status:401};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});
  if(!business)return {error:'Business access denied',status:403};
  return {user,business};
}

function orderNumber(){return `RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;}

async function loadPublicMenus(slug){
  const qr=await prisma.smartQr.findUnique({where:{slug},include:{business:true}});
  if(!qr?.business || !qr.isActive)return null;
  const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
  const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),category:item.category||'',menuId:menu.id,menuName:menu.name})));
  return {qr,menus,items};
}

function publicAllOrderPage(business,items,slug,primaryMenuId){
  const safe=JSON.stringify(items).replace(/</g,'\\u003c');
  const title=`${business.name} · Order`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif}.app{max-width:900px;margin:auto;padding:14px 14px 120px}.top{background:linear-gradient(135deg,#111827,#4338ca 70%,#6366f1);color:#fff;border-radius:26px;padding:22px;box-shadow:0 18px 40px rgba(31,41,95,.2)}.eyebrow{font-size:10px;letter-spacing:.13em;text-transform:uppercase;opacity:.72}.top h1{margin:7px 0 6px;font-size:28px}.top p{margin:0;color:#e5e7eb;line-height:1.5}.trust{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.trust span{font-size:11px;padding:7px 9px;border-radius:999px;background:rgba(255,255,255,.12)}.toolbar{display:flex;gap:8px;overflow:auto;padding:14px 0 5px}.filter{border:1px solid #e1e4ea;background:#fff;border-radius:999px;padding:9px 13px;font-weight:750;white-space:nowrap}.filter.active{background:#111827;color:#fff;border-color:#111827}.grid{display:grid;gap:11px;margin-top:12px}.card{background:#fff;border:1px solid #e6e8ef;border-radius:19px;padding:15px;display:flex;gap:12px;justify-content:space-between;box-shadow:0 6px 20px rgba(16,24,40,.045)}.info{min-width:0}.cat{display:inline-block;font-size:10px;font-weight:800;color:#4338ca;background:#eef2ff;border-radius:999px;padding:5px 8px;margin-bottom:7px}.name{font-weight:850;font-size:16px}.desc{margin:5px 0 8px;color:#667085;font-size:12.5px;line-height:1.45}.price{font-weight:900}.actions{display:flex;align-items:center;gap:7px;align-self:center}.circle{width:38px;height:38px;border:0;border-radius:12px;background:#eef2ff;color:#4338ca;font-size:20px;font-weight:900}.count{min-width:20px;text-align:center;font-weight:850}.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 14px;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-top:1px solid #e5e7eb;z-index:20}.cartBtn{width:min(900px,100%);margin:auto;display:flex;justify-content:space-between;align-items:center;border:0;border-radius:15px;background:#111827;color:#fff;padding:13px 15px;font-size:15px;font-weight:850}.sheet{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:flex-end;z-index:30}.sheet.show{display:flex}.modal{background:#fff;width:100%;max-height:88vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px 16px}.modalHead{display:flex;justify-content:space-between;align-items:center}.close{border:0;background:#f2f4f7;border-radius:10px;padding:9px 11px;font-weight:800}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #eef0f4}.field{width:100%;border:1px solid #dfe3eb;border-radius:12px;padding:12px;font:inherit;margin-top:9px}.submit{width:100%;border:0;border-radius:13px;padding:13px;background:#4338ca;color:#fff;font-weight:850;font-size:15px;margin-top:12px}.note{font-size:12px;color:#667085;line-height:1.45}.success{background:#ecfdf3;border:1px solid #bbf7d0;border-radius:16px;padding:16px;color:#166534}.track{display:inline-block;margin-top:10px;background:#166534;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800}.empty{text-align:center;background:#fff;border:1px dashed #d9dde7;border-radius:18px;padding:28px;color:#667085}@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:24px}}</style></head><body><main class="app"><header class="top"><div class="eyebrow">Repute-Tech · Digital ordering</div><h1>${business.name}</h1><p>All menu items · Add items from any menu to one cart and place your order.</p><div class="trust"><span>✓ All menus</span><span>✓ One cart</span><span>✓ In-store payment</span></div></header><div id="filters" class="toolbar"></div><div id="grid" class="grid"></div></main><div class="bar"><button id="cartBtn" class="cartBtn"><span>View cart</span><strong id="cartLabel">0 items · ₹0.00</strong></button></div><div id="sheet" class="sheet"><section class="modal"><div class="modalHead"><div><div class="eyebrow" style="color:#4338ca">All menus · Checkout</div><h2 style="margin:3px 0">Your order</h2></div><button id="close" class="close">Close</button></div><div id="rows"></div><div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;margin-top:13px"><span>Total</span><span>₹<span id="total">0.00</span></span></div><input id="name" class="field" maxlength="80" placeholder="Your name"><input id="phone" class="field" maxlength="30" placeholder="Phone number (optional)"><textarea id="notes" class="field" maxlength="500" rows="3" placeholder="Table number or special instructions (optional)"></textarea><button id="submit" class="submit">Place order</button><p class="note">Payment is collected manually at the store. Your order starts as <b>PENDING</b>.</p><div id="msg" class="note"></div></section></div><script>const ITEMS=${safe},SLUG=${JSON.stringify(slug)},MENU_ID=${JSON.stringify(primaryMenuId)},cart=new Map();const $=x=>document.getElementById(x);const cats=['All menus',...new Set(ITEMS.map(x=>x.menuName).filter(Boolean))];let active='All menus';function money(n){return Number(n).toFixed(2)}function renderFilters(){if(cats.length<=1){$('filters').style.display='none';return}$('filters').innerHTML=cats.map(c=>'<button class="filter '+(c===active?'active':'')+'" onclick="setCat('+JSON.stringify(c)+')">'+c+'</button>').join('')}function setCat(c){active=c;renderFilters();render()}function render(){const visible=active==='All menus'?ITEMS:ITEMS.filter(x=>x.menuName===active);$('grid').innerHTML=visible.length?visible.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div class="info">'+(i.category?'<span class="cat">'+i.category+'</span>':'')+'<div class="name">'+i.name+'</div><div style="font-size:11px;color:#667085;margin-top:4px">'+i.menuName+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<span class="price">₹'+money(i.price)+'</span></div><div class="actions"><button class="circle" onclick="change('+JSON.stringify(i.id)+',-1)">−</button><span class="count">'+q+'</span><button class="circle" onclick="change('+JSON.stringify(i.id)+',1)">+</button></div></article>'}).join(''):'<div class="empty">No items are available right now.</div>';let count=0,total=0;for(const [id,q] of cart){const i=ITEMS.find(x=>x.id===id);if(i){count+=q;total+=i.price*q}}$('cartLabel').textContent=count+' item'+(count===1?'':'s')+' · ₹'+money(total)}function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);if(q)cart.set(id,q);else cart.delete(id);render()}function openCart(){if(!cart.size){alert('Add an item first.');return}$('sheet').classList.add('show');renderCart()}function renderCart(){let total=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;total+=line;return '<div class="row"><span>'+i.name+' <small style="color:#667085">('+i.menuName+')</small> × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(total)}$('cartBtn').onclick=openCart;$('close').onclick=()=>$('sheet').classList.remove('show');$('sheet').onclick=e=>{if(e.target.id==='sheet')$('sheet').classList.remove('show')};$('submit').onclick=async()=>{const name=$('name').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing your order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({menuId:MENU_ID,customerName:name,customerPhone:$('phone').value.trim(),notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');document.querySelector('.modal').innerHTML='<div class="success"><div class="eyebrow" style="color:#166534">Order received</div><h2 style="margin:4px 0 7px">Order placed ✓</h2><p>Order <b>'+j.order.orderNumber+'</b> has been sent to the business.</p><p>Payment is collected manually at the store.</p><a class="track" href="/q/'+encodeURIComponent(SLUG)+'">Back to menu</a></div>';cart.clear();render()}catch(e){$('msg').textContent=e.message;$('submit').disabled=false}};renderFilters();render();</script></body></html>`;
}

async function registerRoutes(app){
  if(registered)return;
  registered=true;

  originalGet.call(app,'/q/:slug/order',async(req,res,next)=>{
    try{
      const data=await loadPublicMenus(String(req.params.slug||''));
      if(!data)return res.status(404).send('Order menu not found');
      if(!data.menus.length)return res.status(404).send('No published menu available');
      return res.type('html').send(publicAllOrderPage(data.qr.business,data.items,data.qr.slug,data.menus[0].id));
    }catch(e){next(e)}
  });

  originalPost.call(app,'/api/public/orders',async(req,res,next)=>{
    try{
      const b=req.body||{};
      const menuId=String(b.menuId||'');
      const customerName=String(b.customerName||'').trim();
      const customerPhone=String(b.customerPhone||'').trim()||null;
      const notes=String(b.notes||'').trim()||null;
      const rawItems=Array.isArray(b.items)?b.items:[];
      if(!menuId||customerName.length<2||customerName.length>80||rawItems.length<1)return res.status(400).json({error:'Name, menu and at least one item are required'});
      const anchor=await prisma.menu.findFirst({where:{id:menuId,isPublished:true},include:{business:true}});
      if(!anchor)return res.status(404).json({error:'Menu not found'});
      const menus=await prisma.menu.findMany({where:{businessId:anchor.businessId,isPublished:true},include:{items:true}});
      const byId=new Map(menus.flatMap(m=>m.items.filter(i=>i.available).map(i=>[i.id,{item:i,menu:m}])));
      const requested=new Map();
      for(const x of rawItems){const id=String(x?.menuItemId||''),q=Math.floor(Number(x?.quantity));if(id&&q>0&&q<=50)requested.set(id,(requested.get(id)||0)+q)}
      const chosen=[];
      for(const [id,quantity] of requested){const found=byId.get(id);if(found)chosen.push({item:found.item,menu:found.menu,quantity})}
      if(!chosen.length)return res.status(400).json({error:'No available items selected'});
      const items=chosen.map(({item,quantity})=>{const unitPrice=Number(item.price);return {menuItemId:item.id,itemName:item.name,quantity,unitPrice,lineTotal:Number((unitPrice*quantity).toFixed(2))}});
      const total=Number(items.reduce((s,i)=>s+i.lineTotal,0).toFixed(2));
      let customer=customerPhone?await prisma.customer.findFirst({where:{businessId:anchor.businessId,phone:customerPhone}}):null;
      if(!customer)customer=await prisma.customer.create({data:{businessId:anchor.businessId,name:customerName,phone:customerPhone,lastInteractionAt:new Date()}});
      else await prisma.customer.update({where:{id:customer.id},data:{name:customerName,lastInteractionAt:new Date()}});
      const order=await prisma.order.create({data:{businessId:anchor.businessId,menuId:anchor.id,customerId:customer.id,orderNumber:orderNumber(),customerName,customerPhone,fulfilmentType:'IN_STORE',status:'PENDING',paymentStatus:'UNPAID',paymentMethod:'MANUAL',notes,total,items:{create:items}},include:{items:true}});
      await prisma.customerInteraction.create({data:{customerId:customer.id,type:'ORDER_PLACED',channel:'DIGITAL_MENU',metadata:{orderId:order.id,orderNumber:order.orderNumber,total}}}).catch(()=>{});
      return res.status(201).json({ok:true,order});
    }catch(e){next(e)}
  });

  originalGet.call(app,'/api/businesses/:businessId/menus',async(req,res,next)=>{
    try{const a=await businessAccess(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});res.json(await prisma.menu.findMany({where:{businessId:a.business.id},include:{items:true},orderBy:{createdAt:'desc'}}));}catch(e){next(e)}
  });

  originalPut.call(app,'/api/businesses/:businessId/menus/:menuId',async(req,res,next)=>{
    try{const a=await businessAccess(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});const menu=await prisma.menu.findFirst({where:{id:req.params.menuId,businessId:a.business.id}});if(!menu)return res.status(404).json({error:'Menu not found'});const name=String(req.body?.name||'').trim();if(name.length<1)return res.status(400).json({error:'Menu name is required'});const updated=await prisma.menu.update({where:{id:menu.id},data:{name,isPublished:req.body?.isPublished===undefined?menu.isPublished:!!req.body.isPublished}});res.json(updated);}catch(e){next(e)}
  });

  originalDelete.call(app,'/api/businesses/:businessId/menus/:menuId',async(req,res,next)=>{
    try{const a=await businessAccess(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});const menu=await prisma.menu.findFirst({where:{id:req.params.menuId,businessId:a.business.id},include:{items:true}});if(!menu)return res.status(404).json({error:'Menu not found'});const references=menu.items.length?await prisma.orderItem.count({where:{menuItemId:{in:menu.items.map(i=>i.id)}}}):0;if(references>0)return res.status(409).json({error:'This menu has items used by past orders. Unpublish it instead of deleting it.'});await prisma.$transaction([prisma.menuItem.deleteMany({where:{menuId:menu.id}}),prisma.menu.delete({where:{id:menu.id}})]);res.json({ok:true});}catch(e){next(e)}
  });

  originalPut.call(app,'/api/businesses/:businessId/qr/:id',async(req,res,next)=>{
    try{const a=await businessAccess(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});const qr=await prisma.smartQr.findFirst({where:{id:req.params.id,businessId:a.business.id}});if(!qr)return res.status(404).json({error:'QR scanner not found'});const name=String(req.body?.name??qr.name).trim();const slug=String(req.body?.slug??qr.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');if(name.length<1||slug.length<2)return res.status(400).json({error:'Valid scanner name and slug are required'});const clash=await prisma.smartQr.findFirst({where:{slug,id:{not:req.params.id}}});if(clash)return res.status(409).json({error:'That scanner slug is already in use'});const updated=await prisma.smartQr.update({where:{id:qr.id},data:{name,slug,isActive:req.body?.isActive===undefined?qr.isActive:!!req.body.isActive}});res.json(updated);}catch(e){next(e)}
  });

  originalDelete.call(app,'/api/businesses/:businessId/qr/:id',async(req,res,next)=>{
    try{const a=await businessAccess(req,req.params.businessId);if(a.error)return res.status(a.status).json({error:a.error});const qr=await prisma.smartQr.findFirst({where:{id:req.params.id,businessId:a.business.id}});if(!qr)return res.status(404).json({error:'QR scanner not found'});await prisma.smartQr.delete({where:{id:qr.id}});res.json({ok:true});}catch(e){next(e)}
  });
}

express.application.listen=function ownerAndOrderListen(...args){
  return (async()=>{await registerRoutes(this);return previousListen.apply(this,args)})();
};

if(!express.response.__ownerManagementUi){
  express.response.__ownerManagementUi=true;
  express.response.send=function ownerManagementSend(body){
    try{
      const req=this.req;
      if(req && typeof body==='string' && body.includes('id="menuList"') && body.includes('id="qrList"') && body.includes('</body>')){
        const script=`<script>(function(){const A='/api';const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));async function j(p,o={}){const r=await fetch(A+p,{credentials:'include',headers:{'Content-Type':'application/json',...(o.headers||{})},...o});const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t}}if(!r.ok)throw new Error(d.error||'Request failed');return d}async function b(){const s=await j('/business/status');if(s?.businessId)return s.businessId;const x=await j('/businesses');return x[0]?.id}async function menus(){const id=await b(),rows=await j('/businesses/'+encodeURIComponent(id)+'/menus');const box=document.getElementById('menuList');if(!box)return;box.querySelectorAll('.item').forEach((el,i)=>{const m=rows[i];if(!m||el.querySelector('.owner-menu-actions'))return;const a=document.createElement('div');a.className='owner-menu-actions';a.style='display:flex;gap:7px;margin-top:9px;flex-wrap:wrap';a.innerHTML='<button class="btn secondary" type="button">Edit</button><button class="btn secondary" type="button" style="color:#b42318">Delete</button>';a.children[0].onclick=async()=>{const name=prompt('Menu name:',m.name);if(name===null)return;try{await j('/businesses/'+encodeURIComponent(id)+'/menus/'+encodeURIComponent(m.id),{method:'PUT',body:JSON.stringify({name:name.trim(),isPublished:m.isPublished})});location.reload()}catch(e){alert(e.message)}};a.children[1].onclick=async()=>{if(!confirm('Delete menu "'+m.name+'"? This cannot be undone.'))return;try{await j('/businesses/'+encodeURIComponent(id)+'/menus/'+encodeURIComponent(m.id),{method:'DELETE'});location.reload()}catch(e){alert(e.message)}};el.appendChild(a)})}async function qrs(){const id=await b(),rows=await j('/businesses/'+encodeURIComponent(id)+'/qr');const box=document.getElementById('qrList');if(!box)return;box.querySelectorAll('.item').forEach((el,i)=>{const q=rows[i];if(!q||el.querySelector('.owner-qr-actions'))return;const a=document.createElement('div');a.className='owner-qr-actions';a.style='display:flex;gap:7px;margin-top:8px;flex-wrap:wrap';a.innerHTML='<button class="btn secondary" type="button">Edit scanner</button><button class="btn secondary" type="button" style="color:#b42318">Delete scanner</button>';a.children[0].onclick=async()=>{const name=prompt('Scanner name:',q.name);if(name===null)return;const slug=prompt('Scanner slug:',q.slug);if(slug===null)return;try{await j('/businesses/'+encodeURIComponent(id)+'/qr/'+encodeURIComponent(q.id),{method:'PUT',body:JSON.stringify({name:name.trim(),slug:slug.trim(),isActive:q.isActive})});location.reload()}catch(e){alert(e.message)}};a.children[1].onclick=async()=>{if(!confirm('Delete scanner "'+q.name+'"? All scan history for this scanner will also be removed.'))return;try{await j('/businesses/'+encodeURIComponent(id)+'/qr/'+encodeURIComponent(q.id),{method:'DELETE'});location.reload()}catch(e){alert(e.message)}};el.appendChild(a)})}let n=0;const run=()=>{menus().catch(()=>{});qrs().catch(()=>{});if(++n<12)setTimeout(run,1000)};run()})();</script>`;
        body=body.replace('</body>',script+'</body>');
      }
    }catch(_){ }
    return originalSend.call(this,body);
  };
}
