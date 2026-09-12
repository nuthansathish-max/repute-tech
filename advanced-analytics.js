import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
let installed = false;

async function sessionUser(req){
  const token = getCookie(req,'rp_session');
  if(!token) return null;
  const session = await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt < new Date()) return null;
  return session.user;
}

async function allowedBusiness(user,businessId){
  if(!user) return null;
  const unrestricted = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  return prisma.business.findFirst({where:{id:businessId,...(unrestricted?{}:{members:{some:{userId:user.id}}})},select:{id:true,name:true,type:true}});
}

function rangeStart(range){
  const now = new Date(); const start = new Date(now);
  if(range === 'day') start.setHours(0,0,0,0);
  else if(range === 'week'){start.setDate(start.getDate()-6);start.setHours(0,0,0,0)}
  else {start.setDate(start.getDate()-29);start.setHours(0,0,0,0)}
  return start;
}
function dayKey(value){return new Date(value).toISOString().slice(0,10)}
function customerKey(o){return o.customerId || String(o.customerPhone||'').replace(/\D/g,'') || null}
function buildSeries(start,days,orders,reviews,scans){
  const map=new Map();
  for(let i=0;i<days;i++){const d=new Date(start);d.setDate(start.getDate()+i);map.set(dayKey(d),{date:dayKey(d),orders:0,revenue:0,reviews:0,qrScans:0})}
  for(const o of orders){const row=map.get(dayKey(o.createdAt));if(row){row.orders++;row.revenue+=Number(o.total||0)}}
  for(const r of reviews){const row=map.get(dayKey(r.createdAt));if(row)row.reviews++}
  for(const s of scans){const row=map.get(dayKey(s.scannedAt));if(row)row.qrScans++}
  return [...map.values()].map(x=>({...x,revenue:Number(x.revenue.toFixed(2))}));
}

