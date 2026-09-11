import express from 'express';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

// Isolated business-account flow. This module does not modify review, QR, order,
// Google, or existing dashboard business data. It adds only business selection
// and creation endpoints/UI.
const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
let installed = false;
let installing = false;

const CATEGORIES = [
  {id:'restaurant_hotel_cafe', label:'Restaurant / Hotel / Café', icon:'restaurant', description:'Restaurants, hotels, cafés and dining businesses'},
  {id:'medical_clinic', label:'Medical / Clinic', icon:'medical_services', description:'Doctors, clinics, hospitals and healthcare'},
  {id:'theater', label:'Theater', icon:'theaters', description:'Cinema halls, theaters and entertainment venues'},
  {id:'grocery_supermarket', label:'Grocery Shop / Supermarket', icon:'shopping_cart', description:'Grocery stores, supermarkets and daily needs'},
  {id:'clothing', label:'Clothing / Cloth Shop', icon:'checkroom', description:'Clothing, fashion and textile shops'},
  {id:'salon_beauty', label:'Salon / Beauty Parlour', icon:'content_cut', description:'Salons, beauty parlours and grooming'},
  {id:'photography', label:'Photography', icon:'photo_camera', description:'Photo studios, photographers and media'},
  {id:'gaming_cafe', label:'Gaming Café', icon:'sports_esports', description:'Gaming cafés and esports spaces'},
  {id:'automobile_works', label:'Automobile Works', icon:'directions_car', description:'Garages, workshops and automobile services'},
  {id:'commercial_industries', label:'Commercial Industries', icon:'factory', description:'Commercial, industrial and B2B businesses'},
  {id:'gym_fitness', label:'Gym / Fitness', icon:'fitness_center', description:'Gyms, fitness centres and wellness businesses'},
  {id:'small_local_shop', label:'Small Local Shops', icon:'storefront', description:'Local shops and neighbourhood businesses'},
  {id:'other_businesses', label:'Other Businesses', icon:'business', description:'Any other type of business'}
];

function slugify(value){
  const base=String(value||'business').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'business';
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

async function currentUser(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const session=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!session || session.expiresAt<new Date())return null;
  return session.user;
}

