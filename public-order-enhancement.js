import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalUse = express.application.use;
const originalSend = express.response.send;
const currentListen = express.application.listen;

function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}
function orderNumber(){return `RT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;}

// Public menu list used by the customer-side menu switcher.
if(!express.application.__publicOrderMenusApi){
  express.application.__publicOrderMenusApi=true;
  express.application.get=function patchedPublicOrderMenusGet(path,...handlers){
    if(path==='/api/public/order-menus/:slug'){
      return originalGet.call(this,path,async(req,res,next)=>{
        try{
          const slug=String(req.params.slug||'').trim();
          const qr=await prisma.smartQr.findUnique({where:{slug},include:{business:true}});
          if(!qr?.business)return res.status(404).json({error:'QR code not found'});
          const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},select:{id:true,name:true}});
          return res.json({menus});
        }catch(e){return next(e)}
      });
    }
    if(path==='/api/public/all-menu-items/:slug'){
      return originalGet.call(this,path,async(req,res,next)=>{
        try{
          const slug=String(req.params.slug||'').trim();
          const qr=await prisma.smartQr.findUnique({where:{slug}});
          if(!qr)return res.status(404).json({error:'QR code not found'});
          const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
          const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),menuId:menu.id,menuName:menu.name,category:item.category||''})));
          return res.json({items});
        }catch(e){return next(e)}
      });
    }
    return originalGet.call(this,path,...handlers);
  };
}

function publicAllOrderPage(business,items,slug,primaryMenuId){
  const safe=JSON.stringify(items).replace(/</g,'\\u003c');
  const title=`${esc(business.name)} · Order`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#111827"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#111827;font-family:Inter,system-ui,-apple-system,sans-serif}.app{max-width:900px;margin:auto;padding:14px 14px 120px}.top{background:linear-gradient(135deg,#111827,#4338ca 70%,#6366f1);color:#fff;border-radius:26px;padding:22px;box-shadow:0 18px 40px rgba(31,41,95,.2)}.eyebrow{font-size:10px;letter-spacing:.13em;text-transform:uppercase;opacity:.72}.top h1{margin:7px 0 6px;font-size:28px}.top p{margin:0;color:#e5e7eb;line-height:1.5}.trust{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.trust span{font-size:11px;padding:7px 9px;border-radius:999px;background:rgba(255,255,255,.12)}.toolbar{display:flex;gap:8px;overflow:auto;padding:14px 0 5px}.filter{border:1px solid #e1e4ea;background:#fff;border-radius:999px;padding:9px 13px;font-weight:750;white-space:nowrap}.filter.active{background:#111827;color:#fff;border-color:#111827}.grid{display:grid;gap:11px;margin-top:12px}.card{background:#fff;border:1px solid #e6e8ef;border-radius:19px;padding:15px;display:flex;gap:12px;justify-content:space-between;box-shadow:0 6px 20px rgba(16,24,40,.045)}.info{min-width:0}.cat{display:inline-block;font-size:10px;font-weight:800;color:#4338ca;background:#eef2ff;border-radius:999px;padding:5px 8px;margin-bottom:7px}.name{font-weight:850;font-size:16px}.desc{margin:5px 0 8px;color:#667085;font-size:12.5px;line-height:1.45}.price{font-weight:900}.actions{display:flex;align-items:center;gap:7px;align-self:center}.circle{width:38px;height:38px;border:0;border-radius:12px;background:#eef2ff;color:#4338ca;font-size:20px;font-weight:900}.count{min-width:20px;text-align:center;font-weight:850}.bar{position:fixed;left:0;right:0;bottom:0;padding:10px 14px;background:rgba(255,255,255,.96);backdrop-filter:blur(14px);border-top:1px solid #e5e7eb;z-index:20}.cartBtn{width:min(900px,100%);margin:auto;display:flex;justify-content:space-between;align-items:center;border:0;border-radius:15px;background:#111827;color:#fff;padding:13px 15px;font-size:15px;font-weight:850}.sheet{position:fixed;inset:0;background:rgba(15,23,42,.45);display:none;align-items:flex-end;z-index:30}.sheet.show{display:flex}.modal{background:#fff;width:100%;max-height:88vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px 16px}.modalHead{display:flex;justify-content:space-between;align-items:center}.close{border:0;background:#f2f4f7;border-radius:10px;padding:9px 11px;font-weight:800}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #eef0f4}.field{width:100%;border:1px solid #dfe3eb;border-radius:12px;padding:12px;font:inherit;margin-top:9px}.submit{width:100%;border:0;border-radius:13px;padding:13px;background:#4338ca;color:#fff;font-weight:850;font-size:15px;margin-top:12px}.note{font-size:12px;color:#667085;line-height:1.45}.success{background:#ecfdf3;border:1px solid #bbf7d0;border-radius:16px;padding:16px;color:#166534}.track{display:inline-block;margin-top:10px;background:#166534;color:#fff;padding:10px 12px;border-radius:10px;text-decoration:none;font-weight:800}.empty{text-align:center;background:#fff;border:1px dashed #d9dde7;border-radius:18px;padding:28px;color:#667085}@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}.sheet{align-items:center;justify-content:center;padding:20px}.modal{max-width:560px;border-radius:24px}}</style></head><body><main class="app"><header class="top"><div class="eyebrow">Repute-Tech · Digital ordering</div><h1>${esc(business.name)}</h1><p>All menu items · Add items from any menu to one cart and place your order.</p><div class="trust"><span>✓ All menus</span><span>✓ One cart</span><span>✓ In-store payment</span></div></header><div id="filters" class="toolbar"></div><div id="grid" class="grid"></div></main><div class="bar"><button id="cartBtn" class="cartBtn"><span>View cart</span><strong id="cartLabel">0 items · ₹0.00</strong></button></div><div id="sheet" class="sheet"><section class="modal"><div class="modalHead"><div><div class="eyebrow" style="color:#4338ca">All menus · Checkout</div><h2 style="margin:3px 0">Your order</h2></div><button id="close" class="close">Close</button></div><div id="rows"></div><div style="display:flex;justify-content:space-between;font-size:20px;font-weight:900;margin-top:13px"><span>Total</span><span>₹<span id="total">0.00</span></span></div><input id="name" class="field" maxlength="80" placeholder="Your name"><input id="phone" class="field" maxlength="30" placeholder="Phone number (optional)"><textarea id="notes" class="field" maxlength="500" rows="3" placeholder="Table number or special instructions (optional)"></textarea><button id="submit" class="submit">Place order</button><p class="note">Payment is collected manually at the store. Your order starts as <b>PENDING</b>.</p><div id="msg" class="note"></div></section></div><script>const ITEMS=${safe},SLUG=${JSON.stringify(slug)},MENU_ID=${JSON.stringify(primaryMenuId)},cart=new Map();const $=x=>document.getElementById(x);const cats=['All menus',...new Set(ITEMS.map(x=>x.menuName).filter(Boolean))];let active='All menus';function money(n){return Number(n).toFixed(2)}function renderFilters(){if(cats.length<=1){$('filters').style.display='none';return}$('filters').innerHTML=cats.map(c=>'<button class="filter '+(c===active?'active':'')+'" onclick="setCat('+JSON.stringify(c)+')">'+c+'</button>').join('')}function setCat(c){active=c;renderFilters();render()}function render(){const visible=active==='All menus'?ITEMS:ITEMS.filter(x=>x.menuName===active);$('grid').innerHTML=visible.length?visible.map(i=>{const q=cart.get(i.id)||0;return '<article class="card"><div class="info">'+(i.category?'<span class="cat">'+i.category+'</span>':'')+'<div class="name">'+i.name+'</div><div style="font-size:11px;color:#667085;margin-top:4px">'+i.menuName+'</div>'+(i.description?'<div class="desc">'+i.description+'</div>':'')+'<span class="price">₹'+money(i.price)+'</span></div><div class="actions"><button class="circle" onclick="change('+JSON.stringify(i.id)+',-1)">−</button><span class="count">'+q+'</span><button class="circle" onclick="change('+JSON.stringify(i.id)+',1)">+</button></div></article>'}).join(''):'<div class="empty">No items are available right now.</div>';let count=0,total=0;for(const [id,q] of cart){const i=ITEMS.find(x=>x.id===id);if(i){count+=q;total+=i.price*q}}$('cartLabel').textContent=count+' item'+(count===1?'':'s')+' · ₹'+money(total)}function change(id,d){const q=Math.max(0,(cart.get(id)||0)+d);if(q)cart.set(id,q);else cart.delete(id);render()}function openCart(){if(!cart.size){alert('Add an item first.');return}$('sheet').classList.add('show');renderCart()}function renderCart(){let total=0;$('rows').innerHTML=[...cart.entries()].map(([id,q])=>{const i=ITEMS.find(x=>x.id===id),line=i.price*q;total+=line;return '<div class="row"><span>'+i.name+' <small style="color:#667085">('+i.menuName+')</small> × '+q+'</span><b>₹'+money(line)+'</b></div>'}).join('');$('total').textContent=money(total)}$('cartBtn').onclick=openCart;$('close').onclick=()=>$('sheet').classList.remove('show');$('sheet').onclick=e=>{if(e.target.id==='sheet')$('sheet').classList.remove('show')};$('submit').onclick=async()=>{const name=$('name').value.trim();if(name.length<2){$('msg').textContent='Please enter your name.';return}const items=[...cart.entries()].map(([menuItemId,quantity])=>({menuItemId,quantity}));$('submit').disabled=true;$('msg').textContent='Placing your order…';try{const r=await fetch('/api/public/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({menuId:MENU_ID,customerName:name,customerPhone:$('phone').value.trim(),notes:$('notes').value.trim(),items})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Could not place order');document.querySelector('.modal').innerHTML='<div class="success"><div class="eyebrow" style="color:#166534">Order received</div><h2 style="margin:4px 0 7px">Order placed ✓</h2><p>Order <b>'+j.order.orderNumber+'</b> has been sent to the business.</p><p>Payment is collected manually at the store.</p><a class="track" href="/q/'+encodeURIComponent(SLUG)+'">Back to menu</a></div>';cart.clear();render()}catch(e){$('msg').textContent=e.message;$('submit').disabled=false}};renderFilters();render();</script></body></html>`;
}