const page=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Advanced Analytics | Repute-Tech</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6fa;color:#172033}.wrap{max-width:1180px;margin:auto;padding:24px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:20px}.brand{font-weight:800;font-size:25px}.muted{color:#6b7280;font-size:13px;margin-top:3px}.controls{display:flex;gap:8px;flex-wrap:wrap}.btn{border:1px solid #dbe0ea;background:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:700}.btn.active{background:#172033;color:#fff}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#fff;border:1px solid #e7eaf0;border-radius:16px;padding:18px;box-shadow:0 5px 18px rgba(25,35,55,.045)}.kpi .label{font-size:13px;color:#6b7280}.kpi .value{font-size:27px;font-weight:800;margin-top:8px;white-space:nowrap}.section{margin-top:16px}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chart{height:260px;display:flex;align-items:flex-end;gap:5px;padding-top:18px;overflow:hidden}.barwrap{flex:1;min-width:7px;text-align:center}.bar{background:#172033;border-radius:6px 6px 2px 2px;min-height:2px}.barlabel{font-size:9px;color:#8a93a3;margin-top:6px;white-space:nowrap}.row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid #edf0f4}.row:last-child{border-bottom:0}.empty{color:#8a93a3;padding:20px 0}.loading{padding:50px;text-align:center;color:#6b7280}.title{font-size:18px;font-weight:800;margin-bottom:8px}.sub{font-size:13px;color:#7b8494;margin-bottom:12px}.section-card{min-height:190px}
@media(max-width:1000px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.wrap{padding:18px}}
@media(max-width:520px){.wrap{padding:12px}.top{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr 1fr;gap:10px}.card{padding:14px}.kpi .value{font-size:21px}.chart{height:220px}.controls{width:100%}.btn{flex:1}}
</style></head><body><div class="wrap"><div class="top"><div><div class="brand">Repute-Tech Analytics</div><div class="muted" id="businessName">Loading business...</div></div><div class="controls"><button class="btn" data-range="day">Today</button><button class="btn" data-range="week">7 Days</button><button class="btn active" data-range="month">30 Days</button><button class="btn" onclick="location.href='/'">Dashboard</button></div></div><div id="content" class="loading">Loading analytics...</div></div>
<script>
let businessId=null,range='month';const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
async function init(){const qs=new URLSearchParams(location.search);businessId=qs.get('businessId');if(!businessId){const r=await fetch('/api/businesses',{credentials:'include'});if(!r.ok){location.href='/';return}const list=await r.json();businessId=list[0]?.id}if(!businessId){document.getElementById('content').innerHTML='<div class="card">No business found.</div>';return}load()}
async function load(){document.getElementById('content').className='loading';document.getElementById('content').textContent='Loading analytics...';const r=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/analytics?range='+range,{credentials:'include'});const d=await r.json();if(!r.ok){document.getElementById('content').innerHTML='<div class="card">'+esc(d.error||'Unable to load analytics')+'</div>';return}document.getElementById('businessName').textContent=d.business.name+' · '+d.period.label;const maxRev=Math.max(1,...d.series.map(x=>x.revenue));const bars=d.series.map(x=>'<div class="barwrap"><div class="bar" title="'+esc(x.date)+' · '+money(x.revenue)+'" style="height:'+Math.max(2,Math.round(x.revenue/maxRev*200))+'px"></div><div class="barlabel">'+esc(x.date.slice(5))+'</div></div>').join('');const products=d.bestSellers.length?d.bestSellers.map((p,i)=>'<div class="row"><span>'+(i+1)+'. '+esc(p.name)+'</span><b>'+p.quantity+' sold</b></div>').join(''):'<div class="empty">No product sales in this period.</div>';const hours=d.peakHours.length?d.peakHours.map(h=>'<div class="row"><span>'+esc(h.label)+'</span><b>'+h.orders+' orders</b></div>').join(''):'<div class="empty">No order timing data yet.</div>';
document.getElementById('content').className='';document.getElementById('content').innerHTML='<div class="grid">'+
'<div class="card kpi"><div class="label">Revenue</div><div class="value">'+money(d.metrics.revenue)+'</div></div><div class="card kpi"><div class="label">Orders</div><div class="value">'+d.metrics.orders+'</div></div><div class="card kpi"><div class="label">Average Order Value</div><div class="value">'+money(d.metrics.averageOrderValue)+'</div></div><div class="card kpi"><div class="label">Total QR Scans</div><div class="value">'+d.metrics.qrScans+'</div></div><div class="card kpi"><div class="label">New Customers</div><div class="value">'+d.metrics.newCustomers+'</div></div><div class="card kpi"><div class="label">Returning Customers</div><div class="value">'+d.metrics.returningCustomers+'</div></div><div class="card kpi"><div class="label">Average Rating</div><div class="value">'+d.metrics.averageRating+' ★</div></div><div class="card kpi"><div class="label">Customer Satisfaction</div><div class="value">'+d.metrics.satisfactionRate+'%</div></div></div>'+\
'<div class="two section"><div class="card section-card"><div class="title">Revenue Trend</div><div class="sub">Daily revenue for the selected period</div><div class="chart">'+bars+'</div></div><div class="card section-card"><div class="title">Review Trends</div><div class="row"><span>Total reviews</span><b>'+d.metrics.reviews+'</b></div><div class="row"><span>Positive reviews</span><b>'+d.reviewBreakdown.positive+'</b></div><div class="row"><span>Neutral reviews</span><b>'+d.reviewBreakdown.neutral+'</b></div><div class="row"><span>Negative reviews</span><b>'+d.reviewBreakdown.negative+'</b></div></div></div>'+\
'<div class="two section"><div class="card section-card"><div class="title">Best-Selling Products</div>'+products+'</div><div class="card section-card"><div class="title">Peak Business Hours</div>'+hours+'</div></div>';
}
document.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-range]').forEach(x=>x.classList.remove('active'));b.classList.add('active');range=b.dataset.range;load()});init();</script></body></html>`;

