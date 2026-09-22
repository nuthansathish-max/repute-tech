import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
const originalPost=express.application.post;
let installed=false;

async function sessionUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}
async function requireAdmin(req,res){
  const user=await sessionUser(req);
  if(!user){res.status(401).json({error:'Authentication required'});return null;}
  if(!['ADMIN','SUPER_ADMIN'].includes(user.role)){res.status(403).json({error:'Admin access required'});return null;}
  return user;
}
function adminPage(){
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Panel · repute-tech.in</title><style>'+
  ':root{--bg:#f6f7fb;--card:#fff;--ink:#171a2b;--muted:#667085;--line:#e6e8ef;--p:#5146e5}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif}header{background:#10152b;color:#fff;padding:18px 22px;display:flex;justify-content:space-between;align-items:center;gap:10px;position:sticky;top:0;z-index:5}.brand{font-weight:800;font-size:19px}.brand span{color:#8b82ff}button{border:0;border-radius:9px;padding:10px 13px;font-weight:700;cursor:pointer}.light{background:#fff;color:#171a2b}.primary{background:var(--p);color:#fff}main{max-width:1400px;margin:auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px}.label{font-size:12px;color:var(--muted)}.value{font-size:27px;font-weight:800;margin-top:6px}.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:18px 0 12px}.toolbar input{width:min(360px,100%);padding:11px;border:1px solid var(--line);border-radius:9px;font:inherit}.list{display:grid;gap:10px}.business{display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:12px;align-items:center}.name{font-weight:800}.muted{font-size:12px;color:var(--muted);margin-top:4px}.pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#eef2ff;color:#4338ca;font-size:11px;font-weight:700}.empty,.error{padding:14px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:13px}#detail{display:none;margin-top:14px}.detail-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.member{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line)}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.business{grid-template-columns:1fr 1fr}.detail-grid{grid-template-columns:1fr}}@media(max-width:600px){.grid{grid-template-columns:1fr 1fr}.business{grid-template-columns:1fr}.toolbar{flex-direction:column;align-items:stretch}}'+
  '</style></head><body><header><div class="brand">repute<span>-tech</span>.in · Admin Panel</div><div><button class="light" onclick="location.href=\'/\'">Business Dashboard</button> <button class="light" onclick="location.reload()">Refresh</button></div></header><main>'+
  '<div class="grid"><div class="card"><div class="label">Total businesses</div><div class="value" id="count">—</div></div><div class="card"><div class="label">Active subscriptions</div><div class="value" id="activeSubs">—</div></div><div class="card"><div class="label">Pending plan requests</div><div class="value" id="pending">—</div></div><div class="card"><div class="label">Admin role</div><div class="value" id="role">—</div></div></div>'+
  '<div class="toolbar"><div><h2 style="margin:0;font-size:19px">Businesses</h2><div class="muted">Manage and inspect every business in the platform.</div></div><input id="search" placeholder="Search business, owner or email"></div><div id="msg"></div><div id="businesses" class="list"></div><div id="detail"><div class="detail-grid"><div class="card"><h3 style="margin-top:0">Business details</h3><div id="businessDetail"></div></div><div class="card"><h3 style="margin-top:0">Members</h3><div id="members"></div></div></div></div></main>'+
  '<script>'+
  'let rows=[];const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#039;"}[c]));'+
  'async function api(path,opt={}){const r=await fetch("/api"+path,{credentials:"include",...opt,headers:{"Content-Type":"application/json",...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Request failed");return d}'+
  'function render(){const q=$("search").value.trim().toLowerCase();const list=rows.filter(b=>[b.name,b.slug,b.ownerName,b.ownerEmail].some(v=>String(v||"").toLowerCase().includes(q)));$("businesses").innerHTML=list.map(b=>"<div class=\\"card business\\"><div><div class=\\"name\\">"+esc(b.name)+"</div><div class=\\"muted\\">"+esc(b.type)+" · "+esc(b.slug)+"</div></div><div><span class=\\"pill\\">"+esc(b.subscription?.status||"NO SUBSCRIPTION")+"</span><div class=\\"muted\\">"+esc(b.subscription?.plan||"—")+"</div></div><div><div class=\\"name\\">"+esc(b.ownerName||"No owner")+"</div><div class=\\"muted\\">"+esc(b.ownerEmail||"")+"</div><div class=\\"muted\\">"+b.memberCount+" members</div></div><div><button class=\\"primary\\" onclick=\\"openBusiness("+JSON.stringify(b.id)+")\\">View</button> <button class=\\"light\\" onclick=\\"openDashboard("+JSON.stringify(b.id)+")\\">Open</button></div></div>").join("")||"<div class=\\"empty\\">No businesses found.</div>"}'+
  'async function openBusiness(id){try{const b=await api("/admin/businesses/"+encodeURIComponent(id));$("detail").style.display="block";$("businessDetail").innerHTML="<b>"+esc(b.name)+"</b><div class=\\"muted\\">Type: "+esc(b.type)+"</div><div class=\\"muted\\">Slug: "+esc(b.slug)+"</div><div class=\\"muted\\">Created: "+esc(new Date(b.createdAt).toLocaleString())+"</div><div class=\\"muted\\">Business open: "+(b.isOpen?"Yes":"No")+"</div><div style=\\"margin-top:12px\\"><span class=\\"pill\\">"+esc(b.subscription?.status||"NO SUBSCRIPTION")+"</span> "+esc(b.subscription?.plan||"")+"</div>";$("members").innerHTML=b.members.map(m=>"<div class=\\"member\\"><div><b>"+esc(m.user.name)+"</b><div class=\\"muted\\">"+esc(m.user.email)+"</div></div><span class=\\"pill\\">"+esc(m.role)+"</span></div>").join("")||"<div class=\\"empty\\">No members.</div>";window.scrollTo({top:$("detail").offsetTop-80,behavior:"smooth"})}catch(e){$("msg").innerHTML="<div class=\\"error\\">"+esc(e.message)+"</div>"}}'+
  'async function openDashboard(id){try{await api("/businesses/select",{method:"POST",body:JSON.stringify({businessId:id})});location.href="/"}catch(e){$("msg").innerHTML="<div class=\\"error\\">"+esc(e.message)+"</div>"}}'+
  'async function load(){try{const d=await api("/admin/businesses");rows=d.businesses||[];$("count").textContent=rows.length;$("activeSubs").textContent=rows.filter(x=>x.subscription?.status==="ACTIVE").length;$("pending").textContent=d.pendingPlanRequests||0;$("role").textContent=d.adminRole||"—";render()}catch(e){$("msg").innerHTML="<div class=\\"error\\">"+esc(e.message)+"</div>"}}$("search").addEventListener("input",render);load();'+
  '</script></body></html>';
}
function install(app){
 if(installed)return;
 installed=true;
 originalGet.call(app,'/admin-panel',async(req,res,next)=>{try{const user=await requireAdmin(req,res);if(!user)return;res.type('html').send(adminPage())}catch(e){next(e)}});
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
