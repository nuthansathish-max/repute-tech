import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
const originalPost=express.application.post;
let installed=false;

async function sessionUser(req){
  const token=getCookie(req,'rp_admin_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}
async function requireAdmin(req,res){
  const user=await sessionUser(req);
  if(!user)return null;
  if(!['ADMIN','SUPER_ADMIN'].includes(user.role)){res.status(403).json({error:'Admin access required'});return null;}
  return user;
}
function adminPage(){
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Repute Techs · Admin SaaS</title>
 <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
 <style>
 :root{--nav:#0f172a;--nav2:#1e293b;--primary:#4f46e5;--bg:#f8fafc;--card:#fff;--line:#e2e8f0;--muted:#64748b;--ink:#0f172a;--good:#059669;--warn:#d97706;--bad:#dc2626}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px Inter,system-ui,sans-serif}.app{min-height:100vh}.side{position:fixed;left:0;top:0;bottom:0;width:255px;background:var(--nav);color:#cbd5e1;padding:18px 12px;display:flex;flex-direction:column;z-index:5}.brand{font-weight:800;color:#fff;font-size:18px;padding:8px 10px}.brand span{color:#818cf8}.role{font-size:10px;color:#a5b4fc;letter-spacing:.12em;margin:4px 10px 18px}.group{font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:.1em;padding:12px 10px 6px}.nav{display:block;width:100%;border:0;background:none;color:#cbd5e1;text-align:left;padding:10px;border-radius:8px;cursor:pointer;font:inherit}.nav:hover,.nav.active{background:#4f46e5;color:#fff}.main{margin-left:255px;padding:24px;max-width:1600px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px}.top h1{margin:0;font-size:25px}.top p{margin:5px 0 0;color:var(--muted)}button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:9px 12px;cursor:pointer}.light{background:#fff;border:1px solid var(--line);color:var(--ink)}.primary{background:var(--primary);color:#fff}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 1px 2px #00000008}.label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}.metric{font-size:28px;font-weight:800;margin-top:7px}.sub{font-size:12px;color:var(--muted);margin-top:5px}.section{margin-top:18px}.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-head h2{font-size:17px;margin:0}.table{overflow:auto}.row{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr 100px;gap:12px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line);min-width:720px}.row.head{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:700;background:#f8fafc}.name{font-weight:700}.pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;background:#eef2ff;color:#4338ca}.pill.good{background:#ecfdf5;color:#047857}.pill.warn{background:#fffbeb;color:#b45309}.empty{padding:22px;color:var(--muted);text-align:center}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.quick button{text-align:left;background:#fff;border:1px solid var(--line);padding:16px}.quick strong{display:block;margin-bottom:4px}.quick span{font-size:12px;color:var(--muted)}.hidden{display:none!important}@media(max-width:900px){.side{width:72px}.brand{font-size:0}.brand span{font-size:0}.role,.group{display:none}.nav{font-size:0;text-align:center}.nav:before{content:'•';font-size:20px}.main{margin-left:72px}.grid{grid-template-columns:repeat(2,1fr)}.quick{grid-template-columns:1fr}}@media(max-width:600px){.main{padding:14px}.grid{grid-template-columns:1fr 1fr}.top{align-items:flex-start}.top h1{font-size:20px}}
 </style></head><body><div class="app">
 <aside class="side"><div class="brand">repute<span>techs.in</span></div><div class="role">SUPER ADMIN · PLATFORM OWNER</div>
 <div class="group">Platform</div><button class="nav active" data-view="dashboard">Dashboard</button><button class="nav" data-view="businesses">Businesses</button><button class="nav" data-view="users">Users</button><button class="nav" data-view="plans">Plans & Subscriptions</button>
 <div class="group">Operations</div><button class="nav" data-view="orders">Orders</button><button class="nav" data-view="reviews">Reviews</button><button class="nav" data-view="integrations">Integrations</button><button class="nav" data-view="menus">Menus & QR</button>
 <div class="group">Governance</div><button class="nav" data-view="system">System Health</button><button class="nav" data-view="audit">Audit Logs</button><button class="nav" data-view="settings">Platform Settings</button>
 <div style="margin-top:auto"><button class="nav" onclick="location.href='/'">Business Dashboard</button></div></aside>
 <main class="main"><div class="top"><div><h1 id="title">Platform Overview</h1><p id="desc">Repute Techs SaaS owner command center</p></div><button class="light" onclick="load()">↻ Refresh</button></div>
 <section id="dashboard"><div class="grid"><div class="card"><div class="label">Total Businesses</div><div class="metric" id="count">—</div><div class="sub">Registered tenants</div></div><div class="card"><div class="label">Active Subscriptions</div><div class="metric" id="active">—</div><div class="sub">Currently active</div></div><div class="card"><div class="label">Trial Subscriptions</div><div class="metric" id="trials">—</div><div class="sub">7-day trials</div></div><div class="card"><div class="label">Pending Plan Requests</div><div class="metric" id="pending">—</div><div class="sub">Awaiting admin action</div></div></div>
 <div class="section"><div class="section-head"><h2>Business Fleet</h2><button class="primary" onclick="show('businesses')">View all</button></div><div class="card table"><div class="row head"><div>Business</div><div>Owner</div><div>Plan</div><div>Status</div><div></div></div><div id="rows"></div></div></div>
 <div class="section"><div class="section-head"><h2>Quick Administration</h2></div><div class="quick"><button onclick="show('businesses')"><strong>Business Management</strong><span>Inspect businesses, owners, plans and operating status.</span></button><button onclick="show('plans')"><strong>Plans & Subscriptions</strong><span>Review plan and subscription information.</span></button><button onclick="show('users')"><strong>User Management</strong><span>Review platform users and roles.</span></button></div></div></section>
 <section id="businesses" class="hidden"><div class="card table"><div class="row head"><div>Business</div><div>Owner</div><div>Plan</div><div>Status</div><div>Action</div></div><div id="allRows"></div></div></section>
 <section id="users" class="hidden"><div class="card"><h2>Users</h2><p class="sub">User management UI is ready for backend wiring. Existing business-owner data is not modified.</p></div></section>
 <section id="plans" class="hidden"><div class="card"><h2>Plans & Subscriptions</h2><p class="sub">Subscription administration UI is ready. Existing plan records remain unchanged.</p></div></section>
 <section id="orders" class="hidden"><div class="card"><h2>Orders</h2><p class="sub">Admin order governance screen reserved for the next backend integration.</p></div></section>
 <section id="reviews" class="hidden"><div class="card"><h2>Reviews & AI Activity</h2><p class="sub">Review monitoring screen reserved for the next backend integration.</p></div></section>
 <section id="integrations" class="hidden"><div class="card"><h2>Integrations</h2><p class="sub">Google and WhatsApp monitoring screen reserved for the next backend integration.</p></div></section>
 <section id="menus" class="hidden"><div class="card"><h2>Menus & QR</h2><p class="sub">Platform menu and QR overview screen reserved for the next backend integration.</p></div></section>
 <section id="system" class="hidden"><div class="card"><h2>System Health</h2><p class="sub">Infrastructure telemetry screen reserved for the next backend integration.</p></div></section>
 <section id="audit" class="hidden"><div class="card"><h2>Audit Logs</h2><p class="sub">Security and administrative audit screen reserved for the next backend integration.</p></div></section>
 <section id="settings" class="hidden"><div class="card"><h2>Platform Settings</h2><p class="sub">Global SaaS governance settings screen reserved for the next backend integration.</p></div></section>
 </main></div>
 <script>
 let rows=[];
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 async function api(path,opt={}){const r=await fetch('/api'+path,{credentials:'include',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
 function row(b){return '<div class="row"><div><div class="name">'+esc(b.name)+'</div><div class="sub">'+esc(b.type||'')+'</div></div><div>'+esc(b.ownerName||'No owner')+'<div class="sub">'+esc(b.ownerEmail||'')+'</div></div><div><span class="pill">'+esc(b.subscription?.plan||'No plan')+'</span></div><div><span class="pill '+(b.subscription?.status==='ACTIVE'?'good':b.subscription?.status==='TRIAL'?'warn':'')+'">'+esc(b.subscription?.status||'NO SUBSCRIPTION')+'</span></div><div><button class="light" onclick="openBusiness('+JSON.stringify(b.id)+')">View</button></div></div>'}
 function render(){const html=rows.map(row).join('')||'<div class="empty">No businesses found.</div>';$('rows').innerHTML=html;$('allRows').innerHTML=html}
 function show(view){document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));$(view).classList.remove('hidden');document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const titles={dashboard:['Platform Overview','Repute Techs SaaS owner command center'],businesses:['Business Management','Tenant registry and business governance'],users:['User Management','Platform users and access control'],plans:['Plans & Subscriptions','Subscription governance'],orders:['Orders','Platform order governance'],reviews:['Reviews','Reviews and AI activity'],integrations:['Integrations','Google and WhatsApp monitoring'],menus:['Menus & QR','Digital menu and QR overview'],system:['System Health','Infrastructure observability'],audit:['Audit Logs','Administrative security trail'],settings:['Platform Settings','Global SaaS governance']};$('title').textContent=titles[view][0];$('desc').textContent=titles[view][1]}
 async function openBusiness(id){try{await api('/businesses/select',{method:'POST',body:JSON.stringify({businessId:id})});location.href='/'}catch(e){alert(e.message)}}
 async function load(){try{const d=await api('/admin/businesses');rows=d.businesses||[];$('count').textContent=rows.length;$('active').textContent=rows.filter(x=>x.subscription?.status==='ACTIVE').length;$('trials').textContent=rows.filter(x=>x.subscription?.status==='TRIAL').length;$('pending').textContent=d.pendingPlanRequests||0;render()}catch(e){$('rows').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}}
 document.querySelectorAll('.nav[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));load();
 </script></body></html>`;
}
function install(app){
 if(installed)return;installed=true;
 originalGet.call(app,'/admin-panel',async(req,res,next)=>{try{const user=await requireAdmin(req,res);if(!user)return res.redirect('/admin-login');res.type('html').send(adminPage())}catch(e){next(e)}});
 originalGet.call(app,'/api/admin/businesses',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const businesses=await prisma.business.findMany({include:{subscription:true,members:{include:{user:{select:{id:true,name:true,email:true,role:true}}}}},orderBy:{createdAt:'desc'}});
  const mapped=businesses.map(b=>{const owner=b.members.find(m=>m.role==='OWNER');return {id:b.id,name:b.name,type:b.type,slug:b.slug,isOpen:b.isOpen,createdAt:b.createdAt,memberCount:b.members.length,ownerName:owner?.user?.name||null,ownerEmail:owner?.user?.email||null,subscription:b.subscription?{plan:b.subscription.plan,status:b.subscription.status,billingInterval:b.subscription.billingInterval,monthlyPrice:b.subscription.monthlyPrice,currentPeriodEnd:b.subscription.currentPeriodEnd}:null}});
  const pendingPlanRequests=await prisma.planRequest.count({where:{status:'PENDING'}});
  res.json({businesses:mapped,pendingPlanRequests,adminRole:user.role});
 }catch(e){next(e)}});
 originalGet.call(app,'/api/admin/businesses/:businessId',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const b=await prisma.business.findUnique({where:{id:req.params.businessId},include:{subscription:true,members:{include:{user:{select:{id:true,name:true,email:true,role:true,createdAt:true}}}}}});
  if(!b)return res.status(404).json({error:'Business not found'});
  res.json({id:b.id,name:b.name,type:b.type,slug:b.slug,logoUrl:b.logoUrl,phone:b.phone,website:b.website,isOpen:b.isOpen,createdAt:b.createdAt,subscription:b.subscription,members:b.members.map(m=>({id:m.id,role:m.role,user:m.user}))});
 }catch(e){next(e)}});
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
