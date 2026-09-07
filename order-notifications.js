import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalSend = express.response.send;
let registered = false;

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const session=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt<new Date())return null;
  return session.user;
}

async function businessIdsFor(user){
  if(['ADMIN','SUPER_ADMIN'].includes(user.role)){
    const rows=await prisma.business.findMany({select:{id:true}});
    return rows.map(x=>x.id);
  }
  const rows=await prisma.business.findMany({where:{members:{some:{userId:user.id}}},select:{id:true}});
  return rows.map(x=>x.id);
}

const notificationScript=`<script>
(function(){
  if(window.__reputeOrderNotifications)return;
  window.__reputeOrderNotifications=true;
  let lastSeen=localStorage.getItem('repute_last_order_seen')||'';
  let lastIds=new Set();
  const style=document.createElement('style');
  style.textContent='.rt-notify{position:fixed;right:16px;top:16px;z-index:99999;font-family:system-ui,sans-serif}.rt-nbtn{border:0;border-radius:999px;background:#111827;color:#fff;width:48px;height:48px;box-shadow:0 8px 25px rgba(0,0,0,.18);font-size:22px;cursor:pointer}.rt-badge{position:absolute;right:-2px;top:-4px;background:#dc2626;color:#fff;border-radius:999px;min-width:20px;height:20px;padding:2px 5px;font-size:11px;font-weight:800;text-align:center}.rt-panel{display:none;position:absolute;right:0;top:56px;width:min(360px,calc(100vw - 32px));background:#fff;border:1px solid #e5e7eb;border-radius:18px;box-shadow:0 18px 50px rgba(15,23,42,.2);overflow:hidden;color:#111827}.rt-panel.show{display:block}.rt-head{padding:14px 16px;font-weight:900;border-bottom:1px solid #eef0f4;display:flex;justify-content:space-between}.rt-item{padding:13px 16px;border-bottom:1px solid #f0f2f5}.rt-item b{font-size:14px}.rt-item small{display:block;color:#667085;margin-top:4px}.rt-empty{padding:20px 16px;color:#667085;text-align:center}.rt-enable{border:0;background:#4338ca;color:#fff;border-radius:9px;padding:7px 9px;font-weight:800;font-size:11px;margin-left:8px}';
  document.head.appendChild(style);
  const wrap=document.createElement('div');wrap.className='rt-notify';wrap.innerHTML='<button class="rt-nbtn" title="New orders">🔔<span class="rt-badge" style="display:none">0</span></button><div class="rt-panel"><div class="rt-head"><span>New orders</span><button class="rt-enable">Enable alerts</button></div><div class="rt-list"></div></div>';
  document.body.appendChild(wrap);
  const btn=wrap.querySelector('.rt-nbtn'),badge=wrap.querySelector('.rt-badge'),panel=wrap.querySelector('.rt-panel'),list=wrap.querySelector('.rt-list'),enable=wrap.querySelector('.rt-enable');
  btn.onclick=()=>panel.classList.toggle('show');
  enable.onclick=async()=>{if('Notification' in window){const p=await Notification.requestPermission();enable.textContent=p==='granted'?'Alerts enabled':'Alerts blocked'}};
  function esc(s){const d=document.createElement('div');d.textContent=s??'';return d.innerHTML}
  function beep(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.value=.06;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.18)}catch(_) {}}
  function render(rows){badge.textContent=rows.length;badge.style.display=rows.length?'block':'none';list.innerHTML=rows.length?rows.slice(0,8).map(o=>'<div class="rt-item"><b>New order '+esc(o.orderNumber)+'</b><small>'+esc(o.businessName)+' · '+esc(o.customerName)+' · ₹'+Number(o.total).toFixed(2)+'</small></div>').join(''):'<div class="rt-empty">No pending new orders</div>'}
  async function poll(){try{const r=await fetch('/api/owner/order-notifications',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const j=await r.json();const rows=j.orders||[];render(rows);const fresh=rows.filter(o=>!lastIds.has(o.id));if(fresh.length&&lastIds.size){beep();if('Notification' in window&&Notification.permission==='granted')fresh.slice(0,3).forEach(o=>new Notification('New order '+o.orderNumber,{body:o.businessName+' · '+o.customerName+' · ₹'+Number(o.total).toFixed(2)}));}lastIds=new Set(rows.map(o=>o.id));if(rows[0]?.createdAt&&!lastSeen)lastSeen=rows[0].createdAt;}catch(_) {}}
  poll();setInterval(poll,10000);
})();
</script>`;

function install(app){
  if(registered)return;
  registered=true;
  originalGet.call(app,'/api/owner/order-notifications',async(req,res,next)=>{
    try{
      const user=await userFrom(req);
      if(!user)return res.status(401).json({error:'Authentication required'});
      const businessIds=await businessIdsFor(user);
      if(!businessIds.length)return res.json({ok:true,orders:[]});
      const orders=await prisma.order.findMany({
        where:{businessId:{in:businessIds},status:'PENDING'},
        orderBy:{createdAt:'desc'},take:20,
        include:{business:{select:{name:true}},items:true}
      });
      res.json({ok:true,orders:orders.map(o=>({id:o.id,orderNumber:o.orderNumber,businessName:o.business?.name||'Business',customerName:o.customerName,total:Number(o.total),createdAt:o.createdAt,items:o.items.map(i=>({name:i.itemName,quantity:i.quantity,lineTotal:Number(i.lineTotal)}))}))});
    }catch(e){next(e)}
  });
  const send=express.response.send;
  express.response.send=function(body){
    try{
      if(typeof body==='string' && /<\/body>\s*<\/html>/i.test(body)) body=body.replace(/<\/body>/i,notificationScript+'</body>');
    }catch(_){}
    return send.call(this,body);
  };
}

const previousListen=express.application.listen;
express.application.listen=function(...args){install(this);return previousListen.apply(this,args)};