function install(app){if(installed)return;installed=true;
  originalGet.call(app,'/analytics',async(req,res,next)=>{try{const user=await sessionUser(req);if(!user)return res.redirect('/');res.type('html').send(page)}catch(e){next(e)}});
  originalGet.call(app,'/api/businesses/:businessId/analytics',async(req,res,next)=>{try{
    const user=await sessionUser(req);if(!user)return res.status(401).json({error:'Authentication required'});const business=await allowedBusiness(user,req.params.businessId);if(!business)return res.status(404).json({error:'Business not found'});
    const range=['day','week','month'].includes(String(req.query.range))?String(req.query.range):'month';const start=rangeStart(range);const days=range==='day'?1:range==='week'?7:30;const businessId=business.id;
    const [orders,reviews,scans,totalQr,allCustomerOrders]=await Promise.all([
      prisma.order.findMany({where:{businessId,createdAt:{gte:start}},select:{id:true,total:true,createdAt:true,customerId:true,customerPhone:true,items:{select:{itemName:true,quantity:true,lineTotal:true}}},orderBy:{createdAt:'asc'}}),
      prisma.review.findMany({where:{businessId,createdAt:{gte:start}},select:{rating:true,createdAt:true,sentiment:true}}),
      prisma.qrScan.findMany({where:{qr:{businessId},scannedAt:{gte:start}},select:{scannedAt:true}}),
      prisma.smartQr.aggregate({where:{businessId},_sum:{scanCount:true}}),
      prisma.order.findMany({where:{businessId},select:{customerId:true,customerPhone:true,createdAt:true},orderBy:{createdAt:'asc'}})
    ]);
    const revenue=orders.reduce((s,o)=>s+Number(o.total||0),0);const avgOrder=orders.length?revenue/orders.length:0;const avgRating=reviews.length?reviews.reduce((s,r)=>s+r.rating,0)/reviews.length:0;const positive=reviews.filter(r=>r.rating>=4).length;const neutral=reviews.filter(r=>r.rating===3).length;const negative=reviews.filter(r=>r.rating<=2).length;
    const firstSeen=new Map();for(const o of allCustomerOrders){const key=customerKey(o);if(key&&!firstSeen.has(key))firstSeen.set(key,o.createdAt)}
    const periodCounts=new Map();for(const o of orders){const key=customerKey(o);if(key)periodCounts.set(key,(periodCounts.get(key)||0)+1)}
    let newCustomers=0,returningCustomers=0;for(const [key,count] of periodCounts){const first=firstSeen.get(key);if(count>1||(first&&new Date(first)<start))returningCustomers++;else newCustomers++}
    const productMap=new Map();const hourMap=new Map();for(const o of orders){const hour=new Date(o.createdAt).getHours();hourMap.set(hour,(hourMap.get(hour)||0)+1);for(const item of o.items){const old=productMap.get(item.itemName)||{name:item.itemName,quantity:0,revenue:0};old.quantity+=item.quantity;old.revenue+=Number(item.lineTotal||0);productMap.set(item.itemName,old)}}
    const bestSellers=[...productMap.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,8).map(x=>({...x,revenue:Number(x.revenue.toFixed(2))}));const peakHours=[...hourMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([hour,count])=>({hour,label:String(hour).padStart(2,'0')+':00 - '+String((hour+1)%24).padStart(2,'0')+':00',orders:count}));const series=buildSeries(start,days,orders,reviews,scans);
    res.json({business,period:{range,start:start.toISOString(),end:new Date().toISOString(),label:range==='day'?'Today':range==='week'?'Last 7 days':'Last 30 days'},metrics:{revenue:Number(revenue.toFixed(2)),orders:orders.length,averageOrderValue:Number(avgOrder.toFixed(2)),newCustomers,returningCustomers,qrScans:Number(totalQr._sum.scanCount||0),reviews:reviews.length,averageRating:Number(avgRating.toFixed(1)),satisfactionRate:reviews.length?Math.round(positive/reviews.length*100):0},reviewBreakdown:{positive,neutral,negative},bestSellers,peakHours,series});
  }catch(e){next(e)}});
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
