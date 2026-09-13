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
        body=body.replace('</body>',`<script id="reputeBillingNav">(function(){function add(){const side=document.querySelector('.side');const pricing=side&&side.querySelector('[data-page="pricing"]');if(pricing&&!side.querySelector('[data-page="billing"]')){const b=pricing.cloneNode(true);b.dataset.page='billing';b.classList.remove('active');b.textContent='▤ Billing & POS';b.onclick=function(e){e.preventDefault();location.href='/billing-pos'};pricing.parentNode.insertBefore(b,pricing)}const bar=document.querySelector('.mobilebar');if(bar&&!bar.querySelector('[data-page="billing"]')){const b=document.createElement('button');b.type='button';b.dataset.page='billing';b.textContent='▤ Billing';b.onclick=function(){location.href='/billing-pos'};bar.appendChild(b)}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',add);else add()})();</script></body>`);
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
