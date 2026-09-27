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
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px Inter,system-ui,sans-serif}.app{min-height:100vh}.side{position:fixed;left:0;top:0;bottom:0;width:255px;background:var(--nav);color:#cbd5e1;padding:18px 12px;display:flex;flex-direction:column;z-index:5}.brand{font-weight:800;color:#fff;font-size:18px;padding:8px 10px}.brand span{color:#818cf8}.role{font-size:10px;color:#a5b4fc;letter-spacing:.12em;margin:4px 10px 18px}.group{font-size:10px;text-transform:uppercase;color:#64748b;letter-spacing:.1em;padding:12px 10px 6px}.nav{display:block;width:100%;border:0;background:none;color:#cbd5e1;text-align:left;padding:10px;border-radius:8px;cursor:pointer;font:inherit}.nav:hover,.nav.active{background:#4f46e5;color:#fff}.main{margin-left:255px;padding:24px;max-width:1600px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px}.top h1{margin:0;font-size:25px}.top p{margin:5px 0 0;color:var(--muted)}button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:9px 12px;cursor:pointer}.light{background:#fff;border:1px solid var(--line);color:var(--ink)}.primary{background:var(--primary);color:#fff}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 1px 2px #00000008}.label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}.metric{font-size:28px;font-weight:800;margin-top:7px}.sub{font-size:12px;color:var(--muted);margin-top:5px}.section{margin-top:18px}.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-head h2{font-size:17px;margin:0}.table{overflow:auto}.row{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr 100px;gap:12px;align-items:center;padding:13px 14px;border-bottom:1px solid var(--line);min-width:720px}.row.head{font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:700;background:#f8fafc}.name{font-weight:700}.pill{display:inline-block;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;background:#eef2ff;color:#4338ca}.pill.good{background:#ecfdf5;color:#047857}.pill.warn{background:#fffbeb;color:#b45309}.pill.bad{background:#fef2f2;color:#b91c1c}.empty{padding:22px;color:var(--muted);text-align:center}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.quick button{text-align:left;background:#fff;border:1px solid var(--line);padding:16px}.quick strong{display:block;margin-bottom:4px}.quick span{font-size:12px;color:var(--muted)}.hidden{display:none!important}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.search{flex:1;min-width:220px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit}.select{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:inherit}.detail{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.kv{padding:12px;border:1px solid var(--line);border-radius:8px}.kv b{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:4px}.wide{grid-column:1/-1}.back{margin-bottom:12px}.statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.notice{padding:12px;border-radius:8px;background:#f8fafc;color:var(--muted);margin-top:10px}
 @media(max-width:900px){.side{width:72px}.brand{font-size:0}.brand span{font-size:0}.role,.group{display:none}.nav{font-size:0;text-align:center}.nav:before{content:'•';font-size:20px}.main{margin-left:72px}.grid{grid-template-columns:repeat(2,1fr)}.quick{grid-template-columns:1fr}.detail{grid-template-columns:1fr}}@media(max-width:600px){.main{padding:14px}.grid{grid-template-columns:1fr 1fr}.top{align-items:flex-start}.top h1{font-size:20px}.statgrid{grid-template-columns:1fr 1fr}}
 </style></head><body><div class="app">
 <aside class="side"><div class="brand">repute<span>techs.in</span></div><div class="role">SUPER ADMIN · PLATFORM OWNER</div>
 <div class="group">Platform</div><button class="nav active" data-view="dashboard">Dashboard</button><button class="nav" data-view="businesses">Businesses</button><button class="nav" data-view="users">Users</button><button class="nav" data-view="plans">Plans & Subscriptions</button>
 <div class="group">Operations</div><button class="nav" data-view="orders">Orders</button><button class="nav" data-view="reviews">Reviews</button><button class="nav" data-view="integrations">Integrations</button><button class="nav" data-view="menus">Menus & QR</button>
 <div class="group">Governance</div><button class="nav" data-view="system">System Health</button><button class="nav" data-view="audit">Audit Logs</button><button class="nav" data-view="settings">Platform Settings</button>
 <div style="margin-top:auto"><button class="nav" onclick="location.href='/'">Business Dashboard</button></div></aside>
 <main class="main"><div class="top"><div><h1 id="title">Platform Overview</h1><p id="desc">Repute Techs SaaS owner command center</p></div><button class="light" onclick="refreshCurrent()">↻ Refresh</button></div>
 <section id="dashboard"><div class="grid"><div class="card"><div class="label">Total Businesses</div><div class="metric" id="count">—</div><div class="sub">Registered tenants</div></div><div class="card"><div class="label">Active Subscriptions</div><div class="metric" id="active">—</div><div class="sub">Currently active</div></div><div class="card"><div class="label">Trial Subscriptions</div><div class="metric" id="trials">—</div><div class="sub">7-day trials</div></div><div class="card"><div class="label">Pending Plan Requests</div><div class="metric" id="pending">—</div><div class="sub">Awaiting admin action</div></div></div>
 <div class="section"><div class="section-head"><h2>Business Fleet</h2><button class="primary" onclick="show('businesses')">View all</button></div><div class="card table"><div class="row head"><div>Business</div><div>Owner</div><div>Plan</div><div>Status</div><div></div></div><div id="rows"></div></div></div>
 <div class="section"><div class="section-head"><h2>Quick Administration</h2></div><div class="quick"><button onclick="show('businesses')"><strong>Business Management</strong><span>Inspect businesses, owners, plans and operating status.</span></button><button onclick="show('plans')"><strong>Plans & Subscriptions</strong><span>Review plan and subscription information.</span></button><button onclick="show('users')"><strong>User Management</strong><span>Review platform users and roles.</span></button></div></div></section>
 <section id="businesses" class="hidden"><div id="businessList"><div class="toolbar"><input id="businessSearch" class="search" placeholder="Search business, owner or email"><select id="businessStatus" class="select"><option value="">All subscription status</option><option>TRIAL</option><option>ACTIVE</option><option>INACTIVE</option></select></div><div class="card table"><div class="row head"><div>Business</div><div>Owner</div><div>Plan</div><div>Status</div><div>Action</div></div><div id="allRows"></div></div></div><div id="businessDetail" class="hidden"></div></section>
 <section id="users" class="hidden"><div class="toolbar"><input id="userSearch" class="search" placeholder="Search user name or email"></div><div class="card table"><div class="row head"><div>User</div><div>Role</div><div>Businesses</div><div>Created</div><div></div></div><div id="userRows"></div></div></section>
 <section id="plans" class="hidden"><div class="statgrid"><div class="card"><div class="label">Catalog Plans</div><div class="metric" id="planCount">—</div></div><div class="card"><div class="label">Active Plans</div><div class="metric" id="planActive">—</div></div><div class="card"><div class="label">Pending Requests</div><div class="metric" id="planPending">—</div></div></div><div class="section"><div class="card table"><div class="row head"><div>Plan</div><div>Price</div><div>Interval</div><div>Active</div><div></div></div><div id="planRows"></div></div></div></section>
 <section id="orders" class="hidden"><div class="grid"><div class="card"><div class="label">Total Orders</div><div class="metric" id="orderCount">—</div></div><div class="card"><div class="label">Pending</div><div class="metric" id="orderPending">—</div></div><div class="card"><div class="label">Paid</div><div class="metric" id="orderPaid">—</div></div><div class="card"><div class="label">Order Value</div><div class="metric" id="orderValue">—</div></div></div><div class="notice">Read-only platform overview. Business owners continue to manage individual orders from their normal dashboard.</div></section>
 <section id="reviews" class="hidden"><div class="grid"><div class="card"><div class="label">Total Reviews</div><div class="metric" id="reviewCount">—</div></div><div class="card"><div class="label">Approved</div><div class="metric" id="reviewApproved">—</div></div><div class="card"><div class="label">Published</div><div class="metric" id="reviewPublished">—</div></div><div class="card"><div class="label">Failed</div><div class="metric" id="reviewFailed">—</div></div></div><div class="notice">Review publishing remains controlled by the existing business-owner workflow.</div></section>
 <section id="integrations" class="hidden"><div class="grid"><div class="card"><div class="label">Google Connections</div><div class="metric" id="googleCount">—</div></div><div class="card"><div class="label">WhatsApp Connections</div><div class="metric" id="waCount">—</div></div><div class="card"><div class="label">Connected WhatsApp</div><div class="metric" id="waConnected">—</div></div><div class="card"><div class="label">Google Accounts</div><div class="metric" id="googleAccounts">—</div></div></div></section>
 <section id="menus" class="hidden"><div class="grid"><div class="card"><div class="label">Menus</div><div class="metric" id="menuCount">—</div></div><div class="card"><div class="label">Published Menus</div><div class="metric" id="menuPublished">—</div></div><div class="card"><div class="label">QR Codes</div><div class="metric" id="qrCount">—</div></div><div class="card"><div class="label">QR Scans</div><div class="metric" id="qrScans">—</div></div></div></section>
 <section id="system" class="hidden"><div class="card"><h2>System Health</h2><div class="statgrid"><div class="kv"><b>Admin API</b><span class="pill good">ONLINE</span></div><div class="kv"><b>Database</b><span class="pill good" id="dbHealth">CHECKING</span></div><div class="kv"><b>Environment</b><span id="envHealth">—</span></div></div><div class="notice">Infrastructure metrics are read-only here. Deployment and hosting remain managed through the existing Render service.</div></div></section>
 <section id="audit" class="hidden"><div class="card table"><div class="row head"><div>Action</div><div>Entity</div><div>Actor</div><div>Time</div><div></div></div><div id="auditRows"></div></div></section>
 <section id="settings" class="hidden"><div class="card"><h2>Platform Settings</h2><p class="sub">Global governance settings are intentionally read-only until the final Admin SaaS controls are wired.</p><div class="detail" style="margin-top:14px"><div class="kv"><b>Brand</b>reputetechs.in</div><div class="kv"><b>Trial</b>7 days</div><div class="kv"><b>Admin Accounts</b>2 authorized accounts</div><div class="kv"><b>2FA</b>Planned for final security phase</div></div></div></section>
 </main></div>
 <script>
 let rows=[],users=[],currentView='dashboard';
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const money=v=>{const n=Number(v||0);return '₹'+n.toLocaleString('en-IN',{maximumFractionDigits:0})};
 const date=v=>v?new Date(v).toLocaleDateString('en-IN'):'—';
 async function api(path,opt={}){const r=await fetch('/api'+path,{credentials:'include',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
 function statusPill(s){const x=String(s||'NO SUBSCRIPTION');return '<span class="pill '+(x==='ACTIVE'?'good':x==='TRIAL'?'warn':x==='FAILED'?'bad':'')+'">'+esc(x)+'</span>'}
 function row(b){return '<div class="row"><div><div class="name">'+esc(b.name)+'</div><div class="sub">'+esc(b.type||'')+' · '+(b.isOpen?'OPEN':'CLOSED')+'</div></div><div>'+esc(b.ownerName||'No owner')+'<div class="sub">'+esc(b.ownerEmail||'')+'</div></div><div><span class="pill">'+esc(b.subscription?.plan||'No plan')+'</span></div><div>'+statusPill(b.subscription?.status)+'</div><div><button class="light" onclick="openBusiness('+JSON.stringify(b.id)+')">View</button></div></div>'}
 function render(){const q=($('businessSearch')?.value||'').toLowerCase();const st=$('businessStatus')?.value||'';const filtered=rows.filter(b=>(!q||[b.name,b.ownerName,b.ownerEmail,b.type].join(' ').toLowerCase().includes(q))&&(!st||b.subscription?.status===st));$('rows').innerHTML=rows.slice(0,8).map(row).join('')||'<div class="empty">No businesses found.</div>';$('allRows').innerHTML=filtered.map(row).join('')||'<div class="empty">No matching businesses.</div>'}
 async function openBusiness(id){const d=await api('/admin/businesses/'+encodeURIComponent(id));$('businessList').classList.add('hidden');$('businessDetail').classList.remove('hidden');const b=d.business;const sub=d.subscription;$('businessDetail').innerHTML='<button class="light back" onclick="closeBusiness()">← Back to Businesses</button><div class="card"><h2>'+esc(b.name)+'</h2><div class="sub">'+esc(b.type)+' · '+(b.isOpen?'OPEN':'CLOSED')+'</div><div class="detail" style="margin-top:14px"><div class="kv"><b>Owner</b>'+esc(d.members.find(x=>x.role==='OWNER')?.user?.name||'No owner')+'</div><div class="kv"><b>Owner Email</b>'+esc(d.members.find(x=>x.role==='OWNER')?.user?.email||'—')+'</div><div class="kv"><b>Phone</b>'+esc(b.phone||'—')+'</div><div class="kv"><b>Website</b>'+esc(b.website||'—')+'</div><div class="kv"><b>Plan</b>'+esc(sub?.plan||'—')+'</div><div class="kv"><b>Subscription</b>'+statusPill(sub?.status)+'</div><div class="kv"><b>Trial Start</b>'+date(sub?.trialStartedAt)+'</div><div class="kv"><b>Trial End</b>'+date(sub?.trialEndsAt)+'</div><div class="kv"><b>Created</b>'+date(b.createdAt)+'</div><div class="kv"><b>Members</b>'+d.members.length+'</div><div class="kv wide"><b>Business ID</b>'+esc(b.id)+'</div></div></div>'}
 function closeBusiness(){$('businessDetail').classList.add('hidden');$('businessList').classList.remove('hidden')}
 async function load(){try{const d=await api('/admin/businesses');rows=d.businesses||[];$('count').textContent=rows.length;$('active').textContent=rows.filter(x=>x.subscription?.status==='ACTIVE').length;$('trials').textContent=rows.filter(x=>x.subscription?.status==='TRIAL').length;$('pending').textContent=d.pendingPlanRequests||0;render()}catch(e){$('rows').innerHTML='<div class="empty">'+esc(e.message)+'</div>'}}
 async function loadUsers(){const d=await api('/admin/users');users=d.users||[];const q=($('userSearch')?.value||'').toLowerCase();$('userRows').innerHTML=users.filter(u=>!q||[u.name,u.email,u.role].join(' ').toLowerCase().includes(q)).map(u=>'<div class="row"><div><div class="name">'+esc(u.name)+'</div><div class="sub">'+esc(u.email)+'</div></div><div>'+esc(u.role)+'</div><div>'+u.businessCount+'</div><div>'+date(u.createdAt)+'</div><div></div></div>').join('')||'<div class="empty">No users found.</div>'}
 async function loadPlans(){const d=await api('/admin/plans');$('planCount').textContent=d.plans.length;$('planActive').textContent=d.plans.filter(x=>x.active).length;$('planPending').textContent=d.pending;$('planRows').innerHTML=d.plans.map(p=>'<div class="row"><div><div class="name">'+esc(p.name)+'</div><div class="sub">'+esc(p.code)+'</div></div><div>'+money(p.price)+'</div><div>'+esc(p.billingInterval)+'</div><div>'+statusPill(p.active?'ACTIVE':'INACTIVE')+'</div><div></div></div>').join('')||'<div class="empty">No plans.</div>'}
 async function loadOrders(){const d=await api('/admin/orders');$('orderCount').textContent=d.count;$('orderPending').textContent=d.pending;$('orderPaid').textContent=d.paid;$('orderValue').textContent=money(d.value)}
 async function loadReviews(){const d=await api('/admin/reviews');$('reviewCount').textContent=d.count;$('reviewApproved').textContent=d.approved;$('reviewPublished').textContent=d.published;$('reviewFailed').textContent=d.failed}
 async function loadIntegrations(){const d=await api('/admin/integrations');$('googleCount').textContent=d.google;$('googleAccounts').textContent=d.googleAccounts;$('waCount').textContent=d.whatsapp;$('waConnected').textContent=d.whatsappConnected}
 async function loadMenus(){const d=await api('/admin/menus');$('menuCount').textContent=d.menus;$('menuPublished').textContent=d.published;$('qrCount').textContent=d.qr;$('qrScans').textContent=d.scans}
 async function loadAudit(){const d=await api('/admin/audit');$('auditRows').innerHTML=d.logs.map(x=>'<div class="row"><div class="name">'+esc(x.action)+'</div><div>'+esc(x.entity)+'</div><div>'+esc(x.actor||'System')+'</div><div>'+date(x.createdAt)+'</div><div></div></div>').join('')||'<div class="empty">No audit events.</div>'}
 async function loadSystem(){const d=await api('/admin/system');$('dbHealth').textContent=d.database?'ONLINE':'ERROR';$('dbHealth').className='pill '+(d.database?'good':'bad');$('envHealth').textContent=d.environment}
 async function show(view){currentView=view;document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));$(view).classList.remove('hidden');document.querySelectorAll('.nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const titles={dashboard:['Platform Overview','Repute Techs SaaS owner command center'],businesses:['Business Management','Tenant registry and business governance'],users:['User Management','Platform users and access control'],plans:['Plans & Subscriptions','Subscription governance'],orders:['Orders','Platform order governance'],reviews:['Reviews','Reviews and AI activity'],integrations:['Integrations','Google and WhatsApp monitoring'],menus:['Menus & QR','Digital menu and QR overview'],system:['System Health','Infrastructure observability'],audit:['Audit Logs','Administrative security trail'],settings:['Platform Settings','Global SaaS governance']};$('title').textContent=titles[view][0];$('desc').textContent=titles[view][1];if(view==='businesses'){closeBusiness();render()}if(view==='users')await loadUsers();if(view==='plans')await loadPlans();if(view==='orders')await loadOrders();if(view==='reviews')await loadReviews();if(view==='integrations')await loadIntegrations();if(view==='menus')await loadMenus();if(view==='system')await loadSystem();if(view==='audit')await loadAudit()}
 async function refreshCurrent(){if(currentView==='dashboard'||currentView==='businesses')await load();else await show(currentView)}
 document.querySelectorAll('.nav[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
 $('businessSearch').addEventListener('input',render);$('businessStatus').addEventListener('change',render);$('userSearch').addEventListener('input',loadUsers);load();
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
 originalGet.call(app,'/api/admin/users',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const users=await prisma.user.findMany({include:{memberships:true},orderBy:{createdAt:'desc'}});
  res.json({users:users.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,businessCount:u.memberships.length,createdAt:u.createdAt}))});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/plans',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const plans=await prisma.planCatalog.findMany({orderBy:{price:'asc'}});
  const pending=await prisma.planRequest.count({where:{status:'PENDING'}});
  res.json({plans,pending});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/orders',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [count,pending,paid,sum]=await Promise.all([
   prisma.order.count(),
   prisma.order.count({where:{status:'PENDING'}}),
   prisma.order.count({where:{paymentStatus:'PAID'}}),
   prisma.order.aggregate({_sum:{total:true}})
  ]);
  res.json({count,pending,paid,value:Number(sum._sum.total||0)});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/reviews',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [count,approved,published,failed]=await Promise.all([
   prisma.review.count(),
   prisma.review.count({where:{replyStatus:'APPROVED'}}),
   prisma.review.count({where:{replyStatus:'PUBLISHED'}}),
   prisma.review.count({where:{replyStatus:'FAILED'}})
  ]);
  res.json({count,approved,published,failed});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/integrations',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [google,googleAccounts,whatsapp,whatsappConnected]=await Promise.all([
   prisma.googleConnection.count(),
   prisma.googleConnection.count({where:{googleAccountId:{not:null}}}),
   prisma.whatsAppConnection.count(),
   prisma.whatsAppConnection.count({where:{status:'CONNECTED'}})
  ]);
  res.json({google,googleAccounts,whatsapp,whatsappConnected});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/menus',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [menus,published,qr,scans]=await Promise.all([
   prisma.menu.count(),
   prisma.menu.count({where:{isPublished:true}}),
   prisma.smartQr.count(),
   prisma.qrScan.count()
  ]);
  res.json({menus,published,qr,scans});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/audit',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const logs=await prisma.auditLog.findMany({orderBy:{createdAt:'desc'},take:100});
  const ids=[...new Set(logs.map(x=>x.actorUserId).filter(Boolean))];
  const actors=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,email:true}}):[];
  const map=new Map(actors.map(x=>[x.id,x.name||x.email]));
  res.json({logs:logs.map(x=>({...x,actor:x.actorUserId?map.get(x.actorUserId)||'Unknown':'System'}))});
 }catch(e){next(e)}}});
 originalGet.call(app,'/api/admin/system',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  await prisma.$queryRawUnsafe('SELECT 1');
  res.json({database:true,environment:process.env.NODE_ENV||'production'});
 }catch(e){res.json({database:false,environment:process.env.NODE_ENV||'production'})}});

}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
