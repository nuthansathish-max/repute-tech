(function(){
function loadOrders(){
  if(document.querySelector('script[data-repute-orders]'))return;
  const s=document.createElement('script');s.src='/orders-ui.js';s.dataset.reputeOrders='1';document.head.appendChild(s);
}
function loadStableActions(){
  if(document.querySelector('script[data-repute-stable-actions]'))return;
  const s=document.createElement('script');
  s.src='/stable-action-controls.js?v=6';
  s.dataset.reputeStableActions='1';
  document.head.appendChild(s);
}
function loadReviewFinalizer(){
  if(document.querySelector('script[data-repute-review-finalizer]'))return;
  const s=document.createElement('script');
  s.src='/review-action-finalizer.js?v=1';
  s.dataset.reputeReviewFinalizer='1';
  document.head.appendChild(s);
}
function loadRuntimeStability(){
  if(document.querySelector('script[data-repute-runtime-stability]'))return;
  const s=document.createElement('script');
  s.src='/runtime-stability-fix.js?v=1';
  s.dataset.reputeRuntimeStability='1';
  document.head.appendChild(s);
}
function installSignupOnboardingRedirect(){
  if(window.__reputeSignupOnboardingRedirect)return;
  window.__reputeSignupOnboardingRedirect=true;
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    const response=await originalFetch(input,init);
    if(method==='POST' && /\/api\/auth\/signup(?:\?|$)/.test(url)){
      try{
        const data=await response.clone().json();
        if(response.ok && data?.onboardingRequired){
          window.location.href=data.onboardingUrl||'/business-setup';
        }
      }catch(e){}
    }
    return response;
  };
}
function boot(){
  const o=document.getElementById('authOverlay');
  if(o){
    o.style.background='#f6f7fb';
    const c=o.firstElementChild;
    if(c){
      c.style.width='min(460px,94vw)';c.style.padding='34px';c.style.borderRadius='20px';c.style.boxShadow='0 20px 60px rgba(16,21,43,.14)';
      const s=c.querySelector('.sub');if(s)s.textContent='Manage reviews, menus, customers and in-store orders from one workspace.';
      const n=document.getElementById('authName');if(n){n.placeholder='Full name';n.style.display='none'}
      const e=document.getElementById('authEmail');if(e)e.autocomplete='email';
      const p=document.getElementById('authPassword');if(p)p.autocomplete='current-password';
      const t=document.getElementById('toggleAuth');if(t)t.textContent='Create a business account';
    }
  }
  installSignupOnboardingRedirect();
  loadOrders();
  loadStableActions();
  loadReviewFinalizer();
}
loadRuntimeStability();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
