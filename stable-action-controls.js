(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);
  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();let d={};
    try{d=raw?JSON.parse(raw):{}}catch{d={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(d.error||d.message||`Request failed (${r.status})`);
    return d;
  }
  async function getBusiness(){
    try{const s=await req('/business/status');if(s?.businessId)return {id:s.businessId,name:s.businessName||'your business'}}catch{}
    const bs=await req('/businesses');
    if(Array.isArray(bs)&&bs[0])return bs[0];
    throw new Error('No business found.');
  }
  function button(text,kind='secondary'){const b=document.createElement('button');b.type='button';b.className=`btn ${kind}`;b.textContent=text;return b}

  function reviewActions(){
    const list=$('reviewsList');if(!list)return;
    list.querySelectorAll('.item').forEach(item=>{
      const use=item.querySelector('[data-use-review]');if(!use)return;
      const id=use.dataset.useReview;const row=use.parentElement;if(!row)return;
      const reply=item.querySelector('.reply');
      const hasReply=!!reply&&!!reply.textContent.trim();
      const pill=(item.querySelector('.pill')?.textContent||'').toLowerCase();
      const generated=[...item.querySelectorAll('[data-generate-review],[data-stable-generate]')];
      generated.slice(1).forEach(x=>x.remove());
      item.querySelectorAll('[data-stable-publish]').forEach(x=>x.remove());
      if(!hasReply){
        if(!item.querySelector('[data-generate-review],[data-stable-generate]')){
          const b=button('Generate AI Reply');b.dataset.stableGenerate=id;row.appendChild(b);
        }
        return;
      }
      if(pill.includes('pending approval')){
        if(!item.querySelector('[data-approve-review]')){
          const b=button('Approve Reply');b.dataset.stableApprove=id;row.appendChild(b);
        }
        return;
      }
      if(pill.includes('approved')||pill.includes('ready to publish')){
        if(!item.querySelector('[data-publish-review]')){
          const b=button('Publish to Google');b.dataset.stablePublish=id;row.appendChild(b);
        }
      }
    });
  }

  async function generate(id,btn){
    btn.disabled=true;btn.textContent='Generating…';
    try{await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});notify('AI reply generated and is pending approval.');const reload=$('loadReviews');if(reload)reload.click();}
    catch(e){btn.disabled=false;btn.textContent='Generate AI Reply';notify(e.message||'Unable to generate AI reply')}
  }
  async function approve(id,btn){
    btn.disabled=true;btn.textContent='Approving…';
    try{await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({})});notify('AI reply approved. It is ready to publish to Google.');const reload=$('loadReviews');if(reload)reload.click();}
    catch(e){btn.disabled=false;btn.textContent='Approve Reply';notify(e.message||'Unable to approve reply')}
  }
  async function publish(id,btn){
    if(!confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true})});notify('Reply published to Google successfully.');const reload=$('loadReviews');if(reload)reload.click();}
    catch(e){btn.disabled=false;btn.textContent='Publish to Google';notify(e.message||'Unable to publish reply to Google')}
  }
  async function edit(kind,id,btn){
    const b=await getBusiness();const item=btn.closest('.item');
    if(kind==='qr'){
      const currentName=item?.querySelector('b')?.textContent||'';const currentSub=item?.querySelector('.sub')?.textContent||'';const currentSlug=currentSub.split(' · ')[0]||'';
      const name=prompt('QR name:',currentName);if(name===null)return;const slug=prompt('QR slug:',currentSlug);if(slug===null)return;
      if(!name.trim()||!slug.trim())throw new Error('Name and slug are required.');
      await req(`/businesses/${encodeURIComponent(b.id)}/qr/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({name:name.trim(),slug:slug.trim()})});
      if(item){const title=item.querySelector('b');if(title)title.textContent=name.trim();const sub=item.querySelector('.sub');if(sub)sub.textContent=`${slug.trim()} · ${currentSub.split(' · ')[1]||'0 scans'}`;}
      notify('QR updated successfully.');
    }else{
      const currentName=item?.querySelector('b')?.textContent||'';const name=prompt('Menu name:',currentName);if(name===null)return;if(!name.trim())throw new Error('Menu name is required.');
      await req(`/businesses/${encodeURIComponent(b.id)}/menus/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({name:name.trim()})});
      if(item){const title=item.querySelector('b');if(title)title.textContent=name.trim();}
      notify('Menu updated successfully.');
    }
  }
  async function remove(kind,id,btn){
    const label=kind==='qr'?'QR':'menu';if(!confirm(`Delete this ${label}? This cannot be undone.`))return;
    const b=await getBusiness();await req(`/businesses/${encodeURIComponent(b.id)}/${kind==='qr'?'qr':'menus'}/${encodeURIComponent(id)}`,{method:'DELETE'});
    const item=btn.closest('.item');if(item)item.remove();notify(`${label} deleted successfully.`);
  }

  document.addEventListener('click',e=>{
    const gen=e.target.closest('[data-stable-generate],[data-generate-review]');
    if(gen){e.preventDefault();e.stopPropagation();generate(gen.dataset.stableGenerate||gen.dataset.generateReview,gen);return}
    const appr=e.target.closest('[data-stable-approve],[data-approve-review]');
    if(appr&&appr.dataset.approveReview||appr&&appr.dataset.stableApprove){e.preventDefault();e.stopPropagation();approve(appr.dataset.stableApprove||appr.dataset.approveReview,appr);return}
    const pub=e.target.closest('[data-stable-publish],[data-publish-review]');
    if(pub){e.preventDefault();e.stopPropagation();publish(pub.dataset.stablePublish||pub.dataset.publishReview,pub);return}
    const editBtn=e.target.closest('[data-stable-edit]');
    if(editBtn){e.preventDefault();e.stopPropagation();edit(editBtn.dataset.stableKind,editBtn.dataset.stableEdit,editBtn).catch(err=>notify(err.message||'Unable to edit'));return}
    const delBtn=e.target.closest('[data-stable-delete]');
    if(delBtn){e.preventDefault();e.stopPropagation();remove(delBtn.dataset.stableKind,delBtn.dataset.stableDelete,delBtn).catch(err=>notify(err.message||'Unable to delete'));return}
  },true);

  async function decorateList(listId,endpoint,kind){
    const list=$(listId);if(!list)return;
    const items=[...list.children].filter(x=>x.classList.contains('item'));
    if(!items.length)return;
    try{
      const b=await getBusiness();const rows=await req(endpoint(b.id));
      items.forEach((item,index)=>{
        const row=rows[index];if(!row)return;
        item.dataset.stableActionId=String(row.id);
        if(item.querySelector('[data-stable-edit],[data-stable-delete]'))return;
        const actions=document.createElement('div');actions.className='row stable-actions';actions.style.cssText='margin-top:10px;flex-wrap:wrap';
        const editBtn=button('Edit');editBtn.dataset.stableEdit=String(row.id);editBtn.dataset.stableKind=kind;
        const delBtn=button('Delete','danger');delBtn.dataset.stableDelete=String(row.id);delBtn.dataset.stableKind=kind;
        actions.append(editBtn,delBtn);item.appendChild(actions);
      });
    }catch{}
  }

  function boot(){
    const run=()=>{reviewActions();decorateList('qrList',id=>`/businesses/${encodeURIComponent(id)}/qr`,'qr');decorateList('menuList',id=>`/businesses/${encodeURIComponent(id)}/menus`,'menu')};
    const watch=id=>{const list=$(id);if(!list||list.dataset.stableWatched==='1')return;list.dataset.stableWatched='1';let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;run()},30)});observer.observe(list,{childList:true,subtree:true});};
    watch('reviewsList');watch('qrList');watch('menuList');run();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
