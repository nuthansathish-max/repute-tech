(() => {
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const originalFetch=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    const method=String(init.method||'GET').toUpperCase();
    let last;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const res=await originalFetch(input,{...init,cache:method==='GET'?'no-store':init.cache});
        if(method==='GET'&&res.status>=500&&attempt<2){await sleep(350*(attempt+1));continue}
        return res;
      }catch(e){last=e;if(attempt<2)await sleep(350*(attempt+1));else throw e}
    }
    throw last||new Error('Network request failed');
  };

  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const stars=n=>{n=Math.max(0,Math.min(5,Number(n)||0));return '★'.repeat(n)+'☆'.repeat(5-n)};

  async function getBusiness(){
    const r=await fetch('/api/businesses',{credentials:'include'});const d=await r.json();
    if(!r.ok||!Array.isArray(d)||!d[0])throw new Error(d?.error||'Business could not be loaded');
    return d[0];
  }

  async function loadAnalyticsStable(){
    const page=$('analytics');if(!page)return;
    const card=page.querySelector('.card');
    if(!card)return;
    card.dataset.loading='1';
    const old=card.querySelector('#analyticsStable');
    if(old)old.remove();
    const loading=document.createElement('div');loading.id='analyticsStable';loading.style.marginTop='16px';loading.innerHTML='<div class="sub">Loading analytics…</div>';card.appendChild(loading);
    try{
      const b=await getBusiness();
      const r=await fetch(`/api/businesses/${encodeURIComponent(b.id)}/dashboard`,{credentials:'include'});const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Analytics request failed');
      const m=d.metrics||{};
      const positive=Number(m.positiveRate||0);
      const recent=Array.isArray(d.recentReviews)?d.recentReviews:[];
      loading.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px"><div class="item"><div class="label">Average rating</div><div class="value">${esc(m.averageRating??'—')} ★</div></div><div class="item"><div class="label">Total reviews</div><div class="value">${esc(m.reviewCount??0)}</div></div><div class="item"><div class="label">QR scans</div><div class="value">${esc(m.qrScans??0)}</div></div><div class="item"><div class="label">Customers</div><div class="value">${esc(m.customers??0)}</div></div><div class="item"><div class="label">Delivered messages</div><div class="value">${esc(m.messagesDelivered??0)}</div></div><div class="item"><div class="label">Positive share</div><div class="value">${esc(positive)}%</div></div></div><div style="margin-top:18px"><div class="label">Positive review share</div><div class="bar"><span style="width:${Math.max(0,Math.min(100,positive))}%"></span></div></div><div style="margin-top:18px"><div class="section-title">Recent review activity</div>${recent.length?recent.map(x=>`<div class="review"><div class="reviewtop"><b>${esc(x.authorName||'Customer')}</b><span class="stars">${stars(x.rating)}</span></div><div class="sub">${esc(x.text||'No text')}</div><span class="pill">${esc(x.sentiment||'UNANALYZED')}</span></div>`).join(''):'<div class="sub">No review activity yet.</div>'}</div><div style="margin-top:14px" class="notice">Analytics is loaded from the same dashboard data used by the owner overview, with automatic retries for temporary server/network errors.</div>`;
    }catch(e){
      loading.innerHTML=`<div class="notice">Analytics could not be loaded right now. <button id="retryAnalytics" class="btn secondary" style="margin-left:8px">Retry</button></div>`;
      $('retryAnalytics')?.addEventListener('click',loadAnalyticsStable);
    }finally{card.dataset.loading='0'}
  }

  function refreshPage(page){
    const map={
      reviews:'loadReviews',qr:'loadQr',menu:'loadMenus',customers:'loadCustomers',campaigns:'loadCampaigns',pricing:'loadPricing',
      analytics:'loadAnalyticsStable'
    };
    const fn=map[page];if(!fn)return;
    const f=fn==='loadAnalyticsStable'?loadAnalyticsStable:window[fn];
    if(typeof f==='function')Promise.resolve(f()).catch(()=>{});
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest('[data-page]');if(!btn)return;
    const page=btn.dataset.page;
    setTimeout(()=>refreshPage(page),120);
  });

  const observer=new MutationObserver(()=>{
    const active=document.querySelector('.page.active');
    if(active?.id==='analytics'&&!active.querySelector('#analyticsStable'))loadAnalyticsStable();
  });
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});

  let started=false;
  const boot=()=>{if(started)return;if($('authOverlay')?.style.display!=='none')return;started=true;refreshPage('analytics');};
  const timer=setInterval(()=>{if(started){clearInterval(timer);return}boot()},500);
  boot();
})();
