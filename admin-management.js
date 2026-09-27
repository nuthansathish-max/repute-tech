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
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>reputetechs.in · SaaS Owner Console</title>
 <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
 <style>
 :root{--nav:#0b1220;--nav2:#111b2e;--primary:#5146e5;--primary2:#6d63ff;--bg:#f4f7fb;--card:#fff;--line:#e4e9f2;--muted:#6b778c;--ink:#172033;--good:#08a57a;--warn:#e6a11a;--bad:#e0525b;--cyan:#16a6c9}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px Inter,system-ui,sans-serif}.app{min-height:100vh}.side{position:fixed;left:0;top:0;bottom:0;width:224px;background:var(--nav);color:#aeb9ca;padding:12px 10px;overflow:auto;z-index:20}.brand{font-weight:800;color:#fff;font-size:17px;padding:10px 10px 5px}.brand span{color:#7c83ff}.role{font-size:9px;color:#a7b2ff;letter-spacing:.13em;margin:2px 10px 15px}.group{font-size:9px;text-transform:uppercase;color:#6f7d93;letter-spacing:.1em;padding:10px 9px 5px;font-weight:800}.nav{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;color:#b9c3d4;text-align:left;padding:8px 9px;border-radius:7px;cursor:pointer;font:600 11px Inter}.nav:hover{background:#17233a;color:#fff}.nav.active{background:#5146e5;color:#fff;box-shadow:0 5px 18px #5146e540}.nav .ico{width:16px;text-align:center;opacity:.95}.nav .badge{margin-left:auto;font-size:8px;padding:3px 5px;border-radius:5px;background:#1b2a43;color:#aab8cc}.main{margin-left:224px;min-height:100vh}.top{height:62px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 22px;position:sticky;top:0;z-index:10}.crumb{font-size:11px;color:var(--muted)}.top-actions{display:flex;align-items:center;gap:8px}.search{width:260px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#f8fafc;font:12px Inter}.topbtn{padding:8px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:7px;font-weight:700}.primary{background:var(--primary);color:#fff;border-color:var(--primary)}.content{padding:18px 22px 34px;max-width:1500px}.page-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px}.page-head h1{font-size:23px;margin:0 0 4px}.page-head p{margin:0;color:var(--muted);font-size:12px}.live{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:#eafaf5;color:#078663;font-size:10px;font-weight:800}.dot{width:6px;height:6px;border-radius:50%;background:var(--good)}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;box-shadow:0 1px 2px #0f172a08}.metric-card{min-height:92px;position:relative}.label{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#7b879a;font-weight:800}.metric{font-size:24px;font-weight:800;margin-top:7px;letter-spacing:-.03em}.sub{font-size:10px;color:var(--muted);margin-top:5px}.accent{position:absolute;right:12px;top:12px;font-size:18px}.section{margin-top:14px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:0 0 9px}.section-title h2{font-size:15px;margin:0}.section-title span{font-size:10px;color:var(--muted)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.input,.select{padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:#fff;font:11px Inter}.input{flex:1;min-width:200px}.table{overflow:auto}.row{display:grid;grid-template-columns:1.8fr 1fr 1fr 1fr 82px;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--line);min-width:700px}.row.head{background:#f8fafc;color:#7a8698;font-size:9px;text-transform:uppercase;font-weight:800}.name{font-weight:800;font-size:11px}.pill{display:inline-block;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800;background:#eef2ff;color:#4c46b7}.pill.good{background:#eafaf5;color:#087e61}.pill.warn{background:#fff7df;color:#a66b00}.pill.bad{background:#fff0f1;color:#b53b46}.smallbtn{padding:6px 9px;border:1px solid var(--line);background:#fff;border-radius:6px;font-size:10px;font-weight:700}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.quick .card{cursor:pointer}.quick strong{display:block;margin-bottom:5px}.notice{padding:10px 12px;border-radius:7px;background:#f7f9fc;color:var(--muted);font-size:10px}.empty{text-align:center;padding:20px;color:var(--muted)}.chart{height:245px;position:relative;overflow:hidden}.chart svg{width:100%;height:100%}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:9px;color:var(--muted);margin-top:4px}.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px}.fleet{margin-top:4px}.detail{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.kv{border:1px solid var(--line);border-radius:7px;padding:10px}.kv b{display:block;font-size:8px;text-transform:uppercase;color:#7b879a;margin-bottom:4px}.wide{grid-column:1/-1}.hidden{display:none!important}.mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.bar{height:7px;border-radius:999px;background:#edf1f7;overflow:hidden;margin-top:8px}.bar span{display:block;height:100%;background:var(--primary);border-radius:999px}.risk{border-left:3px solid var(--warn)}.danger{border-left:3px solid var(--bad)}.ok{border-left:3px solid var(--good)} .clickable{cursor:pointer}.clickable:hover{border-color:#cfd5e5;box-shadow:0 4px 14px #0f172a10}.snapshot-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.activity-bars{height:205px;display:flex;align-items:flex-end;gap:4px;padding:12px 8px 4px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.activity-bar-wrap{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;min-width:0}.activity-bar{width:100%;max-width:18px;border-radius:4px 4px 0 0;background:var(--primary);min-height:2px}.activity-label{font-size:8px;color:var(--muted);margin-top:5px;text-align:center}.mix-list{display:flex;flex-direction:column;gap:9px}.mix-row{display:grid;grid-template-columns:125px 1fr 28px;gap:8px;align-items:center;font-size:10px}.mix-bar{height:7px;border-radius:999px;background:#edf1f7;overflow:hidden}.mix-bar span{display:block;height:100%;background:var(--primary);border-radius:999px}.recent-list{display:flex;flex-direction:column;gap:8px;max-height:205px;overflow:auto}.recent-item{display:grid;grid-template-columns:74px 1fr;gap:8px;font-size:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}.recent-item:last-child{border-bottom:0}.recent-time{color:var(--muted)}@media(max-width:760px){.snapshot-grid{grid-template-columns:1fr 1fr}.mix-row{grid-template-columns:95px 1fr 24px}}@media(max-width:480px){.snapshot-grid{grid-template-columns:1fr}}
 @media(max-width:1050px){.side{width:190px}.main{margin-left:190px}.grid4{grid-template-columns:repeat(2,1fr)}.search{width:190px}.quick{grid-template-columns:1fr 1fr}}@media(max-width:760px){.side{width:64px;padding:10px 6px}.brand{font-size:0;text-align:center}.brand:before{content:'R';font-size:18px}.brand span,.role,.group{display:none}.nav{justify-content:center;padding:9px 5px}.nav .txt,.nav .badge{display:none}.main{margin-left:64px}.top{padding:0 12px}.search{display:none}.content{padding:14px}.grid4,.grid2,.mini-grid{grid-template-columns:1fr 1fr}.detail{grid-template-columns:1fr}.page-head h1{font-size:19px}}@media(max-width:480px){.grid4,.grid2,.mini-grid,.quick{grid-template-columns:1fr}.top-actions .topbtn{display:none}.page-head{flex-direction:column}.content{padding:12px 10px}}
 </style></head><body><div class="app">
 <aside class="side">
  <div class="brand">repute<span>techs.in</span></div><div class="role">SUPER ADMIN · PLATFORM OWNER</div>
  <div class="group">Platform Governance</div>
  <button class="nav active" data-view="overview"><span class="ico">◉</span><span class="txt">Master Overview</span></button>
  <button class="nav" data-view="tenants"><span class="ico">▦</span><span class="txt">Tenant Workspaces</span><span class="badge" id="tenantBadge">—</span></button>
  <button class="nav" data-view="analytics"><span class="ico">⌁</span><span class="txt">Platform Analytics</span></button>
  <button class="nav" data-view="subscriptions"><span class="ico">◈</span><span class="txt">Subscriptions & Plans</span></button>
  <button class="nav" data-view="revenue"><span class="ico">₹</span><span class="txt">Platform Revenue & Billing</span></button>
  <div class="group">Infrastructure & Gateways</div>
  <button class="nav" data-view="reviews"><span class="ico">✦</span><span class="txt">Reviews & AI Pipeline</span><span class="badge">94% AI</span></button>
  <button class="nav" data-view="ai"><span class="ico">AI</span><span class="txt">AI Usage & Tokens</span></button>
  <button class="nav" data-view="google"><span class="ico">G</span><span class="txt">Google Business API</span></button>
  <button class="nav" data-view="whatsapp"><span class="ico">▣</span><span class="txt">WhatsApp Cloud</span><span class="badge">SLA</span></button>
  <button class="nav" data-view="webhooks"><span class="ico">↯</span><span class="txt">Webhooks & Event Bus</span></button>
  <div class="group">Financials & Ledger</div>
  <button class="nav" data-view="orders"><span class="ico">▤</span><span class="txt">Platform Orders</span></button>
  <button class="nav" data-view="invoices"><span class="ico">▧</span><span class="txt">Invoices & GST Tax</span></button>
  <button class="nav" data-view="payouts"><span class="ico">⇄</span><span class="txt">Payouts & Gateways</span></button>
  <div class="group">Security & Config</div>
  <button class="nav" data-view="audit"><span class="ico">⌑</span><span class="txt">Audit Logs</span></button>
  <button class="nav" data-view="billing"><span class="ico">▣</span><span class="txt">Billing Tiers</span></button>
  <button class="nav" data-view="kill"><span class="ico">!</span><span class="txt">Emergency Kill Switch</span></button>
  <div style="margin-top:12px"><button class="nav" onclick="location.href='/'"><span class="ico">↗</span><span class="txt">Business Dashboard</span></button></div>
 </aside>
 <main class="main">
  <header class="top"><div class="crumb">ROOT CLUSTER &nbsp; / &nbsp; <b>ap-south-1</b></div><div class="top-actions"><input class="search" id="globalSearch" placeholder="Quick search or command  ⌘K"><button class="topbtn" id="maintenanceBtn" title="Platform maintenance control">Maint: OFF</button><button class="topbtn" id="exportBtn" title="Export tenant registry">⇩</button><button class="topbtn" id="refreshBtn" title="Refresh current admin view">◔</button><button class="topbtn primary" id="onboardBtn" onclick="show('tenants')" title="Open tenant workspace">▣ Onboard Business</button></div></header>
  <div class="content">
   <div class="page-head"><div><h1 id="title">Master Overview</h1><p id="desc">Platform-wide SaaS command center for reputetechs.in</p></div><span class="live"><span class="dot"></span> ap-south-1 · Direct Peering · IST Realtime</span></div>

   <section id="overview">
    <div class="grid4">
     <div class="card metric-card clickable" onclick="show('tenants')"><div class="label">Connected Businesses</div><div class="metric" id="ovBusinesses">—</div><div class="sub" id="ovBusinessSub">Live tenant registry · View all</div><div class="accent">▦</div></div>
     <div class="card metric-card clickable" onclick="show('subscriptions')"><div class="label">Active Subscriptions</div><div class="metric" id="ovActive">—</div><div class="sub">Currently active · View plans</div><div class="accent">◈</div></div>
     <div class="card metric-card"><div class="label">7-Day Trials</div><div class="metric" id="ovTrials">—</div><div class="sub">Trial subscriptions</div><div class="accent">◷</div></div>
     <div class="card metric-card clickable" onclick="show('subscriptions')"><div class="label">Pending Plan Requests</div><div class="metric" id="ovPending">—</div><div class="sub">Awaiting admin review · Open plans</div><div class="accent">!</div></div>
    </div>
    <div class="section grid2">
     <div class="card"><div class="section-title"><h2>Platform Activity</h2><span>24H · verified audit events</span></div><div id="overviewActivity" class="activity-bars"><div class="empty">Loading verified activity…</div></div><div class="legend"><span><i style="background:#5146e5"></i>Administrative events recorded in the platform audit log</span></div></div>
     <div class="card"><div class="section-title"><h2>Gateway Health</h2><span>Current</span></div><div class="mini-grid"><div class="card ok"><div class="label">Google API</div><div class="metric" id="ovGoogle">—</div><div class="sub">Connections</div></div><div class="card ok"><div class="label">WhatsApp</div><div class="metric" id="ovWhatsApp">—</div><div class="sub">Connected</div></div><div class="card ok"><div class="label">Database</div><div class="metric" id="ovDb">—</div><div class="sub">Health</div></div></div><div class="notice" style="margin-top:10px">Existing Google publishing, WhatsApp connectivity and database services remain on their current production paths.</div></div>
    </div>
    <div class="section snapshot-grid">
     <div class="card metric-card"><div class="label">Platform Users</div><div class="metric" id="ovUsers">—</div><div class="sub">Registered users</div><div class="accent">◉</div></div>
     <div class="card metric-card clickable" onclick="show('orders')"><div class="label">Platform Orders</div><div class="metric" id="ovOrders">—</div><div class="sub">All recorded orders</div><div class="accent">▤</div></div>
     <div class="card metric-card clickable" onclick="show('reviews')"><div class="label">Reviews</div><div class="metric" id="ovReviews">—</div><div class="sub">All recorded reviews</div><div class="accent">✦</div></div>
     <div class="card metric-card"><div class="label">Plan Types</div><div class="metric" id="ovPlanTypes">—</div><div class="sub">Configured catalog plans</div><div class="accent">◈</div></div>
    </div>
    <div class="section grid2">
     <div class="card"><div class="section-title"><h2>Subscription Mix</h2><span>Current tenant subscriptions</span></div><div id="ovPlanMix" class="mix-list"><div class="empty">Loading plan mix…</div></div></div>
     <div class="card"><div class="section-title"><h2>Recent Platform Activity</h2><span>Latest audit events</span></div><div id="ovRecentActivity" class="recent-list"><div class="empty">Loading activity…</div></div></div>
    </div>
    <div class="section"><div class="section-title"><h2>Tenant Fleet Registry</h2><span>Live businesses</span></div><div class="card table"><div class="row head"><div>Tenant Business & Location</div><div>Owner</div><div>Subscription</div><div>Operating State</div><div></div></div><div id="overviewRows"></div></div></div>
   </section>

   <section id="tenants" class="hidden">
    <div class="toolbar"><input id="businessSearch" class="input" placeholder="Filter business, owner, email or type"><select id="businessStatus" class="select"><option value="">All subscription states</option><option>TRIAL</option><option>ACTIVE</option><option>INACTIVE</option></select></div>
    <div id="businessList" class="card table"><div class="row head"><div>Tenant Business</div><div>Owner</div><div>Plan</div><div>Connection</div><div>Action</div></div><div id="allRows"></div></div>
    <div id="businessDetail" class="hidden"></div>
   </section>

   <section id="analytics" class="hidden">
    <div class="grid4"><div class="card metric-card"><div class="label">Businesses</div><div class="metric" id="anBiz">—</div></div><div class="card metric-card"><div class="label">Users</div><div class="metric" id="anUsers">—</div></div><div class="card metric-card"><div class="label">Orders</div><div class="metric" id="anOrders">—</div></div><div class="card metric-card"><div class="label">Reviews</div><div class="metric" id="anReviews">—</div></div></div>
    <div class="section grid2"><div class="card"><div class="section-title"><h2>Platform Trend</h2><span>Illustrative telemetry shell</span></div><div class="chart"><svg viewBox="0 0 800 245" preserveAspectRatio="none"><path d="M0 220 C100 214 120 190 210 202 S330 145 405 170 S500 118 575 145 S690 86 800 105 L800 245 L0 245Z" fill="#5146e51c"/><path d="M0 220 C100 214 120 190 210 202 S330 145 405 170 S500 118 575 145 S690 86 800 105" fill="none" stroke="#5146e5" stroke-width="3"/></svg></div></div><div class="card"><div class="section-title"><h2>Operational Mix</h2><span>Current platform counts</span></div><div class="label">Active subscriptions</div><div class="bar"><span id="activeBar" style="width:0"></span></div><div class="label" style="margin-top:13px">Trial subscriptions</div><div class="bar"><span id="trialBar" style="width:0"></span></div><div class="label" style="margin-top:13px">Pending requests</div><div class="bar"><span id="pendingBar" style="width:0"></span></div></div></div>
   </section>

   <section id="subscriptions" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Catalog Plans</div><div class="metric" id="planCount">—</div></div><div class="card metric-card"><div class="label">Active Plans</div><div class="metric" id="planActive">—</div></div><div class="card metric-card"><div class="label">Pending Requests</div><div class="metric" id="planPending">—</div></div><div class="card metric-card"><div class="label">Trial Policy</div><div class="metric">7 days</div></div></div><div class="section card table"><div class="row head"><div>Plan</div><div>Price</div><div>Interval</div><div>State</div><div></div></div><div id="planRows"></div></div></section>
   <section id="revenue" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Order Value</div><div class="metric" id="revValue">—</div><div class="sub">Recorded platform orders</div></div><div class="card metric-card"><div class="label">Paid Orders</div><div class="metric" id="revPaid">—</div></div><div class="card metric-card"><div class="label">Pending Orders</div><div class="metric" id="revPending">—</div></div><div class="card metric-card"><div class="label">Billing Model</div><div class="metric">SaaS</div><div class="sub">Subscription + platform orders</div></div></div><div class="section notice">Revenue and tax automation controls are not connected to this admin UI yet; this page currently exposes the verified order totals only.</div></section>

   <section id="reviews" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Total Reviews</div><div class="metric" id="reviewCount">—</div></div><div class="card metric-card"><div class="label">Approved</div><div class="metric" id="reviewApproved">—</div></div><div class="card metric-card"><div class="label">Published</div><div class="metric" id="reviewPublished">—</div></div><div class="card metric-card"><div class="label">Failed</div><div class="metric" id="reviewFailed">—</div></div></div><div class="section card"><div class="section-title"><h2>Reviews & AI Pipeline</h2><span>Existing production workflow</span></div><div class="mini-grid"><div class="card ok"><div class="label">AI pipeline</div><div class="metric">94%</div><div class="sub">UI reference indicator</div></div><div class="card"><div class="label">Google publish</div><div class="metric">LIVE</div><div class="sub">Existing business workflow</div></div><div class="card"><div class="label">Failures</div><div class="metric" id="reviewFailed2">—</div><div class="sub">Recorded failed replies</div></div></div></div></section>
   <section id="ai" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">AI Usage</div><div class="metric">MONITOR</div><div class="sub">Telemetry shell</div></div><div class="card metric-card"><div class="label">Token Usage</div><div class="metric">—</div><div class="sub">No verified token ledger endpoint</div></div><div class="card metric-card"><div class="label">AI Errors</div><div class="metric">—</div><div class="sub">No dedicated metric endpoint</div></div><div class="card metric-card"><div class="label">Policy</div><div class="metric">ACTIVE</div></div></div><div class="section notice">This section is intentionally UI-only until the production AI/token telemetry source is connected.</div></section>
   <section id="google" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Google Connections</div><div class="metric" id="googleCount">—</div></div><div class="card metric-card"><div class="label">Google Accounts</div><div class="metric" id="googleAccounts">—</div></div><div class="card metric-card"><div class="label">API State</div><div class="metric">ONLINE</div></div><div class="card metric-card"><div class="label">Publish Workflow</div><div class="metric">LIVE</div></div></div><div class="section notice">Google Business API monitoring uses the existing connection records; no changes are made to the working review publishing path.</div></section>
   <section id="whatsapp" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">WhatsApp Connections</div><div class="metric" id="waCount">—</div></div><div class="card metric-card"><div class="label">Connected & Active</div><div class="metric" id="waConnected">—</div></div><div class="card metric-card"><div class="label">SLA</div><div class="metric">99.2%</div><div class="sub">UI reference indicator</div></div><div class="card metric-card"><div class="label">Cloud API</div><div class="metric">ONLINE</div></div></div><div class="section grid2"><div class="card"><div class="section-title"><h2>WhatsApp Cloud Mesh</h2><span>Realtime shell</span></div><div class="chart"><svg viewBox="0 0 800 245" preserveAspectRatio="none"><path d="M0 190 C80 195 100 130 180 158 S300 115 370 135 S480 80 560 118 S670 70 800 92" fill="none" stroke="#16a6c9" stroke-width="3"/><path d="M0 214 C100 206 150 190 220 196 S330 168 410 178 S520 145 600 160 S710 130 800 140" fill="none" stroke="#5146e5" stroke-width="2" stroke-dasharray="6 5"/></svg></div></div><div class="card"><div class="section-title"><h2>Gateway State</h2><span>Current</span></div><div class="kv ok"><b>Connection layer</b><span class="pill good">CONNECTED DATA SOURCE</span></div><div class="kv" style="margin-top:8px"><b>Control actions</b>Not enabled in this phase</div></div></div></section>
   <section id="webhooks" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Event Bus</div><div class="metric">MONITOR</div></div><div class="card metric-card"><div class="label">Webhooks</div><div class="metric">—</div><div class="sub">No dedicated endpoint</div></div><div class="card metric-card"><div class="label">Retry Queue</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Gateway</div><div class="metric">ONLINE</div></div></div><div class="section notice">Webhook and event-bus controls will be connected only after a verified production telemetry source is available.</div></section>

   <section id="orders" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Total Orders</div><div class="metric" id="orderCount">—</div></div><div class="card metric-card"><div class="label">Pending</div><div class="metric" id="orderPending">—</div></div><div class="card metric-card"><div class="label">Paid</div><div class="metric" id="orderPaid">—</div></div><div class="card metric-card"><div class="label">Order Value</div><div class="metric" id="orderValue">—</div></div></div><div class="section notice">Platform order governance is read-only here. Business owners continue to manage individual orders from their existing dashboard.</div></section>
   <section id="invoices" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Invoices</div><div class="metric">—</div><div class="sub">No invoice ledger endpoint</div></div><div class="card metric-card"><div class="label">GST</div><div class="metric">READY</div></div><div class="card metric-card"><div class="label">Tax Rules</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Exports</div><div class="metric">UI</div></div></div><div class="section notice">Invoice/GST calculations are not connected to the current admin API, so this page does not invent financial values.</div></section>
   <section id="payouts" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Payouts</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Gateway</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Settled</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Exceptions</div><div class="metric">—</div></div></div><div class="section notice">Payout gateway data is not currently exposed by a verified admin endpoint.</div></section>

   <section id="audit" class="hidden"><div class="section-title"><h2>Administrative Security Trail</h2><span>Latest 100 events</span></div><div class="card table"><div class="row head"><div>Action</div><div>Entity</div><div>Actor</div><div>Time</div><div></div></div><div id="auditRows"></div></div></section>
   <section id="billing" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Starter</div><div class="metric">₹499</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Growth Pro</div><div class="metric">₹999</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Pro Plus</div><div class="metric">₹1499</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Yearly Plans</div><div class="metric">3</div><div class="sub">₹4999 · ₹9999 · ₹12999</div></div></div><div class="section notice">Billing tiers mirror the existing six-plan catalog. Editing controls are not enabled in this phase.</div></section>
   <section id="kill" class="hidden"><div class="card danger"><div class="section-title"><h2>Emergency Kill Switch</h2><span>Security & Config</span></div><div class="kv"><b>Global state</b><span class="pill good">OFF · NORMAL OPERATIONS</span></div><div class="notice" style="margin-top:10px">No destructive or global shutdown action is wired to this UI. This prevents accidental changes to live business operations.</div></div></section>
  </div>
 </main></div>
 <script>
 let rows=[],users=[],currentView='overview';
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0});
 const date=v=>v?new Date(v).toLocaleDateString('en-IN'):'—';
 async function api(path,opt={}){const r=await fetch('/api'+path,{credentials:'include',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
 function statusPill(s){const x=String(s||'NO SUBSCRIPTION');return '<span class="pill '+(x==='ACTIVE'?'good':x==='TRIAL'?'warn':x==='FAILED'?'bad':'')+'">'+esc(x)+'</span>'}
 function row(b){return '<div class="row"><div><div class="name">'+esc(b.name)+'</div><div class="sub">'+esc(b.type||'')+' · '+(b.isOpen?'OPEN':'CLOSED')+'</div></div><div>'+esc(b.ownerName||'No owner')+'<div class="sub">'+esc(b.ownerEmail||'')+'</div></div><div>'+statusPill(b.subscription?.status)+'<div class="sub">'+esc(b.subscription?.plan||'No plan')+'</div></div><div>'+(b.isOpen?'<span class="pill good">OPEN</span>':'<span class="pill">CLOSED</span>')+'</div><div><button class="smallbtn" data-business-id="'+esc(b.id)+'" data-action="view-business">View</button></div></div>'}
 function renderRows(){
  const q=($('businessSearch')?.value||'').trim().toLowerCase();
  const st=$('businessStatus')?.value||'';
  const filtered=rows.filter(b=>{
   const hay=[b.name,b.ownerName,b.ownerEmail,b.type,b.slug,b.subscription?.plan,b.subscription?.status].join(' ').toLowerCase();
   return (!q||hay.includes(q))&&(!st||b.subscription?.status===st);
  });
  if($('tenantBadge'))$('tenantBadge').textContent=rows.length;
  if($('overviewRows'))$('overviewRows').innerHTML=filtered.slice(0,8).map(row).join('')||'<div class="empty">No businesses found.</div>';
  if($('allRows'))$('allRows').innerHTML=filtered.map(row).join('')||'<div class="empty">No businesses found.</div>';
 }
 async function openBusiness(id){
  try{
   const d=await api('/admin/businesses/'+encodeURIComponent(id));
   const b=d;
   const sub=b.subscription||{};
   const members=(b.members||[]).map(m=>'<div class="kv"><b>Member · '+esc(m.role)+'</b>'+esc(m.user?.name||'')+'<div class="sub">'+esc(m.user?.email||'')+'</div></div>').join('');
   $('businessDetail').innerHTML='<div class="section card"><div class="section-title"><h2>'+esc(b.name)+'</h2><button class="smallbtn" onclick="closeBusiness()">Close</button></div><div class="detail">'+
    '<div class="kv"><b>Business Type</b>'+esc(b.type||'—')+'</div>'+
    '<div class="kv"><b>Phone</b>'+esc(b.phone||'—')+'</div>'+
    '<div class="kv"><b>Status</b>'+statusPill(b.isOpen?'OPEN':'CLOSED')+'</div>'+
    '<div class="kv"><b>Plan</b>'+esc(sub.plan||'—')+'</div>'+
    '<div class="kv"><b>Subscription</b>'+statusPill(sub.status)+'</div>'+
    '<div class="kv"><b>Created</b>'+date(b.createdAt)+'</div>'+
    '<div class="wide"><b style="display:block;font-size:8px;text-transform:uppercase;color:#7b879a;margin-bottom:6px">Members / Owners</b><div class="detail">'+(members||'<div class="empty">No members.</div>')+'</div></div>'+
    '</div></div>';
   $('businessDetail').classList.remove('hidden');
  }catch(e){
   $('businessDetail').innerHTML='<div class="card danger"><b>Unable to load business</b><div class="sub">'+esc(e.message)+'</div></div>';
   $('businessDetail').classList.remove('hidden');
  }
 }
 function closeBusiness(){if($('businessDetail')){$('businessDetail').classList.add('hidden');$('businessDetail').innerHTML='';}}
 async function loadBusinesses(){try{const d=await api('/admin/businesses');rows=d.businesses||[];$('ovBusinesses').textContent=rows.length;$('ovActive').textContent=rows.filter(x=>x.subscription?.status==='ACTIVE').length;$('ovTrials').textContent=rows.filter(x=>x.subscription?.status==='TRIAL').length;$('ovPending').textContent=d.pendingPlanRequests||0;renderRows()}catch(e){$('overviewRows').innerHTML='<div class="empty">'+esc(e.message)+'</div>'}}
 async function loadUsers(){const d=await api('/admin/users');users=d.users||[];const q=($('globalSearch')?.value||'').toLowerCase();$('anUsers').textContent=users.length;return users.filter(u=>!q||[u.name,u.email,u.role].join(' ').toLowerCase().includes(q))}
 async function loadPlans(){const d=await api('/admin/plans');$('planCount').textContent=d.plans.length;$('planActive').textContent=d.plans.filter(x=>x.active).length;$('planPending').textContent=d.pending;$('planRows').innerHTML=d.plans.map(p=>'<div class="row"><div><div class="name">'+esc(p.name)+'</div><div class="sub">'+esc(p.code)+'</div></div><div>'+money(p.price)+'</div><div>'+esc(p.billingInterval)+'</div><div>'+statusPill(p.active?'ACTIVE':'INACTIVE')+'</div><div></div></div>').join('')||'<div class="empty">No plans.</div>'}
 async function loadOrders(){const d=await api('/admin/orders');$('orderCount').textContent=d.count;$('orderPending').textContent=d.pending;$('orderPaid').textContent=d.paid;$('orderValue').textContent=money(d.value);$('revValue').textContent=money(d.value);$('revPaid').textContent=d.paid;$('revPending').textContent=d.pending;$('anOrders').textContent=d.count}
 async function loadReviews(){const d=await api('/admin/reviews');$('reviewCount').textContent=d.count;$('reviewApproved').textContent=d.approved;$('reviewPublished').textContent=d.published;$('reviewFailed').textContent=d.failed;$('reviewFailed2').textContent=d.failed;$('anReviews').textContent=d.count}
 async function loadIntegrations(){const d=await api('/admin/integrations');$('googleCount').textContent=d.google;$('googleAccounts').textContent=d.googleAccounts;$('waCount').textContent=d.whatsapp;$('waConnected').textContent=d.whatsappConnected;$('ovGoogle').textContent=d.google;$('ovWhatsApp').textContent=d.whatsappConnected}
 async function loadAudit(){const d=await api('/admin/audit');$('auditRows').innerHTML=d.logs.map(x=>'<div class="row"><div class="name">'+esc(x.action)+'</div><div>'+esc(x.entity)+'</div><div>'+esc(x.actor||'System')+'</div><div>'+date(x.createdAt)+'</div><div></div></div>').join('')||'<div class="empty">No audit events.</div>'}
 async function loadSystem(){const d=await api('/admin/system');$('ovDb').textContent=d.database?'ONLINE':'ERROR';$('ovDb').style.color=d.database?'var(--good)':'var(--bad)'}
 async function loadOverviewInsights(){
  try{
   const [u,o,r,a]=await Promise.all([api('/admin/users'),api('/admin/orders'),api('/admin/reviews'),api('/admin/audit')]);
   users=u.users||[];
   const logs=a.logs||[];
   $('ovUsers').textContent=users.length;
   $('ovOrders').textContent=o.count??0;
   $('ovReviews').textContent=r.count??0;
   const planCounts={};
   rows.forEach(b=>{const p=b.subscription?.plan;if(p)planCounts[p]=(planCounts[p]||0)+1});
   $('ovPlanTypes').textContent=Object.keys(planCounts).length;
   const total=rows.length||1;
   const mix=Object.entries(planCounts).sort((a,b)=>b[1]-a[1]);
   $('ovPlanMix').innerHTML=mix.length?mix.map(([p,n])=>'<div class="mix-row"><span>'+esc(p)+'</span><div class="mix-bar"><span style="width:'+Math.round(n/total*100)+'%"></span></div><b>'+n+'</b></div>').join(''):'<div class="empty">No tenant subscriptions recorded.</div>';
   const now=Date.now(),since=now-24*60*60*1000,buckets=Array(12).fill(0);
   logs.forEach(x=>{const t=new Date(x.createdAt).getTime();if(Number.isFinite(t)&&t>=since){const i=Math.min(11,Math.floor((t-since)/(2*60*60*1000)));buckets[i]++}});
   const max=Math.max(1,...buckets);
   $('overviewActivity').innerHTML=buckets.map((n,i)=>'<div class="activity-bar-wrap"><div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><div class="activity-bar" title="'+n+' audit events">'+Math.max(2,Math.round(n/max*100))+'%</div><div class="activity-label">'+(i%3===0?(i*2)+'h':'')+'</div></div></div>').join('');
   const recent=logs.slice(0,8);
   $('ovRecentActivity').innerHTML=recent.length?recent.map(x=>'<div class="recent-item"><div class="recent-time">'+date(x.createdAt)+'</div><div><b>'+esc(x.action||'Event')+'</b><div class="sub">'+esc(x.entity||'Platform')+' · '+esc(x.actor||'System')+'</div></div></div>').join(''):'<div class="empty">No audit events recorded yet.</div>';
  }catch(e){
   $('ovUsers').textContent='—';$('ovOrders').textContent='—';$('ovReviews').textContent='—';$('ovPlanTypes').textContent='—';
   $('ovPlanMix').innerHTML='<div class="empty">'+esc(e.message)+'</div>';$('ovRecentActivity').innerHTML='<div class="empty">'+esc(e.message)+'</div>';$('overviewActivity').innerHTML='<div class="empty">Verified activity unavailable.</div>';
  }
 }
 const titles={overview:['Master Overview','Platform-wide SaaS command center for reputetechs.in'],tenants:['Tenant Workspaces','Live registry of businesses, owners and subscriptions'],analytics:['Platform Analytics','Platform-wide operational telemetry'],subscriptions:['Subscriptions & Plans','Plan catalog, trials and subscription governance'],revenue:['Platform Revenue & Billing','Verified platform order and billing overview'],reviews:['Reviews & AI Pipeline','Review processing and publishing overview'],ai:['AI Usage & Tokens','AI and token telemetry workspace'],google:['Google Business API','Google Business connection and publishing health'],whatsapp:['WhatsApp Cloud','WhatsApp Cloud API and gateway health'],webhooks:['Webhooks & Event Bus','Webhook and event delivery monitoring'],orders:['Platform Orders','Platform-wide order governance'],invoices:['Invoices & GST Tax','Invoice and tax governance workspace'],payouts:['Payouts & Gateways','Payout and gateway monitoring'],audit:['Audit Logs','Administrative security trail'],billing:['Billing Tiers','Subscription tier reference'],kill:['Emergency Kill Switch','Emergency operational controls']};
 async function show(view){
   const section=$(view);
   if(!section)return;
   currentView=view;
   document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));
   section.classList.remove('hidden');
   document.querySelectorAll('.nav[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
   $('title').textContent=titles[view]?.[0]||view;
   $('desc').textContent=titles[view]?.[1]||'';
   try{
    if(view==='overview'||view==='tenants'||view==='analytics')await loadBusinesses();
    if(view==='analytics'){
     await loadUsers();
     $('activeBar').style.width=Math.min(100,rows.length?rows.filter(x=>x.subscription?.status==='ACTIVE').length/rows.length*100:0)+'%';
     $('trialBar').style.width=Math.min(100,rows.length?rows.filter(x=>x.subscription?.status==='TRIAL').length/rows.length*100:0)+'%';
     $('pendingBar').style.width=Math.min(100,(Number($('ovPending').textContent)||0)*10)+'%';
     $('anBiz').textContent=rows.length;
    }
    if(view==='subscriptions'||view==='billing')await loadPlans();
    if(view==='orders'||view==='revenue')await loadOrders();
    if(view==='reviews')await loadReviews();
    if(view==='google'||view==='whatsapp'||view==='overview')await loadIntegrations();
    if(view==='audit')await loadAudit();
    if(view==='overview'){await loadSystem();await loadOverviewInsights();}
    if(view==='tenants')closeBusiness();
   }catch(e){
    const existing=section.querySelector('.admin-load-error');
    if(!existing){
     const n=document.createElement('div');
     n.className='card danger admin-load-error';
     n.style.marginBottom='12px';
     n.innerHTML='<b>Unable to load this section</b><div class="sub">'+esc(e.message)+'</div>';
     section.prepend(n);
    }
   }
  }
  async function refreshCurrent(){await show(currentView)}
 document.querySelectorAll('.nav[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
 document.addEventListener('click',e=>{
  const viewBtn=e.target.closest('[data-action="view-business"]');
  if(viewBtn){e.preventDefault();openBusiness(viewBtn.dataset.businessId);return}
 });
 $('refreshBtn').addEventListener('click',()=>refreshCurrent());
 $('exportBtn').addEventListener('click',()=>{
  const headers=['Business','Type','Owner','Email','Plan','Subscription','Open'];
  const data=rows.map(b=>[b.name||'',b.type||'',b.ownerName||'',b.ownerEmail||'',b.subscription?.plan||'',b.subscription?.status||'',b.isOpen?'OPEN':'CLOSED']);
  const csv=[headers,...data].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='reputetechs-tenant-registry.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 $('maintenanceBtn').addEventListener('click',()=>alert('Maintenance Mode is not connected to a platform-wide maintenance service yet. It is intentionally read-only until the backend control is implemented.'));
 $('globalSearch').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
   const q=e.target.value.trim().toLowerCase();
   if(!q)return;
   const routes=[['business','tenants'],['tenant','tenants'],['order','orders'],['review','reviews'],['plan','subscriptions'],['subscription','subscriptions'],['audit','audit'],['google','google'],['whatsapp','whatsapp'],['analytics','analytics'],['billing','billing'],['revenue','revenue']];
   const hit=routes.find(x=>q.includes(x[0]));
   if(hit)show(hit[1]);else alert('No matching Admin section found for: '+e.target.value);
  }
 });
 $('businessSearch').addEventListener('input',renderRows);$('businessStatus').addEventListener('change',renderRows);loadBusinesses();loadIntegrations();loadSystem();loadOverviewInsights();
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
  const members=b.members.map(m=>({id:m.id,role:m.role,user:m.user}));
  res.json({
   id:b.id,name:b.name,type:b.type,slug:b.slug,logoUrl:b.logoUrl,
   phone:b.phone,website:b.website,isOpen:b.isOpen,createdAt:b.createdAt,
   subscription:b.subscription,members
  });
 } catch(e) { next(e); }
 });
 originalGet.call(app,'/api/admin/users',async(req,res,next)=>{
  try {
   const user=await requireAdmin(req,res); if(!user)return;
   const users=await prisma.user.findMany({include:{memberships:true},orderBy:{createdAt:'desc'}});
   const mapped=users.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,businessCount:u.memberships.length,createdAt:u.createdAt}));
   res.json({users:mapped});
  } catch(e) { next(e); }
 });
 originalGet.call(app,'/api/admin/plans',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const plans=await prisma.planCatalog.findMany({orderBy:{price:'asc'}});
  const pending=await prisma.planRequest.count({where:{status:'PENDING'}});
  res.json({plans,pending});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/orders',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [count,pending,paid,sum]=await Promise.all([
   prisma.order.count(),
   prisma.order.count({where:{status:'PENDING'}}),
   prisma.order.count({where:{paymentStatus:'PAID'}}),
   prisma.order.aggregate({_sum:{total:true}})
  ]);
  res.json({count,pending,paid,value:Number(sum._sum.total||0)});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/reviews',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [count,approved,published,failed]=await Promise.all([
   prisma.review.count(),
   prisma.review.count({where:{replyStatus:'APPROVED'}}),
   prisma.review.count({where:{replyStatus:'PUBLISHED'}}),
   prisma.review.count({where:{replyStatus:'FAILED'}})
  ]);
  res.json({count,approved,published,failed});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/integrations',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [google,googleAccounts,whatsapp,whatsappConnected]=await Promise.all([
   prisma.googleConnection.count(),
   prisma.googleConnection.count({where:{googleAccountId:{not:null}}}),
   prisma.whatsAppConnection.count(),
   prisma.whatsAppConnection.count({where:{status:'CONNECTED'}})
  ]);
  res.json({google,googleAccounts,whatsapp,whatsappConnected});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/menus',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [menus,published,qr,scans]=await Promise.all([
   prisma.menu.count(),
   prisma.menu.count({where:{isPublished:true}}),
   prisma.smartQr.count(),
   prisma.qrScan.count()
  ]);
  res.json({menus,published,qr,scans});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/audit',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const logs=await prisma.auditLog.findMany({orderBy:{createdAt:'desc'},take:100});
  const ids=[...new Set(logs.map(x=>x.actorUserId).filter(Boolean))];
  const actors=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,email:true}}):[];
  const map=new Map(actors.map(x=>[x.id,x.name||x.email]));
  res.json({logs:logs.map(x=>({...x,actor:x.actorUserId?map.get(x.actorUserId)||'Unknown':'System'}))});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/system',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  await prisma.$queryRawUnsafe('SELECT 1');
  res.json({database:true,environment:process.env.NODE_ENV||'production'});
 }catch(e){res.json({database:false,environment:process.env.NODE_ENV||'production'})}});

}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
