(() => {
  if (window.__reputeStableActionsBooted) return;
  window.__reputeStableActionsBooted = true;
  const API='/api';
  const $=id=>document.getElementById(id);
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);
  let queued=false;
  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();let d={};
    try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);
    return d;
  }
  function button(text,kind='secondary'){const b=document.createElement('button');b.type='button';b.className=`btn ${kind}`;b.textContent=text;return b}
  function reviewActions(){
    const list=$('reviewsList');if(!list)return;
    list.querySelectorAll('.item').forEach(item=>{
      let row=item.querySelector('.stable-review-actions');
      if(!row){row=document.createElement('div');row.className='row stable-review-actions';row.style.cssText='margin-top:10px;flex-wrap:wrap';item.appendChild(row)}
      const use=item.querySelector('[data-use-review]');
      if(!use&&!item.dataset.reviewActionId)return;
      const id=use?.dataset.useReview||item.dataset.reviewActionId;
      if(id)item.dataset.reviewActionId=id;
      row.querySelectorAll('[data-stable-review-action]').forEach(x=>x.remove());
      const reply=item.querySelector('.reply');
      const hasReply=!!reply&&!!reply.textContent.trim();
      const pill=(item.querySelector('.pill')?.textContent||'').toLowerCase();
      const published=pill.includes('published to google');
      if(published)return;
      if(!hasReply){
        const b=button('Generate AI Reply');b.dataset.stableGenerate=id;b.dataset.stableReviewAction='1';row.appendChild(b);return;
      }
      if(pill.includes('pending approval')||pill.includes('no ai reply yet')){
        const b=button('Approve Reply');b.dataset.stableApprove=id;b.dataset.stableReviewAction='1';row.appendChild(b);return;
      }
      if(pill.includes('approved')||pill.includes('ready to publish')){
        const b=button('Publish to Google');b.dataset.stablePublish=id;b.dataset.stableReviewAction='1';row.appendChild(b);
      }
    });
  }
  async function generate(id,btn){
    btn.disabled=true;btn.textContent='Generating…';
    try{await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});notify('AI reply generated and is pending approval.');const r=$('loadReviews');if(r)r.click();else setTimeout(reviewActions,200)}catch(e){btn.disabled=false;btn.textContent='Generate AI Reply';notify(e.message||'Unable to generate AI reply')}
  }
  async function approve(id,btn){
    btn.disabled=true;btn.textContent='Approving…';
    try{await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({})});notify('AI reply approved. It is ready to publish to Google.');const r=$('loadReviews');if(r)r.click();else setTimeout(reviewActions,200)}catch(e){btn.disabled=false;btn.textContent='Approve Reply';notify(e.message||'Unable to approve reply')}
  }
  async function publish(id,btn){
    if(!confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true})});notify('Reply published to Google successfully.');const r=$('loadReviews');if(r)r.click();else setTimeout(reviewActions,200)}catch(e){btn.disabled=false;btn.textContent='Publish to Google';notify(e.message||'Unable to publish reply to Google')}
  }
  async function getBusiness(){const s=await req('/business/status').catch(()=>null);if(s?.businessId)return s;const bs=await req('/businesses');if(bs?.[0])return bs[0];throw new Error('No business found.')}
  async function edit(kind,id,btn){const b=await getBusiness();const item=btn.closest('.item');if(kind==='qr'){const currentName=item?.querySelector('b')?.textContent||'';const currentSub=item?.querySelector('.sub')?.textContent||'';const name=prompt('QR name:',currentName);if(name===null)return;const slug=prompt('QR slug:',currentSub.split(' · ')[0]||'');if(slug===null)return;if(!name.trim()||!slug.trim())throw new Error('Name and slug are required.');await req(`/businesses/${b.id}/qr/${id}`,{method:'PUT',body:JSON.stringify({name:name.trim(),slug:slug.trim()})});if(item)item.querySelector('b').textContent=name.trim();notify('QR updated successfully.')}else{const currentName=item?.querySelector('b')?.textContent||'';const name=prompt('Menu name:',currentName);if(name===null)return;if(!name.trim())throw new Error('Menu name is required.');await req(`/businesses/${b.id}/menus/${id}`,{method:'PUT',body:JSON.stringify({name:name.trim()})});if(item)item.querySelector('b').textContent=name.trim();notify('Menu updated successfully.')}}
  async function remove(kind,id,btn){if(!confirm(`Delete this ${kind==='qr'?'QR':'menu'}? This cannot be undone.`))return;const b=await getBusiness();await req(`/businesses/${b.id}/${kind==='qr'?'qr':'menus'}/${id}`,{method:'DELETE'});btn.closest('.item')?.remove();notify(`${kind==='qr'?'QR':'Menu'} deleted successfully.`)}
  async function decorateList(listId,endpoint,kind){const list=$(listId);if(!list)return;const items=[...list.children].filter(x=>x.classList.contains('item'));if(!items.length)return;try{const b=await getBusiness();const rows=await req(endpoint(b.id));items.forEach((item,i)=>{const row=rows[i];if(!row||item.querySelector('[data-stable-edit]'))return;const a=document.createElement('div');a.className='row stable-actions';a.style.cssText='margin-top:10px;flex-wrap:wrap';const e=button('Edit');e.dataset.stableEdit=row.id;e.dataset.stableKind=kind;const d=button('Delete','danger');d.dataset.stableDelete=row.id;d.dataset.stableKind=kind;a.append(e,d);item.appendChild(a)})}catch{}}
  async function ensureActions(){if(queued)return;queued=true;setTimeout(async()=>{queued=false;const overlay=$('authOverlay');if(overlay&&getComputedStyle(overlay).display!=='none'){reviewActions();return}reviewActions();await decorateList('qrList',id=>`/businesses/${encodeURIComponent(id)}/qr`,'qr');await decorateList('menuList',id=>`/businesses/${encodeURIComponent(id)}/menus`,'menu')},50)}
  document.addEventListener('click',e=>{const g=e.target.closest?.('[data-stable-generate]');if(g){e.preventDefault();e.stopImmediatePropagation();generate(g.dataset.stableGenerate,g);return}const a=e.target.closest?.('[data-stable-approve]');if(a){e.preventDefault();e.stopImmediatePropagation();approve(a.dataset.stableApprove,a);return}const p=e.target.closest?.('[data-stable-publish]');if(p){e.preventDefault();e.stopImmediatePropagation();publish(p.dataset.stablePublish,p);return}const ed=e.target.closest?.('[data-stable-edit]');if(ed){e.preventDefault();e.stopImmediatePropagation();edit(ed.dataset.stableKind,ed.dataset.stableEdit,ed).catch(x=>notify(x.message));return}const dl=e.target.closest?.('[data-stable-delete]');if(dl){e.preventDefault();e.stopImmediatePropagation();remove(dl.dataset.stableKind,dl.dataset.stableDelete,dl).catch(x=>notify(x.message));return}if(e.target.closest?.('[data-page]'))setTimeout(ensureActions,250)},true);
  new MutationObserver(()=>ensureActions()).observe(document.body,{childList:true,subtree:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureActions);else ensureActions();
  [250,750,1500,3000].forEach(ms=>setTimeout(ensureActions,ms));
})();
