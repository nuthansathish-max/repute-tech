import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalSend = express.response.send;

function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));}

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
          res.json({menus});
        }catch(e){next(e)}
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
      if(req && /^\/q\/[^/]+\/order$/.test(path) && typeof body==='string' && body.includes('Place order') && body.includes('View cart')){
        const slug=encodeURIComponent(String(req.params?.slug||path.split('/')[2]||''));
        const currentMenuId=String(req.query?.menuId||'');
        const selector=`<div id="publicMenuSwitcher" style="background:#fff;border:1px solid #e6e8ef;border-radius:18px;padding:12px;margin:12px 0;box-shadow:0 5px 18px rgba(0,0,0,.05)"><div style="font-size:11px;font-weight:800;color:#667085;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Choose menu</div><div id="publicMenuButtons" style="display:flex;gap:8px;overflow:auto"></div></div><script>(async()=>{const box=document.getElementById('publicMenuButtons');if(!box)return;try{const r=await fetch('/api/public/order-menus/${slug}');const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load menus');box.innerHTML=(d.menus||[]).map(m=>'<a href="/q/${slug}/order?menuId='+encodeURIComponent(m.id)+'" style="white-space:nowrap;text-decoration:none;border:1px solid #dfe3eb;border-radius:999px;padding:9px 13px;font-weight:800;font-size:12px;color:'+(m.id===${JSON.stringify(currentMenuId)}?'#fff':'#111827')+';background:'+(m.id===${JSON.stringify(currentMenuId)}?'#111827':'#fff')+'">'+${JSON.stringify('')}+m.name+'</a>').join('')||'<span style="font-size:12px;color:#667085">No other published menus</span>';}catch(e){box.innerHTML='<span style="font-size:12px;color:#667085">Menu selection unavailable</span>';}})();</script>`;
        body=body.replace('<div id="filters" class="toolbar"></div>',selector+'<div id="filters" class="toolbar"></div>');
      }
    }catch(_){}
    return originalSend.call(this,body);
  };
}
