(() => {
  if (window.__reputeStableActionsBooted) return;
  window.__reputeStableActionsBooted = true;

  const API='/api';
  const $=id=>document.getElementById(id);
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);
  let queued=false;
  let businessCache=null;
  let businessCacheAt=0;

  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();let d={};
    try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);
    return d;
  }

  async function getBusiness(force=false){
    if(!force&&businessCache&&Date.now()-businessCacheAt<10000)return businessCache;
    try{
      const s=await req('/business/status');
      if(s?.businessId){businessCache={id:s.businessId,name:s.businessName||'your business'};businessCacheAt=Date.now();return businessCache}
    }catch{}
    const bs=await req('/businesses');
    if(Array.isArray(bs)&&bs[0]){businessCache=bs[0];businessCacheAt=Date.now();return businessCache}
    throw new Error('No business found.');
  }

  function button(text,kind='secondary'){
    const b=document.createElement('button');
    b.type='button';b.className=`btn ${kind}`;b.textContent=text;return b;
  }

  function reviewActions(){
    const list=$('reviewsList');if(!list)return;
    list.querySelectorAll('.item').forEach(item=>{
      const use=item.querySelector('[data-use-review]');if(!use)return;
      const id=use.dataset.useReview;const row=use.parentElement;if(!row)return;
      const reply=item.querySelector('.reply');
      const hasReply=!!reply&&!!reply.textContent.trim();
      const pill=(item.querySelector('.pill')?.textContent||'').toLowerCase();

      item.querySelectorAll('[data-stable-generate]').forEach((x,i)=>{if(i>0)x.remove()});
      item.querySelectorAll('[data-stable-approve]').forEach(x=>x.remove());
      item.querySelectorAll('[data-stable-publish]').forEach(x=>x.remove());

      if(!hasReply){
        if(!item.querySelector('[data-generate-review],[data-stable-generate]')){
          const b=button('Generate AI Reply');b.dataset.stableGenerate=id;row.appendChild(b);
        }
      }else if(pill.includes('pending approval')||pill.includes('no ai reply yet')){
        if(!item.querySelector('[data-approve-review],[data-stable-approve]')){
          const b=button('Approve Reply');b.dataset.stableApprove=id;row.appendChild(b);
        }
      }else if(pill.includes('approved')||pill.includes('ready to publish')){
        if(!item.querySelector('[data-publish-review],[data-stable-publish]')){
          const b=button('Publish to Google');b.dataset.stablePublish=id;row.appendChild(b);
        }
      }
    });
  }

  async function generate(id,btn){
    btn.disabled=true;btn.textContent='Generating…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});
      notify('AI reply generated and is pending approval.');
      const reload=$('loadReviews');if(reload)reload.click();
    }catch(e){btn.disabled=false;btn.textContent='Generate AI Reply';notify(e.message||'Unable to generate AI reply')}
  }

  async function approve(id,btn){
    btn.disabled=true;btn.textContent='Approving…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({})});
      notify('AI reply approved. It is ready to publish to Google.');
      const reload=$('loadReviews');if(reload)reload.click();
    }catch(e){btn.disabled=false;btn.textContent='Approve Reply';notify(e.message||'Unable to approve reply')}
  }

  async function publish(id,btn){
    if(!confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true})});
      notify('Reply published to Google successfully.');
      const reload=$('loadReviews');if(reload)reload.click();
    }catch(e){btn.disabled=false;btn.textContent='Publish to Google';notify(e.message||'Unable to publish reply to Google')}
  }

  async function edit(kind,id,btn){
    const b=await getBusiness(true);const item=btn.closest('.item');
    if(kind==='qr'){
      const currentName=item?.querySelector('b')?.textContent||'';
      const currentSub=item?.querySelector('.sub')?.textContent||'';
      const currentSlug=currentSub.split(' · ')[0]||'';
      const name=prompt('QR name:',currentName);if(name===null)return;
      const slug=prompt('QR slug:',currentSlug);if(slug===null)return;
      if(!name.trim()||!slug.trim())throw new Error('Name and slug are required.');
      await req(`/businesses/${encodeURIComponent(b.id)}/qr/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({name:name.trim(),slug:slug.trim()})});
      if(item){const title=item.querySelector('b');if(title)title.textContent=name.trim();const sub=item.querySelector('.sub');if(sub)sub.textContent=`${slug.trim()} · ${currentSub.split(' · ')[1]||'0 scans'}`;}
      notify('QR updated successfully.');
    }else{
      const currentName=item?.querySelector('b')?.textContent||'';
      const name=prompt('Menu name:',currentName);if(name===null)return;
      if(!name.trim())throw new Error('Menu name is required.');
      await req(`/businesses/${encodeURIComponent(b.id)}/menus/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({name:name.trim()})});
      if(item){const title=item.querySelector('b');if(title)title.textContent=name.trim();}
      notify('Menu updated successfully.');
    }
  }

  async function remove(kind,id,btn){
    const label=kind==='qr'?'QR':'menu';
    if(!confirm(`Delete this ${label}? This cannot be undone.`))return;
    const b=await getBusiness(true);
    await req(`/businesses/${encodeURIComponent(b.id)}/${kind==='qr'?'qr':'menus'}/${encodeURIComponent(id)}`,{method:'DELETE'});
    const item=btn.closest('.item');if(item)item.remove();
    notify(`${label} deleted successfully.`);
  }

  async function decorateList(listId,endpoint,kind){
    const list=$(listId);if(!list)return;
    const items=[...list.children].filter(x=>x.classList.contains('item'));
    if(!items.length)return;
    try{
      const b=await getBusiness();
      const rows=await req(endpoint(b.id));
      items.forEach((item,index)=>{
        const row=rows[index];if(!row)return;
        item.dataset.stableActionId=String(row.id);
        if(item.querySelector('[data-stable-edit],[data-stable-delete]'))return;
        const actions=document.createElement('div');
        actions.className='row stable-actions';
        actions.style.cssText='margin-top:10px;flex-wrap:wrap';
        const editBtn=button('Edit');
        editBtn.dataset.stableEdit=String(row.id);editBtn.dataset.stableKind=kind;
        const delBtn=button('Delete','danger');
        delBtn.dataset.stableDelete=String(row.id);delBtn.dataset.stableKind=kind;
        actions.append(editBtn,delBtn);item.appendChild(actions);
      });
    }catch{}
  }

  async function ensureActions(){
    if(queued)return;
    queued=true;
    setTimeout(async()=>{
      queued=false;
      try{
        const overlay=$('authOverlay');
        if(overlay&&getComputedStyle(overlay).display!=='none')return;
        reviewActions();
        await decorateList('qrList',id=>`/businesses/${encodeURIComponent(id)}/qr`,'qr');
        await decorateList('menuList',id=>`/businesses/${encodeURIComponent(id)}/menus`,'menu');
      }catch{}
    },40);
  }

  document.addEventListener('click',e=>{
    const gen=e.target.closest?.('[data-stable-generate],[data-generate-review]');
    if(gen){e.preventDefault();e.stopImmediatePropagation();generate(gen.dataset.stableGenerate||gen.dataset.generateReview,gen);return}
    const appr=e.target.closest?.('[data-stable-approve],[data-approve-review]');
    if(appr){e.preventDefault();e.stopImmediatePropagation();approve(appr.dataset.stableApprove||appr.dataset.approveReview,appr);return}
    const pub=e.target.closest?.('[data-stable-publish],[data-publish-review]');
    if(pub){e.preventDefault();e.stopImmediatePropagation();publish(pub.dataset.stablePublish||pub.dataset.publishReview,pub);return}
    const editBtn=e.target.closest?.('[data-stable-edit]');
    if(editBtn){e.preventDefault();e.stopImmediatePropagation();edit(editBtn.dataset.stableKind,editBtn.dataset.stableEdit,editBtn).catch(err=>notify(err.message||'Unable to edit'));return}
    const delBtn=e.target.closest?.('[data-stable-delete]');
    if(delBtn){e.preventDefault();e.stopImmediatePropagation();remove(delBtn.dataset.stableKind,delBtn.dataset.stableDelete,delBtn).catch(err=>notify(err.message||'Unable to delete'));return}
    if(e.target.closest?.('[data-page]')||e.target.closest?.('#authSubmit')||e.target.closest?.('#toggleAuth'))setTimeout(ensureActions,250);
  },true);

  const observer=new MutationObserver(()=>ensureActions());
  observer.observe(document.body,{childList:true,subtree:true});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureActions);else ensureActions();
  [250,750,1500,3000].forEach(ms=>setTimeout(ensureActions,ms));
})();
