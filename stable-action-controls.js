(() => {
  if (window.__reputeStableActionsBooted) return;
  window.__reputeStableActionsBooted = true;

  const API='/api';
  const $=id=>document.getElementById(id);
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);
  let observerTimer=null;
  let decorating=false;
  let rerun=false;
  let reviewsTimer=null;
  let reviewSyncTimer=null;
  let reviewSyncing=false;

  async function req(path,opts={},timeoutMs=15000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},signal:controller.signal,...opts});
      const raw=await r.text();
      let d={};
      try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Request failed (${r.status})`}}
      if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);
      return d;
    }catch(e){
      if(e?.name==='AbortError')throw new Error('Request timed out. Please try again.');
      throw e;
    }finally{clearTimeout(timer)}
  }

  function button(text,kind='secondary'){
    const b=document.createElement('button');
    b.type='button';
    b.className=`btn ${kind}`;
    b.textContent=text;
    return b;
  }

  async function getBusiness(){
    const status=await req('/business/status').catch(()=>null);
    if(status?.businessId)return {id:status.businessId,name:status.businessName||'your business'};
    const bs=await req('/businesses');
    if(!Array.isArray(bs)||!bs.length)throw new Error('No business found.');
    return bs[0];
  }

  function pageVisible(id){
    const page=$(id);
    return !!page&&page.classList.contains('active');
  }

  function ensureReviewActionsFromDom(){
    const list=$('reviewsList');
    if(!list||!pageVisible('reviews'))return false;
    let needsServerSync=false;

    list.querySelectorAll('.item').forEach(item=>{
      const use=item.querySelector('[data-use-review]');
      const id=use?.dataset.useReview||item.dataset.reviewActionId;
      if(!id)return;
      item.dataset.reviewActionId=id;

      const nativePublish=item.querySelector('[data-publish-review]');
      const nativeApprove=item.querySelector('[data-approve-review]');
      if(nativePublish||nativeApprove){needsServerSync=true;return;}

      const stableAction=item.querySelector('[data-stable-review-action]');
      if(stableAction)return;

      const pill=(item.querySelector('.pill')?.textContent||'').toLowerCase();
      const replyText=String(item.querySelector('.reply')?.textContent||'').replace(/^AI reply\s*/i,'').trim();
      const published=pill.includes('published to google');
      const approved=pill.includes('approved')||pill.includes('ready to publish');
      if(published)return;

      let row=item.querySelector('.stable-review-actions');
      if(!row){
        row=document.createElement('div');
        row.className='row stable-review-actions';
        row.style.cssText='margin-top:10px;flex-wrap:wrap';
        item.appendChild(row);
      }

      if(approved){
        const b=button('Publish to Google');
        b.dataset.stablePublish=id;
        b.dataset.stableReviewAction='1';
        row.appendChild(b);
      }else if(replyText){
        const b=button('Approve Reply');
        b.dataset.stableApprove=id;
        b.dataset.stableReviewAction='1';
        row.appendChild(b);
      }else{
        const b=button('Generate AI Reply');
        b.dataset.stableGenerate=id;
        b.dataset.stableReviewAction='1';
        row.appendChild(b);
      }
    });

    return needsServerSync;
  }

  function scheduleReviewSync(delay=120){
    clearTimeout(reviewSyncTimer);
    reviewSyncTimer=setTimeout(()=>{
      reviewSyncTimer=null;
      syncReviewActionsFromServer().catch(e=>console.warn('[repute review sync]',e?.message||e));
    },delay);
  }

  async function syncReviewActionsFromServer(){
    const list=$('reviewsList');
    if(reviewSyncing||!list||!pageVisible('reviews'))return;
    if(!list.querySelector('[data-publish-review],[data-approve-review]'))return;

    reviewSyncing=true;
    try{
      const b=await getBusiness();
      const rows=await req(`/businesses/${encodeURIComponent(b.id)}/reviews?sync=${Date.now()}`,{cache:'no-store'},10000);
      const byId=new Map((Array.isArray(rows)?rows:[]).map(r=>[String(r.id),r]));

      list.querySelectorAll('.item').forEach(item=>{
        const use=item.querySelector('[data-use-review]');
        const id=use?.dataset.useReview||item.dataset.reviewActionId;
        if(!id)return;
        const r=byId.get(String(id));
        if(!r)return;

        const actionRow=item.querySelector('.row');
        if(!actionRow)return;
        const nativePublish=item.querySelector('[data-publish-review]');
        const nativeApprove=item.querySelector('[data-approve-review]');
        if(!nativePublish&&!nativeApprove)return;

        const status=String(r.replyStatus||'').toUpperCase();
        const hasReply=!!String(r.aiReply||'').trim();
        const published=status==='PUBLISHED'||String(r.replyState||'').toUpperCase()==='PUBLISHED';
        item.querySelector('.stable-review-actions')?.remove();
        nativePublish?.remove();
        nativeApprove?.remove();

        if(published){
          const b=button('Published to Google');
          b.disabled=true;
          actionRow.appendChild(b);
        }else if(status==='APPROVED'){
          const b=button('Publish to Google','');
          b.dataset.stablePublish=id;
          b.dataset.stableReviewAction='1';
          actionRow.appendChild(b);
        }else if(hasReply){
          const b=button('Approve Reply','secondary');
          b.dataset.stableApprove=id;
          b.dataset.stableReviewAction='1';
          actionRow.appendChild(b);
        }
      });
    }finally{
      reviewSyncing=false;
    }
  }

  async function decorateList(listId,endpoint,kind){
    const list=$(listId);
    if(!list||!pageVisible(kind==='qr'?'qr':'menu'))return;
    const items=[...list.children].filter(x=>x.classList.contains('item'));
    const undecorated=items.filter(x=>!x.querySelector('.stable-actions'));
    if(!undecorated.length)return;

    try{
      const b=await getBusiness();
      const rows=await req(endpoint(b.id),{},10000);
      items.forEach((item,i)=>{
        const row=rows[i];
        if(!row||item.querySelector('.stable-actions'))return;
        const a=document.createElement('div');
        a.className='row stable-actions';
        a.style.cssText='margin-top:10px;flex-wrap:wrap';
        const e=button('Edit');
        e.dataset.stableEdit=row.id;
        e.dataset.stableKind=kind;
        const d=button('Delete','danger');
        d.dataset.stableDelete=row.id;
        d.dataset.stableKind=kind;
        a.append(e,d);
        item.appendChild(a);
      });
    }catch(e){
      console.warn('[repute stable actions]',e?.message||e);
    }
  }

  async function ensureActions(){
    if(decorating){rerun=true;return;}
    decorating=true;
    try{
      const overlay=$('authOverlay');
      if(overlay&&getComputedStyle(overlay).display!=='none')return;
      const needsReviewSync=ensureReviewActionsFromDom();
      if(needsReviewSync)scheduleReviewSync(80);
      if(pageVisible('qr'))await decorateList('qrList',id=>`/businesses/${encodeURIComponent(id)}/qr`,'qr');
      if(pageVisible('menu'))await decorateList('menuList',id=>`/businesses/${encodeURIComponent(id)}/menus`,'menu');
    }finally{
      decorating=false;
      if(rerun){rerun=false;scheduleEnsure(80)}
    }
  }

  function scheduleEnsure(delay=80){
    clearTimeout(observerTimer);
    observerTimer=setTimeout(()=>{observerTimer=null;ensureActions()},delay);
  }

  function refreshReviews(){
    clearTimeout(reviewsTimer);
    const r=$('loadReviews');
    if(r)r.click();
    reviewsTimer=setTimeout(()=>scheduleEnsure(50),150);
  }

  async function generate(id,btn){
    btn.disabled=true;btn.textContent='Generating…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})},30000);
      notify('AI reply generated and is pending your approval.');
      refreshReviews();
    }catch(e){
      btn.disabled=false;btn.textContent='Generate AI Reply';
      notify(e.message||'Unable to generate AI reply');
    }
  }

  async function approve(id,btn){
    btn.disabled=true;btn.textContent='Approving…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({})},10000);
      notify('AI reply approved. It is now ready to publish to Google.');
      refreshReviews();
    }catch(e){
      btn.disabled=false;btn.textContent='Approve Reply';
      notify(`Approval failed: ${e.message||'Unable to approve reply'}`);
    }
  }

  async function publish(id,btn){
    if(!confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true})},20000);
      notify('Reply published to Google successfully.');
      refreshReviews();
    }catch(e){
      btn.disabled=false;btn.textContent='Publish to Google';
      notify(`Publishing failed: ${e.message||'Unable to publish reply to Google'}`);
    }
  }

  async function edit(kind,id,btn){
    const b=await getBusiness();
    const item=btn.closest('.item');
    if(kind==='qr'){
      const currentName=item?.querySelector('b')?.textContent||'';
      const currentSub=item?.querySelector('.sub')?.textContent||'';
      const name=prompt('QR name:',currentName);if(name===null)return;
      const slug=prompt('QR slug:',currentSub.split(' · ')[0]||'');if(slug===null)return;
      if(!name.trim()||!slug.trim())throw new Error('Name and slug are required.');
      await req(`/businesses/${b.id}/qr/${id}`,{method:'PUT',body:JSON.stringify({name:name.trim(),slug:slug.trim()})});
      if(item)item.querySelector('b').textContent=name.trim();
      notify('QR updated successfully.');
    }else{
      const currentName=item?.querySelector('b')?.textContent||'';
      const name=prompt('Menu name:',currentName);if(name===null)return;
      if(!name.trim())throw new Error('Menu name is required.');
      await req(`/businesses/${b.id}/menus/${id}`,{method:'PUT',body:JSON.stringify({name:name.trim()})});
      if(item)item.querySelector('b').textContent=name.trim();
      notify('Menu updated successfully.');
    }
  }

  async function remove(kind,id,btn){
    if(!confirm(`Delete this ${kind==='qr'?'QR':'menu'}? This cannot be undone.`))return;
    const b=await getBusiness();
    await req(`/businesses/${b.id}/${kind==='qr'?'qr':'menus'}/${id}`,{method:'DELETE'});
    btn.closest('.item')?.remove();
    notify(`${kind==='qr'?'QR':'Menu'} deleted successfully.`);
  }

  document.addEventListener('click',e=>{
    const g=e.target.closest?.('[data-stable-generate]');
    if(g){e.preventDefault();e.stopImmediatePropagation();generate(g.dataset.stableGenerate,g);return}
    const a=e.target.closest?.('[data-stable-approve]');
    if(a){e.preventDefault();e.stopImmediatePropagation();approve(a.dataset.stableApprove,a);return}
    const p=e.target.closest?.('[data-stable-publish]');
    if(p){e.preventDefault();e.stopImmediatePropagation();publish(p.dataset.stablePublish,p);return}
    const ed=e.target.closest?.('[data-stable-edit]');
    if(ed){e.preventDefault();e.stopImmediatePropagation();edit(ed.dataset.stableKind,ed.dataset.stableEdit,ed).catch(x=>notify(x.message));return}
    const dl=e.target.closest?.('[data-stable-delete]');
    if(dl){e.preventDefault();e.stopImmediatePropagation();remove(dl.dataset.stableKind,dl.dataset.stableDelete,dl).catch(x=>notify(x.message));return}
    if(e.target.closest?.('[data-page]'))scheduleEnsure(120);
  },true);

  const observer=new MutationObserver(()=>scheduleEnsure(120));
  observer.observe(document.body,{childList:true,subtree:true});

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>scheduleEnsure(80));
  else scheduleEnsure(80);
})();