async function ensureCategoryTable(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "BusinessCategory" ("business_id" TEXT PRIMARY KEY, "category" TEXT NOT NULL, "custom_category" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
}

function mappedPrismaType(category){
  if(category==='restaurant_hotel_cafe')return 'RESTAURANT';
  if(category==='salon_beauty')return 'SALON';
  return 'OTHER';
}

async function businessesFor(user){
  const where=['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}};
  return prisma.business.findMany({where,include:{locations:true,subscription:true},orderBy:{createdAt:'asc'}});
}

function setupPage(){
  const cards=CATEGORIES.map((c,i)=>`<button class="category-card ${i===0?'selected':''}" data-id="${c.id}" onclick="selectCategory(this)"><span class="icon material-symbols-outlined">${c.icon}</span><span class="check">✓</span><strong>${c.label}</strong><small>${c.description}</small></button>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Business Setup · repute-tech.in</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0" rel="stylesheet"><style>
:root{--bg:#f8f9fa;--card:#fff;--ink:#191c1d;--muted:#666b75;--line:#e5e7eb;--p:#4f46e5;--p2:#7c3aed}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif}.wrap{max-width:760px;margin:auto;padding:28px 18px 44px}.brand{font-weight:800;font-size:20px;margin-bottom:30px}.brand span{color:var(--p)}h1{font-size:30px;line-height:1.15;margin:0 0 8px}p{color:var(--muted);font-size:14px;line-height:1.6}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:18px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.category-card{position:relative;text-align:left;min-height:145px;padding:15px;border:1px solid var(--line);border-radius:16px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:7px;transition:.15s}.category-card.selected{border:2px solid var(--p);box-shadow:0 5px 18px rgba(79,70,229,.12)}.icon{font-size:25px;color:var(--p);background:#eef2ff;border-radius:11px;padding:8px;width:43px}.category-card strong{font-size:14px}.category-card small{font-size:11.5px;color:var(--muted);line-height:1.35}.check{position:absolute;right:12px;top:12px;width:21px;height:21px;border-radius:50%;border:2px solid #c7cbd3;color:transparent;text-align:center;font-size:12px;line-height:18px}.selected .check{background:var(--p);border-color:var(--p);color:#fff}.field{display:grid;gap:7px;margin-top:14px}.field label{font-size:12px;font-weight:700}.field input{width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;font:inherit}.btn{border:0;border-radius:11px;background:linear-gradient(90deg,var(--p),var(--p2));color:#fff;padding:12px 16px;font-weight:700;cursor:pointer;width:100%;margin-top:14px}.btn.secondary{background:#fff;color:var(--ink);border:1px solid var(--line)}.business{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid var(--line);border-radius:12px;margin-top:9px}.business b{display:block}.business small{color:var(--muted)}.hidden{display:none}.msg{margin-top:10px;font-size:13px;color:#b42318}@media(max-width:560px){.grid{grid-template-columns:1fr 1fr}.category-card{min-height:155px}h1{font-size:26px}}
</style></head><body><div class="wrap"><div class="brand">repute<span>-tech</span>.in</div><h1>Select your business type</h1><p>Choose the business type that best matches your business. Repute Tech will use this selection to tailor your workspace and tools.</p><div class="card"><div class="grid">${cards}</div><div id="otherField" class="field hidden"><label>Enter your business type</label><input id="customCategory" placeholder="e.g. Travel agency"></div><div class="field"><label>Business name</label><input id="businessName" placeholder="Enter your business name"></div><button class="btn" id="createBtn">Create business & continue</button><div id="msg" class="msg"></div></div><div class="card"><strong>Your businesses</strong><div id="businesses"><p>Loading…</p></div></div><button class="btn secondary" onclick="location.href='/'">Back to dashboard</button></div><script>
let selected='restaurant_hotel_cafe';const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>\\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#039;'}[c]));
function selectCategory(el){document.querySelectorAll('.category-card').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');selected=el.dataset.id;$(\'otherField\').classList.toggle('hidden',selected!==\'other_businesses\')}
async function req(path,opt={}){const r=await fetch('/api'+path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function loadBusinesses(){try{const bs=await req('/businesses');$(\'businesses\').innerHTML=bs.map(b=>\`<div class="business"><div><b>\${esc(b.name)}</b><small>\${esc(b.categoryLabel||b.type||'Business')}</small></div><button class="btn secondary" style="width:auto;margin:0" onclick="selectBusiness('\${b.id}')">Manage</button></div>\`).join('')||'<p>No businesses yet.</p>'}catch(e){$(\'businesses\').innerHTML='<p>'+esc(e.message)+'</p>'}}
async function selectBusiness(id){try{await req('/businesses/select',{method:'POST',body:JSON.stringify({businessId:id})});location.href='/'}catch(e){$(\'msg\').textContent=e.message}}
$(\'createBtn\').onclick=async()=>{const name=$(\'businessName\').value.trim();if(!name){$(\'msg\').textContent='Please enter your business name.';return}if(selected==='other_businesses'&&!$(\'customCategory\').value.trim()){$(\'msg\').textContent='Please enter your business type.';return}try{$(\'createBtn\').disabled=true;$(\'createBtn\').textContent='Creating…';await req('/businesses/create',{method:'POST',body:JSON.stringify({name,category:selected,customCategory:$(\'customCategory\').value.trim()})});location.href='/'}catch(e){$(\'msg\').textContent=e.message;$(\'createBtn\').disabled=false;$(\'createBtn\').textContent='Create business & continue'}};
loadBusinesses();</script></body></html>`;
}

function install(app){
  if(installed||installing)return; installing=true;
  originalGet.call(app,'/business-setup',async(req,res,next)=>{try{const user=await currentUser(req);if(!user)return res.redirect('/');await ensureCategoryTable();res.type('html').send(setupPage())}catch(e){next(e)}});
  originalGet.call(app,'/api/business-categories',async(req,res,next)=>{try{await ensureCategoryTable();res.json(CATEGORIES)}catch(e){next(e)}});
  originalGet.call(app,'/api/businesses',async(req,res,next)=>{try{const user=await currentUser(req);if(!user)return res.status(401).json({error:'Authentication required'});const bs=await businessesFor(user);await ensureCategoryTable();const byId=new Map();for(const b of bs){const rows=await prisma.$queryRawUnsafe('SELECT category, custom_category FROM "BusinessCategory" WHERE business_id = $1',b.id);if(rows[0])byId.set(b.id,rows[0]);}const selected=getCookie(req,'rp_business_id');bs.sort((a,b)=>String(a.id)===String(selected)?-1:String(b.id)===String(selected)?1:0);res.json(bs.map(b=>{const c=byId.get(b.id);const label=c?.category==='other_businesses'?(c.custom_category||'Other Businesses'):CATEGORIES.find(x=>x.id===c?.category)?.label||b.type;return {...b,category:c?.category||null,customCategory:c?.custom_category||null,categoryLabel:label}}))}catch(e){next(e)}});
  originalPost.call(app,'/api/businesses/select',async(req,res,next)=>{try{const user=await currentUser(req);if(!user)return res.status(401).json({error:'Authentication required'});const id=String(req.body?.businessId||'');const allowed=await prisma.business.findFirst({where:{id,...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}});if(!allowed)return res.status(404).json({error:'Business not found'});res.setHeader('Set-Cookie',`rp_business_id=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600`);res.json({ok:true,businessId:id})}catch(e){next(e)}});
  originalPost.call(app,'/api/businesses/create',async(req,res,next)=>{try{const user=await currentUser(req);if(!user)return res.status(401).json({error:'Authentication required'});const name=String(req.body?.name||'').trim();const category=String(req.body?.category||'');const custom=String(req.body?.customCategory||'').trim();if(name.length<2||name.length>100)return res.status(400).json({error:'Business name must be between 2 and 100 characters'});if(!CATEGORIES.some(x=>x.id===category))return res.status(400).json({error:'Invalid business type'});if(category==='other_businesses'&&!custom)return res.status(400).json({error:'Please enter your business type'});await ensureCategoryTable();const business=await prisma.business.create({data:{name,type:mappedPrismaType(category),slug:slugify(name),members:{create:{userId:user.id,role:'OWNER'}}}});await prisma.$executeRawUnsafe(`INSERT INTO "BusinessCategory" ("business_id","category","custom_category") VALUES ($1,$2,$3)`,business.id,category,category==='other_businesses'?custom:null);res.setHeader('Set-Cookie',`rp_business_id=${encodeURIComponent(business.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600`);res.status(201).json({ok:true,businessId:business.id,business})}catch(e){next(e)}});
  installed=true;installing=false;
}

express.application.get=function(path,...handlers){if(handlers.length===0)return originalGet.call(this,path);install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
