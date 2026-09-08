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
  const button=(text,kind='secondary')=>{const b=document.createElement('button');b.type='button';b.className=`btn ${kind}`;b.textContent=text;b.dataset.reviewActionControl='1';return b};

  async function getBusiness(){
    try{const s=await req('/business/status');if(s?.businessId)return s.businessId}catch{}
    const bs=await req('/businesses');
    if(Array.isArray(bs)&&bs[0]?.id)return bs[0].id;
    throw new Error('No business found.');
  }

  async function syncReviewButtons(){
    const list=$('reviewsList');
    if(!list)return;
    try{
      const businessId=await getBusiness();
      const reviews=await req(`/businesses/${encodeURIComponent(businessId)}/reviews`);
      const byId=new Map((Array.isArray(reviews)?reviews:[]).map(r=>[String(r.id),r]));
      list.querySelectorAll('.item').forEach(item=>{
        const use=item.querySelector('[data-use-review]');
        if(!use)return;
        const id=String(use.dataset.useReview||'');
        const r=byId.get(id);
        if(!r)return;
        const status=String(r.replyStatus||'').toUpperCase();
        const hasReply=!!String(r.aiReply||'').trim();
        const published=status==='PUBLISHED'||String(r.replyState||'').toUpperCase()==='PUBLISHED';
        const state=`${status}|${hasReply}|${published}`;
        if(item.dataset.reviewActionState===state)return;
        item.dataset.reviewActionState=state;
        item.querySelectorAll('[data-review-action-control]').forEach(x=>x.remove());
        const row=use.parentElement;
        if(!row)return;
        if(published){
          const b=button('Published to Google');b.disabled=true;row.appendChild(b);return;
        }
        if(status==='APPROVED'){
          const b=button('Publish to Google');b.dataset.publishReview=id;row.appendChild(b);return;
        }
        if(hasReply){
          const b=button('Approve Reply','secondary');b.dataset.approveReview=id;row.appendChild(b);return;
        }
        const b=button('Generate AI Reply');b.classList.remove('secondary');b.dataset.generateReview=id;row.appendChild(b);
      });
    }catch{}
  }

  async function generate(btn){
    const id=btn.dataset.generateReview;if(!id)return;
    btn.disabled=true;btn.textContent='Generating…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});
      notify('AI reply generated and is pending approval.');
      const reload=$('loadReviews');if(reload)reload.click();else await syncReviewButtons();
    }catch(e){btn.disabled=false;btn.textContent='Generate AI Reply';notify(e.message||'Unable to generate AI reply')}
  }

  async function approve(btn){
    const id=btn.dataset.approveReview;if(!id)return;
    btn.disabled=true;btn.textContent='Approving…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/approve`,{method:'POST',body:'{}'});
      notify('AI reply approved. It is ready to publish to Google.');
      const reload=$('loadReviews');if(reload)reload.click();else await syncReviewButtons();
    }catch(e){btn.disabled=false;btn.textContent='Approve Reply';notify(e.message||'Unable to approve reply')}
  }

  async function publish(btn){
    const id=btn.dataset.publishReview;if(!id)return;
    if(!confirm('Publish this approved reply to Google Business Profile?\n\nThe reply will be posted publicly on Google.'))return;
    btn.disabled=true;btn.textContent='Publishing…';
    try{
      const businessId=await getBusiness();
      const reviews=await req(`/businesses/${encodeURIComponent(businessId)}/reviews`);
      const review=(Array.isArray(reviews)?reviews:[]).find(r=>String(r.id)===String(id));
      await req(`/reviews/${encodeURIComponent(id)}/publish`,{method:'POST',body:JSON.stringify({confirm:true,replyText:review?.aiReply||''})});
      notify('Reply published to Google successfully.');
      const reload=$('loadReviews');if(reload)reload.click();else await syncReviewButtons();
    }catch(e){btn.disabled=false;btn.textContent='Publish to Google';notify(e.message||'Unable to publish reply to Google')}
  }

  function boot(){
    const list=$('reviewsList');
    if(!list||list.dataset.reviewActionsV3==='1')return;
    list.dataset.reviewActionsV3='1';
    list.addEventListener('click',e=>{
      const gen=e.target.closest('[data-generate-review]');
      if(gen){e.preventDefault();e.stopPropagation();generate(gen);return}
      const approveBtn=e.target.closest('[data-approve-review]');
      if(approveBtn){e.preventDefault();e.stopPropagation();approve(approveBtn);return}
      const publishBtn=e.target.closest('[data-publish-review]');
      if(publishBtn){e.preventDefault();e.stopPropagation();publish(publishBtn);return}
    });
    let queued=false;
    const observer=new MutationObserver(mutations=>{
      const onlyOurButtons=mutations.length>0&&mutations.every(m=>[...m.addedNodes].every(n=>n.nodeType!==1||n.dataset?.reviewActionControl==='1'));
      if(onlyOurButtons)return;
      if(queued)return;queued=true;
      setTimeout(()=>{queued=false;syncReviewButtons()},40);
    });
    observer.observe(list,{childList:true,subtree:true});
    syncReviewButtons();
  }
  let tries=0;
  const timer=setInterval(()=>{
    if(++tries>60){clearInterval(timer);return}
    if($('reviewsList')){clearInterval(timer);boot()}
  },300);
})();
