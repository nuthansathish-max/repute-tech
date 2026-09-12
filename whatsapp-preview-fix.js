import express from 'express';

const previousGet=express.application.get;
let installed=false;

function install(app){
  if(installed)return;
  installed=true;
  previousGet.call(app,'/__repute_whatsapp_preview_fix_check',(_req,res)=>res.sendStatus(204));
}

express.application.get=function(path,...handlers){
  install(this);
  if(path==='/'&&handlers.length){
    handlers=handlers.map(handler=>async(req,res,next)=>{
      const send=res.send.bind(res);
      res.send=function(body){
        if(typeof body==='string'&&body.includes('id="waPreview"')&&!body.includes('reputeWhatsAppPreviewFix')){
          body=body.replace('</body>',`<script id="reputeWhatsAppPreviewFix">(function(){function wire(){var b=document.getElementById('waPreview');if(!b||b.dataset.previewFix==='1')return;b.dataset.previewFix='1';b.type='button';b.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();var checks=[].slice.call(document.querySelectorAll('.wa-customer:checked'));var eligible=[];var excluded=[];checks.forEach(function(x){var label=x.closest('label');var name=label&&label.querySelector('b')?label.querySelector('b').textContent.trim():'Customer';var text=label?label.textContent:'';var ok=/marketing consent/i.test(text)&&!/no marketing consent/i.test(text)&&!/No phone/i.test(text);(ok?eligible:excluded).push(name)});var out=document.getElementById('waResult');if(!out)return;out.style.display='block';if(!checks.length){out.textContent='Select customers first.';return}var html='Eligible: '+eligible.length+' · Excluded: '+excluded.length;if(eligible.length)html+='<br><br><b>Eligible customers:</b><br>'+eligible.map(function(n){return '• '+n}).join('<br>');if(excluded.length)html+='<br><br><b>Excluded customers:</b><br>'+excluded.map(function(n){return '• '+n}).join('<br>');out.innerHTML=html},true)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();new MutationObserver(wire).observe(document.documentElement,{childList:true,subtree:true})})();</script></body>`);
        }
        return send(body);
      };
      return handler(req,res,next);
    });
  }
  return previousGet.call(this,path,...handlers);
};
