import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function esc(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function publicHubHtml({ business, menus, slug }) {
  const firstMenu = menus[0];
  const firstOrderHref = firstMenu ? `/q/${encodeURIComponent(slug)}/order/${encodeURIComponent(firstMenu.id)}` : `/q/${encodeURIComponent(slug)}/order`;
  const previewItems = menus.flatMap(menu => (menu.items || []).slice(0, 3).map(item => ({...item, menuName: menu.name, menuId: menu.id})));
  const menuHtml = menus.length ? menus.map(menu => {
    const menuOrderHref = `/q/${encodeURIComponent(slug)}/order/${encodeURIComponent(menu.id)}`;
    return `<section class="menu"><div class="menuHead"><div><div class="eyebrow dark">MENU</div><h2>${esc(menu.name)}</h2></div><a class="smallBuy" href="${menuOrderHref}">Order this menu</a></div>${(menu.items||[]).length ? menu.items.map(item => `<div class="item"><div class="itemInfo"><strong>${esc(item.name)}</strong>${item.description?`<p>${esc(item.description)}</p>`:''}</div>${item.price!==null&&item.price!==undefined&&item.price!==''?`<b class="price">₹${esc(item.price)}</b>`:''}</div>`).join('') : '<p class="muted">No items available yet.</p>'}</section>`;
  }).join('') : '<section class="empty">No published menus are available yet.</section>';
  const previewHtml = previewItems.length ? `<section class="shop"><div class="sectionTitle"><div><span>Popular picks</span><h2>Products & ordering</h2></div><a href="${firstOrderHref}">Shop first menu →</a></div><div class="productGrid">${previewItems.map(item => { const href=`/q/${encodeURIComponent(slug)}/order/${encodeURIComponent(item.menuId)}`; return `<article class="product"><div class="productIcon">🍽️</div><div class="productBody"><strong>${esc(item.name)}</strong><small>${esc(item.menuName)}</small><b>₹${esc(item.price)}</b></div><a class="buy" href="${href}">Buy</a></article>`; }).join('')}</div></section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#5b4bdb"><title>${esc(business.name)} — Customer Hub</title><style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Manrope:wght@500;600;700;800&display=swap');
:root{--ink:#17152b;--muted:#77758a;--purple:#5b45d6;--purple-dark:#4030a7;--line:#eceaf3;--surface:#fff;--canvas:#f7f6fb}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:18px}
body{margin:0;background:radial-gradient(ellipse at 85% 0%,#eeeaff 0,transparent 34%),var(--canvas);color:var(--ink);font-family:'DM Sans',Inter,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:min(100% - 28px,680px);margin:0 auto;padding:18px 0 34px}
.hero{position:relative;overflow:hidden;background:linear-gradient(125deg,#4432ad 0%,#604cda 54%,#8875f0 100%);color:#fff;border-radius:28px;padding:28px 24px 27px;margin-bottom:16px;box-shadow:0 18px 42px rgba(74,55,177,.2)}
.hero:after{content:"";position:absolute;width:230px;height:230px;border:1px solid rgba(255,255,255,.13);border-radius:50%;right:-92px;top:-112px;box-shadow:0 0 0 25px rgba(255,255,255,.045),0 0 0 55px rgba(255,255,255,.035);pointer-events:none}
.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.17em;font-weight:800;opacity:.76}
.eyebrow.dark{color:var(--purple);opacity:1}
.hero h1{position:relative;z-index:1;margin:10px 0 9px;font-family:Manrope,'DM Sans',sans-serif;font-size:clamp(29px,7vw,38px);line-height:1.12;letter-spacing:-.045em;font-weight:800;overflow-wrap:anywhere}
.hero p{position:relative;z-index:1;max-width:470px;margin:0;color:rgba(255,255,255,.88);font-size:15px;line-height:1.6}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 17px}
.actions a,.actions button{min-height:54px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid rgba(81,65,174,.07);border-radius:16px;background:#fff;color:#4938b1;padding:13px 11px;font:800 14px 'DM Sans',sans-serif;text-align:center;text-decoration:none;box-shadow:0 7px 18px rgba(30,25,75,.055);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease}
.actions a:active,.actions button:active,.buy:active{transform:scale(.98)}
.actions .order{background:#19172a;color:#fff;border-color:#19172a;box-shadow:0 8px 20px rgba(25,23,42,.15)}
.actions button{grid-column:1/-1;justify-self:start;width:calc(50% - 5px);min-height:48px;font-size:13px}
.shop,.menu,.empty{background:var(--surface);border:1px solid rgba(230,227,241,.8);border-radius:23px;padding:20px;margin:14px 0;box-shadow:0 8px 24px rgba(35,28,76,.045)}
.sectionTitle,.menuHead{display:flex;justify-content:space-between;align-items:center;gap:14px}
.sectionTitle span{display:block;font-size:10px;color:var(--purple);text-transform:uppercase;letter-spacing:.16em;font-weight:800;margin-bottom:5px}
.sectionTitle h2,.menu h2{font-family:Manrope,'DM Sans',sans-serif;font-size:22px;line-height:1.2;letter-spacing:-.035em;margin:0 0 15px;font-weight:800}
.sectionTitle a,.smallBuy{color:var(--purple);font-weight:800;text-decoration:none;font-size:12px;line-height:1.4;white-space:nowrap}
.sectionTitle a{align-self:center;margin-top:-7px}
.productGrid{display:grid;gap:9px}
.product{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #eeecf4;border-radius:17px;background:#fff;min-width:0;transition:border-color .18s ease,box-shadow .18s ease}
.productIcon{width:52px;height:52px;flex:0 0 52px;border-radius:15px;background:linear-gradient(145deg,#f1efff,#e8e4ff);display:grid;place-items:center;font-size:23px}
.productBody{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.productBody strong{font-size:14px;font-weight:800;overflow-wrap:anywhere}
.productBody small{color:var(--muted);font-size:11px}
.productBody b{font-size:14px;margin-top:2px;font-weight:800}
.buy{display:inline-flex;align-items:center;justify-content:center;min-width:62px;min-height:40px;background:linear-gradient(135deg,#6652e5,#5140c6);color:#fff;border-radius:12px;padding:9px 13px;text-decoration:none;font-size:12px;font-weight:800;box-shadow:0 5px 12px rgba(91,75,219,.18)}
.menuHead{margin-bottom:9px}
.menuHead h2{margin:4px 0 8px}
.item{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:15px 0;border-top:1px solid #f0eef5}
.item:first-of-type{border-top:0}
.itemInfo{min-width:0}
.itemInfo strong{font-size:15px;font-weight:800}
.item p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
.price{white-space:nowrap;font-size:15px;font-weight:800}
.muted{color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:26px}
.footer{text-align:center;color:#9290a1;font-size:12px;padding:24px 12px 18px}
.modal{display:none;position:fixed;inset:0;background:rgba(20,17,42,.56);backdrop-filter:blur(5px);align-items:flex-end;padding:12px;z-index:20}
.modal.open{display:flex}
.sheet{background:#fff;border:1px solid rgba(255,255,255,.6);border-radius:26px;padding:22px;width:min(520px,100%);margin:auto;box-shadow:0 22px 70px rgba(14,10,40,.25);max-height:min(88vh,760px);overflow:auto}
.sheet h2{font-family:Manrope,sans-serif;font-size:22px;letter-spacing:-.03em;margin:2px 0 5px}
.sheet .sub{color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px}
.stars{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:10px 0}
.starChoice{border:1px solid #e9e6f1;background:#fff;border-radius:14px;padding:11px 4px;cursor:pointer;text-align:center;transition:.18s}
.starChoice .star{display:block;font-size:25px;line-height:1.1;color:#f2b544}
.starChoice .label{display:block;font-size:9px;font-weight:800;color:var(--muted);margin-top:5px}
.starChoice.selected{border-color:var(--purple);background:#f3f0ff;box-shadow:0 0 0 2px rgba(91,75,219,.1)}
.starChoice.selected .label{color:var(--purple-dark)}
.ratingHint{text-align:center;font-weight:800;color:var(--purple-dark);min-height:20px;margin:9px 0}
textarea,input{width:100%;padding:13px 14px;border:1px solid #e5e2ed;border-radius:13px;margin:6px 0 10px;font:inherit;font-size:14px;color:var(--ink);background:#fff;outline:none}
textarea:focus,input:focus{border-color:#8a7bea;box-shadow:0 0 0 3px rgba(91,75,219,.1)}
.sheet button.submit{width:100%;padding:14px;border:0;border-radius:13px;background:linear-gradient(135deg,#6652e5,#5140c6);color:white;font-weight:800;font-size:14px;cursor:pointer}
.sheet button.submit:disabled{opacity:.6;cursor:wait}
.sheet button.close{width:100%;padding:12px;border:0;border-radius:13px;background:#f2f1f6;color:#4d4a5c;margin-top:9px;font-weight:800;cursor:pointer}
.status{font-size:13px;text-align:center;margin:10px 0 0}
.successBox{text-align:center;background:#effbf4;border:1px solid #c9f0d8;border-radius:18px;padding:20px;color:#166534}
.successBox .big{font-size:34px}
.privacy{font-size:11px;color:#9290a1;line-height:1.5;margin-top:10px;text-align:center}
@media(min-width:600px){.wrap{padding-top:26px}.hero{padding:34px 30px}.actions a,.actions button{min-height:58px}.shop,.menu{padding:23px}.product:hover{border-color:#d6d0fb;box-shadow:0 6px 16px rgba(91,75,219,.07)}}
@media(max-width:420px){.wrap{width:calc(100% - 24px);padding-top:12px}.hero{border-radius:23px;padding:25px 20px}.actions{gap:8px}.actions a,.actions button{font-size:12px;padding:12px 7px;min-height:51px}.actions button{min-height:46px}.shop,.menu{padding:17px;border-radius:20px}.sectionTitle h2,.menu h2{font-size:20px}.sectionTitle a,.smallBuy{font-size:11px}.product{gap:10px;padding:10px}.productIcon{width:48px;height:48px;flex-basis:48px}.buy{min-width:56px;padding:8px 10px}.stars{gap:4px}.starChoice{padding:9px 2px}.starChoice .star{font-size:22px}.starChoice .label{font-size:8px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><div class="wrap"><header class="hero"><div class="eyebrow">Customer Hub</div><h1>${esc(business.name)}</h1><p>Browse our products, order easily, and share your experience.</p></header><div class="actions"><a href="#menus">🍽️ View Menu</a><a class="order" href="${firstOrderHref}">🛍️ Order ${firstMenu ? esc(firstMenu.name) : 'Products'}</a><button onclick="openFeedback()">⭐ Rate Experience</button></div>${previewHtml}<main id="menus">${menuHtml}</main><div class="footer">Powered by reputetechs.in</div></div><div class="modal" id="feedback" onclick="if(event.target===this)closeFeedback()"><div class="sheet" id="sheet"><h2>How was your experience?</h2><p class="sub">Your feedback helps us serve you better.</p><div class="stars">${[[5,'Excellent'],[4,'Very good'],[3,'Good'],[2,'Fair'],[1,'Poor']].map(([n,label])=>`<button type="button" class="starChoice" data-rating="${n}" onclick="chooseRating(${n})"><span class="star">★</span><span class="label">${label}</span></button>`).join('')}</div><div class="ratingHint" id="ratingHint">Select a rating</div><input id="authorName" maxlength="80" placeholder="Your name (optional)"><textarea id="message" rows="4" placeholder="Tell us about your experience (optional)"></textarea><button class="submit" id="submitBtn" onclick="submitFeedback()">Submit Review</button><button class="close" onclick="closeFeedback()">Cancel</button><p class="status" id="status"></p><p class="privacy">No account is required. Your review is sent to the business review inbox.</p></div></div><script>const businessId=${JSON.stringify(business.id)};let selectedRating=0;const labels={1:'Poor — we can do better',2:'Fair — room for improvement',3:'Good — thanks for sharing',4:'Very good — glad you enjoyed it',5:'Excellent — thank you!'};function openFeedback(){document.getElementById('feedback').classList.add('open');document.getElementById('status').textContent=''}function closeFeedback(){document.getElementById('feedback').classList.remove('open')}function chooseRating(n){selectedRating=n;document.querySelectorAll('.starChoice').forEach(b=>b.classList.toggle('selected',Number(b.dataset.rating)===n));document.getElementById('ratingHint').textContent=labels[n]}async function submitFeedback(){const status=document.getElementById('status');const btn=document.getElementById('submitBtn');if(!selectedRating){status.textContent='Please select a star rating first.';status.style.color='#b42318';return}btn.disabled=true;status.textContent='Submitting your review…';status.style.color='#667085';try{const r=await fetch('/api/customer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId,rating:selectedRating,message:document.getElementById('message').value,authorName:document.getElementById('authorName').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Unable to submit review');document.getElementById('sheet').innerHTML='<div class="successBox"><div class="big">⭐</div><h2>Thank you!</h2><p>Your '+selectedRating+'-star review has been received by the business.</p><button class="submit" onclick="closeFeedback()">Done</button></div>';}catch(e){status.textContent=e.message||'Unable to submit review';status.style.color='#b42318';btn.disabled=false}}</script></body></html>`;
}

async function servePublicQr(req,res,next){
  try{
    const slug=String(req.params.slug||'').trim();
    if(!slug)return res.status(404).send('QR code not found');
    const qr=await prisma.smartQr.findFirst({where:{slug},include:{business:{include:{menus:{where:{isPublished:true},orderBy:{createdAt:'desc'},include:{items:{orderBy:{name:'asc'}}}}}}}});
    if(!qr?.business)return res.status(404).send('QR code not found');
    await prisma.smartQr.update({where:{id:qr.id},data:{scanCount:{increment:1}}}).catch(()=>{});
    return res.type('html').send(publicHubHtml({business:qr.business,menus:qr.business.menus||[],slug:qr.slug}));
  }catch(error){return next(error);}
}

function registerPublicQr(app){
  if(app.__publicQrRegistered)return;
  app.__publicQrRegistered=true;
  for(const path of ['/q/:slug','/public/qr/:slug','/public/q/qr/:slug']) app.get(path,servePublicQr);
}

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