async function loadAllOrderData(slug){
  const qr=await prisma.smartQr.findUnique({where:{slug},include:{business:true}});
  if(!qr?.business)return null;
  const menus=await prisma.menu.findMany({where:{businessId:qr.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
  const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),menuId:menu.id,menuName:menu.name,category:item.category||''})));
  return {qr,menus,items};
}

// The existing order route intentionally loads one menu. Put a public-only middleware
// in front of it so customer ordering uses every published menu without changing
// dashboard routes, QR routing, or the existing owner-side order system.
if(!express.application.__publicAllOrderMiddleware){
  express.application.__publicAllOrderMiddleware=true;
  express.application.listen=function patchedPublicAllOrderListen(...args){
    if(!this.__publicAllOrderMiddlewareInstalled){
      this.__publicAllOrderMiddlewareInstalled=true;
      originalUse.call(this,async(req,res,next)=>{
        try{
          if(req.method==='GET'){
            const m=String(req.path||'').match(/^\/q\/([^/]+)\/order$/);
            if(m){
              const data=await loadAllOrderData(decodeURIComponent(m[1]));
              if(!data)return res.status(404).send('Order menu not found');
              const primaryMenuId=data.menus[0]?.id||'';
              if(!data.menus.length)return res.status(404).send('No published menu available');
              return res.type('html').send(publicAllOrderPage(data.qr.business,data.items,decodeURIComponent(m[1]),primaryMenuId));
            }
          }
          if(req.method==='POST' && String(req.path||'')==='/api/public/orders'){
            const b=req.body||{};
            const slug=String(req.query?.slug||b.slug||'').trim();
            let data=slug?await loadAllOrderData(slug):null;
            if(!data && b.menuId){
              const menu=await prisma.menu.findFirst({where:{id:String(b.menuId),isPublished:true},include:{business:true}});
              if(menu?.business){
                const menus=await prisma.menu.findMany({where:{businessId:menu.businessId,isPublished:true},orderBy:{createdAt:'desc'},include:{items:{where:{available:true},orderBy:{name:'asc'}}}});
                data={qr:null,menus,items:menus.flatMap(x=>x.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:Number(item.price),menuId:x.id,menuName:x.name,category:item.category||''})))};
              }
            }
            if(!data)return res.status(404).json({error:'Business or QR code not found'});
            const name=String(b.customerName||'').trim();
            if(name.length<2)return res.status(400).json({error:'Customer name is required'});
            const requested=Array.isArray(b.items)?b.items:[];
            if(!requested.length)return res.status(400).json({error:'Add at least one item'});
            const byId=new Map(data.items.map(i=>[i.id,i]));
            const orderItems=[];
            for(const raw of requested){
              const item=byId.get(String(raw?.menuItemId||''));
              const quantity=Math.max(0,Math.floor(Number(raw?.quantity||0)));
              if(!item || !quantity)continue;
              orderItems.push({menuItemId:item.id,itemName:item.name,quantity,unitPrice:item.price,lineTotal:item.price*quantity});
            }
            if(!orderItems.length)return res.status(400).json({error:'No valid items selected'});
            const total=orderItems.reduce((sum,item)=>sum+item.lineTotal,0);
            const primaryMenuId=data.menus[0]?.id||null;
            const order=await prisma.order.create({data:{businessId:data.menus[0].businessId,menuId:primaryMenuId,customerId:null,orderNumber:orderNumber(),customerName:name,customerPhone:String(b.customerPhone||'').trim()||null,fulfilmentType:'IN_STORE',status:'PENDING',paymentStatus:'UNPAID',paymentMethod:'MANUAL',notes:String(b.notes||'').trim()||null,total,items:{create:orderItems}}});
            return res.status(201).json({ok:true,order:{id:order.id,orderNumber:order.orderNumber,status:order.status,total:Number(order.total)}});
          }
        }catch(e){
          console.error('Public combined order error:',e);
          return res.status(500).json({error:'Could not process the order'});
        }
        return next();
      });
    }
    return currentListen.apply(this,args);
  };
}

