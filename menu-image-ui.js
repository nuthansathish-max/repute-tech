(() => {
  const MAX_BYTES=2*1024*1024;
  const $=id=>document.getElementById(id);

  function notify(message){
    if(typeof window.toast==='function')window.toast(message);
    else if(typeof window.alert==='function')window.alert(message);
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

  function addImageField(){
    if($('menuItemImage'))return;
    const target=$('itemDescription')?.parentElement;
    if(!target)return;
    const wrap=document.createElement('div');
    wrap.id='menuItemImageWrap';
    wrap.style.marginTop='10px';
    wrap.innerHTML='<label style="display:block;font-size:12px;font-weight:700;margin-bottom:6px">Item image</label><input id="menuItemImage" type="file" accept="image/jpeg,image/png,image/webp" style="width:100%;padding:10px;border:1px solid #dfe3eb;border-radius:12px;background:#fff"><div id="menuItemImageHint" style="font-size:11px;color:#667085;margin-top:5px">JPG, PNG or WebP · maximum 2MB</div>';
    target.parentNode.insertBefore(wrap,target.nextSibling);
  }

  async function prepare(file){
    if(!file)return null;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Only JPG, PNG and WebP images are allowed');
    if(file.size<=MAX_BYTES)return {blob:file,mime:file.type};
    const bitmap=await createImageBitmap(file);
    const max=1200;
    const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
    if(!blob)throw new Error('Could not prepare image');
    if(blob.size>MAX_BYTES)throw new Error('Image must be 2MB or smaller');
    return {blob,mime:'image/jpeg'};
  }

  function base64(blob){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
      reader.onerror=()=>reject(new Error('Could not read image'));
      reader.readAsDataURL(blob);
    });
  }

  async function getBusinessId(){
    if(window.__reputeBusinessId)return window.__reputeBusinessId;
    const r=await fetch('/api/business/status',{credentials:'include'});
    const j=await r.json().catch(()=>({}));
    if(j.businessId){window.__reputeBusinessId=j.businessId;return j.businessId;}
    const r2=await fetch('/api/businesses',{credentials:'include'});
    const rows=await r2.json();
    if(!Array.isArray(rows)||!rows[0]?.id)throw new Error('No business found');
    window.__reputeBusinessId=rows[0].id;
    return rows[0].id;
  }

  async function upload(itemId,file){
    const prepared=await prepare(file);
    if(!prepared)return;
    const dataBase64=await base64(prepared.blob);
    const businessId=await getBusinessId();
    const r=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menu-images',{
      method:'POST',
      credentials:'include',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({menuItemId:itemId,mimeType:prepared.mime,dataBase64})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'Image upload failed');
    return j.imageUrl;
  }

  async function refreshMenu(){
    try{
      const businessId=await getBusinessId();
      const rows=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus',{credentials:'include'}).then(r=>r.json());
      const list=$('menuList');
      if(!list||!Array.isArray(rows))return;
      list.innerHTML=rows.map(m=>'<div class="item"><b>'+escapeHtml(m.name)+'</b><div class="sub">'+(m.isPublished?'Published':'Draft')+' · '+(m.items?.length||0)+' items</div><div style="margin-top:8px">'+((m.items||[]).map(i=>'<div style="display:flex;align-items:center;gap:10px;margin:7px 0"><img src="'+escapeHtml(i.imageUrl||'')+'" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:10px;border:1px solid #e6e8ef;background:#f3f4f6" onerror="this.style.display=\'none\'"><div class="sub">• '+escapeHtml(i.name)+' — ₹'+escapeHtml(i.price)+(i.category?' · '+escapeHtml(i.category):'')+'</div></div>').join('')||'<div class="sub">No items yet.</div>')+'</div></div>').join('');
    }catch(_){}
  }

  async function patchAddItem(){
    const add=$('addItem');
    if(!add||add.dataset.menuImagePatched==='1')return;
    add.dataset.menuImagePatched='1';
    addImageField();
    const original=add.onclick;
    add.onclick=async function(event){
      const file=$('menuItemImage')?.files?.[0]||null;
      if(!file)return original?.call(this,event);

      let createdItemId=null;
      const realFetch=window.fetch;
      window.fetch=async function(input,init){
        const url=typeof input==='string'?input:input?.url||'';
        const method=String(init?.method||input?.method||'GET').toUpperCase();
        const response=await realFetch.apply(this,arguments);
        if(method==='POST' && /\/api\/menus\/[^/]+\/items$/.test(url)){
          try{
            const copy=response.clone();
            const json=await copy.json();
            if(response.ok)createdItemId=json?.id||json?.menuItem?.id||null;
          }catch(_){}
        }
        return response;
      };

      try{
        await Promise.resolve(original?.call(this,event));
      }finally{
        window.fetch=realFetch;
      }

      if(!createdItemId){
        notify('Menu item was added, but the image could not be attached.');
        return;
      }

      try{
        await upload(createdItemId,file);
        if($('menuItemImage'))$('menuItemImage').value='';
        notify('Menu item and image saved successfully');
        await refreshMenu();
      }catch(e){
        notify(e.message||'Image upload failed');
      }
    };
  }

  const timer=setInterval(async()=>{
    if($('addItem')&&$('menuSelect')){
      clearInterval(timer);
      try{await getBusinessId();await patchAddItem();await refreshMenu();}catch(_){}
    }
  },500);
})();