(()=> {
 const API='/api';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const req=async(path,opts={})=>{const r=await fetch(API+path,{credentials:'include',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d};
 const notify=m=>{if(typeof toast==='function')toast(m);else alert(m)};
 const readImage=file=>new Promise((resolve,reject)=>{if(!file)return resolve(null);if(!/^image\/(png|jpeg|webp)$/.test(file.type))return reject(new Error('Choose a PNG, JPG or WEBP image.'));if(file.size>600*1024)return reject(new Error('Payment proof must be 600 KB or smaller.'));const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Unable to read payment proof.'));reader.readAsDataURL(file)});
 let busy=false;
 async function enhance(){
  const host=document.getElementById('myPlanRequests');if(!host)return;
  const cards=[...host.querySelectorAll('[data-plan-request-id]')];
  for(const card of cards){
   if(card.dataset.upiEnhanced==='1')continue;
   const status=String(card.dataset.requestStatus||'').toUpperCase(),payment=String(card.dataset.paymentStatus||'').toUpperCase();
   if(status!=='APPROVED'||payment==='PAID')continue;
   card.dataset.upiEnhanced='1';
   const id=card.dataset.planRequestId,biz=typeof businessId!=='undefined'?businessId:'';
   const section=document.createElement('div');section.className='notice';section.style.cssText='margin-top:12px;background:#f5f3ff;color:#312e81;border:1px solid #ddd6fe';
   section.innerHTML='<b>Complete subscription payment manually</b><div data-upi-info style="margin-top:8px">Loading UPI payment details…</div><label style="display:block;margin-top:10px;font-weight:700">UTR / transaction reference</label><input data-upi-utr maxlength="120" placeholder="Enter your UTR/reference number" style="width:100%;padding:10px;border:1px solid #c7c9d5;border-radius:8px;margin-top:5px"><label style="display:block;margin-top:10px;font-weight:700">Payment screenshot (optional, max 600 KB)</label><input data-upi-proof type="file" accept="image/png,image/jpeg,image/webp" style="display:block;margin-top:5px"><button class="btn" type="button" data-upi-submit style="margin-top:12px">Submit payment for review</button><div data-upi-message role="status" style="margin-top:8px"></div>';
   card.appendChild(section);
   try{
    if(!biz)throw new Error('Select your business and refresh this page.');
    const d=await req('/subscription-payment/instructions?businessId='+encodeURIComponent(biz)+'&planRequestId='+encodeURIComponent(id)),s=d.settings||{};
    if(d.submission?.status==='PENDING'){section.innerHTML='<b>Payment submitted</b><div style="margin-top:8px">Your UTR/reference has been received. It is awaiting manual Admin verification. Please do not submit another payment proof.</div>';continue}
    const rejectionNotice=d.submission?.status==='REJECTED'?'<div style="margin-bottom:8px"><b>Previous submission rejected.</b> '+esc(d.submission.reviewNote||'Please check the UTR/reference and submit again.')+'<div style="margin-top:6px">You can submit corrected payment details below.</div></div>':'';
    const info=section.querySelector('[data-upi-info]');
    if(!s.upiId){info.textContent='UPI payment details are not configured yet. Please contact platform support.';section.querySelector('[data-upi-submit]').disabled=true;continue}
    info.innerHTML=rejectionNotice+'<div><b>UPI ID:</b> '+esc(s.upiId)+'</div><div><b>Account name:</b> '+esc(s.accountName)+'</div>'+(s.qrDataUrl?'<img alt="UPI QR code" src="'+esc(s.qrDataUrl)+'" style="display:block;width:190px;max-width:100%;margin:10px auto;background:#fff;padding:8px;border:1px solid #ddd;border-radius:10px">':'')+(s.instructions?'<div style="margin-top:8px">'+esc(s.instructions)+'</div>':'')+'<div style="margin-top:8px">Pay the subscription amount shown above, then enter the UTR/reference below. Admin will verify it manually.</div>';
   }catch(e){section.querySelector('[data-upi-info]').textContent=e.message;section.querySelector('[data-upi-submit]').disabled=true}
  }
 }
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-upi-submit]');if(!button||busy)return;
  const card=button.closest('[data-plan-request-id]');if(!card)return;
  const box=button.parentElement,utr=box.querySelector('[data-upi-utr]').value.trim(),file=box.querySelector('[data-upi-proof]').files[0],message=box.querySelector('[data-upi-message]');
  if(utr.length<6||utr.length>120){message.textContent='Enter a valid UTR/reference number (6–120 characters).';return}
  busy=true;button.disabled=true;button.textContent='Submitting…';message.textContent='';
  try{
   const proofDataUrl=await readImage(file);
   await req('/subscription-payment-submissions',{method:'POST',body:JSON.stringify({planRequestId:card.dataset.planRequestId,businessId:typeof businessId!=='undefined'?businessId:'',utr,proofDataUrl})});
   message.textContent='Submitted successfully. Your payment is awaiting manual Admin review.';
   button.textContent='Submitted';box.querySelector('[data-upi-utr]').disabled=true;box.querySelector('[data-upi-proof]').disabled=true;
  }catch(err){message.textContent=err.message;button.disabled=false;button.textContent='Submit payment for review'}
  finally{busy=false}
 });
 const host=document.getElementById('myPlanRequests');
 if(host){new MutationObserver(()=>enhance()).observe(host,{childList:true,subtree:true});enhance()}
})();
