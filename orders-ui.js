(function(){
  const $=id=>document.getElementById(id);
  const api=async(url,opt={})=>{const r=await fetch('/api'+url,{credentials:'include',headers:{'content-type':'application/json',...(opt.headers||{})},...opt});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed');return j};
  function addNav(){
    const nav=document.querySelector('.side .nav')||document.querySelector('.nav');
    if(nav&&!nav.querySelector('[data-page="orders"]')){const b=document.createElement('button');b.type='button';b.dataset.page='orders';b.textContent='▤ Orders';nav.insertBefore(b,nav.querySelector('[data-page="pricing"]')||null);b.addEventListener('click',showOrders)}
    const bar=document.querySelector('.mobilebar');
    if(bar&&!bar.querySelector('[data-page="orders"]')){const b=document.createElement('button');b.type='button';b.dataset.page='orders';b.textContent='▤ Orders';b.style.minWidth='94px';b.addEventListener('click',showOrders);bar.appendChild(b)}
  }
  function addAvailability(){
    if($('businessAvailability'))return;
    const main=document.querySelector('main.main');if(!main)return;
    const card=document.createElement('div');card.id='businessAvailability';card.className='card';
    card.style.cssText='margin:0 0 18px;padding:18px 20px;border:2px solid var(--line);position:relative;z-index:2';
    card.innerHTML='<div class="row" style="justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap"><div style="min-width:220px"><div class="section-title" style="margin:0 0 5px;font-size:18px">Business availability</div><div id="businessAvailabilityText" class="sub">Checking your business status…</div></div><button id="businessAvailabilityToggle" class="btn" type="button" style="min-width:150px;font-size:14px;padding:12px 18px">Checking…</button></div>';
    main.insertBefore(card,main.firstElementChild);
    $('businessAvailabilityToggle').addEventListener('click',toggleAvailability);
    loadAvailability();
  }
  async function loadAvailability(){
    addAvailability();
    try{const d=await api('/business/status');renderAvailability(Boolean(d.isOpen));window.reputeBusinessId=d.businessId}catch(e){if($('businessAvailabilityText'))$('businessAvailabilityText').textContent=e.message||'Unable to load business status'}}
  function renderAvailability(open){
    const text=$('businessAvailabilityText'),btn=$('businessAvailabilityToggle'),card=$('businessAvailability');if(!text||!btn)return;
    text.textContent=open?'OPEN — customers can view your hub and place new orders.':'CLOSED — customers can still view your hub, but new orders are unavailable.';
    text.style.fontWeight='700';text.style.color=open?'var(--good)':'var(--bad)';
    btn.textContent=open?'Turn OFF':'Turn ON';btn.className='btn '+(open?'danger':'');
    btn.setAttribute('aria-label',open?'Turn business off':'Turn business on');
    if(card)card.style.borderColor=open?'#bbf7d0':'#fecaca';
  }
  async function toggleAvailability(){
    const btn=$('businessAvailabilityToggle');if(!btn)return;btn.disabled=true;btn.textContent='Updating…';
    try{const current=await api('/business/status');const d=await api('/business/status',{method:'PATCH',body:JSON.stringify({isOpen:!current.isOpen})});renderAvailability(Boolean(d.isOpen));notify(d.isOpen?'Business is now ON.':'Business is now OFF.');}
    catch(e){notify(e.message||'Unable to update business status');await loadAvailability()}
    finally{btn.disabled=false}
  }
  function notify(msg){if(typeof window.toast==='function')window.toast(msg);else alert(msg)}
  function addSection(){if($('orders'))return;const main=document.querySelector('main.main');if(!main)return;const s=document.createElement('section');s.id='orders';s.className='page';s.innerHTML='<div class="card"><div class="row" style="justify-content:space-between"><div><div class="section-title">Digital Menu Orders</div><div class="sub">Manage customer orders. Flow: Pending → Accepted → Delivered. Pending and accepted orders can be cancelled.</div></div><button class="btn secondary" id="reloadOrders" type="button">Reload</button></div><div id="orderSummary" class="grid" style="grid-template-columns:repeat(4,1fr);margin:14px 0"></div><div id="ordersList" class="list"></div></div>';main.appendChild(s);$('reloadOrders').addEventListener('click',loadOrders)}
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const money=n=>'₹'+Number(n||0).toFixed(2);
  function updateBadge(n){['ordersBadge','ordersBadgeMobile'].forEach(id=>{const e=$(id);if(e){e.textContent=n;e.style.display=n?'inline-block':'none'}})}
  function transitionsFor(status){if(status==='PENDING')return ['ACCEPTED','CANCELLED'];if(status==='ACCEPTED')return ['DELIVERED','CANCELLED'];return []}
  function buttonLabel(status){return status==='ACCEPTED'?'Accept order':status==='CANCELLED'?'Cancel order':status==='DELIVERED'?'Mark delivered':status}
  function buttonStyle(status){
    if(status==='ACCEPTED')return 'background:#16a34a;color:#fff;border:1px solid #15803d';
    if(status==='CANCELLED')return 'background:#dc2626;color:#fff;border:1px solid #b91c1c';
    if(status==='DELIVERED')return 'background:#2563eb;color:#fff;border:1px solid #1d4ed8';
    return 'background:var(--p);color:#fff';
  }
  async function loadOrders(){
    addNav();addSection();const list=$('ordersList');if(!list)return;list.innerHTML='<div class="sub">Loading orders…</div>';
    try{
      const context=await api('/business/status');window.reputeBusinessId=context.businessId;
      const orders=await api('/businesses/'+encodeURIComponent(context.businessId)+'/orders');
      const counts={PENDING:0,ACCEPTED:0,DELIVERED:0,CANCELLED:0};orders.forEach(o=>counts[o.status]=(counts[o.status]||0)+1);updateBadge(counts.PENDING);
      $('orderSummary').innerHTML='<div class="card"><div class="label">Pending</div><div class="value">'+counts.PENDING+'</div></div><div class="card"><div class="label">Accepted</div><div class="value">'+counts.ACCEPTED+'</div></div><div class="card"><div class="label">Delivered</div><div class="value">'+counts.DELIVERED+'</div></div><div class="card"><div class="label">Cancelled</div><div class="value">'+counts.CANCELLED+'</div></div>';
      if(!orders.length){list.innerHTML='<div class="sub">No orders yet. Orders from the published digital menu will appear here.</div>';return}
      list.innerHTML='';
      orders.forEach(o=>{
        const item=document.createElement('div');item.className='item';item.dataset.orderId=o.id;
        const head=document.createElement('div');head.innerHTML='<strong>'+esc(o.orderNumber)+'</strong> · <b>'+esc(o.status)+'</b><div class="sub" style="margin-top:6px">'+esc(o.customerName)+(o.customerPhone?' · '+esc(o.customerPhone):'')+'</div><div style="margin-top:10px">'+(o.items||[]).map(i=>esc(i.itemName)+' × '+Number(i.quantity||0)+' — '+money(i.lineTotal)).join('<br>')+'</div><div class="sub" style="margin-top:8px">'+new Date(o.createdAt).toLocaleString()+(o.notes?' · '+esc(o.notes):'')+'</div><div style="text-align:right;margin-top:8px"><b style="font-size:20px">'+money(o.total)+'</b><div class="sub">Pay at store</div></div>';
        item.appendChild(head);
        const actions=document.createElement('div');actions.style='display:flex;gap:8px;flex-wrap:wrap;margin-top:13px';
        transitionsFor(o.status).forEach(st=>{const btn=document.createElement('button');btn.type='button';btn.className='btn';btn.style=buttonStyle(st);btn.textContent=buttonLabel(st);btn.dataset.status=st;btn.onclick=()=>updateOrderStatus(o.id,st);actions.appendChild(btn)});
        if(!actions.children.length){const done=document.createElement('span');done.className='sub';done.textContent=o.status==='DELIVERED'?'Order delivered':'Order cancelled';actions.appendChild(done)}
        item.appendChild(actions);list.appendChild(item)
      });
    }catch(e){list.innerHTML='<div class="sub">'+esc(e.message)+'</div>'}
  }
  async function updateOrderStatus(id,status){
    if(status==='CANCELLED'&&!confirm('Cancel this order? This can be done while the order is pending or accepted.'))return;
    try{await api('/orders/'+encodeURIComponent(id)+'/status',{method:'PATCH',body:JSON.stringify({status})});await loadOrders()}catch(e){notify(e.message)}
  }
  function showOrders(){addNav();addSection();document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));$('orders').classList.add('active');document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page==='orders'));if($('heading'))$('heading').textContent='Orders';loadOrders()}
  window.showOrders=showOrders;window.updateOrderStatus=updateOrderStatus;
  function boot(){addNav();addSection();addAvailability();setTimeout(()=>loadOrders(),700);setInterval(addNav,3000);setInterval(loadAvailability,30000);setInterval(()=>{if($('orders')?.classList.contains('active'))loadOrders()},15000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
