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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f3e9"><title>${esc(business.name)} — Discover &amp; Order</title><style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Manrope:wght@500;600;700;800&display=swap');
:root{--ink:#292b25;--muted:#77796f;--sage:#71866c;--sage-dark:#52694f;--sage-soft:#e8eee4;--line:#e9e7dd;--surface:#fffefa;--canvas:#f6f3e9}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:18px}
body{margin:0;background:radial-gradient(ellipse at 90% 0%,#e9eddf 0,transparent 36%),var(--canvas);color:var(--ink);font-family:'DM Sans',Inter,Arial,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:min(100% - 28px,680px);margin:0 auto;padding:18px 0 34px}
.hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#e9eddf 0%,#f2f0e4 58%,#e3e9dc 100%);color:#303b2e;border:1px solid #e0e5d7;border-radius:28px;padding:29px 24px 28px;margin-bottom:16px;box-shadow:0 14px 34px rgba(71,86,62,.09)}
.hero:after{content:"";position:absolute;width:230px;height:230px;border:1px solid rgba(91,116,82,.15);border-radius:50%;right:-92px;top:-112px;box-shadow:0 0 0 25px rgba(91,116,82,.045),0 0 0 55px rgba(91,116,82,.03);pointer-events:none}
.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.17em;font-weight:800;opacity:.72}
.eyebrow.dark{color:var(--sage-dark);opacity:1}
.hero h1{position:relative;z-index:1;margin:10px 0 9px;font-family:Manrope,'DM Sans',sans-serif;font-size:clamp(30px,7vw,39px);line-height:1.12;letter-spacing:-.045em;font-weight:800;overflow-wrap:anywhere}
.hero p{position:relative;z-index:1;max-width:470px;margin:0;color:#606b59;font-size:15px;line-height:1.65}
.hubNav{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;margin:0 0 12px;background:rgba(255,254,250,.82);border:1px solid #e5e5d9;border-radius:17px;box-shadow:0 7px 18px rgba(47,54,39,.045)}
.hubNav a,.hubNav button{min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:12px;background:transparent;color:#66745f;padding:11px 12px;font:700 13px 'DM Sans',sans-serif;text-align:center;text-decoration:none;cursor:pointer;transition:background .2s ease,color .2s ease,box-shadow .2s ease}
.hubNav a:hover,.hubNav button:hover{background:#f0f2e9;color:var(--sage-dark)}
.hubNav a{background:#edf1e8;color:var(--sage-dark);box-shadow:inset 0 0 0 1px #e0e7da}
.orderCta{width:100%;min-height:54px;display:flex;align-items:center;justify-content:center;gap:9px;margin:0 0 19px;padding:15px 20px;border:1px solid var(--sage-dark);border-radius:16px;background:linear-gradient(135deg,#71866c,#52694f);color:#fff;text-decoration:none;font:800 14px 'DM Sans',sans-serif;letter-spacing:.015em;box-shadow:0 9px 22px rgba(82,105,79,.2);transition:transform .2s ease,box-shadow .2s ease,filter .2s ease}
.orderCta:hover{transform:translateY(-2px);filter:brightness(1.03);box-shadow:0 12px 26px rgba(82,105,79,.24)}
.orderCta:active{transform:scale(.99)}
.actions a,.actions button{min-height:54px;display:flex;align-items:center;justify-content:center;gap:7px;border:1px solid #e7e6dc;border-radius:16px;background:#fffefa;color:var(--sage-dark);padding:13px 11px;font:800 14px 'DM Sans',sans-serif;text-align:center;text-decoration:none;box-shadow:0 7px 18px rgba(47,54,39,.055);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.actions a:hover,.actions button:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(47,54,39,.09);border-color:#cbd6c4}
.actions a:active,.actions button:active,.buy:active{transform:scale(.98)}
.actions .order{background:var(--sage);color:#fff;border-color:var(--sage);box-shadow:0 8px 20px rgba(82,105,79,.18)}
.actions button{grid-column:1/-1;justify-self:start;width:calc(50% - 5px);min-height:48px;font-size:13px}
.shop,.menu,.empty{background:var(--surface);border:1px solid #eae8df;border-radius:23px;padding:20px;margin:14px 0;box-shadow:0 8px 24px rgba(47,54,39,.045)}
.sectionTitle,.menuHead{display:flex;justify-content:space-between;align-items:center;gap:14px}
.sectionTitle span{display:block;font-size:10px;color:var(--sage-dark);text-transform:uppercase;letter-spacing:.16em;font-weight:800;margin-bottom:5px}
.sectionTitle h2,.menu h2{font-family:Manrope,'DM Sans',sans-serif;font-size:22px;line-height:1.2;letter-spacing:-.035em;margin:0 0 15px;font-weight:800}
.sectionTitle a,.smallBuy{color:var(--sage-dark);font-weight:800;text-decoration:none;font-size:12px;line-height:1.4;white-space:nowrap}
.sectionTitle a{align-self:center;margin-top:-7px}
.productGrid{display:grid;gap:9px}
.product{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ecebe3;border-radius:17px;background:#fff;min-width:0;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease}
.product:hover{border-color:#cbd6c4;box-shadow:0 7px 18px rgba(71,86,62,.07);transform:translateY(-1px)}
.productIcon{width:52px;height:52px;flex:0 0 52px;border-radius:15px;background:linear-gradient(145deg,#f0f2e9,#e4eadf);display:grid;place-items:center;font-size:23px}
.productBody{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.productBody strong{font-size:14px;font-weight:800;overflow-wrap:anywhere}
.productBody small{color:var(--muted);font-size:11px}
.productBody b{font-size:14px;margin-top:2px;font-weight:800}
.buy{display:inline-flex;align-items:center;justify-content:center;min-width:62px;min-height:40px;background:var(--sage);color:#fff;border-radius:12px;padding:9px 13px;text-decoration:none;font-size:12px;font-weight:800;box-shadow:0 5px 12px rgba(82,105,79,.17);transition:transform .2s ease,background .2s ease}
.buy:hover{background:var(--sage-dark)}
.menuHead{margin-bottom:9px}
.menuHead h2{margin:4px 0 8px}
.item{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:15px 0;border-top:1px solid #efeee8}
.item:first-of-type{border-top:0}
.itemInfo{min-width:0}
.itemInfo strong{font-size:15px;font-weight:800}
.item p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
.price{white-space:nowrap;font-size:15px;font-weight:800}
.muted{color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:26px}
.footer{text-align:center;color:#929287;font-size:12px;padding:24px 12px 18px;letter-spacing:.01em}
.modal{display:none;position:fixed;inset:0;background:rgba(35,40,31,.52);backdrop-filter:blur(5px);align-items:flex-end;padding:12px;z-index:20}
.modal.open{display:flex}
.sheet{background:#fffefa;border:1px solid rgba(255,255,255,.7);border-radius:26px;padding:22px;width:min(520px,100%);margin:auto;box-shadow:0 22px 70px rgba(25,31,22,.22);max-height:min(88vh,760px);overflow:auto}
.sheet h2{font-family:Manrope,sans-serif;font-size:22px;letter-spacing:-.03em;margin:2px 0 5px}
.sheet .sub{color:var(--muted);font-size:13px;line-height:1.5;margin:0 0 16px}
.stars{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:10px 0}
.starChoice{border:1px solid #e9e8df;background:#fffefa;border-radius:14px;padding:11px 4px;cursor:pointer;text-align:center;transition:.18s}
.starChoice .star{display:block;font-size:25px;line-height:1.1;color:#d5a94f}
.starChoice .label{display:block;font-size:9px;font-weight:800;color:var(--muted);margin-top:5px}
.starChoice.selected{border-color:var(--sage);background:#edf2e9;box-shadow:0 0 0 2px rgba(113,134,108,.12)}
.starChoice.selected .label{color:var(--sage-dark)}
.ratingHint{text-align:center;font-weight:800;color:var(--sage-dark);min-height:20px;margin:9px 0}
.fieldLabel{display:flex;align-items:center;gap:7px;margin:12px 0 2px;color:#42483e;font-size:12px;font-weight:800;letter-spacing:.015em}
.fieldLabel span{color:#929287;font-size:11px;font-weight:600}
.fieldLabel .requiredMark{color:#8a604c;background:#f5eee8;border-radius:20px;padding:3px 7px;font-size:9px;text-transform:uppercase;letter-spacing:.08em}
textarea,input{width:100%;padding:13px 14px;border:1px solid #e5e4da;border-radius:13px;margin:6px 0 10px;font:inherit;font-size:14px;color:var(--ink);background:#fffefa;outline:none}
textarea:focus,input:focus{border-color:#9aaa92;box-shadow:0 0 0 3px rgba(113,134,108,.12)}
.sheet button.submit{width:100%;padding:14px;border:0;border-radius:13px;background:var(--sage);color:white;font-weight:800;font-size:14px;cursor:pointer}
.sheet button.submit:disabled{opacity:.6;cursor:wait}
.sheet button.close{width:100%;padding:12px;border:0;border-radius:13px;background:#efeee7;color:#4d5147;margin-top:9px;font-weight:800;cursor:pointer}
.status{font-size:13px;text-align:center;margin:10px 0 0}
.successBox{text-align:center;background:#eef5eb;border:1px solid #d5e5cf;border-radius:18px;padding:20px;color:#405b3e}
.successBox .big{font-size:34px}
.privacy{font-size:11px;color:#929287;line-height:1.5;margin-top:10px;text-align:center}
@media(min-width:600px){.wrap{padding-top:26px}.hero{padding:34px 30px}.actions a,.actions button{min-height:58px}.shop,.menu{padding:23px}}
@media(max-width:420px){.wrap{width:calc(100% - 24px);padding-top:12px}.hero{border-radius:23px;padding:25px 20px}.hubNav a,.hubNav button{font-size:12px;padding:10px 7px;min-height:44px}.orderCta{min-height:51px}.shop,.menu{padding:17px;border-radius:20px}.sectionTitle h2,.menu h2{font-size:20px}.sectionTitle a,.smallBuy{font-size:11px}.product{gap:10px;padding:10px}.productIcon{width:48px;height:48px;flex-basis:48px}.buy{min-width:56px;padding:8px 10px}.stars{gap:4px}.starChoice{padding:9px 2px}.starChoice .star{font-size:22px}.starChoice .label{font-size:8px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><div class="wrap"><header class="hero"><div class="eyebrow">A CURATED EXPERIENCE</div><h1>${esc(business.name)}</h1><p>Discover something special. Browse our collection, order with ease, and share your experience.</p></header><nav class="hubNav" aria-label="Customer navigation"><a href="#menus"><span aria-hidden="true">☰</span> Menu</a><button type="button" onclick="openFeedback()"><span aria-hidden="true">☆</span> Reviews</button></nav><a class="orderCta" href="${firstOrderHref}">Explore &amp; Order <span aria-hidden="true">→</span></a>${previewHtml}<main id="menus">${menuHtml}</main><div class="footer">Powered by reputetechs.in</div></div><div class="modal" id="feedback" onclick="if(event.target===this)closeFeedback()"><div class="sheet" id="sheet"><h2>How was your experience?</h2><p class="sub">Your feedback helps us serve you better.</p><div class="stars">${[[5,'Excellent'],[4,'Very good'],[3,'Good'],[2,'Fair'],[1,'Poor']].map(([n,label])=>`<button type="button" class="starChoice" data-rating="${n}" onclick="chooseRating(${n})"><span class="star">★</span><span class="label">${label}</span></button>`).join('')}</div><div class="ratingHint" id="ratingHint">Select a rating</div><label class="fieldLabel" for="authorName">Your name <span>(optional)</span></label><input id="authorName" maxlength="80" autocomplete="name" placeholder="Enter your name"><label class="fieldLabel" for="message">Your experience <span class="requiredMark">Required</span></label><textarea id="message" rows="4" required aria-required="true" placeholder="Please share your experience"></textarea><button class="submit" id="submitBtn" onclick="submitFeedback()">Submit Review</button><button class="close" onclick="closeFeedback()">Cancel</button><p class="status" id="status"></p><p class="privacy">No account is required. Your review is sent to the business review inbox.</p></div></div><script>const businessId=${JSON.stringify(business.id)};let selectedRating=0;const labels={1:'Poor — we can do better',2:'Fair — room for improvement',3:'Good — thanks for sharing',4:'Very good — glad you enjoyed it',5:'Excellent — thank you!'};function openFeedback(){document.getElementById('feedback').classList.add('open');document.getElementById('status').textContent=''}function closeFeedback(){document.getElementById('feedback').classList.remove('open')}function chooseRating(n){selectedRating=n;document.querySelectorAll('.starChoice').forEach(b=>b.classList.toggle('selected',Number(b.dataset.rating)===n));document.getElementById('ratingHint').textContent=labels[n]}async function submitFeedback(){const status=document.getElementById('status');const btn=document.getElementById('submitBtn');if(!selectedRating){status.textContent='Please select a star rating first.';status.style.color='#b42318';return}const experience=document.getElementById('message').value.trim();if(!experience){status.textContent='Please share your experience before submitting.';status.style.color='#b42318';document.getElementById('message').focus();return}btn.disabled=true;status.textContent='Submitting your review…';status.style.color='#667085';try{const r=await fetch('/api/customer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId,rating:selectedRating,message:experience,authorName:document.getElementById('authorName').value})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Unable to submit review');document.getElementById('sheet').innerHTML='<div class="successBox"><div class="big">⭐</div><h2>Thank you!</h2><p>Your '+selectedRating+'-star review has been received by the business.</p><button class="submit" onclick="closeFeedback()">Done</button></div>';}catch(e){status.textContent=e.message||'Unable to submit review';status.style.color='#b42318';btn.disabled=false}}</script></body></html>`;
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
