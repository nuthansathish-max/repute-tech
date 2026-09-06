(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  async function req(path,opts={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const options={credentials:'include',...opts,signal:controller.signal,headers:{'Content-Type':'application/json',...(opts.headers||{})}};
      let r;
      try{r=await fetch(API+path,options)}catch(e){
        if(e?.name==='AbortError')throw new Error('Request timed out. Please try again.');
        throw new Error('Network error. Please refresh the page and try again.');
      }
      const raw=await r.text();
      let d={};
      try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Server returned ${r.status}`}}
      if(!r.ok){
        const detail=typeof d.error==='string'?d.error:(d.message||`Request failed (${r.status})`);
        throw new Error(detail);
      }
      return d;
    }finally{clearTimeout(timer)}
  }

  async function post(path,body){return req(path,{method:'POST',body:JSON.stringify(body)})}

  async function getBusiness(){
    try{
      const status=await req('/business/status');
      if(status?.businessId)return {id:status.businessId,name:status.businessName||'your business'};
    }catch{}
    const bs=await req('/businesses');
    if(!Array.isArray(bs)||!bs.length)throw new Error('No business found. Please complete business setup.');
    return bs[0];
  }

  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else alert(msg)}

  const pages=[['dashboard','⌂ Dashboard'],['reviews','★ Reviews'],['ai','✦ AI Assistant'],['qr','▣ Smart QR'],['menu','☰ Digital Menu'],['customers','♙ Customers'],['campaigns','◉ WhatsApp'],['analytics','◒ Analytics'],['pricing','💳 Plans & Pricing'],['settings','⚙ Account Settings']];

  function navigate(page){
    document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===page));
    document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
    const labels={dashboard:'Good morning 👋',reviews:'Review inbox',ai:'AI Review Assistant',qr:'Smart QR',menu:'Digital Menu',customers:'Customer CRM',campaigns:'WhatsApp',analytics:'Business analytics',pricing:'Plans & pricing',settings:'Account Settings'};
    if($('heading'))$('heading').textContent=labels[page]||'repute-tech.in';
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function enhanceNavigation(){
    document.querySelectorAll('.side [data-page]').forEach(btn=>{btn.onclick=e=>{e.preventDefault();navigate(btn.dataset.page)}});
    const bar=document.querySelector('.mobilebar');
    if(bar){
      bar.innerHTML=pages.map(([id,label])=>`<button type="button" data-page="${id}">${label}</button>`).join('');
      bar.style.overflowX='auto';bar.style.justifyContent='flex-start';bar.style.scrollbarWidth='none';bar.style.whiteSpace='nowrap';
      bar.querySelectorAll('button').forEach(b=>{b.style.minWidth='94px';b.addEventListener('click',()=>navigate(b.dataset.page))});
    }
    if(!$('dashboard')?.classList.contains('active'))navigate('dashboard');
  }

  async function enhanceAI(){
    const btn=$('aiGenerate'),text=$('aiText'),out=$('aiOutput');if(!btn||!text||!out)return;
    btn.onclick=async()=>{btn.disabled=true;btn.textContent='Generating…';out.style.display='block';out.textContent='Creating your reply…';try{
      const review=text.value.trim();if(!review)throw new Error('Paste a review first');
      const b=await getBusiness();
      const d=await post('/reviews/ai-reply',{text:review,businessId:b.id,businessName:b.name,tone:'WARM',authorName:'Customer',rating:3});
      out.textContent=d.reply||d.text||'No reply was generated.';
    }catch(e){out.textContent=e.message||'Unable to generate reply';}finally{btn.disabled=false;btn.textContent='Generate reply'}};
  }

  async function enhanceQR(){
    const btn=$('createQr'),list=$('qrList');if(!btn||!list)return;
    async function render(){
      const b=await getBusiness();
      const rows=await req(`/businesses/${encodeURIComponent(b.id)}/qr`);
      list.innerHTML=rows.map(q=>{
        const destination=q.destination?.url||`${location.origin}/public/qr/${encodeURIComponent(q.slug)}`;
        const img=`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(destination)}`;
        const hub=q.qrUrl||destination;
        return `<div class="item"><b>${esc(q.name)}</b><div class="sub">${esc(q.slug)} · ${q.scanCount||0} scans</div><img src="${img}" alt="QR code" style="width:180px;height:180px;border:1px solid #e6e8ef;border-radius:8px;margin-top:10px"><div class="row" style="margin-top:8px;flex-wrap:wrap"><a class="btn secondary" href="${img}" download="${esc(q.slug)}-qr.png">Download QR</a><a class="btn secondary" href="${hub}" target="_blank" rel="noopener">Customer Hub</a></div></div>`
      }).join('')||'<div class="sub">No QR codes yet.</div>';
    }
    btn.onclick=async()=>{btn.disabled=true;btn.textContent='Creating…';try{
      const b=await getBusiness();
      const name=$('qrName').value.trim();const slug=$('qrSlug').value.trim().toLowerCase();
      if(!name||!slug)throw new Error('Enter a QR name and slug');
      await post(`/businesses/${encodeURIComponent(b.id)}/qr`,{name,slug});
      $('qrName').value='';$('qrSlug').value='';
      notify('QR created successfully');
      await render();
    }catch(e){notify(e.message||'Unable to create QR')}finally{btn.disabled=false;btn.textContent='Create QR'}};
    try{await render()}catch(e){list.innerHTML=`<div class="sub">${esc(e.message)}</div>`}
  }

  async function enhanceMenu(){
    const create=$('createMenu'),add=$('addItem'),list=$('menuList'),select=$('menuSelect');if(!create||!add||!list||!select)return;
    async function render(){const b=await getBusiness();const rows=await req(`/businesses/${encodeURIComponent(b.id)}/menus`);list.innerHTML=rows.map(m=>`<div class="item"><b>${esc(m.name)}</b><div class="sub">${m.isPublished?'Published':'Draft'} · ${m.items?.length||0} items</div><div style="margin-top:8px">${(m.items||[]).map(i=>`<div class="sub">• ${esc(i.name)} — ₹${esc(i.price)}${i.category?' · '+esc(i.category):''}</div>`).join('')||'<div class="sub">No items yet.</div>'}</div></div>`).join('')||'<div class="sub">No menus yet.</div>';select.innerHTML=rows.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}
    create.onclick=async()=>{create.disabled=true;try{const b=await getBusiness();const name=$('menuName').value.trim();if(!name)throw new Error('Enter a menu name');await post('/menus',{businessId:b.id,name,isPublished:$('menuPublished').checked});notify('Menu created');$('menuName').value='';await render()}catch(e){notify(e.message)}finally{create.disabled=false}};
    add.onclick=async()=>{add.disabled=true;try{if(!select.value)throw new Error('Create a menu first');const name=$('itemName').value.trim();const price=Number($('itemPrice').value);if(!name)throw new Error('Enter an item name');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price');await post(`/menus/${encodeURIComponent(select.value)}/items`,{name,price,category:$('itemCategory').value.trim(),description:$('itemDescription').value.trim()});notify('Menu item added');$('itemName').value='';$('itemPrice').value='';$('itemCategory').value='';$('itemDescription').value='';await render()}catch(e){notify(e.message)}finally{add.disabled=false}};
    try{await render()}catch(e){list.innerHTML=`<div class="sub">${esc(e.message)}</div>`}
  }

  async function enhanceCampaigns(){
    const btn=$('createCampaign'),list=$('campaignList');if(!btn||!list)return;
    async function render(){
      const b=await getBusiness();
      const rows=await req(`/businesses/${encodeURIComponent(b.id)}/campaigns`);
      list.innerHTML=rows.map(c=>`<div class="item"><b>${esc(c.name)}</b><div class="sub">${esc(c.status||'CREATED')} · ${c.sentCount||0} sent · ${c.failedCount||0} failed</div><div style="margin-top:6px">${esc(c.message)}</div></div>`).join('')||'<div class="sub">No campaigns yet.</div>';
    }
    btn.onclick=async()=>{btn.disabled=true;btn.textContent='Creating…';try{
      const b=await getBusiness();
      const name=$('campName').value.trim();const message=$('campMessage').value.trim();
      if(!name||!message)throw new Error('Enter campaign name and message');
      await post('/campaigns',{businessId:b.id,name,message});
      $('campName').value='';$('campMessage').value='';
      notify('Campaign created successfully');
      await render();
    }catch(e){notify(e.message||'Unable to create campaign')}finally{btn.disabled=false;btn.textContent='Create campaign'}};
    try{await render()}catch(e){list.innerHTML=`<div class="sub">${esc(e.message)}</div>`}
  }

  async function enhanceWhatsApp(){
    const page=$('campaigns');if(!page||$('waDeliveryBox'))return;
    const box=document.createElement('div');box.id='waDeliveryBox';box.className='card';box.style.marginTop='14px';box.innerHTML=`<div class="section-title">WhatsApp delivery</div><div id="waStatus" class="sub">Checking connection…</div><div id="waCustomers" class="list" style="margin-top:10px;max-height:240px;overflow:auto"></div><div class="row" style="margin-top:10px"><button class="btn secondary" id="waPreview">Preview eligible</button><button class="btn" id="waSend">Send campaign</button></div><div id="waResult" class="reply" style="display:none"></div>`;page.appendChild(box);
    const status=$('waStatus'),customers=$('waCustomers'),result=$('waResult');
    try{
      const b=await getBusiness();
      const s=await req(`/whatsapp/status/${encodeURIComponent(b.id)}`);
      status.textContent=s.configured?'WhatsApp Cloud API configured.':'WhatsApp is in setup mode. Add Meta WhatsApp environment settings before real delivery.';
      const customerRows=await req(`/businesses/${encodeURIComponent(b.id)}/customers`);
      customers.innerHTML=customerRows.map(c=>`<label class="item" style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="wa-customer" value="${esc(c.id)}"><span><b>${esc(c.name||'Customer')}</b><span class="sub"> ${esc(c.phone||'No phone')} · ${c.consents?.some(x=>x.type==='WHATSAPP_MARKETING'&&x.granted)?'marketing consent':'no marketing consent'}</span></span></label>`).join('')||'<div class="sub">No customers available.</div>';
      $('waPreview').onclick=async()=>{try{const ids=[...document.querySelectorAll('.wa-customer:checked')].map(x=>x.value);if(!ids.length)throw new Error('Select customers first');const d=await post('/whatsapp/campaigns/preview',{businessId:b.id,message:$('campMessage').value.trim()||'Preview',customerIds:ids});result.style.display='block';result.textContent=`Eligible: ${d.eligibleCount} · Excluded: ${d.excludedCount}`;}catch(e){notify(e.message)}};
      $('waSend').onclick=async()=>{const send=$('waSend');send.disabled=true;send.textContent='Sending…';try{const ids=[...document.querySelectorAll('.wa-customer:checked')].map(x=>x.value);const name=$('campName').value.trim();const message=$('campMessage').value.trim();if(!name||!message)throw new Error('Enter campaign name and message');if(!ids.length)throw new Error('Select customers first');const d=await post('/whatsapp/campaigns/send',{businessId:b.id,name,message,customerIds:ids});result.style.display='block';result.textContent=`Campaign ${d.campaign.status}. Eligible: ${d.eligibleCount}, sent: ${d.campaign.sentCount}, failed: ${d.campaign.failedCount}.`;notify('Campaign processed');}catch(e){notify(e.message)}finally{send.disabled=false;send.textContent='Send campaign'}};
    }catch(e){status.textContent=e.message||'Unable to load WhatsApp status'}
  }

  async function enhanceAnalytics(){
    const page=$('analytics');if(!page)return;try{const b=await getBusiness();const d=await req(`/businesses/${encodeURIComponent(b.id)}/analytics?days=30`);$('aReviews').textContent=d.totalReviews;$('aQr').textContent=d.totalQrScans??'—';$('aDelivered').textContent=d.messagesDelivered??'—';$('positiveBar').style.width=`${d.totalReviews?Math.round((d.sentiments.positive/d.totalReviews)*100):0}%`;const card=page.querySelector('.card');let extra=$('analyticsExtra');if(!extra){extra=document.createElement('div');extra.id='analyticsExtra';extra.style.marginTop='18px';card.appendChild(extra)}extra.innerHTML=`<div class="section-title">30-day summary</div><div class="sub">Average rating: ${d.averageRating} · Positive: ${d.sentiments.positive} · Neutral: ${d.sentiments.neutral} · Negative: ${d.sentiments.negative}</div><div class="sub" style="margin-top:8px">Top topics: ${d.topTopics?.map(x=>esc(x.topic)+' ('+x.count+')').join(', ')||'None yet'}</div>`}catch(e){}}

  async function enhancePlans(){
    const grid=$('pricingGrid');if(!grid)return;
    const fallback=[
      {code:'STARTER',name:'Starter',price:199,billingInterval:'MONTH',features:['Reviews','AI reply suggestions','Smart QR','Basic analytics']},
      {code:'GROWTH',name:'Growth',price:499,billingInterval:'MONTH',features:['Everything in Starter','Digital menu','Customer CRM','WhatsApp marketing']},
      {code:'PRO',name:'Pro',price:999,billingInterval:'MONTH',features:['Everything in Growth','Advanced analytics','AI insights','Higher usage limits']},
      {code:'HIGH_TRAFFIC',name:'High Traffic',price:1999,billingInterval:'MONTH',features:['Everything in Pro','High-volume usage','Priority support','Multi-location ready']},
      {code:'ALL_IN_ONE_YEARLY',name:'All-in-One Yearly',price:8999,billingInterval:'YEAR',features:['Everything in High Traffic','All features','Best yearly value','Priority support']}
    ];
    function draw(data){grid.style.gridTemplateColumns='repeat(auto-fit,minmax(190px,1fr))';grid.innerHTML=data.map(p=>`<div class="card ${p.code==='PRO'?'featured':''}"><div class="section-title">${esc(p.name)}</div><div class="price">₹${esc(p.price)}<small>/${p.billingInterval==='YEAR'?'year':'month'}</small></div><div class="features">${(p.features||[]).map(f=>`<div>✓ ${esc(f)}</div>`).join('')}</div><button class="btn" data-plan-code="${esc(p.code)}">Request plan</button></div>`).join('');grid.querySelectorAll('[data-plan-code]').forEach(btn=>btn.onclick=async()=>{try{await requestPlan(btn.dataset.planCode)}catch(e){notify(e.message)}})}
    try{const d=await req('/plans');draw(Array.isArray(d)&&d.length?d:fallback)}catch{draw(fallback)}
  }

  async function enhance(){
    if(!$('authOverlay')||$('authOverlay').style.display!=='none')return;
    enhanceNavigation();
    await Promise.allSettled([enhanceAI(),enhanceQR(),enhanceMenu(),enhanceCampaigns(),enhanceWhatsApp(),enhanceAnalytics(),enhancePlans()]);
  }
  let tries=0;const timer=setInterval(async()=>{if(++tries>40)return;if($('authOverlay')?.style.display==='none'){clearInterval(timer);await enhance()}},500);
})();
