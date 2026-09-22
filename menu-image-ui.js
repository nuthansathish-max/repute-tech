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

    // Keep the JSON upload comfortably below the server's existing 1MB parser limit.
    const bitmap=await createImageBitmap(file);
    const maxDimension=900;
    const scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);

    let quality=0.78;
    let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    while(blob && blob.size>650*1024 && quality>0.45){
      quality-=0.08;
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
    }
    if(!blob)throw new Error('Could not prepare image');
    if(blob.size>700*1024)throw new Error('Image could not be compressed enough. Please choose a smaller image.');
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

  function ensureEditModal(){
    if($('menuEditModal'))return;
    const wrap=document.createElement('div');
    wrap.id='menuEditModal';
    wrap.style.cssText='display:none;position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:10000;align-items:center;justify-content:center;padding:16px';
    wrap.innerHTML='<div style="background:#fff;width:min(720px,96vw);max-height:90vh;overflow:auto;border-radius:18px;padding:18px"><div style="display:flex;justify-content:space-between;align-items:center"><b>Edit menu & items</b><button type="button" id="menuEditClose">Close</button></div><div id="menuEditBody" style="margin-top:14px"></div></div>';
    document.body.appendChild(wrap);
    $('menuEditClose').onclick=()=>wrap.style.display='none';
  }

  async function openMenuEditor(menuId){
    ensureEditModal();
    const modal=$('menuEditModal'),body=$('menuEditBody');
    modal.style.display='flex';body.innerHTML='<div class="sub">Loading…</div>';
    try{
      const businessId=await getBusinessId();
      const rows=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus',{credentials:'include'}).then(r=>r.json());
      const menu=rows.find(m=>m.id===menuId);if(!menu)throw new Error('Menu not found');
      body.innerHTML='<div class="form"><input id="editMenuName" value="'+escapeHtml(menu.name)+'"><button class="btn" id="saveMenuName">Save menu name</button></div><div style="margin-top:16px;font-weight:700">Items</div><div id="editMenuItems" style="margin-top:8px"></div><div style="margin-top:16px;font-weight:700">Add item</div><div class="form" style="margin-top:8px"><input id="newMenuItemName" placeholder="Item name"><input id="newMenuItemPrice" type="number" min="0" placeholder="Price ₹"><input id="newMenuItemCategory" placeholder="Category"><textarea id="newMenuItemDescription" placeholder="Description"></textarea><button class="btn" id="addMenuEditorItem">Add item</button></div>';
      const box=$('editMenuItems');
      box.innerHTML=(menu.items||[]).map(i=>'<div class="item" style="margin:8px 0;padding:10px;border:1px solid #e6e8ef;border-radius:12px"><input data-edit-name="'+escapeHtml(i.id)+'" value="'+escapeHtml(i.name)+'" placeholder="Item name"><input data-edit-price="'+escapeHtml(i.id)+'" type="number" min="0" value="'+escapeHtml(i.price)+'" placeholder="Price ₹"><input data-edit-category="'+escapeHtml(i.id)+'" value="'+escapeHtml(i.category||'')+'" placeholder="Category"><textarea data-edit-description="'+escapeHtml(i.id)+'" placeholder="Description">'+escapeHtml(i.description||'')+'</textarea><button class="btn secondary" data-save-item="'+escapeHtml(i.id)+'" type="button">Save item</button></div>').join('')||'<div class="sub">No items yet.</div>';
      $('saveMenuName').onclick=async()=>{try{
        const name=$('editMenuName').value.trim();if(!name)throw new Error('Enter a menu name');
        const r=await fetch('/api/menus/'+encodeURIComponent(menu.id),{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Unable to save menu');
        notify('Menu name updated');await refreshMenu();bindEditButtons();await openMenuEditor(menu.id);
      }catch(e){notify(e.message||'Unable to save menu')}};
      box.querySelectorAll('[data-save-item]').forEach(btn=>btn.onclick=async()=>{try{
        const id=btn.dataset.saveItem;const name=box.querySelector('[data-edit-name="'+id+'"]').value.trim();const price=Number(box.querySelector('[data-edit-price="'+id+'"]').value);const category=box.querySelector('[data-edit-category="'+id+'"]').value.trim();const description=box.querySelector('[data-edit-description="'+id+'"]').value.trim();
        if(!name)throw new Error('Enter an item name');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price');
        const payload={name,price,category,description};
        let r=await fetch('/api/menus/'+encodeURIComponent(menu.id)+'/items/'+encodeURIComponent(id),{method:'PUT',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
        let j=await r.json().catch(()=>({}));
        if(!r.ok){r=await fetch('/api/menus/'+encodeURIComponent(menu.id)+'/items/'+encodeURIComponent(id),{method:'PATCH',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});j=await r.json().catch(()=>({}));}
        if(!r.ok)throw new Error(j.error||'Unable to save item');
        notify('Menu item updated');await refreshMenu();bindEditButtons();await openMenuEditor(menu.id);
      }catch(e){notify(e.message||'Unable to save item')}});
      $('addMenuEditorItem').onclick=async()=>{try{
        const name=$('newMenuItemName').value.trim(),price=Number($('newMenuItemPrice').value);if(!name)throw new Error('Enter an item name');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price');
        const r=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus/'+encodeURIComponent(menu.id)+'/items',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({name,price,category:$('newMenuItemCategory').value.trim(),description:$('newMenuItemDescription').value.trim()})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Unable to add item');
        notify('Menu item added');await refreshMenu();bindEditButtons();await openMenuEditor(menu.id);
      }catch(e){notify(e.message||'Unable to add item')}};
    }catch(e){body.innerHTML='<div class="notice">'+escapeHtml(e.message||'Unable to load menu')+'</div>'}
  }

  async function refreshMenu(){
    try{
      const businessId=await getBusinessId();
      const rows=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus',{credentials:'include'}).then(r=>r.json());
      const list=$('menuList');
      if(!list||!Array.isArray(rows))return;
      list.innerHTML=rows.map(m=>'<div class="item"><b>'+escapeHtml(m.name)+'</b><div class="sub">'+(m.isPublished?'Published':'Draft')+' · '+(m.items?.length||0)+' items</div><div style="margin-top:8px">'+((m.items||[]).map(i=>'<div style="display:flex;align-items:center;gap:10px;margin:7px 0"><img src="'+escapeHtml(i.imageUrl||'')+'" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:10px;border:1px solid #e6e8ef;background:#f3f4f6" onerror="this.style.display=\'none\'"><div class="sub">• '+escapeHtml(i.name)+' — ₹'+escapeHtml(i.price)+(i.category?' · '+escapeHtml(i.category):'')+'</div></div>').join('')||'<div class="sub">No items yet.</div>')+'</div><button class="btn secondary" type="button" data-edit-menu="'+escapeHtml(m.id)+'" style="margin-top:10px">Edit menu & items</button></div>').join('');
    }catch(_){}
  }
  function bindEditButtons(){
    const list=$('menuList');if(!list)return;
    list.querySelectorAll('[data-edit-menu]').forEach(btn=>{
      if(btn.dataset.bound==='1')return;
      btn.dataset.bound='1';
      btn.onclick=e=>{e.preventDefault();e.stopPropagation();openMenuEditor(btn.dataset.editMenu)};
    });
  }

  // Use event delegation as a fallback so the Edit action still works even
  // when another dashboard refresh replaces the menu list after binding.
  if(!document.documentElement.dataset.reputeMenuEditClick){
    document.documentElement.dataset.reputeMenuEditClick='1';
    document.addEventListener('click',e=>{
      const btn=e.target?.closest?.('[data-edit-menu]');
      if(!btn||btn.dataset.bound==='1')return;
      e.preventDefault();
      openMenuEditor(btn.dataset.editMenu);
    });
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

      const businessId=await getBusinessId();
      const menuId=$('menuSelect')?.value||'';
      let before=[];
      try{
        const rows=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus',{credentials:'include'}).then(r=>r.json());
        before=(rows.find(m=>m.id===menuId)?.items||[]).map(i=>i.id);
      }catch(_){}

      await Promise.resolve(original?.call(this,event));

      try{
        const rows=await fetch('/api/businesses/'+encodeURIComponent(businessId)+'/menus',{credentials:'include'}).then(r=>r.json());
        const items=rows.find(m=>m.id===menuId)?.items||[];
        const created=items.find(i=>!before.includes(i.id));
        if(!created)throw new Error('Menu item was added, but its image could not be attached.');
        await upload(created.id,file);
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
      try{await getBusinessId();patchAddItem();bindEditButtons();}catch(_){}
    }
  },500);
})();