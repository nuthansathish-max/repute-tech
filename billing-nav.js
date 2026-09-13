import express from 'express';

const originalUse=express.application.use;
let installed=false;

function install(app){
  if(installed)return;
  installed=true;
  originalUse.call(app,async(req,res,next)=>{
    const send=res.send.bind(res);
    res.send=function(body){
      if(typeof body==='string' && body.includes('data-page="pricing"') && !body.includes('reputeBillingNav')){
        body=body.replace('</body>',`<script id="reputeBillingNav">(function(){function add(){const side=document.querySelector('.side');const pricing=side&&side.querySelector('[data-page="pricing"]');if(pricing&&!side.querySelector('[data-repute-billing]')){const b=pricing.cloneNode(true);b.removeAttribute('data-page');b.setAttribute('data-repute-billing','1');b.classList.remove('active');b.textContent='▤ Billing & POS';b.onclick=function(e){e.preventDefault();e.stopPropagation();window.location.assign('/billing-pos')};pricing.parentNode.insertBefore(b,pricing)}if(window.innerWidth<=800){const ps=[...document.querySelectorAll('[data-page="pricing"]')];const mobile=ps.find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>window.innerHeight-220});if(mobile&&!mobile.parentElement.querySelector('[data-repute-mobile-billing]')){const b=mobile.cloneNode(true);b.removeAttribute('data-page');b.setAttribute('data-repute-mobile-billing','1');b.classList.remove('active');b.textContent='▤ Billing';b.onclick=function(e){e.preventDefault();e.stopPropagation();window.location.assign('/billing-pos')};mobile.parentElement.insertBefore(b,mobile.nextSibling)}}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add();const observer=new MutationObserver(add);observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('resize',add)})();</script></body>`);
      }
      return send(body);
    };
    next();
  });
}

express.application.use=function(...args){
  install(this);
  return originalUse.call(this,...args);
};
