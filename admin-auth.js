import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash, randomToken } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
const originalPost=express.application.post;
let installed=false;

async function createAdminSessionFromUser(req,res){
  const token=getCookie(req,'rp_session');
  if(!token)return res.status(401).json({error:'Please sign in first'});
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return res.status(401).json({error:'Please sign in first'});
  if(!['ADMIN','SUPER_ADMIN'].includes(s.user.role))return res.status(403).json({error:'Admin access required'});
  const adminToken=randomToken();
  await prisma.session.create({data:{tokenHash:tokenHash(adminToken),userId:s.user.id,expiresAt:new Date(Date.now()+86400000)}});
  const parts=[`rp_admin_session=${adminToken}`,'Max-Age=86400','Path=/','HttpOnly','SameSite=Lax'];
  if(process.env.NODE_ENV==='production')parts.push('Secure');
  res.setHeader('Set-Cookie',parts.join('; '));
  res.json({ok:true,user:{id:s.user.id,name:s.user.name,email:s.user.email,role:s.user.role}});
}

function loginPage(){
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin Login · repute-tech.in</title><style>body{margin:0;background:#f6f7fb;color:#171a2b;font-family:Inter,system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}.card{width:min(420px,92vw);background:#fff;border:1px solid #e6e8ef;border-radius:16px;padding:28px;box-shadow:0 15px 45px rgba(16,21,43,.12)}h1{margin:0 0 8px;font-size:24px}.sub{color:#667085;font-size:13px}.form{display:grid;gap:10px;margin-top:18px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d9dce5;border-radius:9px;font:inherit}button{padding:12px;border:0;border-radius:9px;background:#5146e5;color:#fff;font-weight:700;font-size:14px}#msg{color:#b42318;font-size:13px;min-height:18px}</style></head><body><div class="card"><h1>repute-tech.in</h1><div style="font-weight:800;font-size:18px">SaaS Admin Login</div><p class="sub">Restricted to authorized platform administrators.</p><div class="form"><input id="email" type="email" autocomplete="username" placeholder="Admin email"><input id="password" type="password" autocomplete="current-password" placeholder="Password"><button id="login">Sign in to Admin Panel</button><div id="msg"></div></div></div><script>async function login(){const msg=document.getElementById("msg");msg.textContent="";try{let r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({email:document.getElementById("email").value,password:document.getElementById("password").value})});let d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Invalid email or password");r=await fetch("/api/admin/session",{method:"POST",credentials:"include"});d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Admin access denied");location.href="/admin-panel"}catch(e){msg.textContent=e.message}}document.getElementById("login").onclick=login;document.addEventListener("keydown",e=>{if(e.key==="Enter")login()});</script></body></html>';
}

function install(app){
  if(installed)return;
  installed=true;
  originalGet.call(app,'/admin-login',async(req,res,next)=>{try{res.type('html').send(loginPage())}catch(e){next(e)}});
  originalPost.call(app,'/api/admin/session',async(req,res,next)=>{try{await createAdminSessionFromUser(req,res)}catch(e){next(e)}});
  originalPost.call(app,'/api/admin/logout',async(req,res,next)=>{try{
    const token=getCookie(req,'rp_admin_session');
    if(token)await prisma.session.deleteMany({where:{tokenHash:tokenHash(token)}});
    res.setHeader('Set-Cookie','rp_admin_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    res.json({ok:true});
  }catch(e){next(e)}});
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
