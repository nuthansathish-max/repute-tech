(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(data.error||data.message||`Request failed (${r.status})`);
    return data;
  }
  const notify=msg=>typeof window.toast==='function'?window.toast(msg):alert(msg);
  const makeButton=(text)=>{const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=text;b.dataset.reviewActionControl='1';return b};

  async function getBusinessId(){
    const s=await req('/business/status');
    if(!s?.businessId)throw new Error('No business found.');
    return s.businessId;
  }

  async function sync(){
    const list=$('reviewsList');
    if(!list)return;
    const businessId=await getBusinessId();
    const reviews=await req(`/businesses/${encodeURIComponent(businessId)}/reviews`);
    const byId=new Map((Array.isArray(reviews)?reviews:[]).map(r=>[String(r.id),r]));
    list.querySelectorAll('.item').forEach(item=>{
      const use=item.querySelector('[data-use-review]');
      if(!use)return;
      const id=String(use.dataset.useReview||'');
      const review=byId.get(id);
      if(!review)return;
      item.querySelectorAll('[data-approve-review],[data-publish-review],[data-generate-review],[data-review-action-control]').forEach(b=>b.remove());
      const row=use.parentElement;
      if(!row)return;
      const status=String(review.replyStatus||'').toUpperCase();
      const hasReply=!!String(review.aiReply||'').trim();
      const published=status==='PUBLISHED'||String(review.replyState||'').toUpperCase()==='PUBLISHED';
      if(published){const b=makeButton('Published to Google');b.disabled=true;row.appendChild(b);return;}
      if(status==='APPROVED'){const b=makeButton('Publish to Google');b.dataset.publishReview=id;row.appendChild(b);return;}
      if(hasReply||status==='PENDING_APPROVAL'){const b=makeButton('Approve Reply');b.dataset.approveReview=id;row.appendChild(b);return;}
      const b=makeButton('Generate AI Reply');b.dataset.generateReview=id;row.appendChild(b);
    });
  }

  async function generate(btn){
    const id=btn.dataset.generateReview;if(!id)return;
    btn.disabled=true;btn.textContent='Generating…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});
      notify('AI reply generated and is pending approval.');
      await sync();
    }catch(e){btn.disabled=false;btn.textContent='Generate AI Reply';notify(e.message||'Unable to generate AI reply')}
  }

  async function approve(btn){
    const id=btn.dataset.approveReview;if(!id)return;
    btn.disabled=true;btn.textContent='Approving…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:'{}'});
      notify('AI reply approved. It is ready to publish to Google.');
      await sync();
    }catch(e){btn.disabled=false;btn.textContent='Approve Reply';notify(e.message||'Unable to approve reply')}
  }

  async function publish(btn){
    const id=btn.dataset.publishReview;if(!id)return;
    if(!window.confirm('Publish this approved AI reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{
      const businessId=await getBusinessId();
      const reviews=await req(`/businesses/${encodeURIComponent(businessId)}/reviews`);
      const review=(Array.isArray(reviews)?reviews:[]).find(r=>String(r.id)===String(id));
      if(!review?.aiReply)throw new Error('AI reply text is missing. Generate the reply again.');
      await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true,replyText:review.aiReply})});
      notify('Reply published to Google successfully.');
      await sync();
    }catch(e){btn.disabled=false;btn.textContent='Publish to Google';notify(e.message||'Unable to publish reply to Google')}
  }

  function boot(){
    const list=$('reviewsList');
    if(!list||list.dataset.reviewActionsV4==='1')return;
    list.dataset.reviewActionsV4='1';
    list.onclick=async e=>{
      const gen=e.target.closest('[data-generate-review]');
      const approveBtn=e.target.closest('[data-approve-review]');
      const publishBtn=e.target.closest('[data-publish-review]');
      try{
        if(gen){e.preventDefault();e.stopPropagation();await generate(gen);return;}
        if(approveBtn){e.preventDefault();e.stopPropagation();await approve(approveBtn);return;}
        if(publishBtn){e.preventDefault();e.stopPropagation();await publish(publishBtn);return;}
      }catch(err){notify(err.message||'Unable to complete review action')}
    };
    let queued=false;
    const observer=new MutationObserver(mutations=>{
      const onlyOurChanges=mutations.length>0&&mutations.every(m=>{
        const nodes=[...m.addedNodes,...m.removedNodes].filter(n=>n.nodeType===1);
        return nodes.length>0&&nodes.every(n=>n.dataset?.reviewActionControl==='1');
      });
      if(onlyOurChanges)return;
      if(queued)return;
      queued=true;
      setTimeout(async()=>{queued=false;try{await sync()}catch{}},60);
    });
    observer.observe(list,{childList:true,subtree:true});
    sync().catch(()=>{});
  }

  let tries=0;
  const timer=setInterval(()=>{
    if(++tries>60){clearInterval(timer);return;}
    if($('reviewsList')){clearInterval(timer);boot();}
  },300);
})();
