(() => {
  const API='/api';
  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  async function req(path,opts={}){
    const r=await fetch(API+path,{credentials:'include',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    const raw=await r.text();
    let data={};try{data=raw?JSON.parse(raw):{}}catch{data={error:raw||`Request failed (${r.status})`}}
    if(!r.ok)throw new Error(data.error||data.message||`Request failed (${r.status})`);
    return data;
  }
  function addGenerateButtons(){
    const page=$('reviews'),list=$('reviewsList');
    if(!page||!list)return;
    list.querySelectorAll('.item').forEach(item=>{
      if(item.querySelector('[data-generate-review]'))return;
      const use=item.querySelector('[data-use-review]');
      if(!use)return;
      const reply=item.querySelector('.reply');
      if(reply && reply.textContent.trim())return;
      const id=use.dataset.useReview;
      if(!id)return;
      const row=use.parentElement;
      if(!row)return;
      const btn=document.createElement('button');
      btn.className='btn';
      btn.type='button';
      btn.dataset.generateReview=id;
      btn.textContent='Generate AI Reply';
      row.appendChild(btn);
    });
  }
  async function generate(btn){
    const id=btn.dataset.generateReview;
    if(!id)return;
    btn.disabled=true;
    btn.textContent='Generating…';
    try{
      await req(`/reviews/${encodeURIComponent(id)}/ai-reply`,{method:'POST',body:JSON.stringify({tone:'WARM'})});
      if(typeof window.toast==='function')window.toast('AI reply generated and is pending approval.');
      else alert('AI reply generated and is pending approval.');
      const reload=$('loadReviews');
      if(reload)reload.click();
      else addGenerateButtons();
    }catch(e){
      if(typeof window.toast==='function')window.toast(e.message||'Unable to generate AI reply');
      else alert(e.message||'Unable to generate AI reply');
      btn.disabled=false;
      btn.textContent='Generate AI Reply';
    }
  }
  function boot(){
    const list=$('reviewsList');
    if(!list)return;
    if(list.dataset.reviewActionsV2==='1')return;
    list.dataset.reviewActionsV2='1';
    list.addEventListener('click',e=>{
      const btn=e.target.closest('[data-generate-review]');
      if(btn){e.preventDefault();e.stopPropagation();generate(btn)}
    });
    const observer=new MutationObserver(addGenerateButtons);
    observer.observe(list,{childList:true,subtree:true});
    addGenerateButtons();
  }
  let tries=0;
  const timer=setInterval(()=>{
    if(++tries>60){clearInterval(timer);return;}
    if($('reviewsList')){clearInterval(timer);boot()}
  },500);
})();
