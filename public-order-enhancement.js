import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalSend = express.response.send;

function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}

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
          const items=menus.flatMap(menu=>menu.items.map(item=>({id:item.id,name:item.name,description:item.description||'',price:item.price,menuId:menu.id,menuName:menu.name})));
          return res.json({items});
        }catch(e){return next(e)}
      });
    }
    return originalGet.call(this,path,...handlers);
  };
}

if(!express.response.__publicOrderEnhancement){
  express.response.__publicOrderEnhancement=true;
  express.response.send=function patchedPublicOrderSend(body){
    try{
      const req=this.req;
      const path=String(req?.path||'');

      // Make every customer-hub/order link use the canonical query form directly.
      if(req && typeof body==='string' && /\/q\/[^/]+(?:\/order(?:\/[^/?#"'<>\s]+)?)?/.test(body)){
        body=body.replace(/\/q\/([^/"?#]+)\/order\/([^/"?#'<>\s]+)/g,(match,slug,menuId)=>`/q/${slug}/order?menuId=${encodeURIComponent(menuId)}`);
      }

      // Show every published item together in one customer-facing menu.
      if(req && /^\/q\/[^/]+$/.test(path) && typeof body==='string' && body.includes('Customer Hub')){
        const slug=encodeURIComponent(String(req.params?.slug||path.split('/')[2]||''));
        const combined=`<section class="menu" id="combinedCustomerMenu"><div class="menuHead"><div><div class="eyebrow dark">MENU</div><h2>All Items</h2></div><span class="smallBuy">All products</span></div><div id="combinedCustomerItems"><p class="muted">Loading items…</p></div></section><script>(async()=>{const box=document.getElementById('combinedCustomerItems');if(!box)return;try{const r=await fetch('/api/public/all-menu-items/${slug}');const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load items');const items=d.items||[];box.innerHTML=items.length?items.map(i=>'<div class="item"><div class="itemInfo"><strong>'+i.name+'</strong>'+(i.description?'<p>'+i.description+'</p>':'')+'<small style="display:block;color:#888;font-size:11px;margin-top:5px">'+i.menuName+'</small></div><b class="price">₹'+Number(i.price).toFixed(2)+'</b></div>').join(''):'<p class="muted">No items available yet.</p>';}catch(e){box.innerHTML='<p class="muted">Unable to load items right now.</p>';}})();</script>`;
        body=body.replace('<main id="menus">', '<main id="menus">'+combined);
      }

      // Add a menu switcher to the customer order page.
      if(req && /^\/q\/[^/]+\/order$/.test(path) && typeof body==='string' && body.includes('Place order') && body.includes('View cart')){
        const slug=encodeURIComponent(String(req.params?.slug||path.split('/')[2]||''));
        const currentMenuId=String(req.query?.menuId||'');
        const selector=`<div id="publicMenuSwitcher" style="background:#fff;border:1px solid #e6e8ef;border-radius:18px;padding:12px;margin:12px 0;box-shadow:0 5px 18px rgba(0,0,0,.05)"><div style="font-size:11px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Choose menu</div><div id="publicMenuButtons" style="display:flex;gap:8px;overflow:auto"></div></div><script>(async()=>{const box=document.getElementById('publicMenuButtons');if(!box)return;try{const r=await fetch('/api/public/order-menus/${slug}');const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load menus');box.innerHTML=(d.menus||[]).map(m=>'<a href="/q/${slug}/order?menuId='+encodeURIComponent(m.id)+'" style="white-space:nowrap;text-decoration:none;border:1px solid #dfe3eb;border-radius:999px;padding:9px 13px;font-weight:800;font-size:12px;color:'+(m.id===${JSON.stringify(currentMenuId)}?'#fff':'#111827')+';background:'+(m.id===${JSON.stringify(currentMenuId)}?'#111827':'#fff')+'">'+m.name+'</a>').join('')||'<span style="font-size:12px;color:#667085">No other published menus</span>';}catch(e){box.innerHTML='<span style="font-size:12px;color:#667085">Menu selection unavailable</span>';}})();</script>`;
        body=body.replace('<div id="filters" class="toolbar"></div>',selector+'<div id="filters" class="toolbar"></div>');
      }
    }catch(_){}
    return originalSend.call(this,body);
  };
}
