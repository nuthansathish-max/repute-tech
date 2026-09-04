(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  async function req(path,opts={}){const r=await fetch(API+path,{credentials:'include',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
  async function post(path,body){return req(path,{method:'POST',body:JSON.stringify(body)})}
  async function getBusiness(){const bs=await req('/businesses');if(!bs.length)throw new Error('No business found');return bs[0]}
  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else alert(msg)}

  function enhanceMobileNav(){
    const bar=document.querySelector('.mobilebar');if(!bar)return;
    const pages=[['dashboard','⌂ Dashboard'],['reviews','★ Reviews'],['ai','✦ AI'],['qr','▣ QR'],['menu','☰ Menu'],['customers','♙ Customers'],['campaigns','◉ WhatsApp'],['analytics','◒ Analytics'],['pricing','💳 Plans'],['settings','⚙ Account']];
    bar.innerHTML=pages.map(([id,label])=>`<button data-page="${id}">${label}</button>`).join('');
    bar.style.overflowX='auto';bar.style.justifyContent='flex-start';bar.style.scrollbarWidth='none';bar.style.whiteSpace='nowrap';
    bar.querySelectorAll('button').forEach(b=>{b.style.minWidth='82px';b.addEventListener('click',e=>{e.preventDefault();if(typeof showPage==='function')showPage(b.dataset.page)})});
  }

  async function enhanceAI(){
    const btn=$('aiGenerate'), text=$('aiText'), out=$('aiOutput'); if(!btn||!text||!out)return;
    btn.onclick=async()=>{btn.disabled=true;btn.textContent='Generating…';out.style.display='block';out.textContent='Creating your reply…';try{
      const review=text.value.trim(); if(!review)throw new Error('Paste a review first');
      const b=await getBusiness();
      const d=await post('/reviews/ai-reply',{text:review,businessName:b.name,tone:'WARM',authorName:'Customer',rating:3});
      out.textContent=d.reply||'No reply was generated.';
    }catch(e){out.textContent=e.message||'Unable to generate reply';}finally{btn.disabled=false;btn.textContent='Generate reply'}};
  }

  async function enhanceQR(){
    const btn=$('createQr'), list=$('qrList'); if(!btn||!list)return;
    async function render(){const b=await getBusiness();const rows=await req(`/businesses/${b.id}/qr`);list.innerHTML=rows.map(q=>{
      const url=q.qrUrl||`${location.origin}/q/${encodeURIComponent(q.slug)}`;
      const img=q.qrImageUrl||`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
      return `<div class="item"><b>${esc(q.name)}</b><div class="sub">${esc(q.slug)} · ${q.scanCount||0} scans</div><img src="${img}" alt="QR code" style="width:180px;height:180px;border:1px solid #e6e8ef;border-radius:8px;margin-top:10px"><div class="row" style="margin-top:8px"><a class="btn secondary" href="${img}" target="_blank" rel="noopener">Open QR</a><a class="btn secondary" href="${url}" target="_blank" rel="noopener">Open customer hub</a></div></div>`
    }).join('')||'<div class="sub">No QR codes yet.</div>'}
    btn.onclick=async()=>{btn.disabled=true;btn.textContent='Creating…';try{const b=await getBusiness();const name=$('qrName').value.trim();const slug=$('qrSlug').value.trim().toLowerCase();if(!name||!slug)throw new Error('Enter a QR name and slug');const created=await post(`/businesses/${b.id}/qr`,{name,slug});notify('QR created successfully');if(created.qrImageUrl){list.innerHTML=`<div class="item"><b>${esc(created.name)}</b><div class="sub">${esc(created.slug)} · 0 scans</div><img src="${created.qrImageUrl}" alt="QR code" style="width:220px;height:220px;border:1px solid #e6e8ef;border-radius:8px;margin-top:10px"><div class="row" style="margin-top:8px"><a class="btn secondary" href="${created.qrImageUrl}" target="_blank" rel="noopener">Open QR</a><a class="btn secondary" href="${created.qrUrl}" target="_blank" rel="noopener">Open customer hub</a></div></div>`}await render();}catch(e){notify(e.message)}finally{btn.disabled=false;btn.textContent='Create QR'}};
    try{await render()}catch{}
  }

  async function enhanceMenu(){
    const create=$('createMenu'),add=$('addItem'),list=$('menuList'),select=$('menuSelect');if(!create||!add||!list||!select)return;
    async function render(){const b=await getBusiness();const rows=await req(`/businesses/${b.id}/menus`);list.innerHTML=rows.map(m=>`<div class="item"><b>${esc(m.name)}</b><div class="sub">${m.isPublished?'Published':'Draft'} · ${m.items?.length||0} items</div><div style="margin-top:8px">${(m.items||[]).map(i=>`<div class="sub">• ${esc(i.name)} — ₹${esc(i.price)}${i.category?' · '+esc(i.category):''}</div>`).join('')||'<div class="sub">No items yet.</div>'}</div></div>`).join('')||'<div class="sub">No menus yet.</div>';select.innerHTML=rows.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');}
    create.onclick=async()=>{create.disabled=true;try{const b=await getBusiness();const name=$('menuName').value.trim();if(!name)throw new Error('Enter a menu name');await post(`/businesses/${b.id}/menus`,{name,published:$('menuPublished').checked});notify('Menu created');$('menuName').value='';await render()}catch(e){notify(e.message)}finally{create.disabled=false}};
    add.onclick=async()=>{add.disabled=true;try{if(!select.value)throw new Error('Create a menu first');const name=$('itemName').value.trim();const price=Number($('itemPrice').value);if(!name)throw new Error('Enter an item name');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price');await post(`/menus/${select.value}/items`,{name,price,category:$('itemCategory').value.trim(),description:$('itemDescription').value.trim()});notify('Menu item added');$('itemName').value='';$('itemPrice').value='';$('itemCategory').value='';$('itemDescription').value='';await render()}catch(e){notify(e.message)}finally{add.disabled=false}};
    try{await render()}catch{}
  }

  async function enhanceWhatsApp(){
    const page=$('campaigns');if(!page)return;
    if($('waDeliveryBox'))return;
    const box=document.createElement('div');box.id='waDeliveryBox';box.className='card';box.style.marginTop='14px';box.innerHTML=`<div class="section-title">WhatsApp delivery</div><div id="waStatus" class="sub">Checking connection…</div><div id="waCustomers" class="list" style="margin-top:10px;max-height:240px;overflow:auto"></div><div class="row" style="margin-top:10px"><button class="btn secondary" id="waPreview">Preview eligible</button><button class="btn" id="waSend">Send campaign</button></div><div id="waResult" class="reply" style="display:none"></div>`;page.appendChild(box);
    const status=$('waStatus'), customers=$('waCustomers'), result=$('waResult');
    try{const b=await getBusiness();const s=await req(`/whatsapp/status/${b.id}`);status.textContent=s.configured?'WhatsApp Cloud API configured.':'WhatsApp is in setup mode. Add Meta WhatsApp environment settings before real delivery.';const customerRows=await req(`/businesses/${b.id}/customers`);customers.innerHTML=customerRows.map(c=>`<label class="item" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="wa-customer" value="${esc(c.id)}"><span><b>${esc(c.name||'Customer')}</b><span class="sub"> ${esc(c.phone||'No phone')} · ${c.consents?.some(x=>x.type==='WHATSAPP_MARKETING'&&x.granted)?'marketing consent':'no marketing consent'}</span></span></label>`).join('')||'<div class="sub">No customers available.</div>';
      $('waPreview').onclick=async()=>{try{const ids=[...document.querySelectorAll('.wa-customer:checked')].map(x=>x.value);if(!ids.length)throw new Error('Select customers first');const d=await post('/whatsapp/campaigns/preview',{businessId:b.id,message:$('campMessage').value.trim()||'Preview',customerIds:ids});result.style.display='block';result.textContent=`Eligible: ${d.eligibleCount} · Excluded: ${d.excludedCount}`;}catch(e){notify(e.message)}};
      $('waSend').onclick=async()=>{try{const ids=[...document.querySelectorAll('.wa-customer:checked')].map(x=>x.value);const name=$('campName').value.trim();const message=$('campMessage').value.trim();if(!name||!message)throw new Error('Enter campaign name and message');if(!ids.length)throw new Error('Select customers first');const d=await post('/whatsapp/campaigns/send',{businessId:b.id,name,message,customerIds:ids});result.style.display='block';result.textContent=`Campaign ${d.campaign.status}. Eligible: ${d.eligibleCount}, sent: ${d.campaign.sentCount}, failed: ${d.campaign.failedCount}.`;notify('Campaign processed');}catch(e){notify(e.message)}};
    }catch(e){status.textContent=e.message}
  }

  async function enhanceAnalytics(){
    const page=$('analytics');if(!page)return;try{const b=await getBusiness();const d=await req(`/businesses/${b.id}/analytics?days=30`);$('aReviews').textContent=d.totalReviews;$('aQr').textContent='—';$('aDelivered').textContent='—';$('positiveBar').style.width=`${d.totalReviews?Math.round((d.sentiments.positive/d.totalReviews)*100):0}%`;const card=page.querySelector('.card');let extra=$('analyticsExtra');if(!extra){extra=document.createElement('div');extra.id='analyticsExtra';extra.style.marginTop='18px';card.appendChild(extra)}extra.innerHTML=`<div class="section-title">30-day summary</div><div class="sub">Average rating: ${d.averageRating} · Positive: ${d.sentiments.positive} · Neutral: ${d.sentiments.neutral} · Negative: ${d.sentiments.negative}</div><div class="sub" style="margin-top:8px">Top topics: ${d.topTopics?.map(x=>esc(x.topic)+' ('+x.count+')').join(', ')||'None yet'}</div>`}catch(e){}}

  async function enhancePlans(){
    const grid=$('pricingGrid');if(!grid)return;
    try{
      const d=await req('/plans');
      grid.innerHTML=d.map(p=>`<div class="card ${p.code==='PRO'?'featured':''}"><div class="section-title">${esc(p.name)}</div><div class="price">₹${esc(p.price)}<small>/${p.billingInterval==='YEAR'?'year':'month'}</small></div><div class="features">${(p.features||[]).map(f=>`<div>✓ ${esc(f)}</div>`).join('')}</div><button class="btn" data-plan-code="${esc(p.code)}">Request plan</button></div>`).join('')||'<div class="notice">No plans are configured.</div>';
      grid.querySelectorAll('[data-plan-code]').forEach(btn=>btn.onclick=async()=>{try{await requestPlan(btn.dataset.planCode)}catch(e){notify(e.message)}});
    }catch(e){grid.innerHTML=`<div class="notice">Unable to load plans: ${esc(e.message)}</div>`}
  }

  async function enhance(){
    if(!$('authOverlay')||$('authOverlay').style.display!=='none')return;
    enhanceMobileNav();
    await Promise.allSettled([enhanceAI(),enhanceQR(),enhanceMenu(),enhanceWhatsApp(),enhanceAnalytics(),enhancePlans()]);
  }
  let tries=0;const timer=setInterval(async()=>{if(++tries>40)return;if($('authOverlay')?.style.display==='none'){clearInterval(timer);await enhance()}},500);
})();
