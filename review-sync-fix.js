(() => {
  if (window.__reputeReviewSyncFix) return;
  window.__reputeReviewSyncFix = true;

  const API='/api';
  const textOf=el=>(el?.textContent||'').trim();
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);

  async function readJson(response){
    const raw=await response.text();
    let data={};
    try{data=raw?JSON.parse(raw):{}}catch{data={error:raw||`Request failed (${response.status})`};}
    return {response,data};
  }

  async function getBusiness(){
    const r=await fetch(`${API}/business/status`,{credentials:'include',cache:'no-store'}).catch(()=>null);
    if(r?.ok){const d=await r.json().catch(()=>({}));if(d?.businessId)return {id:d.businessId,name:d.businessName||'your business'};}
    const b=await fetch(`${API}/businesses`,{credentials:'include',cache:'no-store'});
    const d=await b.json().catch(()=>({}));
    if(!b.ok)throw new Error(d?.error||'Unable to load business.');
    if(!Array.isArray(d)||!d.length)throw new Error('No business found. Please complete business setup.');
    return d[0];
  }

  async function sync(btn){
    if(btn.dataset.reputeSyncBusy==='1')return;
    btn.dataset.reputeSyncBusy='1';
    const original=textOf(btn)||'Sync Reviews';
    btn.disabled=true;
    btn.textContent='Syncing…';
    try{
      const status=await fetch(`${API}/google/status`,{credentials:'include',cache:'no-store'});
      const statusData=await status.json().catch(()=>({}));
      if(status.status===401)throw new Error('Please sign in again.');
      if(!statusData.connected)throw new Error('Connect Google first to sync reviews.');

      const business=await getBusiness();
      const payload=JSON.stringify({});
      let r=await fetch(`${API}/businesses/${encodeURIComponent(business.id)}/reviews/sync`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:payload});
      let parsed=await readJson(r);
      if(r.status===404){
        r=await fetch(`${API}/businesses/${encodeURIComponent(business.id)}/google/sync`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:payload});
        parsed=await readJson(r);
      }
      if(!parsed.response.ok)throw new Error(typeof parsed.data?.error==='string'?parsed.data.error:(parsed.data?.message||`Request failed (${parsed.response.status})`));

      const imported=Number(parsed.data?.result?.imported||0);
      const updated=Number(parsed.data?.result?.updated||0);
      notify(`Reviews synced successfully. ${imported} new, ${updated} updated.`);
    }catch(e){
      notify(e.message||'Unable to sync reviews.');
    }finally{
      btn.disabled=false;
      btn.dataset.reputeSyncBusy='0';
      btn.textContent=original;
    }
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('button');
    if(!btn)return;
    if(textOf(btn)!=='Sync Reviews')return;
    e.preventDefault();
    e.stopImmediatePropagation();
    sync(btn);
  },true);
})();
