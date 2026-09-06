import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function esc(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function publicHubHtml({ business, menus }) {
  const menuHtml = menus.length ? menus.map(menu => `<section class="menu"><h2>${esc(menu.name)}</h2>${(menu.items||[]).length ? menu.items.map(item => `<div class="item"><div><strong>${esc(item.name)}</strong>${item.description?`<p>${esc(item.description)}</p>`:''}</div>${item.price!==null&&item.price!==undefined&&item.price!==''?`<b>₹${esc(item.price)}</b>`:''}</div>`).join('') : '<p class="muted">No items available yet.</p>'}</section>`).join('') : '<section class="empty">No published menus are available yet.</section>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#5b4bdb"><title>${esc(business.name)} — Customer Hub</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#171725;font-family:Arial,system-ui,sans-serif}.wrap{max-width:720px;margin:auto;padding:16px 14px 36px}.hero{background:linear-gradient(135deg,#5b4bdb,#7b68ee);color:white;border-radius:22px;padding:26px 20px;margin-bottom:14px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;opacity:.85}.hero h1{margin:7px 0;font-size:28px}.hero p{margin:0;opacity:.9}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.actions a,.actions button{border:0;border-radius:14px;background:white;color:#4034a5;padding:13px;font-weight:700;text-align:center;text-decoration:none;box-shadow:0 4px 14px #00000010}.menu,.empty{background:white;border-radius:18px;padding:18px;margin:12px 0;box-shadow:0 4px 14px #0000000c}.menu h2{margin:0 0 10px}.item{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-top:1px solid #eee}.item:first-of-type{border-top:0}.item p{margin:4px 0 0;color:#666;font-size:13px}.muted{color:#777}.footer{text-align:center;color:#888;font-size:12px;padding:18px}.modal{display:none;position:fixed;inset:0;background:#0008;align-items:flex-end;padding:12px}.modal.open{display:flex}.sheet{background:white;border-radius:20px;padding:18px;width:min(720px,100%)}textarea,select{width:100%;padding:12px;border:1px solid #ddd;border-radius:12px;margin:6px 0 10px;font:inherit}.sheet button{width:100%;padding:13px;border:0;border-radius:12px;background:#5b4bdb;color:white;font-weight:700}.sheet .close{margin-top:8px;background:#eee;color:#333}</style></head><body><div class="wrap"><header class="hero"><div class="eyebrow">Customer Hub</div><h1>${esc(business.name)}</h1><p>Browse our menu and share your experience.</p></header><div class="actions"><a href="#menus">🍽️ View Menu</a><button onclick="openFeedback()">⭐ Give Feedback</button></div><main id="menus">${menuHtml}</main><div class="footer">Powered by repute-tech.in</div></div><div class="modal" id="feedback" onclick="if(event.target===this)closeFeedback()"><div class="sheet"><h2>How was your experience?</h2><select id="rating"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Very good</option><option value="3">★★★ Good</option><option value="2">★★ Needs improvement</option><option value="1">★ Poor</option></select><textarea id="message" rows="4" placeholder="Tell us about your experience (optional)"></textarea><button onclick="submitFeedback()">Submit Feedback</button><button class="close" onclick="closeFeedback()">Close</button><p id="status" class="muted"></p></div></div><script>const businessId=${JSON.stringify(business.id)};function openFeedback(){document.getElementById('feedback').classList.add('open')}function closeFeedback(){document.getElementById('feedback').classList.remove('open')}async function submitFeedback(){const s=document.getElementById('status');s.textContent='Submitting...';try{const r=await fetch('/api/customer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId,rating:Number(document.getElementById('rating').value),message:document.getElementById('message').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Unable to submit feedback');s.textContent='Thank you for your feedback!';}catch(e){s.textContent=e.message||'Unable to submit feedback';}}</script></body></html>`;
}

async function servePublicQr(req,res,next){
  try{
    const slug=String(req.params.slug||'').trim();
    if(!slug)return res.status(404).send('QR code not found');
    const qr=await prisma.smartQr.findFirst({where:{slug},include:{business:{include:{menus:{where:{isPublished:true},orderBy:{createdAt:'desc'},include:{items:{orderBy:{name:'asc'}}}}}}}});
    if(!qr?.business)return res.status(404).send('QR code not found');
    await prisma.smartQr.update({where:{id:qr.id},data:{scanCount:{increment:1}}}).catch(()=>{});
    return res.type('html').send(publicHubHtml({business:qr.business,menus:qr.business.menus||[]}));
  }catch(error){return next(error);}
}

function registerPublicQr(app){
  if(app.__publicQrRegistered)return;
  app.__publicQrRegistered=true;
  for(const path of ['/q/:slug','/public/qr/:slug','/public/q/qr/:slug']) app.get(path,servePublicQr);
}

// Register on the actual Express application as soon as its first GET route is added.
// This places QR routes before the application's later catch-all/static routes.
const previousGet=express.application.get;
if(!express.application.__publicQrGetPatched){
  express.application.__publicQrGetPatched=true;
  express.application.get=function patchedPublicQrGet(path,...handlers){
    if(!this.__publicQrRegistering && !this.__publicQrRegistered){
      this.__publicQrRegistering=true;
      registerPublicQr(this);
      this.__publicQrRegistering=false;
    }
    return previousGet.call(this,path,...handlers);
  };
}
