import express from 'express';
import { PrismaClient } from '@prisma/client';

// Public customer-facing QR destination. QR scans must never expose raw API/JSON data.
const prisma = new PrismaClient();
const originalGet = express.application.get;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function money(value) {
  if (value === null || value === undefined || value === '') return '';
  return `₹${esc(value)}`;
}

function publicHubHtml({ business, menus, slug }) {
  const menuHtml = menus.length
    ? menus.map(menu => `
      <section class="menu">
        <div class="menu-title">${esc(menu.name)}</div>
        <div class="items">
          ${(menu.items || []).length
            ? menu.items.map(item => `
              <article class="item">
                <div class="item-main">
                  <h3>${esc(item.name)}</h3>
                  ${item.description ? `<p>${esc(item.description)}</p>` : ''}
                </div>
                ${item.price !== null && item.price !== undefined && item.price !== '' ? `<strong>${money(item.price)}</strong>` : ''}
              </article>`).join('')
            : '<p class="muted">Menu items will appear here soon.</p>'}
        </div>
      </section>`).join('')
    : '<div class="empty">No published menus are available yet.</div>';

  const businessId = esc(business.id);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#5b4bdb">
<title>${esc(business.name)} — Customer Hub</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#171725;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:720px;margin:0 auto;padding:18px 14px 40px}.hero{background:linear-gradient(135deg,#5b4bdb,#7b68ee);color:#fff;border-radius:22px;padding:28px 22px;margin-bottom:16px;box-shadow:0 12px 30px rgba(62,50,160,.18)}.eyebrow{font-size:12px;opacity:.85;text-transform:uppercase;letter-spacing:.12em}.hero h1{font-size:28px;margin:7px 0 6px}.hero p{margin:0;opacity:.9}.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 18px}.actions a,.actions button{border:0;border-radius:14px;background:#fff;color:#4034a5;padding:13px 10px;font-weight:700;text-decoration:none;text-align:center;box-shadow:0 5px 18px rgba(20,20,50,.07)}.menu{background:#fff;border-radius:20px;padding:18px;margin:14px 0;box-shadow:0 5px 18px rgba(20,20,50,.06)}.menu-title{font-size:21px;font-weight:800;margin-bottom:10px}.item{display:flex;justify-content:space-between;gap:14px;padding:14px 0;border-top:1px solid #eee}.item:first-child{border-top:0}.item h3{font-size:16px;margin:0 0 4px}.item p{font-size:13px;color:#686878;margin:0;line-height:1.45}.item strong{white-space:nowrap;font-size:15px}.muted,.empty{color:#777;font-size:14px}.empty{background:#fff;border-radius:18px;padding:24px;text-align:center}.footer{text-align:center;color:#888;font-size:12px;padding:20px 0}.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.48);align-items:flex-end;justify-content:center;padding:12px}.modal.open{display:flex}.sheet{background:#fff;border-radius:22px 22px 10px 10px;width:min(720px,100%);padding:20px}.sheet h2{margin-top:0}.sheet textarea,.sheet select{width:100%;border:1px solid #ddd;border-radius:12px;padding:12px;margin:6px 0 10px;font:inherit}.sheet button{width:100%;border:0;border-radius:12px;padding:13px;background:#5b4bdb;color:#fff;font-weight:800}.close{background:#eee!important;color:#333!important;margin-top:8px}</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="eyebrow">Customer Hub</div>
    <h1>${esc(business.name)}</h1>
    <p>Browse our menu and share your experience.</p>
  </header>
  <div class="actions">
    <a href="#menus">🍽️ View Menu</a>
    <button type="button" onclick="openFeedback()">⭐ Give Feedback</button>
  </div>
  <main id="menus">${menuHtml}</main>
  <div class="footer">Powered by repute-tech.in</div>
</div>
<div class="modal" id="feedbackModal" onclick="if(event.target===this)closeFeedback()">
  <div class="sheet">
    <h2>How was your experience?</h2>
    <select id="rating"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Very good</option><option value="3">★★★ Good</option><option value="2">★★ Needs improvement</option><option value="1">★ Poor</option></select>
    <textarea id="message" rows="4" placeholder="Tell us about your experience (optional)"></textarea>
    <button onclick="submitFeedback()">Submit Feedback</button>
    <button class="close" onclick="closeFeedback()">Close</button>
    <p id="feedbackStatus" class="muted"></p>
  </div>
</div>
<script>
const businessId=${JSON.stringify(business.id)};
function openFeedback(){document.getElementById('feedbackModal').classList.add('open')}
function closeFeedback(){document.getElementById('feedbackModal').classList.remove('open')}
async function submitFeedback(){
  const status=document.getElementById('feedbackStatus');
  status.textContent='Submitting...';
  try{
    const r=await fetch('/api/customer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({businessId,rating:Number(document.getElementById('rating').value),message:document.getElementById('message').value})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Unable to submit feedback');
    status.textContent='Thank you for your feedback!';
    document.getElementById('message').value='';
  }catch(e){status.textContent=e.message||'Unable to submit feedback';}
}
</script>
</body>
</html>`;
}

async function servePublicQr(req, res, next) {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug) return res.status(404).send('QR code not found');

    const qr = await prisma.smartQr.findFirst({
      where: { slug },
      include: {
        business: {
          include: {
            menus: {
              where: { isPublished: true },
              orderBy: { createdAt: 'desc' },
              include: { items: { orderBy: { name: 'asc' } } }
            }
          }
        }
      }
    });

    if (!qr?.business) return res.status(404).send('QR code not found');

    await prisma.smartQr.update({
      where: { id: qr.id },
      data: { scanCount: { increment: 1 } }
    }).catch(() => {});

    return res.type('html').send(publicHubHtml({
      business: qr.business,
      menus: qr.business.menus || [],
      slug
    }));
  } catch (error) {
    return next(error);
  }
}

for (const path of ['/q/:slug', '/public/qr/:slug', '/public/q/qr/:slug']) {
  originalGet.call(express.application, path, servePublicQr);
}
