import express from 'express';

const originalUse = express.application.use;
let installed = false;

function cleanHtml(body){
  if(typeof body !== 'string') return body;
  body = body.replace('</head>', `<style id="billingHistoryClean">
    .pill{display:none!important}
  </style></head>`);
  body = body.replace('</body>', `<script id="billingHistoryCleanFix">
(function(){
  function clean(){
    document.querySelectorAll('#history .pill').forEach(function(el){el.remove()});
  }
  function wire(){
    var b=document.getElementById('reload');
    if(!b || b.dataset.historyFix==='1') return;
    b.dataset.historyFix='1';
    b.onclick=async function(){
      var old=b.textContent;
      b.disabled=true;
      b.textContent='Refreshing…';
      try{
        if(typeof historyLoad==='function') await historyLoad();
        if(typeof dailyLoad==='function') await dailyLoad();
        clean();
      }catch(e){}
      finally{b.disabled=false;b.textContent=old}
    };
  }
  document.addEventListener('DOMContentLoaded',function(){
    wire();
    clean();
    var h=document.getElementById('history');
    if(h) new MutationObserver(clean).observe(h,{childList:true,subtree:true});
  });
})();
</script></body>`);
  return body;
}

function install(){
  if(installed) return;
  installed = true;

  express.application.use = function(...args){
    const wrapped = args.map((arg)=>{
      if(typeof arg !== 'function') return arg;
      return function(req,res,next){
        if(req.path === '/billing-pos'){
          const send=res.send.bind(res);
          res.send=function(body){return send(cleanHtml(body))};
        }
        return arg(req,res,next);
      };
    });
    return originalUse.apply(this,wrapped);
  };
}

install();
