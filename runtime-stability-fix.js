(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);

  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();
    let d={};
    try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);
    return d;
  }

  function guardRemovedAdminTargets(){
    [['loadAdminPlans','planCatalog'],['loadAdminPlanRequests','adminPlanRequests']].forEach(([name,id])=>{
      const fn=window[name];
      if(typeof fn!=='function'||fn.__reputeSafeWrapper)return;
      const wrapped=async function(...args){
        if(!$(id))return;
        return fn.apply(this,args);
      };
      wrapped.__reputeSafeWrapper=true;
      window[name]=wrapped;
    });
  }

  async function createQr(){
    const btn=$('createQr'),nameEl=$('qrName'),slugEl=$('qrSlug');
    if(!btn||!nameEl||!slugEl)return;
    btn.disabled=true;btn.textContent='Creating…';
    try{
      const name=nameEl.value.trim();
      const slug=slugEl.value.trim().toLowerCase();
      if(!name||!slug)throw new Error('Enter a QR name and slug');
      let businessId=null;
      try{businessId=(await req('/business/status')).businessId||null}catch{}
      if(!businessId){const bs=await req('/businesses');businessId=Array.isArray(bs)&&bs[0]?.id}
      if(!businessId)throw new Error('No business found. Please complete business setup.');
      const destinationUrl=`${location.origin}/q/${encodeURIComponent(slug)}`;
      await req('/qr',{method:'POST',body:JSON.stringify({businessId,name,slug,destination:{url:destinationUrl}})});
      nameEl.value='';slugEl.value='';
      notify('QR created successfully');
      if(typeof window.loadQr==='function')await window.loadQr();
    }catch(e){notify(e.message||'Unable to create QR')}finally{btn.disabled=false;btn.textContent='Create QR'}
  }

  function interceptQrCreate(){
    document.addEventListener('click',e=>{
      const btn=e.target.closest?.('#createQr');
      if(!btn)return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if(btn.__reputeQrBusy)return;
      btn.__reputeQrBusy=true;
      createQr().finally(()=>{btn.__reputeQrBusy=false});
    },true);
  }

  guardRemovedAdminTargets();
  setTimeout(guardRemovedAdminTargets,0);
  setTimeout(guardRemovedAdminTargets,500);
  setTimeout(guardRemovedAdminTargets,1500);
  interceptQrCreate();
})();
