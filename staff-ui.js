(function(){
async function staffApi(path,opts={}){const r=await fetch('/api'+path,{credentials:'include',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function loadStaff(){if(!window.businessId)return;const list=document.getElementById('staffList');if(!list)return;try{const rows=await staffApi('/businesses/'+encodeURIComponent(window.businessId)+'/staff');list.innerHTML=rows.map(x=>'<div class="item"><b>'+esc(x.name)+'</b><div class="sub">'+esc(x.email)+' · '+esc(x.role)+'</div><div class="row" style="margin-top:8px"><button class="btn secondary" onclick="changeStaff(\''+x.id+'\',\''+x.role+'\')">Change role</button><button class="btn secondary" onclick="removeStaff(\''+x.id+'\')">Remove</button></div></div>').join('')||'<div class="sub">No staff members yet.</div>'}catch(e){list.innerHTML='<div class="notice">'+esc(e.message)+'</div>'}}
let lastStaffEmail='';
window.addStaff=async function(){
 const msg=document.getElementById('staffMsg'),form=document.getElementById('staffForm'),button=document.getElementById('staffAddButton');
 msg.textContent='';
 const data=new FormData(form);
 const email=String(data.get('email')||'').trim();
 const role=String(data.get('role')||'STAFF').toUpperCase();
 if(!email){msg.textContent='Enter the staff member email';document.getElementById('staffEmail').focus();return}
 button.disabled=true;
 try{
  await staffApi('/businesses/'+encodeURIComponent(window.businessId)+'/staff',{method:'POST',body:JSON.stringify({email,role})});
  msg.textContent='Staff member added.';
  form.reset();
  await loadStaff();
 }catch(e){msg.textContent=e.message}
 finally{button.disabled=false}
};
function bindStaffAdd(){
 const form=document.getElementById('staffForm');
 if(form&&!form.dataset.bound){
  form.dataset.bound='1';
  form.addEventListener('submit',e=>{e.preventDefault();window.addStaff()});
 }
}
window.changeStaff=async function(id,current){const role=prompt('Enter MANAGER or STAFF',current);if(!role)return;try{await staffApi('/businesses/'+encodeURIComponent(window.businessId)+'/staff/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({role})});await loadStaff()}catch(e){alert(e.message)}};
window.removeStaff=async function(id){if(!confirm('Remove this staff member from this business?'))return;try{await staffApi('/businesses/'+encodeURIComponent(window.businessId)+'/staff/'+encodeURIComponent(id),{method:'DELETE'});await loadStaff()}catch(e){alert(e.message)}};
window.loadStaff=loadStaff;
function bindStaffAdd(){const b=document.getElementById('staffAddButton');if(b&&!b.dataset.bound){b.dataset.bound='1';b.addEventListener('click',()=>window.addStaff())}const p=document.getElementById('staffEmail');if(p&&!p.dataset.bound){p.dataset.bound='1';const remember=()=>{if(p.value.trim())lastStaffEmail=p.value.trim();const m=document.getElementById('staffMsg');if(m)m.textContent=''};p.addEventListener('input',remember);p.addEventListener('change',remember);p.addEventListener('keyup',remember);p.addEventListener('blur',remember);p.addEventListener('focus',()=>{if(p.value.trim())lastStaffEmail=p.value.trim()})}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindStaffAdd);else bindStaffAdd();
document.addEventListener('DOMContentLoaded',()=>{const b=document.querySelector('[data-page="staff"]');if(b)b.addEventListener('click',()=>setTimeout(()=>{bindStaffAdd();loadStaff()},50))});
})();