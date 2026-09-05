(()=>{
  const style=document.createElement('style');
  style.textContent=`#rtNotifBtn{position:relative;min-width:42px;padding:10px 12px;font-size:18px}#rtNotifBadge{position:absolute;top:4px;right:4px;min-width:17px;height:17px;padding:0 4px;border-radius:99px;background:#dc2626;color:#fff;font-size:10px;line-height:17px;font-weight:800;text-align:center;display:none}.rtNotifPanel{position:fixed;right:20px;top:74px;width:min(390px,calc(100vw - 28px));max-height:min(560px,calc(100vh - 96px));background:#fff;border:1px solid #e6e8ef;border-radius:16px;box-shadow:0 20px 55px rgba(16,24,40,.18);z-index:10001;display:none;overflow:hidden}.rtNotifHead{display:flex;align-items:center;justify-content:space-between;padding:15px 16px;border-bottom:1px solid #eef0f4}.rtNotifTitle{font-weight:800}.rtNotifActions{display:flex;gap:6px}.rtNotifActions button{border:0;background:#f2f4f7;color:#475467;border-radius:8px;padding:7px 9px;font-size:11px;cursor:pointer}.rtNotifList{overflow:auto;max-height:470px}.rtNotifItem{display:flex;gap:11px;padding:13px 15px;border-bottom:1px solid #f0f1f5;cursor:pointer}.rtNotifItem:hover{background:#fafbff}.rtNotifItem.unread{background:#f7f7ff}.rtNotifIcon{width:34px;height:34px;border-radius:10px;background:#eef2ff;color:#5146e5;display:grid;place-items:center;flex:0 0 34px;font-size:15px}.rtNotifBody{min-width:0}.rtNotifItemTitle{font-size:13px;font-weight:750;margin-bottom:3px}.rtNotifMsg{font-size:12px;color:#667085;line-height:1.4}.rtNotifTime{font-size:10px;color:#98a2b3;margin-top:5px}.rtNotifEmpty{padding:38px 20px;text-align:center;color:#667085;font-size:13px}@media(max-width:700px){.rtNotifPanel{right:10px;top:62px;width:calc(100vw - 20px)}}`;
  document.head.appendChild(style);

  const topRow=document.querySelector('.top .row');
  if(!topRow)return;
  const btn=document.createElement('button');btn.id='rtNotifBtn';btn.className='btn secondary';btn.title='Notifications';btn.setAttribute('aria-label','Notifications');btn.innerHTML='🔔<span id="rtNotifBadge">0</span>';
  topRow.insertBefore(btn,topRow.firstChild);
  const panel=document.createElement('div');panel.className='rtNotifPanel';panel.innerHTML='<div class="rtNotifHead"><div class="rtNotifTitle">Notifications</div><div class="rtNotifActions"><button id="rtNotifReadAll">Mark all read</button><button id="rtNotifClose">Close</button></div></div><div id="rtNotifList" class="rtNotifList"></div>';
  document.body.appendChild(panel);
  const badge=document.getElementById('rtNotifBadge'),list=document.getElementById('rtNotifList');
  const icon=t=>({ORDER_NEW:'🛒',ORDER_ACCEPTED:'✅',ORDER_DELIVERED:'🍽️',ORDER_CANCELLED:'❌',REVIEW:'⭐',PLAN:'💳',SYSTEM:'⚙️',TEST:'🔔'}[t]||'🔔');
  const ago=d=>{const s=Math.max(0,Math.floor((Date.now()-new Date(d).getTime())/1000));if(s<60)return `${s}s ago`;const m=Math.floor(s/60);if(m<60)return `${m}m ago`;const h=Math.floor(m/60);if(h<24)return `${h}h ago`;return `${Math.floor(h/24)}d ago`};
  async function load(){
    try{const r=await fetch('/api/notifications?limit=30',{cache:'no-store'});if(!r.ok)return;const data=await r.json();badge.textContent=data.unread>99?'99+':String(data.unread);badge.style.display=data.unread?'block':'none';
      list.innerHTML=data.notifications?.length?data.notifications.map(n=>`<div class="rtNotifItem ${n.readAt?'':'unread'}" data-id="${String(n.id).replace(/[^a-zA-Z0-9_-]/g,'')}"><div class="rtNotifIcon">${icon(n.type)}</div><div class="rtNotifBody"><div class="rtNotifItemTitle">${esc(n.title)}</div><div class="rtNotifMsg">${esc(n.message)}</div><div class="rtNotifTime">${ago(n.createdAt)}</div></div></div>`).join(''):'<div class="rtNotifEmpty">You’re all caught up 🎉</div>';
      list.querySelectorAll('.rtNotifItem.unread').forEach(x=>x.addEventListener('click',async()=>{await fetch('/api/notifications/'+encodeURIComponent(x.dataset.id)+'/read',{method:'PATCH'});load()}));
    }catch{}
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  btn.onclick=()=>{panel.style.display=panel.style.display==='block'?'none':'block';if(panel.style.display==='block')load()};
  document.getElementById('rtNotifClose').onclick=()=>panel.style.display='none';
  document.getElementById('rtNotifReadAll').onclick=async()=>{await fetch('/api/notifications/read-all',{method:'PATCH'});load()};
  document.addEventListener('click',e=>{if(panel.style.display==='block'&&!panel.contains(e.target)&&!btn.contains(e.target))panel.style.display='none'});
  load();setInterval(load,10000);
})();