if(!express.response.__publicOrderEnhancement){
  express.response.__publicOrderEnhancement=true;
  express.response.send=function patchedPublicOrderSend(body){
    try{
      const req=this.req;
      if(req && typeof body==='string' && /\/q\/[^/]+(?:\/order(?:\/[^/?#"'<>\s]+)?)?/.test(body)){
        body=body.replace(/\/q\/([^/"?#]+)\/order\/([^/"?#'<>\s]+)/g,(match,slug,menuId)=>`/q/${slug}/order?menuId=${encodeURIComponent(menuId)}`);
      }
      if(req && /^\/q\/[^/]+$/.test(String(req.path||'')) && typeof body==='string' && body.includes('Customer Hub')){
        const slug=encodeURIComponent(String(req.params?.slug||String(req.path).split('/')[2]||''));
        const combined=`<section class="menu" id="combinedCustomerMenu"><div class="menuHead"><div><div class="eyebrow dark">MENU</div><h2>All Items</h2></div><span class="smallBuy">All products</span></div><div id="combinedCustomerItems"><p class="muted">Loading items…</p></div></section><script>(async()=>{const box=document.getElementById('combinedCustomerItems');if(!box)return;try{const r=await fetch('/api/public/all-menu-items/${slug}');const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load items');const items=d.items||[];box.innerHTML=items.length?items.map(i=>'<div class="item"><div class="itemInfo"><strong>'+i.name+'</strong>'+(i.description?'<p>'+i.description+'</p>':'')+'<small style="display:block;color:#888;font-size:11px;margin-top:5px">'+i.menuName+'</small></div><b class="price">₹'+Number(i.price).toFixed(2)+'</b></div>').join(''):'<p class="muted">No items available yet.</p>';}catch(e){box.innerHTML='<p class="muted">Unable to load items right now.</p>';}})();</script>`;
        body=body.replace('<main id="menus">','<main id="menus">'+combined);
      }
      if(req && /^\/q\/[^/]+\/order$/.test(String(req.path||'')) && typeof body==='string' && body.includes('Place order') && body.includes('View cart')){
        // The combined public-order middleware above normally handles this first.
        // Keep the legacy switcher untouched for any fallback response.
        const slug=encodeURIComponent(String(req.params?.slug||String(req.path).split('/')[2]||''));
        const currentMenuId=String(req.query?.menuId||'');
        const selector=`<div id="publicMenuSwitcher" style="background:#fff;border:1px solid #e6e8ef;border-radius:18px;padding:12px;margin:12px 0;box-shadow:0 5px 18px rgba(0,0,0,.05)"><div style="font-size:11px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Choose menu</div><div id="publicMenuButtons" style="display:flex;gap:8px;overflow:auto"></div></div><script>(async()=>{const box=document.getElementById('publicMenuButtons');if(!box)return;try{const r=await fetch('/api/public/order-menus/${slug}');const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load menus');box.innerHTML=(d.menus||[]).map(m=>'<a href="/q/${slug}/order?menuId='+encodeURIComponent(m.id)+'" style="white-space:nowrap;text-decoration:none;border:1px solid #dfe3eb;border-radius:999px;padding:9px 13px;font-weight:800;font-size:12px;color:'+(m.id===${JSON.stringify(currentMenuId)}?'#fff':'#111827')+';background:'+(m.id===${JSON.stringify(currentMenuId)}?'#111827':'#fff')+'">'+m.name+'</a>').join('')||'<span style="font-size:12px;color:#667085">No other published menus</span>';}catch(e){box.innerHTML='<span style="font-size:12px;color:#667085">Menu selection unavailable</span>';}})();</script>`;
        body=body.replace('<div id="filters" class="toolbar"></div>',selector+'<div id="filters" class="toolbar"></div>');
      }
    }catch(_){}
    return originalSend.call(this,body);
  };
}
