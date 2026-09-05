(function(){
function loadOrders(){
  if(document.querySelector('script[data-repute-orders]'))return;
  const s=document.createElement('script');s.src='/orders-ui.js';s.dataset.reputeOrders='1';document.head.appendChild(s);
}
function boot(){const o=document.getElementById('authOverlay');if(o){o.style.background='#f6f7fb';const c=o.firstElementChild;if(c){c.style.width='min(460px,94vw)';c.style.padding='34px';c.style.borderRadius='20px';c.style.boxShadow='0 20px 60px rgba(16,21,43,.14)';const s=c.querySelector('.sub');if(s)s.textContent='Manage reviews, menus, customers and in-store orders from one workspace.';const n=document.getElementById('authName');if(n){n.placeholder='Full name';n.style.display='none'}const e=document.getElementById('authEmail');if(e)e.autocomplete='email';const p=document.getElementById('authPassword');if(p)p.autocomplete='current-password';const t=document.getElementById('toggleAuth');if(t)t.textContent='Create a business account'}}loadOrders()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
