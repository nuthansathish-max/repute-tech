import express from 'express';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash, verifyPassword } from './auth.js';
import { getAdminTwoFactor } from './admin-two-factor.js';

const prisma = new PrismaClient();
const originalGet = express.application.get;
const originalPost = express.application.post;
let installed = false;

async function currentAdmin(req, res) {
  const token = getCookie(req, 'rp_admin_session');
  if (!token) { res.status(401).json({ error: 'Admin sign-in required.' }); return null; }
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) { res.status(401).json({ error: 'Admin session expired. Sign in again.' }); return null; }
  if (session.user.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Only a Super Admin can use Dangerous Actions.' }); return null; }
  return session.user;
}
async function requireFreshSecurity(user, password) {
  if (typeof password !== 'string' || !user.passwordHash || !verifyPassword(password, user.passwordHash)) return 'Current password is incorrect.';
  const twoFactor = await getAdminTwoFactor(user.id);
  if (!twoFactor?.enabled) return 'Enable authenticator-based 2FA before requesting or approving a destructive action.';
  return null;
}
async function ensureDangerousTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminDangerousAction" (
    "id" TEXT PRIMARY KEY,
    "actionType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "rejectedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AdminDangerousAction_status_createdAt_idx" ON "AdminDangerousAction" ("status","createdAt" DESC)');
}
async function deleteBusiness(tx, businessId, actorId, business) {
  await tx.auditLog.create({data:{actorUserId:actorId,action:'ADMIN_BUSINESS_DELETED_AFTER_DUAL_APPROVAL',entity:'Business',entityId:business.id,metadata:{businessName:business.name,memberCount:business.members.length}}});
  await tx.$executeRawUnsafe('DELETE FROM "CampaignMessage" WHERE "campaignId" IN (SELECT "id" FROM "Campaign" WHERE "businessId" = $1)',businessId);
  await tx.campaign.deleteMany({where:{businessId}});
  await tx.orderItem.deleteMany({where:{order:{businessId}}});
  await tx.order.deleteMany({where:{businessId}});
  await tx.menuItem.deleteMany({where:{menu:{businessId}}});
  await tx.menu.deleteMany({where:{businessId}});
  await tx.review.deleteMany({where:{businessId}});
  await tx.reviewSyncLog.deleteMany({where:{businessId}});
  await tx.qrScan.deleteMany({where:{qr:{businessId}}});
  await tx.smartQr.deleteMany({where:{businessId}});
  await tx.customer.deleteMany({where:{businessId}});
  await tx.location.deleteMany({where:{businessId}});
  await tx.googleConnection.updateMany({where:{businessId},data:{businessId:null}});
  await tx.notification.updateMany({where:{businessId},data:{businessId:null}});
  await tx.whatsAppConnection.deleteMany({where:{businessId}});
  await tx.planRequest.deleteMany({where:{businessId}});
  await tx.subscription.deleteMany({where:{businessId}});
  await tx.businessMember.deleteMany({where:{businessId}});
  await tx.business.delete({where:{id:businessId}});
}
const page = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dangerous Actions · reputetechs.in</title><style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#f4f6fb;color:#172033;font:14px Inter,system-ui,sans-serif}.wrap{max-width:1150px;margin:auto}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.head h1{margin:0;font-size:25px}.muted{color:#667085;line-height:1.55}.card{background:white;border:1px solid #d9d1ff;border-radius:13px;padding:18px;margin-top:15px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.metric{font-size:25px;font-weight:800;margin-top:7px}.btn{border:0;border-radius:8px;padding:10px 14px;background:#5146e5;color:white;font-weight:700;cursor:pointer}.secondary{background:#eef0f6;color:#263248}.danger{background:#c93645}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}input,select{padding:10px;border:1px solid #cfd5e1;border-radius:8px;font:inherit;max-width:100%}input{width:100%}.formgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #edf0f5;font-size:13px;vertical-align:top}.pill{display:inline-block;padding:4px 8px;border-radius:99px;background:#fff1dc;color:#96510a;font-weight:700;font-size:11px}.error{color:#b42318}.success{color:#087b59}.tablewrap{overflow:auto}.notice{background:#fff6ed;border:1px solid #fed7aa;border-radius:9px;padding:12px;color:#9a3412}@media(max-width:600px){body{padding:12px}}</style></head><body><main class="wrap">
<div class="head"><div><h1>⚠ Dangerous Actions</h1><p class="muted">High-impact operations are restricted to Super Admins, require authenticator 2FA and a second, independent Super Admin approval.</p></div><button class="btn secondary" onclick="location.href='/admin-panel'">← Admin dashboard</button></div>
<div class="grid"><div class="card"><div class="muted">Access control</div><div class="metric">Super Admin only</div><p class="muted">Fresh password + enrolled 2FA</p></div><div class="card"><div class="muted">Irreversible deletion</div><div class="metric">Dual approval</div><p class="muted">Requester cannot approve own request</p></div><div class="card"><div class="muted">Request expiry</div><div class="metric">24 hours</div><p class="muted">Expired requests cannot be approved</p></div></div>
<section class="card"><h2 style="margin:0 0 8px;font-size:18px">Request permanent business deletion</h2><div class="notice">Permanent deletion removes business records and related operational data. It is not reversible from this dashboard. Confirm an independent backup exists before requesting deletion. No backup is assumed or represented as verified here.</div><p class="muted">Requesting and approving admins must be different Super Admin accounts. Both must have authenticator 2FA enabled and re-enter their current password.</p>
<div class="formgrid"><div><label>Business</label><select id="business"><option value="">Loading businesses…</option></select></div><div><label>Reason (required)</label><input id="reason" maxlength="500" placeholder="Explain why deletion is necessary"></div><div><label>Your current password</label><input id="password" type="password" autocomplete="current-password"></div><div><label>Type REQUEST BUSINESS DELETION</label><input id="phrase" placeholder="REQUEST BUSINESS DELETION"></div></div><div class="row" style="margin-top:12px"><button class="btn danger" id="request">Submit deletion request</button><button class="btn secondary" id="refresh">Refresh</button></div><div id="message" class="muted" style="margin-top:10px"></div></section>
<section class="card"><h2 style="margin:0 0 8px;font-size:18px">Approval queue & action history</h2><p class="muted">A second Super Admin may approve or reject pending requests. Approval executes the deletion transaction immediately.</p><div class="tablewrap"><table><thead><tr><th>Action / business</th><th>Requester / reason</th><th>Status / expiry</th><th>Approval controls</th></tr></thead><tbody id="items"><tr><td colspan="4">Loading…</td></tr></tbody></table></div></section>
<section class="card"><h2 style="margin:0 0 8px;font-size:18px">Emergency controls & recovery readiness</h2><p class="muted">Global kill switches, maintenance locks, database restore and credential rotation are intentionally not exposed as one-click actions. Each needs a separately tested scope, rollback path and incident runbook before activation.</p><p class="muted">Backup status: <b>Not verified by this dashboard</b>. Recovery status: <b>Not verified</b>. No simulated status is displayed.</p></section>
</main><script>
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body){const r=await fetch(url,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function load(){try{const d=await api('/api/admin/dangerous-actions');$('business').innerHTML='<option value="">Select a business</option>'+d.businesses.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');$('items').innerHTML=d.actions.map(a=>'<tr><td><b>'+esc(a.actionType)+'</b><br>'+esc(a.entityLabel)+'</td><td>'+esc(a.requesterName||a.requestedByUserId)+'<br>'+esc(a.reason)+'</td><td><span class="pill">'+esc(a.status)+'</span><br>'+new Date(a.expiresAt).toLocaleString()+'</td><td>'+(a.status==='PENDING'&&a.requestedByUserId!==d.currentUserId?'<div class="formgrid"><input id="pw-'+esc(a.id)+'" type="password" placeholder="Your password"><input id="ph-'+esc(a.id)+'" placeholder="Type APPROVE DELETE"></div><div class="row" style="margin-top:6px"><button class="btn danger" onclick="act(\''+esc(a.id)+'\',\'approve\')">Approve & execute</button><button class="btn secondary" onclick="act(\''+esc(a.id)+'\',\'reject\')">Reject</button></div>':a.status==='PENDING'?'Waiting for another Super Admin':esc(a.approvedByName?'Approved by '+a.approvedByName:a.rejectedByName?'Rejected by '+a.rejectedByName:''))+'</td></tr>').join('')||'<tr><td colspan="4">No dangerous-action requests recorded.</td></tr>'}catch(e){$('message').textContent=e.message;$('message').className='error'}}
window.act=async(id,kind)=>{try{const password=$('pw-'+id)?.value||'',phrase=$('ph-'+id)?.value||'';if(kind==='reject'&&!confirm('Reject this request?'))return;await api('/api/admin/dangerous-actions/'+id+'/'+kind,{password,phrase});$('message').textContent=kind==='approve'?'Approved. The action was executed.':'Request rejected.';$('message').className='success';await load()}catch(e){$('message').textContent=e.message;$('message').className='error'}};
$('request').onclick=async()=>{try{const businessId=$('business').value;if(!businessId)throw new Error('Select a business.');await api('/api/admin/dangerous-actions/request',{businessId,reason:$('reason').value,password:$('password').value,phrase:$('phrase').value});$('message').textContent='Request submitted. A different Super Admin must approve it within 24 hours.';$('message').className='success';$('password').value='';$('phrase').value='';$('reason').value='';await load()}catch(e){$('message').textContent=e.message;$('message').className='error'}};
$('refresh').onclick=load;load();
</script></body></html>`;

function install(app) {
 if(installed)return; installed=true;
 originalGet.call(app,'/admin-dangerous-actions',async(req,res,next)=>{try{const user=await currentAdmin(req,res);if(!user)return;res.set('Cache-Control','no-store');res.type('html').send(page())}catch(e){next(e)}});
 originalGet.call(app,'/api/admin/dangerous-actions',async(req,res,next)=>{try{const user=await currentAdmin(req,res);if(!user)return;await ensureDangerousTable();const businesses=await prisma.business.findMany({select:{id:true,name:true},orderBy:{name:'asc'}});const rows=await prisma.$queryRawUnsafe(`SELECT a.*,u."name" AS "requesterName",ap."name" AS "approvedByName",rj."name" AS "rejectedByName" FROM "AdminDangerousAction" a LEFT JOIN "User" u ON u."id"=a."requestedByUserId" LEFT JOIN "User" ap ON ap."id"=a."approvedByUserId" LEFT JOIN "User" rj ON rj."id"=a."rejectedByUserId" ORDER BY a."createdAt" DESC LIMIT 100`);res.set('Cache-Control','no-store');res.json({currentUserId:user.id,businesses,actions:rows})}catch(e){next(e)}});
 originalPost.call(app,'/api/admin/dangerous-actions/request',async(req,res,next)=>{try{const user=await currentAdmin(req,res);if(!user)return;await ensureDangerousTable();const error=await requireFreshSecurity(user,req.body?.password);if(error)return res.status(401).json({error});if(req.body?.phrase!=='REQUEST BUSINESS DELETION')return res.status(400).json({error:'Type REQUEST BUSINESS DELETION exactly.'});const reason=String(req.body?.reason||'').trim();if(reason.length<10||reason.length>500)return res.status(400).json({error:'Provide a reason between 10 and 500 characters.'});const business=await prisma.business.findUnique({where:{id:String(req.body?.businessId||'')},select:{id:true,name:true}});if(!business)return res.status(404).json({error:'Business not found.'});const id=crypto.randomUUID();await prisma.$executeRawUnsafe('INSERT INTO "AdminDangerousAction" ("id","actionType","entityId","entityLabel","reason","requestedByUserId","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',id,'DELETE_BUSINESS',business.id,business.name,reason,user.id,new Date(Date.now()+24*60*60*1000));await prisma.auditLog.create({data:{actorUserId:user.id,action:'DANGEROUS_ACTION_REQUESTED',entity:'Business',entityId:business.id,metadata:{requestId:id,reason}}});res.status(201).json({ok:true,id})}catch(e){next(e)}});
 originalPost.call(app,'/api/admin/dangerous-actions/:id/reject',async(req,res,next)=>{try{const user=await currentAdmin(req,res);if(!user)return;const error=await requireFreshSecurity(user,req.body?.password);if(error)return res.status(401).json({error});const result=await prisma.$executeRawUnsafe('UPDATE "AdminDangerousAction" SET "status"=\'REJECTED\',"rejectedByUserId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\' AND "requestedByUserId"<>$2 AND "expiresAt">CURRENT_TIMESTAMP',req.params.id,user.id);if(!result)return res.status(409).json({error:'Request is no longer pending, has expired, or you are the requester.'});await prisma.auditLog.create({data:{actorUserId:user.id,action:'DANGEROUS_ACTION_REJECTED',entity:'AdminDangerousAction',entityId:req.params.id}});res.json({ok:true})}catch(e){next(e)}});
 originalPost.call(app,'/api/admin/dangerous-actions/:id/approve',async(req,res,next)=>{try{const user=await currentAdmin(req,res);if(!user)return;const error=await requireFreshSecurity(user,req.body?.password);if(error)return res.status(401).json({error});if(req.body?.phrase!=='APPROVE DELETE')return res.status(400).json({error:'Type APPROVE DELETE exactly.'});const rows=await prisma.$queryRawUnsafe('UPDATE "AdminDangerousAction" SET "status"=\'EXECUTING\',"approvedByUserId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'PENDING\' AND "requestedByUserId"<>$2 AND "expiresAt">CURRENT_TIMESTAMP RETURNING *',req.params.id,user.id);const action=rows?.[0];if(!action)return res.status(409).json({error:'Request is no longer pending, has expired, or you are the requester.'});try{await prisma.$transaction(async tx=>{const business=await tx.business.findUnique({where:{id:action.entityId},include:{members:true}});if(!business)throw new Error('Business no longer exists.');await deleteBusiness(tx,action.entityId,user.id,business);await tx.$executeRawUnsafe('UPDATE "AdminDangerousAction" SET "status"=\'EXECUTED\',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'EXECUTING\'',action.id);await tx.auditLog.create({data:{actorUserId:user.id,action:'DANGEROUS_ACTION_APPROVED_AND_EXECUTED',entity:'AdminDangerousAction',entityId:action.id,metadata:{businessId:action.entityId,businessName:action.entityLabel,requestedBy:action.requestedByUserId}}})});res.json({ok:true})}catch(ex){await prisma.$executeRawUnsafe('UPDATE "AdminDangerousAction" SET "status"=\'FAILED\',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"=\'EXECUTING\'',action.id);throw ex}}catch(e){next(e)}});
}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
