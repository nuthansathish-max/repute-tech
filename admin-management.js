import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash, hashPassword } from './auth.js';
import { deflateRawSync } from 'node:zlib';
import crypto from 'node:crypto';

const prisma=new PrismaClient();
const originalGet=express.application.get;
const originalPost=express.application.post;
let installed=false;
const ADMIN_FEATURE_KEYS=['GOOGLE','WHATSAPP','AI','REVIEWS','ORDERS','MENU','QR','BILLING'];
// Do not block module loading on a database schema check. The admin routes must
// register even if the database is temporarily slow/unavailable during startup.
function ensureAdminFeatureColumn(){
  return prisma.$executeRawUnsafe('ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "adminFeatureFlags" JSONB')
    .catch(e=>console.error('Admin feature-control column check failed:',e?.message||e));
}
setTimeout(()=>{ ensureAdminFeatureColumn().catch(()=>{}); },1000);

function ensureCustomPlanRequestColumns(){
  return Promise.all([
    prisma.$executeRawUnsafe('ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT FALSE'),
    prisma.$executeRawUnsafe('ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "customDetails" TEXT')
  ]).catch(e=>console.error('Custom plan request column check failed:',e?.message||e));
}
setTimeout(()=>{ ensureCustomPlanRequestColumns().catch(()=>{}); },1000);

async function ensureWebhookTables(){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminWebhookEndpoint"("id" TEXT PRIMARY KEY,"url" TEXT NOT NULL,"secret" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT true,"lastEventAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminWebhookDelivery"("id" TEXT PRIMARY KEY,"endpointId" TEXT NOT NULL,"auditId" TEXT NOT NULL,"eventType" TEXT NOT NULL,"payload" JSONB NOT NULL,"status" TEXT NOT NULL DEFAULT 'PENDING',"attempts" INTEGER NOT NULL DEFAULT 0,"responseCode" INTEGER,"error" TEXT,"nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"deliveredAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("endpointId","auditId"))`);
}
function webhookId(){return crypto.randomUUID()}
function webhookSignature(secret,body){return 'sha256='+crypto.createHmac('sha256',secret).update(body).digest('hex')}
async function webhookRequest(url,secret,payload){
 const body=JSON.stringify(payload),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-repute-webhook-signature':webhookSignature(secret,body),'x-repute-webhook-event':String(payload.event||'EVENT')},body,signal:controller.signal});const text=await response.text().catch(()=> '');return {ok:response.ok,status:response.status,error:response.ok?null:(text||('HTTP '+response.status)).slice(0,500)}}catch(e){return {ok:false,status:null,error:String(e?.message||e).slice(0,500)}}finally{clearTimeout(timer)}
}
async function webhookWorker(){
 try{
  await ensureWebhookTables();
  const endpoints=await prisma.$queryRawUnsafe(`SELECT "id","url","secret","enabled","lastEventAt" FROM "AdminWebhookEndpoint" WHERE "enabled"=true`);
  for(const ep of endpoints){
   const since=ep.lastEventAt||new Date();
   const logs=await prisma.auditLog.findMany({where:{createdAt:{gt:since}},orderBy:{createdAt:'asc'},take:50});
   let cursor=since;
   for(const log of logs){
    cursor=log.createdAt;
    const payload={event:log.action,version:1,id:log.id,occurredAt:log.createdAt.toISOString(),entity:log.entity,entityId:log.entityId||null,actorUserId:log.actorUserId||null,metadata:log.metadata||{}};
    await prisma.$executeRawUnsafe(`INSERT INTO "AdminWebhookDelivery"("id","endpointId","auditId","eventType","payload") VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT ("endpointId","auditId") DO NOTHING`,webhookId(),ep.id,log.id,log.action,JSON.stringify(payload));
   }
   if(logs.length)await prisma.$executeRawUnsafe(`UPDATE "AdminWebhookEndpoint" SET "lastEventAt"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2`,cursor,ep.id);
  }
  const pending=await prisma.$queryRawUnsafe(`SELECT d.*,e."url",e."secret" FROM "AdminWebhookDelivery" d JOIN "AdminWebhookEndpoint" e ON e."id"=d."endpointId" WHERE e."enabled"=true AND d."status" IN ('PENDING','FAILED') AND d."nextAttemptAt"<=CURRENT_TIMESTAMP ORDER BY d."createdAt" ASC LIMIT 20`);
  for(const d of pending){
   const result=await webhookRequest(d.url,d.secret,d.payload),attempts=Number(d.attempts||0)+1;
   if(result.ok)await prisma.$executeRawUnsafe(`UPDATE "AdminWebhookDelivery" SET "status"='DELIVERED',"attempts"=$1,"responseCode"=$2,"error"=NULL,"deliveredAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`,attempts,result.status,d.id);
   else {const delay=Math.min(3600,Math.pow(2,Math.min(attempts,10))*10);await prisma.$executeRawUnsafe(`UPDATE "AdminWebhookDelivery" SET "status"='FAILED',"attempts"=$1,"responseCode"=$2,"error"=$3,"nextAttemptAt"=CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`,attempts,result.status,result.error,delay,d.id)}
  }
 }catch(e){console.error('Webhook worker error:',e?.message||e)}
}
setTimeout(()=>{webhookWorker().catch(()=>{});setInterval(()=>webhookWorker().catch(()=>{}),10000)},5000);


function crc32(buf){
  let crc=0xffffffff;
  for(const byte of buf){
    crc^=byte;
    for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function dosDateTime(d=new Date()){
  const year=Math.max(1980,d.getFullYear());
  return {time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2),date:((year-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};
}
function makeZip(files){
  const chunks=[],central=[];let offset=0;const now=dosDateTime();
  for(const file of files){
    const name=Buffer.from(file.name,'utf8');
    const raw=Buffer.from(file.content,'utf8');
    const deflated=deflateRawSync(raw);
    const useDeflated=deflated.length<raw.length;
    const data=useDeflated?deflated:raw,method=useDeflated?8:0,crc=crc32(raw);
    const local=Buffer.alloc(30+name.length);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(method,8);
    local.writeUInt16LE(now.time,10);local.writeUInt16LE(now.date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);
    local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);name.copy(local,30);chunks.push(local,data);
    const cen=Buffer.alloc(46+name.length);
    cen.writeUInt32LE(0x02014b50,0);cen.writeUInt16LE(20,4);cen.writeUInt16LE(20,6);cen.writeUInt16LE(0,8);cen.writeUInt16LE(method,10);
    cen.writeUInt16LE(now.time,12);cen.writeUInt16LE(now.date,14);cen.writeUInt32LE(crc,16);cen.writeUInt32LE(data.length,20);cen.writeUInt32LE(raw.length,24);
    cen.writeUInt16LE(name.length,28);cen.writeUInt16LE(0,30);cen.writeUInt16LE(0,32);cen.writeUInt16LE(0,34);cen.writeUInt16LE(0,36);cen.writeUInt32LE(0,38);cen.writeUInt32LE(offset,42);name.copy(cen,46);
    central.push(cen);offset+=local.length+data.length;
  }
  const centralData=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralData.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
  return Buffer.concat([...chunks,centralData,end]);
}
function exportJson(value){return JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,null,2);}
function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function xlsxCell(v){
  if(v===null||v===undefined)return '<c t="inlineStr"><is><t></t></is></c>';
  if(typeof v==='number'&&Number.isFinite(v))return '<c><v>'+v+'</v></c>';
  if(typeof v==='boolean')return '<c t="b"><v>'+(v?1:0)+'</v></c>';
  return '<c t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(String(v))+'</t></is></c>';
}
function xlsxColumn(n){
  let s='';
  while(n>=0){s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1}
  return s;
}
function xlsxSheet(rows){
  const safe=rows.length?rows:[['No data']];
  const body=safe.map((row,r)=>{
    const cells=row.map((v,i)=>'<c r="'+xlsxColumn(i)+(r+1)+'"'+xlsxCell(v).slice(2));
    return '<row r="'+(r+1)+'">'+cells.join('')+'</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+body+'</sheetData></worksheet>';
}
function makeXlsx(sheets){
  const files=[];
  const sheetEntries=sheets.map((s,i)=>({name:s.name,rows:s.rows,index:i+1}));
  const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheetEntries.map(s=>'<sheet name="'+xmlEsc(s.name.slice(0,31))+'" sheetId="'+s.index+'" r:id="rId'+s.index+'"/>').join('')+'</sheets></workbook>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheetEntries.map(s=>'<Relationship Id="rId'+s.index+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+s.index+'.xml"/>').join('')+'</Relationships>';
  const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheetEntries.map(s=>'<Override PartName="/xl/worksheets/sheet'+s.index+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
  files.push({name:'[Content_Types].xml',content:types},{name:'_rels/.rels',content:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},{name:'xl/workbook.xml',content:workbook},{name:'xl/_rels/workbook.xml.rels',content:rels});
  for(const s of sheetEntries)files.push({name:'xl/worksheets/sheet'+s.index+'.xml',content:xlsxSheet(s.rows)});
  return makeZip(files);
}
function tableRows(headers,items,fields){return [headers,...items.map(item=>fields.map(field=>{const v=typeof field==='function'?field(item):item?.[field];if(v instanceof Date)return v.toISOString();return v}))]}


async function readAdminJsonBody(req){
  if(req.body && typeof req.body==='object')return req.body;
  return await new Promise(resolve=>{
    let raw='';
    req.on('data',chunk=>{raw+=chunk});
    req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{})}catch{resolve({})}});
    req.on('error',()=>resolve({}));
  });
}
async function sessionUser(req){
  const token=getCookie(req,'rp_admin_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}
async function requireAdmin(req,res){
  const user=await sessionUser(req);
  if(!user)return null;
  if(!['ADMIN','SUPER_ADMIN'].includes(user.role)){res.status(403).json({error:'Admin access required'});return null;}
  return user;
}
function adminPage(){
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>reputetechs.in · SaaS Owner Console</title>
 <link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
 <style>
 :root{--nav:#0b1220;--nav2:#111b2e;--primary:#4f46e5;--primary2:#7c3aed;--bg:#f4f7fb;--card:#fff;--line:#e4e9f2;--muted:#6b778c;--ink:#172033;--good:#08a57a;--warn:#e6a11a;--bad:#e0525b;--cyan:#16a6c9;--btn-ink:#172033;--btn-soft:#f8fafc;--btn-border:#dfe5ee}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px Inter,system-ui,sans-serif}.app{min-height:100vh}.side{position:fixed;left:0;top:0;bottom:0;width:224px;background:var(--nav);color:#aeb9ca;padding:12px 10px;overflow:auto;z-index:20}.brand{font-weight:800;color:#fff;font-size:17px;padding:10px 10px 5px}.brand span{color:#7c83ff}.role{font-size:9px;color:#a7b2ff;letter-spacing:.13em;margin:2px 10px 15px}.group{font-size:9px;text-transform:uppercase;color:#6f7d93;letter-spacing:.1em;padding:10px 9px 5px;font-weight:800}.nav{display:flex;align-items:center;gap:9px;width:100%;border:0;background:transparent;color:#b9c3d4;text-align:left;padding:8px 9px;border-radius:7px;cursor:pointer;font:600 11px Inter}.nav:hover{background:#17233a;color:#fff}.nav.active{background:#5146e5;color:#fff;box-shadow:0 5px 18px #5146e540}.nav .ico{width:16px;text-align:center;opacity:.95}.nav .badge{margin-left:auto;font-size:8px;padding:3px 5px;border-radius:5px;background:#1b2a43;color:#aab8cc}.main{margin-left:224px;min-height:100vh}.top{height:62px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 22px;position:sticky;top:0;z-index:10}.crumb{font-size:11px;color:var(--muted)}.top-actions{display:flex;align-items:center;gap:8px}.search{width:260px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#f8fafc;font:12px Inter}.topbtn{height:38px;padding:0 14px;border:1px solid var(--btn-border);background:linear-gradient(180deg,#fff 0%,#f8fafc 100%);color:var(--btn-ink);border-radius:10px;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;box-shadow:0 1px 2px #0f172a0a,0 3px 10px #0f172a08;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease,background .16s ease}.topbtn:hover{transform:translateY(-1px);border-color:#cbd5e1;background:#fff;box-shadow:0 4px 14px #0f172a12}.topbtn:active{transform:translateY(0);box-shadow:0 1px 4px #0f172a10}.topbtn:focus-visible,.smallbtn:focus-visible,.admin-approve:focus-visible,.admin-reject:focus-visible,.admin-feature-toggle:focus-visible,.nav:focus-visible{outline:3px solid #4f46e533;outline-offset:2px}.primary{background:linear-gradient(135deg,var(--primary),var(--primary2));color:#fff;border-color:transparent;box-shadow:0 5px 16px #4f46e52e}.primary:hover{background:linear-gradient(135deg,#4338ca,#6d28d9);border-color:transparent;box-shadow:0 7px 20px #4f46e53d}.content{padding:18px 22px 34px;max-width:1500px}.page-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;margin-bottom:16px}.page-head h1{font-size:23px;margin:0 0 4px}.page-head p{margin:0;color:var(--muted);font-size:12px}.live{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:999px;background:#eafaf5;color:#078663;font-size:10px;font-weight:800}.dot{width:6px;height:6px;border-radius:50%;background:var(--good)}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;box-shadow:0 1px 2px #0f172a08}.metric-card{min-height:92px;position:relative}.metric-card.clickable{cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.metric-card.clickable:hover{transform:translateY(-1px);border-color:#cbd5e1;box-shadow:0 5px 14px #0f172a12}.label{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#7b879a;font-weight:800}.metric{font-size:24px;font-weight:800;margin-top:7px;letter-spacing:-.03em}.sub{font-size:10px;color:var(--muted);margin-top:5px}.accent{position:absolute;right:12px;top:12px;font-size:18px}.section{margin-top:14px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:0 0 9px}.section-title h2{font-size:15px;margin:0}.section-title span{font-size:10px;color:var(--muted)}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.input,.select{padding:9px 10px;border:1px solid var(--line);border-radius:7px;background:#fff;font:11px Inter}.input{flex:1;min-width:200px}.table{overflow:auto}.row{display:grid;grid-template-columns:1.8fr 1fr 1fr 1fr 82px;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--line);min-width:700px}.row.head{background:#f8fafc;color:#7a8698;font-size:9px;text-transform:uppercase;font-weight:800}.name{font-weight:800;font-size:11px}.pill{display:inline-block;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:800;background:#eef2ff;color:#4c46b7}.pill.good{background:#eafaf5;color:#087e61}.pill.warn{background:#fff7df;color:#a66b00}.pill.bad{background:#fff0f1;color:#b53b46}.smallbtn{height:32px;padding:0 11px;border:1px solid var(--btn-border);background:var(--btn-soft);color:#344054;border-radius:9px;font:700 10px Inter,system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease,background .16s ease}.smallbtn:hover{transform:translateY(-1px);border-color:#cbd5e1;background:#fff;box-shadow:0 4px 12px #0f172a12}.smallbtn:active{transform:translateY(0);box-shadow:none}.smallbtn:disabled{opacity:.55;cursor:wait;transform:none;box-shadow:none}.admin-feature-toggle{position:relative;min-width:88px;height:34px;padding:0 12px;border:1px solid transparent;border-radius:999px;font:800 10px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;text-align:center;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease,border-color .18s ease}.admin-feature-toggle:before{content:'';position:absolute;left:6px;top:6px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 2px 5px #0f172a30;transition:transform .18s ease}.admin-feature-toggle.on{background:#0f9f78;border-color:#0f9f78;color:#fff;box-shadow:0 4px 12px #0f9f7826}.admin-feature-toggle.on:before{transform:translateX(56px)}.admin-feature-toggle.off{background:#dc2626;border-color:#dc2626;color:#fff;box-shadow:0 4px 12px #dc262626}.admin-feature-toggle.off:before{transform:translateX(0)}.admin-feature-toggle:hover{transform:translateY(-1px);box-shadow:0 5px 13px #0f172a18}.admin-feature-toggle:active{transform:translateY(0)}.admin-feature-toggle:disabled{transform:none;opacity:.65}.admin-download-data,.admin-close-business{height:42px;padding:0 15px;border-radius:11px;font:800 11px Inter,system-ui,sans-serif;letter-spacing:.01em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:9px;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease,background .18s ease;white-space:nowrap}.admin-download-data{border:1px solid #4f46e5!important;background:linear-gradient(135deg,#6366f1,#4f46e5)!important;color:#fff!important;opacity:1!important;filter:none!important;box-shadow:0 7px 18px rgba(79,70,229,.34)!important}.admin-download-data:hover{background:linear-gradient(135deg,#4338ca,#3730a3);border-color:#3730a3;transform:translateY(-1px);box-shadow:0 9px 21px rgba(79,70,229,.30)}.admin-download-data:active{transform:translateY(0);box-shadow:0 3px 8px rgba(79,70,229,.20)}.admin-download-data:disabled{opacity:1;cursor:wait;transform:none}.admin-close-business{border:1px solid #fecaca;background:#fff7f7;color:#b42318;box-shadow:0 4px 12px rgba(180,35,24,.08)}
.admin-close-business:hover{background:#feecec;border-color:#fca5a5;color:#991b1b;transform:translateY(-1px);box-shadow:0 8px 18px rgba(180,35,24,.13)}
.admin-close-business:active{transform:translateY(0);box-shadow:0 3px 8px rgba(180,35,24,.08)}
.btn-icon{width:18px;height:18px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:1;font-weight:900}
.admin-download-data .btn-icon{background:rgba(255,255,255,.15)}
.admin-close-business .btn-icon{font-size:18px;background:#fee2e2;color:#b42318} .admin-paid{height:36px;padding:0 12px;border:1px solid #0f9f78;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border-radius:9px;font:800 10px Inter,system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 4px 12px rgba(16,185,129,.22);transition:transform .16s ease,box-shadow .16s ease,background .16s ease,border-color .16s ease}.admin-paid:hover{background:linear-gradient(135deg,#059669,#047857);border-color:#047857;transform:translateY(-1px);box-shadow:0 7px 16px rgba(16,185,129,.28)}.admin-paid:active{transform:translateY(0);box-shadow:0 2px 7px rgba(16,185,129,.18)}.admin-paid:disabled{opacity:.65;cursor:wait;transform:none}.admin-paid .btn-icon{width:17px;height:17px;background:rgba(255,255,255,.16);border-radius:50%;font-size:10px}
.admin-delete-business{height:34px;padding:0 14px;border:1px solid #ef4444;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border-radius:9px;font:800 10px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 12px #dc26262b}.admin-delete-business:hover{background:linear-gradient(135deg,#b91c1c,#991b1b);transform:translateY(-1px);box-shadow:0 7px 16px #dc26263d}.admin-delete-business:disabled{opacity:.6;cursor:wait}.admin-approve,.admin-reject{height:34px;border-radius:9px;padding:0 13px;font:800 10px Inter,system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,background .16s ease,border-color .16s ease}.admin-approve{background:linear-gradient(135deg,#0f9f78,#0b8f6d);color:#fff;border:1px solid #0f9f78;box-shadow:0 4px 12px #0f9f7826}.admin-approve:hover{background:linear-gradient(135deg,#0b8f6d,#08775c);border-color:#08775c;transform:translateY(-1px);box-shadow:0 7px 16px #0f9f7833}.admin-reject{background:#fff7f7;color:#b42318;border:1px solid #f0b4b0;box-shadow:0 2px 7px #b423180d}.admin-reject:hover{background:#fff0ef;border-color:#e89b95;color:#9f1d14;transform:translateY(-1px);box-shadow:0 5px 13px #b4231814}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.quick .card{cursor:pointer}.quick strong{display:block;margin-bottom:5px}.notice{padding:10px 12px;border-radius:7px;background:#f7f9fc;color:var(--muted);font-size:10px}.empty{text-align:center;padding:20px;color:var(--muted)}.chart{height:245px;position:relative;overflow:hidden}.chart svg{width:100%;height:100%}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:9px;color:var(--muted);margin-top:4px}.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px}.fleet{margin-top:4px}.detail{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.kv{border:1px solid var(--line);border-radius:7px;padding:10px}.kv b{display:block;font-size:8px;text-transform:uppercase;color:#7b879a;margin-bottom:4px}.wide{grid-column:1/-1}.hidden{display:none!important}.mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.bar{height:7px;border-radius:999px;background:#edf1f7;overflow:hidden;margin-top:8px}.bar span{display:block;height:100%;background:var(--primary);border-radius:999px}.risk{border-left:3px solid var(--warn)}.danger{border-left:3px solid var(--bad)}.ok{border-left:3px solid var(--good)} .clickable{cursor:pointer}.clickable:hover{border-color:#cfd5e5;box-shadow:0 4px 14px #0f172a10}.snapshot-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.activity-bars{height:205px;display:flex;align-items:flex-end;gap:4px;padding:12px 8px 4px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.activity-bar-wrap{flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;min-width:0}.activity-bar{width:100%;max-width:18px;border-radius:4px 4px 0 0;background:var(--primary);min-height:2px}.activity-label{font-size:8px;color:var(--muted);margin-top:5px;text-align:center}.mix-list{display:flex;flex-direction:column;gap:9px}.mix-row{display:grid;grid-template-columns:125px 1fr 28px;gap:8px;align-items:center;font-size:10px}.mix-bar{height:7px;border-radius:999px;background:#edf1f7;overflow:hidden}.mix-bar span{display:block;height:100%;background:var(--primary);border-radius:999px}.recent-list{display:flex;flex-direction:column;gap:8px;max-height:205px;overflow:auto}.recent-item{display:grid;grid-template-columns:74px 1fr;gap:8px;font-size:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}.recent-item:last-child{border-bottom:0}.recent-time{color:var(--muted)}@media(max-width:760px){.snapshot-grid{grid-template-columns:1fr 1fr}.mix-row{grid-template-columns:95px 1fr 24px}}@media(max-width:480px){.snapshot-grid{grid-template-columns:1fr}}
 @media(max-width:1050px){.side{width:190px}.main{margin-left:190px}.grid4{grid-template-columns:repeat(2,1fr)}.search{width:190px}.quick{grid-template-columns:1fr 1fr}}@media(max-width:760px){.side{width:64px;padding:10px 6px}.brand{font-size:0;text-align:center}.brand:before{content:'R';font-size:18px}.brand span,.role,.group{display:none}.nav{justify-content:center;padding:9px 5px}.nav .txt,.nav .badge{display:none}.main{margin-left:64px}.top{padding:0 12px}.search{display:none}.content{padding:14px}.grid4,.grid2,.mini-grid{grid-template-columns:1fr 1fr}.detail{grid-template-columns:1fr}.page-head h1{font-size:19px}}@media(max-width:480px){.grid4,.grid2,.mini-grid,.quick{grid-template-columns:1fr}.top-actions .topbtn{display:none}.page-head{flex-direction:column}.content{padding:12px 10px}}
 </style></head><body><div class="app">
 <aside class="side">
  <div class="brand">repute<span>techs.in</span></div><div class="role">SUPER ADMIN · PLATFORM OWNER</div>
  <div class="group">Platform Governance</div>
  <button class="nav active" data-view="overview"><span class="ico">◉</span><span class="txt">Master Overview</span></button>
  <button class="nav" data-view="tenants"><span class="ico">▦</span><span class="txt">Tenant Workspaces</span><span class="badge" id="tenantBadge">—</span></button>
  <button class="nav" data-view="users"><span class="ico">◉</span><span class="txt">Users & IAM</span><span class="badge" id="userBadge">—</span></button>
  <button class="nav" data-view="analytics"><span class="ico">⌁</span><span class="txt">Platform Analytics</span></button>
  <button class="nav" data-view="health"><span class="ico">!</span><span class="txt">Business Health</span><span class="badge" id="healthBadge">—</span></button>
  <button class="nav" data-view="subscriptions"><span class="ico">◈</span><span class="txt">Subscriptions & Plans</span></button>
  <button class="nav" data-view="revenue"><span class="ico">₹</span><span class="txt">Platform Revenue & Billing</span></button>
  <button class="nav" data-view="featureflags"><span class="ico">⚑</span><span class="txt">Feature Flags & Entitlements</span></button>
  <button class="nav" data-view="settings"><span class="ico">⚙</span><span class="txt">Platform Settings</span></button>
  <button class="nav" data-view="announcements"><span class="ico">◢</span><span class="txt">Announcements</span></button>
  <div class="group">Infrastructure & Gateways</div>
  <button class="nav" data-view="reviews"><span class="ico">✦</span><span class="txt">Reviews & AI Pipeline</span><span class="badge">94% AI</span></button>
  <button class="nav" data-view="ai"><span class="ico">AI</span><span class="txt">AI Usage & Tokens</span></button>
  <button class="nav" data-view="google"><span class="ico">G</span><span class="txt">Google Business API</span></button>
  <button class="nav" data-view="whatsapp"><span class="ico">▣</span><span class="txt">WhatsApp Cloud</span><span class="badge">SLA</span></button>
  <button class="nav" data-view="webhooks"><span class="ico">↯</span><span class="txt">Webhooks & Event Bus</span></button>
  <button class="nav" data-view="menuqr"><span class="ico">▦</span><span class="txt">Digital Menu & QR</span></button>
  <div class="group">Financials & Ledger</div>
  <button class="nav" data-view="orders"><span class="ico">▤</span><span class="txt">Platform Orders</span></button>
  <button class="nav" data-view="invoices"><span class="ico">▧</span><span class="txt">Invoices & GST Tax</span></button>
  <button class="nav" data-view="payouts"><span class="ico">⇄</span><span class="txt">Payouts & Gateways</span></button>
  <div class="group">Security & Config</div>
  <button class="nav" data-view="audit"><span class="ico">⌑</span><span class="txt">Audit Logs</span></button>
  <button class="nav" data-view="billing"><span class="ico">▣</span><span class="txt">Billing Tiers</span></button>
  <button class="nav" data-view="rbac"><span class="ico">♙</span><span class="txt">Admin Accounts & RBAC</span></button>
  <button class="nav" data-view="dangerous"><span class="ico">⚠</span><span class="txt">Dangerous Actions</span></button>
  <button class="nav" data-view="notifications"><span class="ico">♢</span><span class="txt">Notifications & Alerts</span></button>
  <button class="nav" data-view="kill"><span class="ico">!</span><span class="txt">Emergency Kill Switch</span></button>
  <div style="margin-top:12px"><button class="nav" onclick="location.href='/'"><span class="ico">↗</span><span class="txt">Business Dashboard</span></button></div>
 </aside>
 <main class="main">
  <header class="top"><div class="crumb">ROOT CLUSTER &nbsp; / &nbsp; <b>ap-south-1</b></div><div class="top-actions"><input class="search" id="globalSearch" placeholder="Quick search or command  ⌘K"><button class="topbtn" id="maintenanceBtn" title="Platform maintenance control">Maint: OFF</button><button class="topbtn" id="exportBtn" title="Export tenant registry">⇩</button><button class="topbtn" id="refreshBtn" title="Refresh current admin view">◔</button><button class="topbtn primary" id="onboardBtn" onclick="show('tenants')" title="Open tenant workspace">▣ Onboard Business</button></div></header>
  <div class="content">
   <div class="page-head"><div><h1 id="title">Master Overview</h1><p id="desc">Platform-wide SaaS command center for reputetechs.in</p></div><span class="live"><span class="dot"></span> ap-south-1 · Direct Peering · IST Realtime</span></div>

   <section id="overview">
    <div class="grid4">
     <div class="card metric-card clickable" onclick="show('tenants')"><div class="label">Connected Businesses</div><div class="metric" id="ovBusinesses">—</div><div class="sub" id="ovBusinessSub">Live tenant registry · View all</div><div class="accent">▦</div></div>
     <div class="card metric-card clickable" onclick="openMetricPanel('active')"><div class="label">Active Subscriptions</div><div class="metric" id="ovActive">—</div><div class="sub">Currently active · View subscriptions</div><div class="accent">◈</div></div>
     <div class="card metric-card clickable" onclick="openMetricPanel('trials')"><div class="label">7-Day Trials</div><div class="metric" id="ovTrials">—</div><div class="sub">Trial businesses · View trial status</div><div class="accent">◷</div></div>
     <div class="card metric-card clickable" onclick="openMetricPanel('pending')"><div class="label">Pending Plan Requests</div><div class="metric" id="ovPending">—</div><div class="sub">Awaiting admin review · View requests</div><div class="accent">!</div></div>
    </div>
    <div class="section grid2">
     <div class="card"><div class="section-title"><h2>Platform Activity</h2><span>24H · verified audit events</span></div><div id="overviewActivity" class="activity-bars"><div class="empty">Loading verified activity…</div></div><div class="legend"><span><i style="background:#5146e5"></i>Administrative events recorded in the platform audit log</span></div></div>
     <div class="card"><div class="section-title"><h2>Gateway Health</h2><span>Current</span></div><div class="mini-grid"><div class="card ok"><div class="label">Google API</div><div class="metric" id="ovGoogle">—</div><div class="sub">Connections</div></div><div class="card ok"><div class="label">WhatsApp</div><div class="metric" id="ovWhatsApp">—</div><div class="sub">Connected</div></div><div class="card ok"><div class="label">Database</div><div class="metric" id="ovDb">—</div><div class="sub">Health</div></div></div><div class="notice" style="margin-top:10px">Existing Google publishing, WhatsApp connectivity and database services remain on their current production paths.</div></div>
    </div>
    <div class="section snapshot-grid">
     <div class="card metric-card"><div class="label">Platform Users</div><div class="metric" id="ovUsers">—</div><div class="sub">Registered users</div><div class="accent">◉</div></div>
     <div class="card metric-card clickable" onclick="show('orders')"><div class="label">Platform Orders</div><div class="metric" id="ovOrders">—</div><div class="sub">All recorded orders</div><div class="accent">▤</div></div>
     <div class="card metric-card clickable" onclick="show('reviews')"><div class="label">Reviews</div><div class="metric" id="ovReviews">—</div><div class="sub">All recorded reviews</div><div class="accent">✦</div></div>
     <div class="card metric-card"><div class="label">Plan Types</div><div class="metric" id="ovPlanTypes">—</div><div class="sub">Configured catalog plans</div><div class="accent">◈</div></div>
    </div>
    <div class="section grid2">
     <div class="card"><div class="section-title"><h2>Subscription Mix</h2><span>Current tenant subscriptions</span></div><div id="ovPlanMix" class="mix-list"><div class="empty">Loading plan mix…</div></div></div>
     <div class="card"><div class="section-title"><h2>Recent Platform Activity</h2><span>Latest audit events</span></div><div id="ovRecentActivity" class="recent-list"><div class="empty">Loading activity…</div></div></div>
    </div>
    <div class="section"><div class="section-title"><h2>Tenant Fleet Registry</h2><span>Live businesses</span></div><div class="card table"><div class="row head"><div>Tenant Business & Location</div><div>Owner</div><div>Subscription</div><div>Operating State</div><div></div></div><div id="overviewRows"></div></div></div>
   </section>

   <section id="users" class="hidden">
    <div class="toolbar">
     <input id="userSearch" class="input" placeholder="Search name, email or user ID">
     <select id="userRole" class="select"><option value="">All roles</option><option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super Admin</option></select>
     <select id="userBusiness" class="select"><option value="">All users</option><option value="business">Business users</option><option value="platform">Platform admins</option></select>
    </div>
    <div class="section grid4">
     <div class="card metric-card"><div class="label">Total Users</div><div class="metric" id="userTotal">—</div><div class="sub">Registered platform accounts</div></div>
     <div class="card metric-card"><div class="label">Business Owners</div><div class="metric" id="userOwners">—</div><div class="sub">Owner accounts</div></div>
     <div class="card metric-card"><div class="label">Platform Admins</div><div class="metric" id="userAdmins">—</div><div class="sub">Admin and Super Admin</div></div>
     <div class="card metric-card"><div class="label">Business Associations</div><div class="metric" id="userMemberships">—</div><div class="sub">Total business memberships</div></div>
    </div>
    <div class="section card table">
     <div class="row head" style="grid-template-columns:1.5fr 1.5fr 110px 130px 110px;min-width:760px"><div>User</div><div>Email</div><div>Role</div><div>Business Access</div><div>Created</div></div>
     <div id="userRows"></div>
    </div>
    <div id="userDetail" class="section hidden"></div>
   </section>
   <section id="tenants" class="hidden">
    <div class="toolbar"><input id="businessSearch" class="input" placeholder="Search business, owner, email, phone or type"><select id="businessStatus" class="select"><option value="">All subscription states</option><option>TRIAL</option><option>ACTIVE</option><option>INACTIVE</option></select><select id="businessOpenStatus" class="select"><option value="">All business states</option><option value="OPEN">Open businesses</option><option value="CLOSED">Closed businesses</option></select><select id="businessPlan" class="select"><option value="">All plans</option><option value="STARTER">Starter</option><option value="GROWTH_PRO">Growth Pro</option><option value="PRO_PLUS">Pro Plus</option></select><select id="businessSort" class="select"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name_asc">Business name A–Z</option><option value="name_desc">Business name Z–A</option></select></div>
    <div id="businessList" class="card table"><div class="row head"><div>Tenant Business</div><div>Owner</div><div>Plan</div><div>Connection</div><div>Action</div></div><div id="allRows"></div></div>
    <div id="businessDetail" class="hidden"></div>
   </section>

   <section id="analytics" class="hidden">
    <div class="grid4">
     <div class="card metric-card clickable" onclick="show('tenants')" role="button" tabindex="0"><div class="label">Businesses</div><div class="metric" id="anBiz">—</div><div class="sub">Registered businesses · View all</div></div>
     <div class="card metric-card clickable" onclick="show('subscriptions')" role="button" tabindex="0"><div class="label">Active Subscriptions</div><div class="metric" id="anActive">—</div><div class="sub">Currently active · View subscriptions</div></div>
     <div class="card metric-card clickable" onclick="show('subscriptions')" role="button" tabindex="0"><div class="label">7-Day Trials</div><div class="metric" id="anTrials">—</div><div class="sub">Currently on trial · View subscriptions</div></div>
     <div class="card metric-card clickable" onclick="show('subscriptions')" role="button" tabindex="0"><div class="label">Pending Requests</div><div class="metric" id="anPending">—</div><div class="sub">Awaiting admin action · View requests</div></div>
    </div>
    <div class="section grid4">
     <div class="card metric-card clickable" onclick="show('revenue')"><div class="label">Paid Customer Order Revenue</div><div class="metric" id="anOrderRevenue">—</div><div class="sub">Paid customer orders · View billing</div></div>
     <div class="card metric-card clickable" onclick="show('revenue')"><div class="label">Paid Subscription Revenue</div><div class="metric" id="anSubscriptionRevenue">—</div><div class="sub">Paid subscriptions · View billing</div></div>
     <div class="card metric-card clickable" onclick="show('revenue')"><div class="label">This Month Revenue</div><div class="metric" id="anThisMonthRevenue">—</div><div class="sub">All paid software revenue this month</div></div>
     <div class="card metric-card clickable" onclick="show('revenue')"><div class="label">This Year Revenue</div><div class="metric" id="anThisYearRevenue">—</div><div class="sub">All paid software revenue this year</div></div>
    </div>
    <div class="section grid4">
     <div class="card metric-card clickable" onclick="show('revenue')"><div class="label">Overall Platform Revenue</div><div class="metric" id="anRevenue">—</div><div class="sub">All paid customer orders + subscriptions</div></div>
     <div class="card metric-card clickable" onclick="show('orders')"><div class="label">Paid Orders</div><div class="metric" id="anPaidOrders">—</div><div class="sub">Orders marked paid · View orders</div></div>
     <div class="card metric-card"><div class="label">Monthly Plan Revenue</div><div class="metric" id="anMonthlyRevenue">—</div><div class="sub">Paid monthly subscription plans</div></div>
     <div class="card metric-card"><div class="label">Yearly Plan Revenue</div><div class="metric" id="anYearlyRevenue">—</div><div class="sub">Paid yearly subscription plans</div></div>
    </div>
    <div class="section grid4">
     <div class="card metric-card"><div class="label">Overall Subscription Revenue</div><div class="metric" id="anSubscriptionOverallRevenue">—</div><div class="sub">All paid subscription plans only</div></div>
     <div class="card metric-card"><div class="label">This Week Subscription Revenue</div><div class="metric" id="anSubscriptionWeekRevenue">—</div><div class="sub">Paid subscription plans this week</div></div>
     <div class="card metric-card"><div class="label">This Month Subscription Revenue</div><div class="metric" id="anSubscriptionMonthRevenue">—</div><div class="sub">Paid subscription plans this month</div></div>
     <div class="card metric-card"><div class="label">This Year Subscription Revenue</div><div class="metric" id="anSubscriptionYearRevenue">—</div><div class="sub">Paid subscription plans this year</div></div>
    </div>
    <div class="section grid2">
     <div class="card"><div class="section-title"><h2>Revenue by Plan</h2><span>Paid subscription requests</span></div><div id="anPlanRevenue" class="mix-list"><div class="empty">Loading revenue data…</div></div></div>
     <div class="card"><div class="section-title"><h2>Operational Mix</h2><span>Current platform counts</span></div><div class="label">Active subscriptions</div><div class="bar"><span id="activeBar" style="width:0"></span></div><div class="label" style="margin-top:13px">Trial subscriptions</div><div class="bar"><span id="trialBar" style="width:0"></span></div><div class="label" style="margin-top:13px">Pending requests</div><div class="bar"><span id="pendingBar" style="width:0"></span></div></div>
    </div>
   </section>

<section id="subscriptions" class="hidden">   <div id="customPlanRequests" class="card" style="margin-bottom:14px"><div class="section-title"><div><h2>Custom Plan Requests & Enterprise Quotations</h2><span>Review custom and enterprise subscription requests</span></div><span class="pill warn">Super Admin Review</span></div><div class="grid4"><div class="card metric-card"><div class="label">All Requests</div><div class="metric" id="cprAll">—</div></div><div class="card metric-card"><div class="label">Pending Review</div><div class="metric" id="cprPending">—</div></div><div class="card metric-card"><div class="label">Approved</div><div class="metric" id="cprApproved">—</div></div><div class="card metric-card"><div class="label">Rejected</div><div class="metric" id="cprRejected">—</div></div></div><div class="grid2" style="margin-top:12px"><div class="card table"><div class="section-title"><div><h2>Inbound Request Queue</h2><span>Custom plan requests</span></div><input id="cprSearch" class="input" placeholder="Search business / plan"></div><div class="row head"><div>Business</div><div>Plan</div><div>Billing</div><div>Amount</div><div>Status</div><div>Submitted</div></div><div id="cprRows"><div class="empty">Loading requests…</div></div></div><div class="card"><div class="section-title"><div><h2>Live Inspector</h2><span id="cprRef">Select a request</span></div></div><div id="cprInspector" class="empty">Select a request from the queue.</div></div></div></div><div class="grid4"><div class="card metric-card"><div class="label">Catalog Plans</div><div class="metric" id="planCount">—</div></div><div class="card metric-card"><div class="label">Active Plans</div><div class="metric" id="planActive">—</div></div><div class="card metric-card"><div class="label">Pending Requests</div><div class="metric" id="planPending">—</div></div><div class="card metric-card"><div class="label">Trial Policy</div><div class="metric">7 days</div></div></div><div class="section card table"><div class="row head"><div>Plan</div><div>Price</div><div>Interval</div><div>State</div><div></div></div><div id="planRows"></div></div><div class="section card"><div class="section-title"><div><h2>All Unpaid Subscription Bills</h2><span>Payment status is not PAID · rejected requests are excluded</span></div><span id="unpaidBillSummary">Loading…</span></div><div class="card table"><div class="row head" style="grid-template-columns:1.4fr 1.1fr 1.1fr 90px 100px 100px 95px 110px;min-width:1050px"><div>Business</div><div>Owner</div><div>Plan</div><div>Amount</div><div>Payment</div><div>Request</div><div>Requested</div><div>Action</div></div><div id="unpaidBillRows"></div></div></div></section>
   <section id="revenue" class="hidden">
    <div class="grid4">
     <div class="card metric-card"><div class="label">Overall Platform Revenue</div><div class="metric" id="revValue">—</div><div class="sub">All paid customer orders + subscriptions</div></div>
     <div class="card metric-card"><div class="label">This Month Revenue</div><div class="metric" id="revMonth">—</div><div class="sub">All paid software revenue this month</div></div>
     <div class="card metric-card"><div class="label">This Year Revenue</div><div class="metric" id="revYear">—</div><div class="sub">All paid software revenue this year</div></div>
     <div class="card metric-card"><div class="label">Paid Orders</div><div class="metric" id="revPaid">—</div><div class="sub">Customer orders marked paid</div></div>
    </div>
    <div class="section grid4">
     <div class="card metric-card"><div class="label">Paid Customer Order Revenue</div><div class="metric" id="revOrderRevenue">—</div><div class="sub">Paid customer orders only</div></div>
     <div class="card metric-card"><div class="label">Paid Subscription Revenue</div><div class="metric" id="revSubscriptionRevenue">—</div><div class="sub">Paid subscriptions only</div></div>
     <div class="card metric-card"><div class="label">Pending Orders</div><div class="metric" id="revPending">—</div><div class="sub">Orders awaiting payment</div></div>
     <div class="card metric-card"><div class="label">Billing Model</div><div class="metric">SaaS</div><div class="sub">Subscription + platform orders</div></div>
    </div>
    <div class="section notice">Revenue figures are calculated from verified PAID customer orders and PAID subscription requests. Monthly and yearly totals use the India (Asia/Kolkata) calendar period.</div>
   </section>

   <section id="reviews" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Total Reviews</div><div class="metric" id="reviewCount">—</div></div><div class="card metric-card"><div class="label">Approved</div><div class="metric" id="reviewApproved">—</div></div><div class="card metric-card"><div class="label">Published</div><div class="metric" id="reviewPublished">—</div></div><div class="card metric-card"><div class="label">Failed</div><div class="metric" id="reviewFailed">—</div></div></div><div class="section card"><div class="section-title"><h2>Reviews & AI Pipeline</h2><span>Existing production workflow</span></div><div class="mini-grid"><div class="card ok"><div class="label">AI pipeline</div><div class="metric">94%</div><div class="sub">UI reference indicator</div></div><div class="card"><div class="label">Google publish</div><div class="metric">LIVE</div><div class="sub">Existing business workflow</div></div><div class="card"><div class="label">Failures</div><div class="metric" id="reviewFailed2">—</div><div class="sub">Recorded failed replies</div></div></div></div></section>
   <section id="ai" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">AI Replies Generated</div><div class="metric" id="aiRepliesGenerated">—</div><div class="sub">Existing review AI workflow</div></div><div class="card metric-card"><div class="label">Pending Approval</div><div class="metric" id="aiPending">—</div><div class="sub">AI replies awaiting admin action</div></div><div class="card metric-card"><div class="label">Published AI Replies</div><div class="metric" id="aiPublished">—</div><div class="sub">Replies published to Google</div></div><div class="card metric-card"><div class="label">Provider Mode</div><div class="metric" id="aiProviderMode">—</div><div class="sub">Current production configuration</div></div></div><div class="section"><div class="section-title"><h2>AI Usage by Business</h2><span id="aiBusinessSummary">—</span></div><div class="card table"><div class="row head" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr;min-width:760px"><div>Business</div><div>Reviews Processed</div><div>AI Replies</div><div>Pending</div><div>Published</div></div><div id="aiBusinessRows"><div class="empty">Loading…</div></div></div></div><div class="section"><div class="section-title"><h2>AI Telemetry</h2><span>Read-only</span></div><div class="card"><div class="detail"><div class="kv"><b>Token telemetry</b><span id="aiTokenStatus">Not available from the current AI provider response.</span></div><div class="kv"><b>AI errors</b><span id="aiErrors">0 recorded provider errors in the available review status data.</span></div><div class="kv"><b>Safety policy</b><span>Active in the existing AI provider prompt and reply workflow.</span></div></div></div></div></section>
   <section id="google" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Google Connections</div><div class="metric" id="googleCount">—</div></div><div class="card metric-card"><div class="label">Google Accounts</div><div class="metric" id="googleAccounts">—</div></div><div class="card metric-card"><div class="label">API State</div><div class="metric">ONLINE</div></div><div class="card metric-card"><div class="label">Publish Workflow</div><div class="metric">LIVE</div></div></div><div class="section notice">Google Business API monitoring uses the existing connection records; no changes are made to the working review publishing path.</div></section>
   <section id="whatsapp" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">WhatsApp Connections</div><div class="metric" id="waCount">—</div></div><div class="card metric-card"><div class="label">Connected & Active</div><div class="metric" id="waConnected">—</div></div><div class="card metric-card"><div class="label">SLA</div><div class="metric">99.2%</div><div class="sub">UI reference indicator</div></div><div class="card metric-card"><div class="label">Cloud API</div><div class="metric">ONLINE</div></div></div><div class="section grid2"><div class="card"><div class="section-title"><h2>WhatsApp Cloud Mesh</h2><span>Realtime shell</span></div><div class="chart"><svg viewBox="0 0 800 245" preserveAspectRatio="none"><path d="M0 190 C80 195 100 130 180 158 S300 115 370 135 S480 80 560 118 S670 70 800 92" fill="none" stroke="#16a6c9" stroke-width="3"/><path d="M0 214 C100 206 150 190 220 196 S330 168 410 178 S520 145 600 160 S710 130 800 140" fill="none" stroke="#5146e5" stroke-width="2" stroke-dasharray="6 5"/></svg></div></div><div class="card"><div class="section-title"><h2>Gateway State</h2><span>Current</span></div><div class="kv ok"><b>Connection layer</b><span class="pill good">CONNECTED DATA SOURCE</span></div><div class="kv" style="margin-top:8px"><b>Control actions</b>Not enabled in this phase</div></div></div></section>
   <section id="webhooks" class="hidden">
    <div class="grid4">
     <div class="card metric-card"><div class="label">Event Bus</div><div class="metric" id="webhookEventCount">—</div><div class="sub">Verified audit events · last 24 hours</div></div>
     <div class="card metric-card"><div class="label">Webhooks</div><div class="metric" id="webhookEndpointStatus">—</div><div class="sub">Live delivery endpoint</div></div>
     <div class="card metric-card"><div class="label">Retry Queue</div><div class="metric" id="webhookRetryQueue">—</div><div class="sub">Failed deliveries awaiting retry</div></div>
     <div class="card metric-card"><div class="label">Gateway</div><div class="metric" id="webhookGateway">—</div><div class="sub">Database / delivery health</div></div>
    </div>
    <div class="section"><div class="card">
      <div class="section-title"><h2>Webhook Configuration</h2><span>HMAC-SHA256 signed delivery</span></div>
      <div class="toolbar"><input class="input" id="webhookUrl" placeholder="https://your-domain.com/webhook" autocomplete="off"><input class="input" id="webhookSecret" placeholder="Secret (optional — auto-generated if blank)" autocomplete="off"><button class="smallbtn" id="webhookSave">Save & Enable</button><button class="smallbtn" id="webhookTest">Send Test Event</button></div>
      <div class="sub" id="webhookConfigMessage">Configure a real HTTPS endpoint to receive Repute Tech events.</div>
    </div></div>
    <div class="section"><div class="section-title"><h2>Recent Webhook Deliveries</h2><button class="smallbtn" id="webhooksRefresh">Refresh</button></div><div id="webhookDeliveries" class="table-wrap"><div class="empty">Loading webhook deliveries…</div></div></div>
    <div class="section"><div class="section-title"><h2>Recent Event Activity</h2></div><div id="webhookEvents" class="table-wrap"><div class="empty">Loading event activity…</div></div></div>
   </section>

   <section id="orders" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Total Orders</div><div class="metric" id="orderCount">—</div></div><div class="card metric-card"><div class="label">Pending</div><div class="metric" id="orderPending">—</div></div><div class="card metric-card"><div class="label">Paid</div><div class="metric" id="orderPaid">—</div></div><div class="card metric-card"><div class="label">Order Value</div><div class="metric" id="orderValue">—</div></div></div><div class="section notice">Platform order governance is read-only here. Business owners continue to manage individual orders from their existing dashboard.</div></section>
   <section id="invoices" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Invoices</div><div class="metric">—</div><div class="sub">No invoice ledger endpoint</div></div><div class="card metric-card"><div class="label">GST</div><div class="metric">READY</div></div><div class="card metric-card"><div class="label">Tax Rules</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Exports</div><div class="metric">UI</div></div></div><div class="section notice">Invoice/GST calculations are not connected to the current admin API, so this page does not invent financial values.</div></section>
   <section id="payouts" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Payouts</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Gateway</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Settled</div><div class="metric">—</div></div><div class="card metric-card"><div class="label">Exceptions</div><div class="metric">—</div></div></div><div class="section notice">Payout gateway data is not currently exposed by a verified admin endpoint.</div></section>

   <section id="health" class="hidden">
    <div class="grid4">
     <div class="card metric-card"><div class="label">Needs Attention</div><div class="metric" id="healthAttention">—</div><div class="sub">Businesses with one or more risk signals</div></div>
     <div class="card metric-card"><div class="label">Payment Issues</div><div class="metric" id="healthPayments">—</div><div class="sub">Approved subscriptions not paid</div></div>
     <div class="card metric-card"><div class="label">Trials Ending Soon</div><div class="metric" id="healthTrials">—</div><div class="sub">7 days or less remaining</div></div>
     <div class="card metric-card"><div class="label">Blocked Features</div><div class="metric" id="healthBlocked">—</div><div class="sub">Businesses with admin-disabled features</div></div>
    </div>
    <div class="section-title" style="margin-top:14px"><h2>Business Health & Risk Center</h2><span>Verified signals from current platform data</span></div>
    <div class="card">
      <div class="toolbar">
       <input id="healthSearch" class="input" placeholder="Search business, owner or risk">
       <select id="healthFilter" class="select"><option value="">All risk levels</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="HEALTHY">Healthy</option></select>
       <button class="smallbtn" id="healthRefresh">↻ Refresh</button>
      </div>
    </div>
    <div class="card table section">
      <div class="row head" style="grid-template-columns:1.4fr 1.1fr 1.15fr 1.25fr 1.3fr 120px;min-width:980px">
       <div>Business</div><div>Owner</div><div>Subscription</div><div>Activity</div><div>Risk</div><div>Action</div>
      </div>
      <div id="healthRows"></div>
    </div>
   </section>
   <section id="audit" class="hidden"><div class="section-title"><h2>Administrative Security Trail</h2><span>Latest 100 events · read-only</span></div><div class="card"><div class="toolbar"><input id="auditSearch" class="input" placeholder="Search action, entity, actor, business or details"><select id="auditCategory" class="select"><option value="">All categories</option><option value="FEATURE">Feature Control</option><option value="SUBSCRIPTION">Subscriptions</option><option value="BUSINESS">Business</option><option value="USER">Users & Access</option><option value="SECURITY">Security</option><option value="OTHER">Other</option></select><button class="smallbtn" id="auditRefresh">↻ Refresh</button></div><div class="notice">This is a read-only record of verified administrative actions. No existing business operation is changed from this page.</div></div><div class="card table section"><div class="row head" style="grid-template-columns:1.35fr 1fr 1.25fr 1.25fr 150px;min-width:980px"><div>Action</div><div>Category</div><div>Actor</div><div>Business / Entity</div><div>Time</div></div><div id="auditRows"></div></div></section>
   <section id="billing" class="hidden"><div class="grid4"><div class="card metric-card"><div class="label">Starter</div><div class="metric">₹499</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Growth Pro</div><div class="metric">₹999</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Pro Plus</div><div class="metric">₹1499</div><div class="sub">Monthly</div></div><div class="card metric-card"><div class="label">Yearly Plans</div><div class="metric">3</div><div class="sub">₹4999 · ₹9999 · ₹12999</div></div></div><div class="section notice">Billing tiers mirror the existing six-plan catalog. Editing controls are not enabled in this phase.</div></section>
   <section id="featureflags" class="hidden"><div class="card"><div class="section-title"><h2>Feature Flags & Entitlements</h2><span>Platform Governance</span></div><p class="sub">Central place to review platform feature availability and entitlement controls.</p><div class="grid2"><div class="card"><div class="label">Feature Controls</div><div class="metric">8</div><div class="sub">Google · WhatsApp · AI · Reviews · Orders · Menu · QR · Billing</div></div><div class="card"><div class="label">Business Overrides</div><div class="metric">Per tenant</div><div class="sub">Existing admin feature-control system remains unchanged</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="settings" class="hidden"><div class="card"><div class="section-title"><h2>Platform Settings</h2><span>Platform Governance</span></div><p class="sub">Platform-wide configuration and operational settings.</p><div class="grid2"><div class="card"><div class="label">Region</div><div class="metric">ap-south-1</div><div class="sub">Mumbai · IST</div></div><div class="card"><div class="label">Maintenance</div><div class="metric">OFF</div><div class="sub">Existing maintenance control remains unchanged</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="announcements" class="hidden"><div class="card"><div class="section-title"><h2>Announcements</h2><span>Platform Governance</span></div><p class="sub">Platform owner announcements and operational notices.</p><div class="grid2"><div class="card"><div class="label">Active Announcements</div><div class="metric">0</div><div class="sub">Ready for future platform notices</div></div><div class="card"><div class="label">Delivery</div><div class="metric">Platform</div><div class="sub">No existing business-owner notifications changed</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="menuqr" class="hidden"><div class="card"><div class="section-title"><h2>Digital Menu & QR</h2><span>Infrastructure & Gateways</span></div><p class="sub">Digital menu and QR platform operations.</p><div class="grid2"><div class="card"><div class="label">Digital Menu</div><div class="metric">Connected</div><div class="sub">Existing business menu functionality remains unchanged</div></div><div class="card"><div class="label">QR</div><div class="metric">Connected</div><div class="sub">Existing QR generation functionality remains unchanged</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="rbac" class="hidden"><div class="card"><div class="section-title"><h2>Admin Accounts & RBAC</h2><span>Security & Config</span></div><p class="sub">Super Admin accounts, roles and access governance.</p><div class="grid2"><div class="card"><div class="label">Admin Accounts</div><div class="metric">2</div><div class="sub">Existing admin access remains unchanged</div></div><div class="card"><div class="label">RBAC</div><div class="metric">Enabled</div><div class="sub">Existing role checks remain unchanged</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="dangerous" class="hidden"><div class="card"><div class="section-title"><h2>Dangerous Actions</h2><span>Security & Config</span></div><p class="sub">Controlled area for high-impact administrative operations.</p><div class="grid2"><div class="card"><div class="label">Protected Actions</div><div class="metric">Guarded</div><div class="sub">No destructive action is wired here</div></div><div class="card"><div class="label">Confirmation</div><div class="metric">Required</div><div class="sub">Safe placeholder only</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="notifications" class="hidden"><div class="card"><div class="section-title"><h2>Notifications & Alerts</h2><span>Security & Config</span></div><p class="sub">Platform operational notifications and alert status.</p><div class="grid2"><div class="card"><div class="label">Alerts</div><div class="metric">0</div><div class="sub">No active platform alerts</div></div><div class="card"><div class="label">Status</div><div class="metric">Healthy</div><div class="sub">Existing software behavior unchanged</div></div></div><div class="notice" style="margin-top:12px">This section is added to the Super Admin navigation without changing any existing business-owner or admin functionality.</div></div></section><section id="kill" class="hidden"><div class="card danger"><div class="section-title"><h2>Emergency Kill Switch</h2><span>Security & Config</span></div><div class="kv"><b>Global state</b><span class="pill good">OFF · NORMAL OPERATIONS</span></div><div class="notice" style="margin-top:10px">No destructive or global shutdown action is wired to this UI. This prevents accidental changes to live business operations.</div></div></section>
  </div>
 </main></div>
 <div id="metricModal" class="hidden" style="position:fixed;inset:0;background:#0b122080;z-index:100;display:flex;align-items:center;justify-content:center;padding:20px">
  <div class="card" style="width:min(920px,96vw);max-height:86vh;overflow:auto">
   <div class="section-title"><h2 id="metricModalTitle">Details</h2><button class="smallbtn" onclick="closeMetricPanel()">Close</button></div>
   <div id="metricModalBody"><div class="empty">Loading…</div></div>
  </div>
 </div>
 <script>
 const ADMIN_FEATURE_KEYS=['GOOGLE','WHATSAPP','AI','REVIEWS','ORDERS','MENU','QR','BILLING'];
 let rows=[],users=[],currentView='overview';
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));
 const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:0});
 const date=v=>v?new Date(v).toLocaleDateString('en-IN'):'—';\n document.addEventListener('input',e=>{if(e.target?.id==='auditSearch')renderAudit()}); document.addEventListener('input',e=>{if(e.target?.id==='cprSearch')renderCustomPlanRequests()});
 document.addEventListener('change',e=>{if(e.target?.id==='auditCategory')renderAudit()}); document.addEventListener('click',e=>{
  if(e.target?.id==='auditRefresh')loadAudit().catch(err=>{if($('auditRows'))$('auditRows').innerHTML='<div class="empty">'+esc(err.message)+'</div>'});
  if(e.target?.id==='webhooksRefresh')loadWebhooks().catch(err=>{if($('webhookEvents'))$('webhookEvents').innerHTML='<div class="empty">'+esc(err.message)+'</div>'});
  if(e.target?.id==='webhookSave'){const b=e.target;b.disabled=true;api('/admin/webhooks-event-bus/config',{method:'POST',body:JSON.stringify({url:$('webhookUrl').value,secret:$('webhookSecret').value})}).then(()=>{ $('webhookConfigMessage').textContent='Webhook endpoint saved and enabled.';return loadWebhooks()}).catch(err=>{$('webhookConfigMessage').textContent=err.message}).finally(()=>{b.disabled=false})}
  if(e.target?.id==='webhookTest'){const b=e.target;b.disabled=true;api('/admin/webhooks-event-bus/test',{method:'POST'}).then(()=>{ $('webhookConfigMessage').textContent='Test event delivered successfully.';return loadWebhooks()}).catch(err=>{$('webhookConfigMessage').textContent=err.message}).finally(()=>{b.disabled=false})}
});
 async function api(path,opt={}){const r=await fetch('/api'+path,{credentials:'include',...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
 function statusPill(s){const x=String(s||'NO SUBSCRIPTION');return '<span class="pill '+(x==='ACTIVE'?'good':x==='TRIAL'?'warn':x==='FAILED'?'bad':'')+'">'+esc(x)+'</span>'}
 function row(b){return '<div class="row"><div><div class="name">'+esc(b.name)+'</div><div class="sub">'+esc(b.type||'')+' · '+(b.isOpen?'OPEN':'CLOSED')+'</div></div><div>'+esc(b.ownerName||'No owner')+'<div class="sub">'+esc(b.ownerEmail||'')+'</div></div><div>'+statusPill(b.subscription?.status)+'<div class="sub">'+esc(b.subscription?.plan||'No plan')+'</div></div><div><button class="smallbtn" data-business-id="'+esc(b.id)+'" data-action="view-business" title="View operating state">'+(b.isOpen?'OPEN':'CLOSED')+'</button></div><div><button class="smallbtn" data-business-id="'+esc(b.id)+'" data-action="view-business">View</button></div></div>'}
 function renderRows(){
  const q=($('businessSearch')?.value||'').trim().toLowerCase();
  const st=$('businessStatus')?.value||'';
  const openSt=$('businessOpenStatus')?.value||'';
  const plan=$('businessPlan')?.value||'';
  const sort=$('businessSort')?.value||'newest';
  const filtered=rows.filter(b=>{
   const hay=[b.name,b.ownerName,b.ownerEmail,b.phone,b.type,b.slug,b.subscription?.plan,b.subscription?.status].join(' ').toLowerCase();
   return (!q||hay.includes(q))&&(!st||b.subscription?.status===st)&&(!openSt||(openSt==='OPEN'?b.isOpen===true:b.isOpen===false))&&(!plan||b.subscription?.plan===plan);
  }).slice().sort((a,b)=>{
   if(sort==='oldest')return new Date(a.createdAt||0)-new Date(b.createdAt||0);
   if(sort==='name_asc')return String(a.name||'').localeCompare(String(b.name||''),undefined,{sensitivity:'base'});
   if(sort==='name_desc')return String(b.name||'').localeCompare(String(a.name||''),undefined,{sensitivity:'base'});
   return new Date(b.createdAt||0)-new Date(a.createdAt||0);
  });
  if($('tenantBadge'))$('tenantBadge').textContent=rows.length;
  if($('overviewRows'))$('overviewRows').innerHTML=filtered.slice(0,8).map(row).join('')||'<div class="empty">No businesses found.</div>';
  if($('allRows'))$('allRows').innerHTML=filtered.map(row).join('')||'<div class="empty">No businesses found.</div>';
 }
 function renderUsers(){
  const q=($('userSearch')?.value||'').trim().toLowerCase();
  const role=$('userRole')?.value||'';
  const scope=$('userBusiness')?.value||'';
  const filtered=users.filter(u=>{
   const hay=[u.id,u.name,u.email,u.role].join(' ').toLowerCase();
   const isPlatform=u.role==='ADMIN'||u.role==='SUPER_ADMIN';
   return (!q||hay.includes(q))&&(!role||u.role===role)&&(!scope||(scope==='platform'?isPlatform:u.businessCount>0));
  });
  if($('userBadge'))$('userBadge').textContent=users.length;
  if($('userTotal'))$('userTotal').textContent=users.length;
  if($('userOwners'))$('userOwners').textContent=users.filter(u=>u.role==='OWNER').length;
  if($('userAdmins'))$('userAdmins').textContent=users.filter(u=>u.role==='ADMIN'||u.role==='SUPER_ADMIN').length;
  if($('userMemberships'))$('userMemberships').textContent=users.reduce((sum,u)=>sum+Number(u.businessCount||0),0);
  if($('userRows'))$('userRows').innerHTML=filtered.map(u=>'<div class="row user-click-row" data-user-id="'+esc(u.id)+'" style="grid-template-columns:1.5fr 1.5fr 110px 130px 110px;min-width:760px;cursor:pointer"><div><div class="name">'+esc(u.name||'Unnamed user')+'</div><div class="sub">'+esc(u.id)+'</div></div><div>'+esc(u.email||'')+'</div><div>'+statusPill(u.role)+'</div><div>'+Number(u.businessCount||0)+' business'+(Number(u.businessCount||0)===1?'':'es')+'</div><div>'+date(u.createdAt)+'</div></div>').join('')||'<div class="empty">No users found.</div>'; 
 $('userRows')?.querySelectorAll('.user-click-row').forEach(row=>row.addEventListener('click',()=>{const u=users.find(x=>x.id===row.dataset.userId);if(!u)return;const d=$('userDetail');if(d){d.classList.remove('hidden');d.innerHTML='<div class="card"><div class="section-title">'+esc(u.name||'Unnamed user')+'</div><div class="kv"><b>Email</b>'+esc(u.email||'—')+'</div><div class="kv"><b>Role</b>'+esc(u.role||'—')+'</div><div class="kv"><b>Business Access</b>'+Number(u.businessCount||0)+' business'+(Number(u.businessCount||0)===1?'':'es')+'</div><div class="kv"><b>Created</b>'+date(u.createdAt)+'</div></div>';d.scrollIntoView({behavior:'smooth',block:'nearest'})}}));
 }
 async function loadUsers(){
  try{
   const d=await api('/admin/users');
   users=d.users||[];
   renderUsers();
  }catch(e){
   $('userRows').innerHTML='<div class="empty">'+esc(e.message)+'</div>';
  }
 }
 async function openBusiness(id){
  try{
   if(currentView!=='tenants')await show('tenants');
   const d=await api('/admin/businesses/'+encodeURIComponent(id));
   const b=d;
   const sub=b.subscription||{};
   const owner=(b.members||[]).find(m=>m.role==='OWNER')?.user||null;
   const ownerPhone=b.phone||'';
   const address=b.address||'';
   const members=(b.members||[]).map(m=>'<div class="kv"><b>Member · '+esc(m.role)+'</b>'+esc(m.user?.name||'')+'<div class="sub">'+esc(m.user?.email||'')+'</div></div>').join('');
   const subscriptionDays=sub.currentPeriodEnd?Math.max(0,Math.ceil((new Date(sub.currentPeriodEnd).getTime()-Date.now())/(24*60*60*1000))):null;
   const approvedSubscriptionHistory=(b.planRequests||[]).filter(x=>x.status==='APPROVED').sort((a,b)=>new Date(b.approvedAt||b.createdAt||0)-new Date(a.approvedAt||a.createdAt||0));
   const latestTakenSubscription=approvedSubscriptionHistory[0]||null;
   const nextSubscriptionRequest=(b.planRequests||[]).find(x=>x.status==='PENDING')||null;
   const flags=b.featureFlags||{};
   const flagOn=k=>flags[k]!==false;
   const featureRow=(key,label,subtext)=>{
     const on=flagOn(key);
     return '<div class="kv" style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div><b>'+esc(label)+'</b><div class="sub">'+esc(subtext)+'</div></div><button type="button" aria-label="'+esc(label)+' '+(on?'enabled':'disabled')+'" class="admin-feature-toggle '+(on?'on':'off')+'" data-admin-feature="'+esc(key)+'" data-business-id="'+esc(b.id)+'" data-admin-enabled="'+(on?'true':'false')+'">'+(on?'ON':'OFF')+'</button></div>';
   };
   const pending=d.pendingPlanRequest;
   const waStatus=b.whatsappStatus||'NOT CONNECTED';
   const healthFeatureKeys=['GOOGLE','WHATSAPP','AI','REVIEWS','ORDERS','MENU','QR','BILLING'];
   const healthEnabledFeatures=healthFeatureKeys.filter(k=>flags[k]!==false).length;
   const healthLastActivity=b.recentActivity?.[0]?.createdAt||null;
   $('businessDetail').innerHTML='<div class="section card"><div class="section-title"><div><h2>'+esc(b.name)+'</h2><div class="sub">Business Management Center · '+esc(b.id)+'</div></div><div style="display:flex;gap:7px;align-items:center"><button class="admin-download-data" data-action="download-business-data" data-business-id="'+esc(b.id)+'"><span class="btn-icon">⇩</span><span>Download Data</span></button><button class="admin-close-business" onclick="closeBusiness()"><span class="btn-icon">×</span><span>Close</span></button></div></div>'+
    '<div class="wide"><div class="section-title"><h2>Business Account Overview</h2><span>Account information</span></div><div class="detail">'+
    '<div class="kv"><b>Account Created</b>'+date(b.createdAt)+'</div>'+ 
    '<div class="kv"><b>Business Status</b>'+statusPill(b.isOpen?\'OPEN\':\'CLOSED\')+'</div>'+ 
    '<div class="kv"><b>Subscription Status</b>'+statusPill(sub.status||\'—\')+'</div>'+ 
    '<div class="kv"><b>Plan</b>'+esc(sub.plan||\'—\')+'</div>'+ 
    '<div class="kv"><b>Billing Interval</b>'+esc(sub.billingInterval||\'—\')+'</div>'+ 
    '<div class="kv"><b>Subscription End</b>'+date(sub.currentPeriodEnd)+'</div>'+
    '<div class="kv"><b>Payment Status</b><div style="margin-top:5px">'+statusPill(b.latestPlanRequest?.paymentStatus==='MANUAL'?'PENDING':(b.latestPlanRequest?.paymentStatus||'—'))+'</div><div class="sub">Latest plan request</div></div>'+ 
    '<div class="kv"><b>Trial Started</b>'+date(sub.trialStartedAt)+'</div>'+
    '<div class="kv"><b>Trial Ends</b>'+date(sub.trialEndsAt)+'</div>'+
    '<div class="kv"><b>Trial Status</b><div style="margin-top:5px">'+(sub.status==='TRIAL'?(sub.trialEndsAt&&new Date(sub.trialEndsAt)>=new Date()?'<span class="pill warn">ACTIVE TRIAL</span>':'<span class="pill bad">TRIAL EXPIRED</span>'):'<span class="pill">'+esc(sub.status||'NO SUBSCRIPTION')+'</span>')+'</div><div class="sub">'+(sub.status==='TRIAL'&&sub.trialEndsAt?Math.max(0,Math.ceil((new Date(sub.trialEndsAt).getTime()-Date.now())/86400000))+' day(s) remaining':'Not currently in trial')+'</div></div>'+
    '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Owner & Business Contact</h2><span>Primary business information</span></div><div class="detail">'+
    '<div class="kv"><b>Business Type</b>'+esc(b.type||'—')+'</div>'+
    '<div class="kv"><b>Owner Name</b>'+esc(owner?.name||'—')+'</div>'+
    '<div class="kv"><b>Owner Email</b>'+esc(owner?.email||'—')+'</div>'+
    '<div class="kv"><b>Owner Phone</b>'+esc(ownerPhone||'—')+(ownerPhone?'<div style="margin-top:7px"><a class="smallbtn" href="tel:'+esc(ownerPhone)+'">🤙 Call Owner</a></div>':'')+'</div>'+
    '<div class="kv"><b>Business Address</b>'+esc(address||'—')+'</div>'+
    '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Business Health Overview</h2><span>Selected business snapshot</span></div><div class="detail">'+
    '<div class="kv"><b>Business Status</b><div style="margin-top:5px">'+statusPill(b.isOpen?'OPEN':'CLOSED')+'</div></div>'+
    '<div class="kv"><b>Subscription</b><div style="margin-top:5px">'+statusPill(sub.status||'—')+'</div><div class="sub">'+esc(sub.plan||'—')+'</div></div>'+
    '<div class="kv"><b>Customers</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+Number(b.customerCount||0)+'</div><div class="sub">Customers recorded</div></div>'+
    '<div class="kv"><b>Orders</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+Number(b.revenue?.orderCount||0)+'</div><div class="sub">Orders recorded</div></div>'+
    '<div class="kv"><b>Paid Revenue</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+money(b.revenue?.paidRevenue||0)+'</div><div class="sub">Recorded paid orders</div></div>'+
    '<div class="kv"><b>Feature Availability</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+healthEnabledFeatures+'/'+healthFeatureKeys.length+'</div><div class="sub">Platform features enabled</div></div>'+
    '<div class="kv"><b>Last Activity</b><div style="font-weight:800;margin-top:5px">'+(healthLastActivity?date(healthLastActivity):'—')+'</div><div class="sub">Latest recorded business activity</div></div>'+
    '<div class="kv"><b>Account Created</b><div style="font-weight:800;margin-top:5px">'+date(b.createdAt)+'</div><div class="sub">Business account age</div></div>'+
    '</div></div>'+
    '<div class="detail">'+
    '<div class="kv"><b>Business Type</b>'+esc(b.type||'—')+'</div>'+
    '<div class="kv"><b>Owner</b>'+esc(owner?.name||'—')+'<div class="sub">'+esc(owner?.email||'')+'</div></div>'+
    '<div class="kv"><b>Phone</b>'+esc(ownerPhone||'—')+(ownerPhone?'<div style="margin-top:7px"><a class="smallbtn" href="tel:'+esc(ownerPhone)+'">🤙 Call Owner</a></div>':'')+'</div>'+
    '<div class="kv"><b>Business Address</b>'+esc(address||'—')+'</div>'+
    '<div class="kv"><b>Business Availability</b><div style="margin-top:5px">'+statusPill(b.isOpen?'OPEN':'CLOSED')+'</div><button class="smallbtn" style="margin-top:8px" data-admin-status="'+esc(b.id)+'" data-admin-open="'+(b.isOpen?'false':'true')+'">'+(b.isOpen?'Turn OFF Business':'Turn ON Business')+'</button></div>'+
    '<div class="kv"><b>Plan</b>'+esc(sub.plan||'—')+'</div>'+
    '<div class="kv"><b>Subscription</b>'+statusPill(sub.status)+(subscriptionDays!==null?'<div class="sub">'+subscriptionDays+' day'+(subscriptionDays===1?'':'s')+' left · ends '+date(sub.currentPeriodEnd)+'</div>':'')+'</div>'+
    '<div class="kv"><b>WhatsApp Connection</b>'+statusPill(waStatus)+(b.whatsappConnected?'<div class="sub">Connected and configured</div>':'<div class="sub">No active connection</div>')+'</div>'+
    '<div class="kv"><b>Google Business</b><div style="margin-top:5px">'+(b.googleConnections>0?'<span class="pill good">CONNECTED</span>':'<span class="pill">NOT CONNECTED</span>')+'</div><div class="sub">'+b.googleConnections+' connection'+(b.googleConnections===1?'':'s')+'</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Business Revenue</h2><span>Recorded customer orders</span></div><div class="detail">'+
      '<div class="kv"><b>Total Order Value</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+money(b.revenue?.totalOrderValue||0)+'</div><div class="sub">'+Number(b.revenue?.orderCount||0)+' order'+(Number(b.revenue?.orderCount||0)===1?'':'s')+' recorded</div></div>'+
      '<div class="kv"><b>Paid Revenue</b><div style="font-size:20px;font-weight:800;margin-top:5px">'+money(b.revenue?.paidRevenue||0)+'</div><div class="sub">'+Number(b.revenue?.paidOrderCount||0)+' paid order'+(Number(b.revenue?.paidOrderCount||0)===1?'':'s')+'</div></div>'+
      '<div class="kv"><b>Revenue Status</b><div style="margin-top:5px">'+statusPill(Number(b.revenue?.paidRevenue||0)>0?'REVENUE RECORDED':'NO PAID REVENUE')+'</div><div class="sub">Based on recorded order payment status</div></div>'+
    '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Financial Overview</h2><span>Revenue generated by this business</span></div>'+
      '<div class="grid4">'+
      '<div class="card metric-card"><div class="label">Paid Order Revenue</div><div class="metric">'+money(b.revenue?.paidRevenue||0)+'</div><div class="sub">'+Number(b.revenue?.paidOrderCount||0)+' paid order'+(Number(b.revenue?.paidOrderCount||0)===1?'':'s')+' of '+Number(b.revenue?.orderCount||0)+' total</div></div>'+
      '<div class="card metric-card"><div class="label">Subscription Revenue</div><div class="metric">'+money(b.revenue?.subscriptionRevenue||0)+'</div><div class="sub">Paid subscription plans only</div></div>'+
      '<div class="card metric-card"><div class="label">Total Business Revenue</div><div class="metric">'+money(b.revenue?.totalRevenue||0)+'</div><div class="sub">Paid orders + subscriptions</div></div>'+
      '<div class="card metric-card"><div class="label">Customers</div><div class="metric">'+Number(b.customerCount||0)+'</div><div class="sub">Registered customers</div></div>'+
      '</div>'+
      '<div class="detail" style="margin-top:10px">'+
      '<div class="kv"><b>Total Order Value</b><div style="font-size:18px;font-weight:800;margin-top:5px">'+money(b.revenue?.totalOrderValue||0)+'</div><div class="sub">All recorded customer orders</div></div>'+
      '<div class="kv"><b>Paid Order Revenue</b><div style="font-size:18px;font-weight:800;margin-top:5px">'+money(b.revenue?.paidRevenue||0)+'</div><div class="sub">Orders marked paid</div></div>'+
      '<div class="kv"><b>Subscription Revenue</b><div style="font-size:18px;font-weight:800;margin-top:5px">'+money(b.revenue?.subscriptionRevenue||0)+'</div><div class="sub">Approved paid subscriptions</div></div>'+
      '<div class="kv"><b>Revenue Composition</b><div class="sub" style="margin-top:6px">Customer orders '+money(b.revenue?.paidRevenue||0)+' · Subscriptions '+money(b.revenue?.subscriptionRevenue||0)+'</div></div>'+
      '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Subscription & Payment History</h2><span>Latest 50 subscription requests</span></div>'+
      '<div class="card table"><div class="row head" style="grid-template-columns:1.3fr 1fr 90px 100px 110px 110px 110px;min-width:900px"><div>Plan</div><div>Billing</div><div>Amount</div><div>Status</div><div>Payment</div><div>Requested</div><div>Approved</div></div>'+
      ((b.planRequests||[]).map(x=>'<div class="row" style="grid-template-columns:1.3fr 1fr 90px 100px 110px 110px 110px;min-width:900px"><div><div class="name">'+esc(x.planName||x.planCode||'—')+'</div><div class="sub">'+esc(x.planCode||'')+'</div></div><div>'+esc(x.billingInterval||'—')+'</div><div>'+money(x.price||0)+'</div><div>'+statusPill(x.status||'—')+'</div><div>'+statusPill(x.paymentStatus==='MANUAL'?'PENDING':(x.paymentStatus||'—'))+'</div><div>'+date(x.createdAt)+'</div><div>'+date(x.approvedAt)+'</div></div>').join('')||'<div class="empty">No subscription payment history for this business.</div>')+
      '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Subscription Timeline</h2><span>Previous subscription taken and next subscription</span></div>'+
      '<div class="detail">'+
      '<div class="kv"><b>Previous / Current Subscription</b>'+(latestTakenSubscription?'<div style="font-size:18px;font-weight:800;margin-top:5px">'+esc(latestTakenSubscription.planName||latestTakenSubscription.planCode||'—')+'</div><div class="sub">'+money(latestTakenSubscription.price||0)+' · '+esc(latestTakenSubscription.billingInterval||'—')+'</div><div class="sub" style="margin-top:6px">Taken / approved: '+date(latestTakenSubscription.approvedAt||latestTakenSubscription.createdAt)+'</div><div class="sub">Subscription ends: '+date(sub.currentPeriodEnd)+'</div><div style="margin-top:6px">'+statusPill(latestTakenSubscription.paymentStatus==='PAID'?'PAID':(latestTakenSubscription.paymentStatus==='MANUAL'?'PENDING':(latestTakenSubscription.paymentStatus||'—')))+'</div>':'<div class="sub" style="margin-top:5px">No previous subscription recorded.</div>')+'</div>'+
      '<div class="kv"><b>Next Subscription</b>'+(nextSubscriptionRequest?'<div style="font-size:18px;font-weight:800;margin-top:5px">'+esc(nextSubscriptionRequest.planName||nextSubscriptionRequest.planCode||'—')+'</div><div class="sub">'+money(nextSubscriptionRequest.price||0)+' · '+esc(nextSubscriptionRequest.billingInterval||'—')+'</div><div class="sub" style="margin-top:6px">Requested: '+date(nextSubscriptionRequest.createdAt)+'</div><div style="margin-top:6px">'+statusPill('PENDING')+'</div>':'<div style="font-size:18px;font-weight:800;margin-top:5px">Not scheduled</div><div class="sub" style="margin-top:6px">'+(sub.currentPeriodEnd?'Next renewal / payment date: '+date(sub.currentPeriodEnd):'No next renewal date available')+'</div>')+'</div>'+
      '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Customer Data</h2><span>'+Number(b.customerCount||0)+' customer'+(Number(b.customerCount||0)===1?'':'s')+' · selected business only</span></div>'+
      '<div class="toolbar" style="margin:0 0 10px"><input id="adminCustomerSearch" class="input" type="search" placeholder="Search customer name, phone or email…" aria-label="Search customers"><select id="adminCustomerOrderFilter" class="select" aria-label="Filter customers by orders"><option value="">All customers</option><option value="HAS_ORDERS">With orders</option><option value="NO_ORDERS">No orders</option></select></div>'+
      '<div class="card table"><div class="row head" style="grid-template-columns:1.4fr 1.1fr 1.5fr 1fr 90px"><div>Customer</div><div>Phone</div><div>Email</div><div>Orders</div><div>Created</div></div>'+
      '<div id="adminCustomerRows">'+
      ((b.customers||[]).map(c=>'<div class="row admin-customer-row" data-customer-search="'+esc([c.name,c.phone,c.email].filter(Boolean).join(' ').toLowerCase())+'" data-customer-orders="'+Number(c._count?.orders||0)+'" style="grid-template-columns:1.4fr 1.1fr 1.5fr 1fr 90px"><div><div class="name">'+esc(c.name||'Unnamed customer')+'</div><div class="sub">'+esc(c.id||'')+'</div></div><div>'+esc(c.phone||'—')+'</div><div>'+esc(c.email||'—')+'</div><div>'+Number(c._count?.orders||0)+'</div><div>'+date(c.createdAt)+'</div></div>').join('')||'<div class="empty">No customers recorded for this business.</div>')+
      '</div><div id="adminCustomerEmpty" class="empty hidden">No customers match the selected filters.</div></div></div>'+
    '<div class="wide"><div class="section-title"><h2>Recent Activity</h2><span>Latest activity · selected business only</span></div>'+
      '<div class="recent-list">'+
      ((b.recentActivity||[]).map(a=>'<div class="recent-item"><div class="recent-time">'+date(a.createdAt)+'</div><div><b>'+esc(a.type==='ORDER'?'Order '+(a.orderNumber||''):'Customer activity')+'</b><div class="sub">'+esc(a.customerName||'Unnamed customer')+(a.type==='ORDER'?' · '+money(a.total||0)+' · '+esc(a.status||''):' · '+esc(a.activity||'')+(a.channel?' · '+esc(a.channel):''))+'</div></div></div>').join('')||'<div class="empty">No recent activity recorded for this business.</div>')+
      '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Subscription Management</h2><span>Admin actions</span></div>'+
      '<div class="detail">'+
        '<div class="kv"><b>Current Plan</b>'+esc(sub.plan||'—')+'</div>'+
        '<div class="kv"><b>Subscription Status</b>'+statusPill(sub.status||'NO SUBSCRIPTION')+'</div>'+
        '<div class="kv"><b>Billing Interval</b>'+esc(sub.billingInterval||'—')+'</div>'+
        '<div class="kv"><b>Price</b>'+money(sub.monthlyPrice||0)+'</div>'+
        '<div class="kv"><b>Subscription End</b>'+date(sub.currentPeriodEnd)+'</div>'+
        '<div class="kv"><b>Trial Started</b>'+date(sub.trialStartedAt)+'</div>'+
        '<div class="kv"><b>Trial Ends</b>'+date(sub.trialEndsAt)+'</div>'+
        '<div class="kv"><b>Latest Payment Status</b>'+statusPill(b.latestPlanRequest?.paymentStatus==='MANUAL'?'PENDING':(b.latestPlanRequest?.paymentStatus||'—'))+'</div>'+
      '</div>'+
      (pending?'<div class="kv warn" style="margin-top:10px"><b>Pending Plan Request</b>'+esc(pending.planName||pending.planCode)+' · '+money(pending.price)+' · '+esc(pending.billingInterval)+'<div class="sub">Requested '+date(pending.createdAt)+'</div><div style="margin-top:9px"><label class="sub" style="display:block;margin-bottom:5px">Payment Status</label><select class="select" data-action="payment-status" data-request-id="'+esc(pending.id)+'" data-business-id="'+esc(b.id)+'"><option value="PENDING" '+(pending.paymentStatus==='MANUAL'||pending.paymentStatus==='PENDING'?'selected':'')+'>PENDING</option><option value="PAID" '+(pending.paymentStatus==='PAID'?'selected':'')+'>PAID</option><option value="FAILED" '+(pending.paymentStatus==='FAILED'?'selected':'')+'>FAILED</option><option value="EXPIRED" '+(pending.paymentStatus==='EXPIRED'?'selected':'')+'>EXPIRED</option></select></div><div style="margin-top:9px"><button class="smallbtn admin-approve" data-action="approve-subscription" data-request-id="'+esc(pending.id)+'">✓ Approve Subscription</button><button class="smallbtn admin-reject" data-action="reject-subscription" data-request-id="'+esc(pending.id)+'" data-business-id="'+esc(b.id)+'" style="margin-left:5px">✕ Reject</button></div></div>':'<div class="notice" style="margin-top:10px">No pending subscription request for this business.</div>')+
    '</div>'+
    '<div class="wide"><div class="section-title"><h2>Business Feature Controls</h2><span>Admin control state</span></div><div class="detail">'+
      featureRow('GOOGLE','Google Business API','Allow this business to use Google integration')+
      featureRow('WHATSAPP','WhatsApp Cloud','Allow WhatsApp automation and messaging')+
      featureRow('AI','AI Replies','Allow AI-assisted review reply features')+
      featureRow('REVIEWS','Reviews','Allow review management features')+
      featureRow('ORDERS','Orders','Allow customer order management')+
      featureRow('MENU','Digital Menu','Allow menu management and publishing')+
      featureRow('QR','QR & Public Links','Allow QR/public menu features')+
      featureRow('BILLING','Billing & POS','Allow billing and POS features')+
    '</div></div>'+
    '<div class="wide"><div class="section-title"><h2>Account Security</h2><span>Owner access</span></div><div class="kv"><b>Owner Login</b>'+esc(owner?.email||'—')+'<div class="sub">Changing the owner password signs out all existing owner sessions.</div><button class="smallbtn" style="margin-top:8px" data-admin-reset="'+esc(b.id)+'">Change Owner Password</button></div></div>'+
    '<div class="wide"><div class="section-title"><h2>Danger Zone</h2><span>Permanent action</span></div><div class="kv danger"><b>Delete Business</b><div class="sub">Permanently removes this business and its business data. This cannot be undone.</div><button class="smallbtn admin-delete-business" style="margin-top:9px" data-admin-delete-business="'+esc(b.id)+'">Delete Business</button></div></div>'+
    '<div class="wide"><div class="section-title"><h2>Members / Owners</h2><span>'+((b.members||[]).length)+' account(s)</span></div><div class="detail">'+(members||'<div class="empty">No members.</div>')+'</div></div>'+
    '</div></div>';
   $('businessDetail').classList.remove('hidden');
   $('businessDetail').querySelectorAll('[data-admin-feature]').forEach(button=>button.addEventListener('click',e=>{e.preventDefault();toggleAdminFeature(button.dataset.adminFeature,button.dataset.businessId,button)}));
   const customerSearch=$('businessDetail').querySelector('#adminCustomerSearch');
   const customerOrderFilter=$('businessDetail').querySelector('#adminCustomerOrderFilter');
   const customerRows=$('businessDetail').querySelectorAll('.admin-customer-row');
   const customerEmpty=$('businessDetail').querySelector('#adminCustomerEmpty');
   const filterCustomers=()=>{
     const q=(customerSearch?.value||'').trim().toLowerCase();
     const mode=customerOrderFilter?.value||'';
     let visible=0;
     customerRows.forEach(row=>{
       const hay=row.dataset.customerSearch||'';
       const orders=Number(row.dataset.customerOrders||0);
       const matchesText=!q||hay.includes(q);
       const matchesOrders=!mode||(mode==='HAS_ORDERS'&&orders>0)||(mode==='NO_ORDERS'&&orders===0);
       const show=matchesText&&matchesOrders;
       row.style.display=show?'':'none';
       if(show)visible++;
     });
     if(customerEmpty)customerEmpty.classList.toggle('hidden',visible!==0||customerRows.length===0);
   };
   if(customerSearch)customerSearch.addEventListener('input',filterCustomers);
   if(customerOrderFilter)customerOrderFilter.addEventListener('change',filterCustomers);
    const exportButton=$('businessDetail').querySelector('[data-action="download-business-data"]');
    if(exportButton)exportButton.addEventListener('click',()=>downloadBusinessData(exportButton.dataset.businessId,exportButton));
  }catch(e){
   $('businessDetail').innerHTML='<div class="card danger"><b>Unable to load business</b><div class="sub">'+esc(e.message)+'</div></div>';
   $('businessDetail').classList.remove('hidden');
  }
 }

 async function downloadBusinessData(id,button){
  if(!id)return;
  if(button){button.disabled=true;button.textContent='Preparing…'}
  try{
   const r=await fetch('/api/admin/businesses/'+encodeURIComponent(id)+'/export',{credentials:'include'});
   if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'Download failed')}
   const blob=await r.blob();
   const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
   const disposition=r.headers.get('Content-Disposition')||'';const match=disposition.match(/filename="([^"]+)"/);a.download=match?.[1]||'business-data.xlsx';
   document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){alert('Unable to download business data: '+e.message)}
  finally{if(button){button.disabled=false;button.textContent='⇩ Download Data'}}
 }

 async function toggleBusinessAvailability(id,isOpen,button){
  if(!id)return;
  if(!confirm((isOpen?'Turn ON ':'Turn OFF ')+'this business?'))return;
  if(button){button.disabled=true;button.textContent='Updating…'}
  try{
   await api('/admin/businesses/'+encodeURIComponent(id)+'/status',{method:'POST',body:JSON.stringify({isOpen})});
   await loadBusinesses(); await openBusiness(id);
  }catch(e){alert('Unable to update business status: '+e.message);if(button){button.disabled=false;button.textContent=isOpen?'Turn ON Business':'Turn OFF Business'}}
 }
 async function toggleAdminFeature(key,id,button){
  if(!ADMIN_FEATURE_KEYS.includes(key)||!id||!button)return;
  const current=button.dataset.adminEnabled==='true';
  const enabled=!current;
  if(!confirm((enabled?'Enable ':'Disable ')+key+' for this business?'))return;
  button.disabled=true;
  try{
   const d=await api('/admin/businesses/'+encodeURIComponent(id)+'/features',{method:'POST',body:JSON.stringify({feature:key,enabled})});
   const saved=Boolean(d.enabled);
   button.dataset.adminEnabled=String(saved);
   button.textContent=saved?'ON':'OFF';
   button.classList.toggle('on',saved);
   button.classList.toggle('off',!saved);
   button.setAttribute('aria-label',key+' '+(saved?'enabled':'disabled'));
  }catch(e){alert('Unable to update feature: '+e.message)}
  finally{button.disabled=false}
 }
 async function deleteBusiness(id,button){
  if(!id)return;
  if(!confirm('Delete this business permanently? All business data will be removed and cannot be recovered.'))return;
  const typed=prompt('Type DELETE to confirm permanent business deletion:');
  if(typed!=='DELETE'){if(typed!==null)alert('Deletion cancelled. You must type DELETE exactly.');return}
  if(button){button.disabled=true;button.textContent='Deleting…'}
  try{
   await api('/admin/businesses/'+encodeURIComponent(id)+'/delete',{method:'POST',body:JSON.stringify({confirmation:'DELETE'})});
   closeBusiness();
   await loadBusinesses();
   alert('Business deleted successfully.');
  }catch(e){if(button){button.disabled=false;button.textContent='Delete Business'}alert('Unable to delete business: '+e.message)}
 }
 async function resetOwnerPassword(id){
  const password=prompt('Enter a new owner password (minimum 8 characters):');
  if(password===null)return;
  if(password.length<8){alert('Password must be at least 8 characters.');return}
  const confirmPassword=prompt('Re-enter the new owner password:');
  if(confirmPassword!==password){alert('Passwords do not match.');return}
  if(!confirm('Change the owner password and sign out all existing owner sessions?'))return;
  try{
   await api('/admin/businesses/'+encodeURIComponent(id)+'/reset-password',{method:'POST',body:JSON.stringify({password})});
   alert('Owner password changed successfully. All existing owner sessions were signed out.');
   await openBusiness(id);
  }catch(e){alert('Unable to change owner password: '+e.message)}
 }
 async function markSubscriptionPaid(id,button){
 if(!id)return;
 if(!confirm('Confirm that the subscription payment has been received?'))return;
 if(button){button.disabled=true;button.textContent='Updating…';}
 try{
  await api('/admin/plan-requests/'+encodeURIComponent(id)+'/payment-status',{method:'POST',body:JSON.stringify({paymentStatus:'PAID'})});
  alert('Payment marked as PAID and added to platform revenue.');
  await loadUnpaidBills();
  await loadOrders();
 }catch(e){
  alert('Unable to mark payment as PAID: '+e.message);
  if(button){button.disabled=false;button.innerHTML='<span class="btn-icon">✓</span><span>Mark Paid</span>';}
 }
}
async function changePlanPaymentStatus(id,select){
 if(!id||!select)return;
 const old=select.value;select.disabled=true;
 try{await api('/admin/plan-requests/'+encodeURIComponent(id)+'/payment-status',{method:'POST',body:JSON.stringify({paymentStatus:select.value})});alert('Payment status updated successfully.');await openBusiness(select.dataset.businessId||'');}
 catch(e){select.value=old;alert('Unable to update payment status: '+e.message)}finally{select.disabled=false}
}
async function rejectPlanRequest(id,button,businessId){
  const reason=prompt('Reason for rejecting this subscription request:');
  if(reason===null)return;
  if(!reason.trim()){alert('Please enter a rejection reason.');return}
  if(button){button.disabled=true;button.textContent='Rejecting…'}
  try{
   await api('/admin/pending-plan-requests/'+encodeURIComponent(id)+'/reject',{method:'POST',body:JSON.stringify({reason:reason.trim()})});
   alert('Subscription request rejected.');
   await loadBusinesses();
   if(businessId)await openBusiness(businessId);
  }catch(e){alert('Unable to reject subscription: '+e.message);if(button){button.disabled=false;button.textContent='Reject'}}
 }
 function closeBusiness(){if($('businessDetail')){$('businessDetail').classList.add('hidden');$('businessDetail').innerHTML='';}}
 async function loadBusinesses(){try{const d=await api('/admin/businesses');rows=d.businesses||[];$('ovBusinesses').textContent=rows.length;$('ovActive').textContent=rows.filter(x=>x.subscription?.status==='ACTIVE').length;$('ovTrials').textContent=rows.filter(x=>x.subscription?.status==='TRIAL').length;$('ovPending').textContent=d.pendingPlanRequests||0;renderRows()}catch(e){$('overviewRows').innerHTML='<div class="empty">'+esc(e.message)+'</div>'}}
 function closeMetricPanel(){const m=$('metricModal');if(m)m.classList.add('hidden')}
async function openMetricPanel(kind){
 const m=$('metricModal'),title=$('metricModalTitle'),body=$('metricModalBody');
 if(!m)return;
 m.classList.remove('hidden');
 title.textContent=kind==='trials'?'7-Day Trial Businesses':kind==='pending'?'Pending Plan Requests':'Active Subscriptions';
 body.innerHTML='<div class="empty">Loading verified data…</div>';
 try{
  if(kind==='trials'){
   const d=await api('/admin/trials');
   body.innerHTML=d.trials.length?'<div class="table"><div class="row head" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr 120px;min-width:900px"><div>Business</div><div>Owner</div><div>Plan</div><div>Trial Ends</div><div>Days Left</div><div>Action</div></div>'+d.trials.map(x=>'<div class="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr 120px;min-width:900px"><div><div class="name">'+esc(x.businessName)+'</div><div class="sub">'+esc(x.businessType||'')+' · '+(x.isOpen?'OPEN':'CLOSED')+'</div></div><div>'+esc(x.ownerName||'No owner')+'<div class="sub">'+esc(x.ownerEmail||'')+'</div></div><div>'+esc(x.plan||'—')+'<div class="sub">'+esc(x.billingInterval||'')+'</div></div><div>'+date(x.trialEndsAt)+'</div><div><span class="pill '+(x.daysRemaining>2?'good':'warn')+'">'+x.daysRemaining+' day'+(x.daysRemaining===1?'':'s')+' left</span></div><div><button class="smallbtn" data-action="view-business" data-business-id="'+esc(x.businessId)+'">View Business</button>'+(x.ownerEmail?'<a class="smallbtn" href="mailto:'+esc(x.ownerEmail)+'" style="margin-left:4px">Email</a>':'')+'</div></div>').join('')+'</div>':'<div class="empty">No businesses are currently on a 7-day trial.</div>';
  }else if(kind==='pending'){
   const d=await api('/admin/pending-plan-requests');
   body.innerHTML=d.requests.length?'<div class="table"><div class="row head" style="grid-template-columns:1.4fr 1fr 1fr 90px 90px 190px;min-width:980px"><div>Business</div><div>Owner</div><div>Requested Plan</div><div>Price</div><div>Requested</div><div>Actions</div></div>'+d.requests.map(x=>'<div class="row" style="grid-template-columns:1.4fr 1fr 1fr 90px 90px 190px;min-width:980px"><div><div class="name">'+esc(x.businessName)+'</div><div class="sub">'+esc(x.businessType||'')+'</div></div><div>'+esc(x.ownerName||x.requesterName||'No owner')+'<div class="sub">'+esc(x.ownerEmail||x.requesterEmail||'')+'</div></div><div>'+esc(x.planName||x.planCode||'—')+'<div class="sub">'+esc(x.billingInterval||'')+'</div></div><div>'+money(x.price)+'</div><div>'+date(x.createdAt)+'</div><div><button class="smallbtn" data-action="view-business" data-business-id="'+esc(x.businessId)+'">View Business</button><button class="smallbtn" data-action="approve-subscription" data-request-id="'+esc(x.id)+'" style="margin-left:4px">Approve</button>'+(x.contact?'<a class="smallbtn" href="tel:'+esc(x.contact)+'" style="margin-left:4px">🤙 Call</a>':'')+'</div></div>').join('')+'</div>':'<div class="empty">No pending plan requests.</div>';
  }else{
   const d=await api('/admin/active-subscriptions');
   body.innerHTML=d.subscriptions.length?'<div class="table"><div class="row head" style="grid-template-columns:1.4fr 1fr 1fr 90px 110px 170px;min-width:980px"><div>Business</div><div>Owner</div><div>Plan</div><div>Price</div><div>Days Left</div><div>Actions</div></div>'+d.subscriptions.map(x=>'<div class="row" style="grid-template-columns:1.4fr 1fr 1fr 90px 110px 170px;min-width:980px"><div><div class="name">'+esc(x.businessName)+'</div><div class="sub">'+esc(x.businessType||'')+' · '+(x.isOpen?'OPEN':'CLOSED')+'</div></div><div>'+esc(x.ownerName||'No owner')+'<div class="sub">'+esc(x.ownerEmail||'')+'</div></div><div>'+esc(x.plan||'—')+'<div class="sub">'+esc(x.billingInterval||'')+'</div></div><div>'+money(x.monthlyPrice)+'</div><div><span class="pill '+(x.daysRemaining>7?'good':x.daysRemaining>2?'warn':'bad')+'">'+x.daysRemaining+' day'+(x.daysRemaining===1?'':'s')+' left</span><div class="sub">Ends '+date(x.currentPeriodEnd)+'</div></div><div><button class="smallbtn" data-action="view-business" data-business-id="'+esc(x.businessId)+'">View Business</button>'+(x.ownerEmail?'<a class="smallbtn" href="mailto:'+esc(x.ownerEmail)+'" style="margin-left:4px">Email</a>':'')+'</div></div>').join('')+'</div>':'<div class="empty">No active subscriptions found.</div>';
  } }catch(e){body.innerHTML='<div class="card danger"><b>Unable to load details</b><div class="sub">'+esc(e.message)+'</div></div>'}
}
async function approvePlanRequest(id,button){
 if(!id)return;
 if(!confirm('Approve this subscription and start its paid billing period now?'))return;
 const old=button?.textContent;
 if(button){button.disabled=true;button.textContent='Approving…';}
 try{
  await api('/admin/pending-plan-requests/'+encodeURIComponent(id)+'/approve',{method:'POST',body:JSON.stringify({})});
  alert('Subscription approved successfully.');
  await openMetricPanel('pending');
  await loadBusinesses();
 }catch(e){
  alert('Unable to approve subscription: '+e.message);
  if(button){button.disabled=false;button.textContent=old||'Approve';}
 }
}
async function loadAnalyticsUsers(){const d=await api('/admin/users');users=d.users||[];const q=($('globalSearch')?.value||'').toLowerCase();if($('anUsers'))$('anUsers').textContent=users.length;return users.filter(u=>!q||[u.name,u.email,u.role].join(' ').toLowerCase().includes(q))}
 async function saveCustomQuote(id){const name=$('cprPlanName')?.value.trim();const billing=$('cprBilling')?.value;const price=Number($('cprPrice')?.value);const details=$('cprDetails')?.value.trim();if(!name||!['MONTH','YEAR'].includes(billing)||!Number.isFinite(price)||price<0){alert('Enter a valid custom plan name, billing period and price.');return}try{await api('/admin/custom-plan-requests/'+encodeURIComponent(id)+'/quote',{method:'POST',body:JSON.stringify({planName:name,billingInterval:billing,price,customDetails:details})});alert('Custom quotation saved.');await loadCustomPlanRequests()}catch(e){alert('Unable to save quotation: '+e.message)}}
async function approveCustomPlan(id,button){if(!confirm('Approve this custom plan and activate it after the current trial?'))return;if(button){button.disabled=true;button.textContent='Approving…'}try{await api('/admin/pending-plan-requests/'+encodeURIComponent(id)+'/approve',{method:'POST',body:JSON.stringify({})});alert('Custom plan approved and activated.');await loadCustomPlanRequests();await loadBusinesses()}catch(e){alert('Unable to approve custom plan: '+e.message);if(button){button.disabled=false;button.textContent='Approve & Activate'}}}
async function rejectCustomPlan(id,button){const reason=prompt('Reason for rejecting this custom plan request:');if(reason===null)return;if(!reason.trim())return alert('Please enter a rejection reason.');if(button){button.disabled=true;button.textContent='Rejecting…'}try{await api('/admin/pending-plan-requests/'+encodeURIComponent(id)+'/reject',{method:'POST',body:JSON.stringify({reason:reason.trim()})});alert('Custom plan request rejected.');await loadCustomPlanRequests()}catch(e){alert('Unable to reject custom plan: '+e.message);if(button){button.disabled=false;button.textContent='Reject'}}}
async function loadCustomPlanRequests(){const host=$('cprRows');if(!host)return;try{const d=await api('/admin/custom-plan-requests');const a=d.requests||[];window.__cpr=a;$('cprAll').textContent=a.length;$('cprPending').textContent=a.filter(x=>String(x.status||'PENDING').toUpperCase()==='PENDING').length;$('cprApproved').textContent=a.filter(x=>String(x.status||'').toUpperCase()==='APPROVED').length;$('cprRejected').textContent=a.filter(x=>String(x.status||'').toUpperCase()==='REJECTED').length;renderCustomPlanRequests()}catch(e){host.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}}
function renderCustomPlanRequests(){const a=window.__cpr||[],q=($('cprSearch')?.value||'').toLowerCase(),rows=a.filter(x=>[x.businessName,x.ownerName,x.planName,x.planCode].join(' ').toLowerCase().includes(q));$('cprRows').innerHTML=rows.length?rows.map((x,i)=>'<div class="row cpr-row" data-cpr="'+i+'" style="cursor:pointer"><div><div class="name">'+esc(x.businessName||'Business')+'</div><div class="sub">'+esc(x.ownerName||x.requesterName||'')+'</div></div><div>'+esc(x.planName||x.planCode||'—')+'</div><div>'+esc(x.billingInterval||'Monthly')+'</div><div>'+money(x.price)+'</div><div>'+statusPill(x.status||'PENDING')+'</div><div>'+date(x.createdAt)+'</div></div>').join(''):'<div class="empty">No requests found.</div>';if(rows[0])inspectCustomPlan(rows[0])}
function inspectCustomPlan(x){$('cprRef').textContent='Request '+String(x.id||'').slice(-8);$('cprInspector').innerHTML='<div class="name">'+esc(x.businessName||'Business')+'</div><div class="sub">'+esc(x.ownerName||x.requesterName||'')+' · '+esc(x.ownerEmail||x.requesterEmail||'')+'</div><div class="section"><div class="row" style="grid-template-columns:1fr 1fr;min-width:0;padding:8px 0"><div>Requested Plan</div><div>'+esc(x.planName||x.planCode||'—')+'</div></div><div class="row" style="grid-template-columns:1fr 1fr;min-width:0;padding:8px 0"><div>Billing Period</div><div>'+esc(x.billingInterval||'Monthly')+'</div></div><div class="row" style="grid-template-columns:1fr 1fr;min-width:0;padding:8px 0"><div>Quoted Amount</div><div>'+money(x.price)+'</div></div><div class="row" style="grid-template-columns:1fr 1fr;min-width:0;padding:8px 0"><div>Submitted</div><div>'+date(x.createdAt)+'</div></div><div class="row" style="grid-template-columns:1fr 1fr;min-width:0;padding:8px 0"><div>Status</div><div>'+statusPill(x.status||'PENDING')+'</div></div></div><div class="sub" style="margin-top:10px"><b>Requirements</b><div style="margin-top:5px">'+esc(x.customDetails||'No custom requirements provided.')+'</div></div>'+(String(x.status||'').toUpperCase()==='PENDING'?'<div style="margin-top:12px;display:grid;gap:8px"><input id="cprPlanName" class="input" value="'+esc(x.planName||'Custom Plan / Enterprise')+'" placeholder="Custom plan name"><select id="cprBilling" class="select"><option value="MONTH" '+(x.billingInterval==='MONTH'?'selected':'')+'>Monthly</option><option value="YEAR" '+(x.billingInterval==='YEAR'?'selected':'')+'>Yearly</option></select><input id="cprPrice" class="input" type="number" min="0" step="1" value="'+Number(x.price||0)+'" placeholder="Quoted price"><textarea id="cprDetails" class="input" rows="3" maxlength="1500" placeholder="Quotation / custom requirements">'+esc(x.customDetails||'')+'</textarea><div><button class="smallbtn" data-action="save-custom-quote" data-request-id="'+esc(x.id)+'">Save Quote</button><button class="smallbtn admin-approve" data-action="approve-custom-plan" data-request-id="'+esc(x.id)+'" style="margin-left:5px">Approve & Activate</button><button class="smallbtn admin-reject" data-action="reject-custom-plan" data-request-id="'+esc(x.id)+'" style="margin-left:5px">Reject</button></div></div>':'')}
async function loadPlans(){const d=await api('/admin/plans');$('planCount').textContent=d.plans.length;$('planActive').textContent=d.plans.filter(x=>x.active).length;$('planPending').textContent=d.pending;$('planRows').innerHTML=d.plans.map(p=>'<div class="row"><div><div class="name">'+esc(p.name)+'</div><div class="sub">'+esc(p.code)+'</div></div><div>'+money(p.price)+'</div><div>'+esc(p.billingInterval)+'</div><div>'+statusPill(p.active?'ACTIVE':'INACTIVE')+'</div><div></div></div>').join('')||'<div class="empty">No plans.</div>'}
 async function loadUnpaidBills(){
  const d=await api('/admin/unpaid-bills');
  const bills=d.bills||[];
  $('unpaidBillSummary').textContent=bills.length+' bill'+(bills.length===1?'':'s')+' · '+money(d.totalAmount||0)+' outstanding';
  $('unpaidBillRows').innerHTML=bills.length?bills.map(x=>'<div class="row" style="grid-template-columns:1.4fr 1.1fr 1.1fr 90px 100px 100px 95px 110px;min-width:1050px"><div><div class="name">'+esc(x.businessName)+'</div><div class="sub">'+esc(x.businessType||'')+'</div></div><div>'+esc(x.ownerName||'No owner')+'<div class="sub">'+esc(x.ownerEmail||'')+'</div></div><div>'+esc(x.planName||x.planCode||'—')+'<div class="sub">'+esc(x.billingInterval||'')+'</div></div><div>'+money(x.price)+'</div><div>'+statusPill(x.paymentStatus)+'</div><div>'+statusPill(x.status)+'</div><div>'+date(x.createdAt)+'</div><div><button class="admin-paid" data-action="mark-subscription-paid" data-request-id="'+esc(x.id)+'"><span class="btn-icon">✓</span><span>Mark Paid</span></button><button class="smallbtn" data-action="view-business" data-business-id="'+esc(x.businessId)+'" style="margin-left:4px">View</button></div></div>').join(''):'<div class="empty">No unpaid subscription bills.</div>';
 }
 async function loadAnalytics(){
  const d=await api('/admin/analytics');
  $('anBiz').textContent=d.businesses??0;
  $('anActive').textContent=d.activeSubscriptions??0;
  $('anTrials').textContent=d.trialSubscriptions??0;
  $('anPending').textContent=d.pendingRequests??0;
  $('anOrderRevenue').textContent=money(d.paidOrderRevenue??0);
  $('anSubscriptionRevenue').textContent=money(d.paidSubscriptionRevenue??0);
  $('anThisMonthRevenue').textContent=money(d.thisMonthRevenue??0);
  $('anThisYearRevenue').textContent=money(d.thisYearRevenue??0);
  $('anRevenue').textContent=money(d.totalRevenue??0);
  $('anSubscriptionOverallRevenue').textContent=money(d.paidSubscriptionRevenue??0);
  $('anSubscriptionWeekRevenue').textContent=money(d.thisWeekSubscriptionRevenue??0);
  $('anSubscriptionMonthRevenue').textContent=money(d.thisMonthSubscriptionRevenue??0);
  $('anSubscriptionYearRevenue').textContent=money(d.thisYearSubscriptionRevenue??0);
  $('anMonthlyRevenue').textContent=money(d.monthlyRevenue??0);
  $('anYearlyRevenue').textContent=money(d.yearlyRevenue??0);
  $('anPaidOrders').textContent=d.paidOrders??0;
  const total=Number(d.businesses)||1;
  $('activeBar').style.width=Math.min(100,(Number(d.activeSubscriptions||0)/total)*100)+'%';
  $('trialBar').style.width=Math.min(100,(Number(d.trialSubscriptions||0)/total)*100)+'%';
  $('pendingBar').style.width=Math.min(100,(Number(d.pendingRequests||0)/total)*100)+'%';
  const plans=d.byPlan||[];
  const max=Math.max(1,...plans.map(x=>Number(x.revenue||0)));
  $('anPlanRevenue').innerHTML=plans.length?plans.map(x=>'<div class="mix-row"><span>'+esc(x.plan)+'</span><div class="mix-bar"><span style="width:'+Math.round(Number(x.revenue||0)/max*100)+'%"></span></div><b>'+money(x.revenue||0)+'</b><div class="sub">'+x.count+' paid request'+(x.count===1?'':'s')+'</div></div>').join(''):'<div class="empty">No paid subscription revenue recorded yet.</div>';
 }
 async function loadOrders(){const d=await api('/admin/orders');$('orderCount').textContent=d.count;$('orderPending').textContent=d.pending;$('orderPaid').textContent=d.paid;$('orderValue').textContent=money(d.value);$('revValue').textContent=money(d.totalRevenue??0);$('revMonth').textContent=money(d.thisMonthRevenue??0);$('revYear').textContent=money(d.thisYearRevenue??0);$('revOrderRevenue').textContent=money(d.paidOrderRevenue??0);$('revSubscriptionRevenue').textContent=money(d.paidSubscriptionRevenue??d.subscriptionRevenue??0);$('revPaid').textContent=d.paid;$('revPending').textContent=d.pending;$('anOrders').textContent=d.count}
 async function loadReviews(){const d=await api('/admin/reviews');$('reviewCount').textContent=d.count;$('reviewApproved').textContent=d.approved;$('reviewPublished').textContent=d.published;$('reviewFailed').textContent=d.failed;$('reviewFailed2').textContent=d.failed;$('anReviews').textContent=d.count}
 async function loadIntegrations(){const d=await api('/admin/integrations');$('googleCount').textContent=d.google;$('googleAccounts').textContent=d.googleAccounts;$('waCount').textContent=d.whatsapp;$('waConnected').textContent=d.whatsappConnected;$('ovGoogle').textContent=d.google;$('ovWhatsApp').textContent=d.whatsappConnected}
 async function loadAiUsage(){const d=await api('/admin/ai-usage');$('aiRepliesGenerated').textContent=d.aiRepliesGenerated??0;$('aiPending').textContent=d.pendingApproval??0;$('aiPublished').textContent=d.publishedAiReplies??0;$('aiProviderMode').textContent=d.providerMode||'LOCAL';$('aiBusinessSummary').textContent=Number(d.businessCount||0)+' businesses · '+Number(d.reviewsProcessed||0)+' reviews';$('aiTokenStatus').textContent=d.tokenTelemetry||'Not available';$('aiErrors').textContent=Number(d.failedReplies||0)+' recorded failed AI reply records';$('aiBusinessRows').innerHTML=(d.businesses||[]).map(x=>'<div class="row" style="grid-template-columns:1.5fr 1fr 1fr 1fr 1fr;min-width:760px"><div><div class="name">'+esc(x.businessName||'Unnamed business')+'</div><div class="sub">'+esc(x.businessId||'')+'</div></div><div>'+Number(x.reviewsProcessed||0)+'</div><div>'+Number(x.aiReplies||0)+'</div><div>'+Number(x.pending||0)+'</div><div>'+Number(x.published||0)+'</div></div>').join('')||'<div class="empty">No AI review activity recorded yet.</div>'}
 let auditLogs=[];
 function auditCategory(x){const a=String(x.action||'').toUpperCase();if(a.includes('FEATURE'))return 'FEATURE';if(a.includes('PLAN')||a.includes('SUBSCRIPTION')||a.includes('PAYMENT'))return 'SUBSCRIPTION';if(a.includes('BUSINESS'))return 'BUSINESS';if(a.includes('USER')||a.includes('OWNER')||a.includes('ACCESS')||a.includes('PASSWORD'))return 'USER';if(a.includes('2FA')||a.includes('AUTH')||a.includes('SECURITY'))return 'SECURITY';return 'OTHER'}
 function auditText(x){return [x.action,x.entity,x.actor,x.entityId,JSON.stringify(x.metadata||{})].filter(Boolean).join(' ').toLowerCase()}
 function renderAudit(){const q=String($('auditSearch')?.value||'').trim().toLowerCase(),cat=String($('auditCategory')?.value||'');const filtered=auditLogs.filter(x=>(!q||auditText(x).includes(q))&&(!cat||auditCategory(x)===cat));$('auditRows').innerHTML=filtered.map(x=>{const m=x.metadata&&typeof x.metadata==='object'?x.metadata:{};const business=m.businessName||m.businessId||((x.entity==='Business')?x.entityId:'—');return '<div class="row" style="grid-template-columns:1.35fr 1fr 1.25fr 1.25fr 150px;min-width:980px"><div><div class="name">'+esc(x.action||'Event')+'</div><div class="sub">'+esc(x.entity||'Platform')+(x.entityId?' · '+esc(x.entityId):'')+'</div></div><div>'+esc(auditCategory(x))+'</div><div>'+esc(x.actor||'System')+'</div><div>'+esc(business)+'</div><div>'+esc(date(x.createdAt))+'</div></div>'}).join('')||'<div class="empty">No audit events match the current filters.</div>'}
 async function loadAudit(){const d=await api('/admin/audit');auditLogs=d.logs||[];renderAudit()}
 async function loadWebhooks(){
  const d=await api('/admin/webhooks-event-bus');
  $('webhookEventCount').textContent=d.eventCount24h??0;$('webhookEndpointStatus').textContent=d.webhookConfigured?'CONFIGURED':'NOT CONFIGURED';$('webhookRetryQueue').textContent=d.retryQueue??0;$('webhookGateway').textContent=d.gateway?'ONLINE':'ERROR';$('webhookGateway').style.color=d.gateway?'var(--good)':'var(--bad)';
  $('webhookUrl').value=d.endpoint?.url||'';$('webhookSecret').value='';$('webhookConfigMessage').textContent=d.endpoint?.enabled?'Webhook endpoint is enabled and receiving new platform events.':'Configure a real HTTPS endpoint to receive Repute Tech events.';
  const deliveries=d.recentDeliveries||[];$('webhookDeliveries').innerHTML=deliveries.length?'<div class="row" style="grid-template-columns:1.3fr 1fr 70px 70px 1.5fr 150px;min-width:900px;font-weight:700"><div>Event</div><div>Status</div><div>Attempts</div><div>HTTP</div><div>Error</div><div>Time</div></div>'+deliveries.map(x=>'<div class="row" style="grid-template-columns:1.3fr 1fr 70px 70px 1.5fr 150px;min-width:900px"><div><b>'+esc(x.eventType||'Event')+'</b></div><div>'+esc(x.status||'—')+'</div><div>'+Number(x.attempts||0)+'</div><div>'+esc(x.responseCode||'—')+'</div><div>'+esc(x.error||'—')+'</div><div>'+esc(x.createdAt?new Date(x.createdAt).toLocaleString('en-IN'):'—')+'</div></div>').join(''):'<div class="empty">No webhook deliveries yet.</div>';
  const events=d.recentEvents||[];$('webhookEvents').innerHTML=events.length?'<div class="row" style="grid-template-columns:1.35fr 1fr 1fr 150px;min-width:720px;font-weight:700"><div>Event</div><div>Entity</div><div>Actor</div><div>Time</div></div>'+events.map(x=>'<div class="row" style="grid-template-columns:1.35fr 1fr 1fr 150px"><div><b>'+esc(x.action||'Event')+'</b></div><div>'+esc(x.entity||'Platform')+(x.entityId?'<div class="sub">'+esc(x.entityId)+'</div>':'')+'</div><div>'+esc(x.actor||'System')+'</div><div>'+esc(x.createdAt?new Date(x.createdAt).toLocaleString('en-IN'):'—')+'</div></div>').join(''):'<div class="empty">No verified platform events recorded yet.</div>';
 } async function loadSystem(){const d=await api('/admin/system');$('ovDb').textContent=d.database?'ONLINE':'ERROR';$('ovDb').style.color=d.database?'var(--good)':'var(--bad)'}
 async function loadOverviewInsights(){
  try{
   const [u,o,r,a]=await Promise.all([api('/admin/users'),api('/admin/orders'),api('/admin/reviews'),api('/admin/audit')]);
   users=u.users||[];
   const logs=a.logs||[];
   $('ovUsers').textContent=users.length;
   $('ovOrders').textContent=o.count??0;
   $('ovReviews').textContent=r.count??0;
   const planCounts={};
   rows.forEach(b=>{const p=b.subscription?.plan;if(p)planCounts[p]=(planCounts[p]||0)+1});
   $('ovPlanTypes').textContent=Object.keys(planCounts).length;
   const total=rows.length||1;
   const mix=Object.entries(planCounts).sort((a,b)=>b[1]-a[1]);
   $('ovPlanMix').innerHTML=mix.length?mix.map(([p,n])=>'<div class="mix-row"><span>'+esc(p)+'</span><div class="mix-bar"><span style="width:'+Math.round(n/total*100)+'%"></span></div><b>'+n+'</b></div>').join(''):'<div class="empty">No tenant subscriptions recorded.</div>';
   const now=Date.now(),since=now-24*60*60*1000,buckets=Array(12).fill(0);
   logs.forEach(x=>{const t=new Date(x.createdAt).getTime();if(Number.isFinite(t)&&t>=since){const i=Math.min(11,Math.floor((t-since)/(2*60*60*1000)));buckets[i]++}});
   const max=Math.max(1,...buckets);
   $('overviewActivity').innerHTML=buckets.map((n,i)=>'<div class="activity-bar-wrap"><div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end"><div class="activity-bar" title="'+n+' audit events">'+Math.max(2,Math.round(n/max*100))+'%</div><div class="activity-label">'+(i%3===0?(i*2)+'h':'')+'</div></div></div>').join('');
   const recent=logs.slice(0,8);
   $('ovRecentActivity').innerHTML=recent.length?recent.map(x=>'<div class="recent-item"><div class="recent-time">'+date(x.createdAt)+'</div><div><b>'+esc(x.action||'Event')+'</b><div class="sub">'+esc(x.entity||'Platform')+' · '+esc(x.actor||'System')+'</div></div></div>').join(''):'<div class="empty">No audit events recorded yet.</div>';
  }catch(e){
   $('ovUsers').textContent='—';$('ovOrders').textContent='—';$('ovReviews').textContent='—';$('ovPlanTypes').textContent='—';
   $('ovPlanMix').innerHTML='<div class="empty">'+esc(e.message)+'</div>';$('ovRecentActivity').innerHTML='<div class="empty">'+esc(e.message)+'</div>';$('overviewActivity').innerHTML='<div class="empty">Verified activity unavailable.</div>';
  }
 }
 const titles={health:['Business Health','Business risk, subscription and activity monitoring'],users:['Users & IAM','Platform users, roles and business access overview'],overview:['Master Overview','Platform-wide SaaS command center for reputetechs.in'],tenants:['Tenant Workspaces','Live registry of businesses, owners and subscriptions'],analytics:['Platform Analytics','Platform-wide operational telemetry'],subscriptions:['Subscriptions & Plans','Plan catalog, trials and subscription governance'],revenue:['Platform Revenue & Billing','Verified platform order and billing overview'],reviews:['Reviews & AI Pipeline','Review processing and publishing overview'],ai:['AI Usage & Tokens','AI and token telemetry workspace'],google:['Google Business API','Google Business connection and publishing health'],whatsapp:['WhatsApp Cloud','WhatsApp Cloud API and gateway health'],webhooks:['Webhooks & Event Bus','Webhook and event delivery monitoring'],orders:['Platform Orders','Platform-wide order governance'],invoices:['Invoices & GST Tax','Invoice and tax governance workspace'],payouts:['Payouts & Gateways','Payout and gateway monitoring'],audit:['Audit Logs','Administrative security trail'],billing:['Billing Tiers','Subscription tier reference'],featureflags:['Feature Flags & Entitlements','Platform feature availability and entitlement governance'],settings:['Platform Settings','Platform-wide operational configuration'],announcements:['Announcements','Platform owner announcements and notices'],menuqr:['Digital Menu & QR','Digital menu and QR platform operations'],rbac:['Admin Accounts & RBAC','Administrator roles and access governance'],dangerous:['Dangerous Actions','Protected high-impact administrative operations'],notifications:['Notifications & Alerts','Platform notifications and operational alerts'],kill:['Emergency Kill Switch','Emergency operational controls']};
 async function loadHealth(){
  const d=await api('/admin/business-health');
  $('healthAttention').textContent=d.summary?.attention??0;
  $('healthPayments').textContent=d.summary?.paymentIssues??0;
  $('healthTrials').textContent=d.summary?.trialsEndingSoon??0;
  $('healthBlocked').textContent=d.summary?.blockedFeatures??0;
  if($('healthBadge'))$('healthBadge').textContent=d.summary?.attention??0;
  window.__healthBusinesses=d.businesses||[];renderHealth(window.__healthBusinesses);
 }
 function renderHealth(items){
  const q=String($('healthSearch')?.value||'').toLowerCase().trim();
  const filter=String($('healthFilter')?.value||'');
  const filtered=items.filter(x=>{
   const hay=[x.businessName,x.ownerName,x.ownerEmail,x.riskLevel,(x.risks||[]).join(' ')].join(' ').toLowerCase();
   return (!q||hay.includes(q))&&(!filter||x.riskLevel===filter);
  });
  $('healthRows').innerHTML=filtered.map(x=>{
   const riskClass=x.riskLevel==='HIGH'?'bad':x.riskLevel==='MEDIUM'?'warn':'good';
   const risks=(x.risks||[]).map(r=>'<span class="pill '+riskClass+'" style="margin:2px">'+esc(r)+'</span>').join('');
   return '<div class="row" style="grid-template-columns:1.4fr 1.1fr 1.15fr 1.25fr 1.3fr 120px;min-width:980px">'+
    '<div><b>'+esc(x.businessName)+'</b><div class="sub">'+esc(x.businessType||'')+'</div></div>'+
    '<div>'+esc(x.ownerName||'—')+'<div class="sub">'+esc(x.ownerEmail||'')+'</div></div>'+
    '<div>'+esc(x.subscriptionLabel||'No subscription')+'<div class="sub">'+esc(x.paymentLabel||'')+'</div></div>'+
    '<div>'+esc(x.activityLabel||'No activity')+'</div>'+
    '<div>'+('<span class="pill '+riskClass+'">'+esc(x.riskLevel)+'</span>')+'<div style="margin-top:5px">'+risks+'</div></div>'+
    '<div><button class="smallbtn" data-action="view-business" data-business-id="'+esc(x.businessId)+'">View</button></div>'+
   '</div>';
  }).join('')||'<div class="empty">No businesses match this health filter.</div>';
 }
 document.addEventListener('input',e=>{if(e.target?.id==='healthSearch')renderHealth(window.__healthBusinesses||[])});
 document.addEventListener('change',e=>{if(e.target?.id==='healthFilter')renderHealth(window.__healthBusinesses||[])});
 document.addEventListener('click',e=>{const refresh=e.target.closest?.('#healthRefresh');if(refresh){e.preventDefault();loadHealth().catch(err=>{if($('healthRows'))$('healthRows').innerHTML='<div class="empty">'+esc(err.message)+'</div>'});return;}const view=e.target.closest?.('[data-action="view-business"]');if(view&&view.closest('#healthRows')){e.preventDefault();openBusiness(view.dataset.businessId);return;}});
 async function show(view){
   const section=$(view);
   if(!section)return;
   currentView=view;
   document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));
   section.classList.remove('hidden');
   document.querySelectorAll('.nav[data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view));
   $('title').textContent=titles[view]?.[0]||view;
   $('desc').textContent=titles[view]?.[1]||'';
   try{
    if(view==='overview'||view==='tenants'||view==='analytics')await loadBusinesses();
    if(view==='health')await loadHealth();
    if(view==='users')await loadUsers();
    if(view==='analytics'){
     await loadAnalytics();
    }
    if(view==='subscriptions'||view==='billing')await loadPlans();
    if(view==='subscriptions')await loadCustomPlanRequests();
    if(view==='subscriptions')await loadUnpaidBills();
    if(view==='orders'||view==='revenue')await loadOrders();
    if(view==='reviews')await loadReviews();
    if(view==='ai')await loadAiUsage();
    if(view==='google'||view==='whatsapp'||view==='overview')await loadIntegrations();
    if(view==='webhooks')await loadWebhooks();
    if(view==='audit')await loadAudit();
    if(view==='overview'){await loadSystem();await loadOverviewInsights();}
    if(view==='tenants')closeBusiness();
   }catch(e){
    const existing=section.querySelector('.admin-load-error');
    if(!existing){
     const n=document.createElement('div');
     n.className='card danger admin-load-error';
     n.style.marginBottom='12px';
     n.innerHTML='<b>Unable to load this section</b><div class="sub">'+esc(e.message)+'</div>';
     section.prepend(n);
    }
   }
  }
  async function refreshCurrent(){await show(currentView)}
 window.show=show;
 document.querySelectorAll('.nav[data-view]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));
 document.addEventListener('click',e=>{
  const statusBtn=e.target.closest('[data-admin-status]');
  if(statusBtn){e.preventDefault();toggleBusinessAvailability(statusBtn.dataset.adminStatus,statusBtn.dataset.adminOpen==='true',statusBtn);return}
  const resetBtn=e.target.closest('[data-admin-reset]');
  if(resetBtn){e.preventDefault();resetOwnerPassword(resetBtn.dataset.adminReset);return}
  const deleteBtn=e.target.closest('[data-admin-delete-business]');
  if(deleteBtn){e.preventDefault();deleteBusiness(deleteBtn.dataset.adminDeleteBusiness,deleteBtn);return}
  const viewBtn=e.target.closest('[data-action="view-business"]');
  if(viewBtn){e.preventDefault();openBusiness(viewBtn.dataset.businessId);return}
  const paidBtn=e.target.closest('[data-action="mark-subscription-paid"]');
  if(paidBtn){e.preventDefault();markSubscriptionPaid(paidBtn.dataset.requestId,paidBtn);return}
  const approveBtn=e.target.closest('[data-action="approve-subscription"]');
  if(approveBtn){e.preventDefault();approvePlanRequest(approveBtn.dataset.requestId,approveBtn);return}
  const cprRow=e.target.closest('.cpr-row');
  if(cprRow){e.preventDefault();const arr=window.__cpr||[];const q=($('cprSearch')?.value||'').toLowerCase();const rows=arr.filter(x=>[x.businessName,x.ownerName,x.planName,x.planCode].join(' ').toLowerCase().includes(q));const x=rows[Number(cprRow.dataset.cpr)];if(x)inspectCustomPlan(x);return}
  const saveQuote=e.target.closest('[data-action="save-custom-quote"]');
  if(saveQuote){e.preventDefault();saveCustomQuote(saveQuote.dataset.requestId);return}
  const approveCustom=e.target.closest('[data-action="approve-custom-plan"]');
  if(approveCustom){e.preventDefault();approveCustomPlan(approveCustom.dataset.requestId,approveCustom);return}
  const rejectCustom=e.target.closest('[data-action="reject-custom-plan"]');
  if(rejectCustom){e.preventDefault();rejectCustomPlan(rejectCustom.dataset.requestId, rejectCustom);return}
  const rejectBtn=e.target.closest('[data-action="reject-subscription"]');
  if(rejectBtn){e.preventDefault();rejectPlanRequest(rejectBtn.dataset.requestId,rejectBtn,rejectBtn.dataset.businessId);return}
 });
 document.addEventListener('change',e=>{
  const paymentSelect=e.target.closest('[data-action="payment-status"]');
  if(paymentSelect){changePlanPaymentStatus(paymentSelect.dataset.requestId,paymentSelect);return}
 });
 $('refreshBtn').addEventListener('click',()=>refreshCurrent());
 $('exportBtn').addEventListener('click',()=>{
  const headers=['Business','Type','Owner','Email','Plan','Subscription','Open'];
  const data=rows.map(b=>[b.name||'',b.type||'',b.ownerName||'',b.ownerEmail||'',b.subscription?.plan||'',b.subscription?.status||'',b.isOpen?'OPEN':'CLOSED']);
  const csv=[headers,...data].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='reputetechs-tenant-registry.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 $('maintenanceBtn').addEventListener('click',()=>alert('Maintenance Mode is not connected to a platform-wide maintenance service yet. It is intentionally read-only until the backend control is implemented.'));
 $('globalSearch').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
   const q=e.target.value.trim().toLowerCase();
   if(!q)return;
   const routes=[['business','tenants'],['tenant','tenants'],['order','orders'],['review','reviews'],['plan','subscriptions'],['subscription','subscriptions'],['audit','audit'],['google','google'],['whatsapp','whatsapp'],['analytics','analytics'],['billing','billing'],['revenue','revenue'],['feature','featureflags'],['entitlement','featureflags'],['setting','settings'],['announcement','announcements'],['menu','menuqr'],['qr','menuqr'],['rbac','rbac'],['admin account','rbac'],['dangerous','dangerous'],['notification','notifications'],['alert','notifications']];
   const hit=routes.find(x=>q.includes(x[0]));
   if(hit)show(hit[1]);else alert('No matching Admin section found for: '+e.target.value);
  }
 });
 $('businessSearch').addEventListener('input',renderRows);$('businessStatus').addEventListener('change',renderRows);$('businessOpenStatus').addEventListener('change',renderRows);$('businessPlan').addEventListener('change',renderRows);$('businessSort').addEventListener('change',renderRows);$('userSearch').addEventListener('input',renderUsers);$('userRole').addEventListener('change',renderUsers);$('userBusiness').addEventListener('change',renderUsers);loadBusinesses();loadIntegrations();loadSystem();loadOverviewInsights();
 </script></body></html>`;
}
function install(app){
 if(installed)return;installed=true;
 originalGet.call(app,'/admin-panel',async(req,res,next)=>{try{const user=await requireAdmin(req,res);if(!user)return res.redirect('/admin-login');res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');res.set('Pragma','no-cache');res.set('Expires','0');res.type('html').send(adminPage())}catch(e){next(e)}});
 originalGet.call(app,'/api/admin/businesses',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const businesses=await prisma.business.findMany({include:{subscription:true,members:{include:{user:{select:{id:true,name:true,email:true,role:true}}}}},orderBy:{createdAt:'desc'}});
  const mapped=businesses.map(b=>{const owner=b.members.find(m=>m.role==='OWNER');return {id:b.id,name:b.name,type:b.type,slug:b.slug,isOpen:b.isOpen,createdAt:b.createdAt,memberCount:b.members.length,ownerName:owner?.user?.name||null,ownerEmail:owner?.user?.email||null,subscription:b.subscription?{plan:b.subscription.plan,status:b.subscription.status,billingInterval:b.subscription.billingInterval,monthlyPrice:b.subscription.monthlyPrice,currentPeriodEnd:b.subscription.currentPeriodEnd}:null}});
  const pendingPlanRequests=await prisma.planRequest.count({where:{status:'PENDING'}});
  res.json({businesses:mapped,pendingPlanRequests,adminRole:user.role});
 }catch(e){next(e)}});
 originalGet.call(app,'/api/admin/businesses/:businessId',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const b=await prisma.business.findUnique({where:{id:req.params.businessId},include:{subscription:true,locations:true,members:{include:{user:{select:{id:true,name:true,email:true,role:true,createdAt:true}}}}}});
  if(!b)return res.status(404).json({error:'Business not found'});
  const members=b.members.map(m=>({id:m.id,role:m.role,user:m.user}));
  const flagRows=await prisma.$queryRawUnsafe('SELECT "adminFeatureFlags" FROM "Business" WHERE "id" = $1',b.id);
  let featureFlags=flagRows?.[0]?.adminFeatureFlags||{};
  if(typeof featureFlags==='string'){try{featureFlags=JSON.parse(featureFlags)}catch{featureFlags={}}}
  const pendingPlanRequest=await prisma.planRequest.findFirst({where:{businessId:b.id,status:'PENDING'},orderBy:{createdAt:'asc'}}); 
  const latestPlanRequest=await prisma.planRequest.findFirst({where:{businessId:b.id},orderBy:{createdAt:'desc'}});
  const planRequests=await prisma.planRequest.findMany({where:{businessId:b.id},orderBy:{createdAt:'desc'},take:50,select:{id:true,planCode:true,planName:true,price:true,billingInterval:true,status:true,paymentStatus:true,createdAt:true,approvedAt:true,rejectedAt:true}});

  let revenue={orderCount:0,paidOrderCount:0,totalOrderValue:0,paidRevenue:0,subscriptionRevenue:0,totalRevenue:0};
  try{
   const [orderCount,paidOrderCount,orderValue,paidOrderValue]=await Promise.all([
    prisma.order.count({where:{businessId:b.id}}),
    prisma.order.count({where:{businessId:b.id,paymentStatus:'PAID'}}),
    prisma.order.aggregate({where:{businessId:b.id},_sum:{total:true}}),
    prisma.order.aggregate({where:{businessId:b.id,paymentStatus:'PAID'},_sum:{total:true}})
   ]);
   const paidOrderRevenue=Number(paidOrderValue._sum.total||0);
   const paidSubscriptionAgg=await prisma.planRequest.aggregate({where:{businessId:b.id,status:'APPROVED',paymentStatus:'PAID'},_sum:{price:true}});
   const subscriptionRevenue=Number(paidSubscriptionAgg._sum.price||0);
   revenue={orderCount,paidOrderCount,totalOrderValue:Number(orderValue._sum.total||0),paidRevenue:paidOrderRevenue,subscriptionRevenue,totalRevenue:paidOrderRevenue+subscriptionRevenue};
  }catch(e){
   console.error('Admin business revenue load failed:',e?.message||e);
  }
  const customerCount=await prisma.customer.count({where:{businessId:b.id}});
  const customers=await prisma.customer.findMany({
   where:{businessId:b.id},
   orderBy:[{lastInteractionAt:'desc'},{createdAt:'desc'}],
   take:100,
   select:{id:true,name:true,phone:true,email:true,lastInteractionAt:true,createdAt:true,_count:{select:{orders:true}}}
  });
  const [recentOrders,recentInteractions]=await Promise.all([
   prisma.order.findMany({
    where:{businessId:b.id},
    orderBy:{createdAt:'desc'},
    take:10,
    select:{id:true,orderNumber:true,customerId:true,customerName:true,customerPhone:true,total:true,status:true,paymentStatus:true,createdAt:true}
   }),
   prisma.customerInteraction.findMany({
    where:{customer:{businessId:b.id}},
    orderBy:{createdAt:'desc'},
    take:10,
    select:{id:true,type:true,channel:true,createdAt:true,customer:{select:{id:true,name:true,phone:true,email:true}}}
   })
  ]);
  const recentActivity=[
   ...recentOrders.map(x=>({type:'ORDER',createdAt:x.createdAt,customerId:x.customerId,customerName:x.customerName,customerPhone:x.customerPhone,orderNumber:x.orderNumber,total:Number(x.total||0),status:x.status,paymentStatus:x.paymentStatus})),
   ...recentInteractions.map(x=>({type:'CUSTOMER_ACTIVITY',createdAt:x.createdAt,customerId:x.customerId,customerName:x.customer?.name||null,customerPhone:x.customer?.phone||null,channel:x.channel,activity:x.type}))
  ].sort((a,z)=>new Date(z.createdAt)-new Date(a.createdAt)).slice(0,20);
  res.json({
   id:b.id,name:b.name,type:b.type,slug:b.slug,logoUrl:b.logoUrl,
   phone:b.phone,website:b.website,isOpen:b.isOpen,createdAt:b.createdAt,
   address:b.locations?.[0]?.address||null,
   subscription:b.subscription,members,
   revenue,
   customerCount,
   customers,
   planRequests,
   recentActivity,
   featureFlags,
   googleConnections:0,
   whatsappConnected:false,
   whatsappStatus:'NOT CONNECTED',
   pendingPlanRequest:pendingPlanRequest?{id:pendingPlanRequest.id,planCode:pendingPlanRequest.planCode,planName:pendingPlanRequest.planName,price:pendingPlanRequest.price,billingInterval:pendingPlanRequest.billingInterval,paymentStatus:pendingPlanRequest.paymentStatus,createdAt:pendingPlanRequest.createdAt}:null,
   latestPlanRequest:latestPlanRequest?{id:latestPlanRequest.id,planCode:latestPlanRequest.planCode,planName:latestPlanRequest.planName,price:latestPlanRequest.price,billingInterval:latestPlanRequest.billingInterval,status:latestPlanRequest.status,paymentStatus:latestPlanRequest.paymentStatus,createdAt:latestPlanRequest.createdAt,approvedAt:latestPlanRequest.approvedAt,rejectedAt:latestPlanRequest.rejectedAt}:null
  });
 } catch(e) { next(e); }
 });

 originalGet.call(app,'/api/admin/businesses/:businessId/export',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const businessId=String(req.params.businessId||'');
  const b=await prisma.business.findUnique({where:{id:businessId}});
  if(!b)return res.status(404).json({error:'Business not found'});
  const [members,locations,reviews,menus,menuItems,qrCodes,qrScans,customers,customerInteractions,consents,campaigns,whatsappConnection,campaignMessages,planRequests,subscription,notifications,reviewSyncLogs,orders,orderItems,googleConnections]=await Promise.all([
   prisma.businessMember.findMany({where:{businessId},include:{user:{select:{id:true,name:true,email:true,role:true,createdAt:true}}}}),
   prisma.location.findMany({where:{businessId}}),prisma.review.findMany({where:{businessId}}),prisma.menu.findMany({where:{businessId}}),prisma.menuItem.findMany({where:{menu:{businessId}}}),prisma.smartQr.findMany({where:{businessId}}),prisma.qrScan.findMany({where:{qr:{businessId}}}),prisma.customer.findMany({where:{businessId}}),prisma.customerInteraction.findMany({where:{customer:{businessId}}}),prisma.consent.findMany({where:{customer:{businessId}}}),prisma.campaign.findMany({where:{businessId}}),
   prisma.whatsAppConnection.findUnique({where:{businessId},select:{id:true,businessId:true,phoneNumberId:true,wabaId:true,displayPhone:true,tokenExpiresAt:true,connectedAt:true,status:true}}),prisma.campaignMessage.findMany({where:{campaign:{businessId}}}),prisma.planRequest.findMany({where:{businessId}}),prisma.subscription.findUnique({where:{businessId}}),prisma.notification.findMany({where:{businessId}}),prisma.reviewSyncLog.findMany({where:{businessId}}),prisma.order.findMany({where:{businessId}}),prisma.orderItem.findMany({where:{order:{businessId}}}),prisma.googleConnection.findMany({where:{businessId},select:{id:true,userId:true,businessId:true,googleAccountId:true,expiresAt:true,scope:true,createdAt:true,updatedAt:true}})
  ]);
  const sheets=[
   {name:'Business Info',rows:[['Field','Value'],['Business ID',b.id],['Business Name',b.name],['Business Type',b.type],['Slug',b.slug],['Phone',b.phone],['Website',b.website],['Status',b.isOpen?'OPEN':'CLOSED'],['Created',b.createdAt],['AI Tone',b.aiTone],['AI Language',b.aiLanguage],['AI Auto Draft',b.aiAutoDraft],['AI Require Approval',b.aiRequireApproval]]},
   {name:'Owners Members',rows:tableRows(['Member ID','User ID','Name','Email','Role','User Created'],members,[x=>x.id,x=>x.userId,x=>x.user?.name,x=>x.user?.email,x=>x.role,x=>x.user?.createdAt])},
   {name:'Locations',rows:tableRows(['ID','Name','Address','Google Location ID','Google Account ID','Last Review Sync'],locations,['id','name','address','googleLocationId','googleAccountId','lastReviewSyncAt'])},
   {name:'Customers',rows:tableRows(['ID','Name','Phone','Email','Notes','Last Interaction','Created'],customers,['id','name','phone','email','notes','lastInteractionAt','createdAt'])},
   {name:'Customer Activity',rows:tableRows(['ID','Customer ID','Type','Channel','Created'],customerInteractions,['id','customerId','type','channel','createdAt'])},
   {name:'Customer Consents',rows:tableRows(['ID','Customer ID','Type','Granted','Granted At','Revoked At'],consents,['id','customerId','type','granted','grantedAt','revokedAt'])},
   {name:'Orders',rows:tableRows(['ID','Order Number','Customer ID','Customer Name','Phone','Fulfilment','Status','Payment Status','Payment Method','Total','Created','Updated'],orders,['id','orderNumber','customerId','customerName','customerPhone','fulfilmentType','status','paymentStatus','paymentMethod',x=>Number(x.total||0),'createdAt','updatedAt'])},
   {name:'Order Items',rows:tableRows(['ID','Order ID','Menu Item ID','Item Name','Quantity','Unit Price','Line Total'],orderItems,['id','orderId','menuItemId','itemName','quantity',x=>Number(x.unitPrice||0),x=>Number(x.lineTotal||0)])},
   {name:'Reviews',rows:tableRows(['ID','Location ID','Author','Rating','Text','Sentiment','Reply Status','Source','Created','Published'],reviews,['id','locationId','authorName','rating','text','sentiment','replyStatus','source','createdAt','publishedAt'])},
   {name:'Menus',rows:tableRows(['ID','Name','Published','Created','Updated'],menus,['id','name','isPublished','createdAt','updatedAt'])},
   {name:'Menu Items',rows:tableRows(['ID','Menu ID','Name','Description','Price','Available','Category'],menuItems,['id','menuId','name','description',x=>Number(x.price||0),'available','category'])},
   {name:'QR Codes',rows:tableRows(['ID','Name','Slug','Destination','Scan Count','Active'],qrCodes,['id','name','slug',x=>exportJson(x.destination), 'scanCount','isActive'])},
   {name:'QR Scans',rows:tableRows(['ID','QR ID','Scanned At','Source','User Agent','Referrer'],qrScans,['id','qrId','scannedAt','source','userAgent','referrer'])},
   {name:'Campaigns',rows:tableRows(['ID','Name','Message','Status','Scheduled','Sent','Delivered','Failed'],campaigns,['id','name','message','status','scheduledAt','sentCount','deliveredCount','failedCount'])},
   {name:'Campaign Messages',rows:tableRows(['ID','Campaign ID','Customer ID','To Phone','Status','Sent','Delivered','Read','Created'],campaignMessages,['id','campaignId','customerId','toPhone','status','sentAt','deliveredAt','readAt','createdAt'])},
   {name:'Subscription',rows:tableRows(['ID','Plan','Status','Monthly Price','Interval','Provider','Current Period End','Trial Started','Trial Ends'],subscription?[subscription]:[],['id','plan','status',x=>Number(x.monthlyPrice||0),'billingInterval','provider','currentPeriodEnd','trialStartedAt','trialEndsAt'])},
   {name:'Plan Requests',rows:tableRows(['ID','Plan Code','Plan Name','Price','Interval','Status','Payment Status','Requested','Approved','Rejected'],planRequests,['id','planCode','planName',x=>Number(x.price||0),'billingInterval','status','paymentStatus','createdAt','approvedAt','rejectedAt'])},
   {name:'Google Connections',rows:tableRows(['ID','User ID','Business ID','Google Account ID','Expires','Scope','Created','Updated'],googleConnections,['id','userId','businessId','googleAccountId','expiresAt','scope','createdAt','updatedAt'])},
   {name:'WhatsApp Connection',rows:tableRows(['ID','Business ID','Phone Number ID','WABA ID','Display Phone','Token Expires','Connected','Status'],whatsappConnection?[whatsappConnection]:[],['id','businessId','phoneNumberId','wabaId','displayPhone','tokenExpiresAt','connectedAt','status'])},
   {name:'Notifications',rows:tableRows(['ID','User ID','Type','Title','Message','Read At','Created'],notifications,['id','userId','type','title','message','readAt','createdAt'])},
   {name:'Review Sync Logs',rows:tableRows(['ID','Location ID','Status','Provider','Imported','Updated','Error','Created'],reviewSyncLogs,['id','locationId','status','provider','imported','updated','error','createdAt'])}
  ];
  const xlsx=makeXlsx(sheets);
  await prisma.auditLog.create({data:{actorUserId:user.id,action:'ADMIN_BUSINESS_DATA_EXPORTED',entity:'Business',entityId:b.id,metadata:{businessName:b.name,format:'xlsx',sheetCount:sheets.length}}});
  const safeName=String(b.name||'business').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60)||'business';
  res.status(200).set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+safeName+'-data.xlsx"','Content-Length':String(xlsx.length),'Cache-Control':'no-store'}).send(xlsx);
 }catch(e){next(e)}});

 originalPost.call(app,'/api/admin/businesses/:businessId/status',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const body=await readAdminJsonBody(req);
  const isOpen=body?.isOpen;
  if(typeof isOpen!=='boolean')return res.status(400).json({error:'isOpen must be true or false'});
  const business=await prisma.business.findUnique({where:{id:req.params.businessId},select:{id:true,name:true}});
  if(!business)return res.status(404).json({error:'Business not found'});
  const updated=await prisma.business.update({where:{id:business.id},data:{isOpen}});
  await prisma.auditLog.create({data:{actorUserId:user.id,action:isOpen?'ADMIN_BUSINESS_OPENED':'ADMIN_BUSINESS_CLOSED',entity:'Business',entityId:business.id,metadata:{isOpen}}});
  res.json({ok:true,isOpen:Boolean(updated.isOpen)});
}catch(e){next(e)}});

 originalPost.call(app,'/api/admin/businesses/:businessId/features',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const body=await readAdminJsonBody(req);
  const feature=String(body?.feature||'').toUpperCase();
  const enabled=body?.enabled;
  if(!ADMIN_FEATURE_KEYS.includes(feature))return res.status(400).json({error:'Unknown feature control'});
  if(typeof enabled!=='boolean')return res.status(400).json({error:'enabled must be true or false'});
  const business=await prisma.business.findUnique({where:{id:req.params.businessId},select:{id:true,name:true}});
  if(!business)return res.status(404).json({error:'Business not found'});
  const currentRows=await prisma.$queryRawUnsafe('SELECT COALESCE("adminFeatureFlags", \'{}\'::jsonb) AS flags FROM "Business" WHERE "id" = $1',business.id);
  let flags=currentRows?.[0]?.flags||{};
  if(typeof flags==='string'){try{flags=JSON.parse(flags)}catch{flags={}}}
  flags={...flags,[feature]:enabled};
  await prisma.$executeRawUnsafe('UPDATE "Business" SET "adminFeatureFlags" = $1::jsonb WHERE "id" = $2',JSON.stringify(flags),business.id);
  if(feature==='WHATSAPP'){
    const connection=await prisma.whatsAppConnection.findUnique({where:{businessId:business.id}});
    if(connection){
      const nextStatus=enabled?(connection.accessTokenEnc?'CONNECTED':'DISCONNECTED'):'DISABLED';
      await prisma.whatsAppConnection.update({where:{businessId:business.id},data:{status:nextStatus}});
    }
  }
  await prisma.auditLog.create({data:{actorUserId:user.id,action:enabled?'ADMIN_FEATURE_ENABLED':'ADMIN_FEATURE_DISABLED',entity:'Business',entityId:business.id,metadata:{feature,enabled}}});
  res.json({ok:true,feature,enabled,flags});
}catch(e){next(e)}});

 originalPost.call(app,'/api/admin/businesses/:businessId/delete',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const body=await readAdminJsonBody(req);
  if(body?.confirmation!=='DELETE')return res.status(400).json({error:'Deletion confirmation is required'});
  const businessId=req.params.businessId;
  const business=await prisma.business.findUnique({where:{id:businessId},include:{members:true}});
  if(!business)return res.status(404).json({error:'Business not found'});
  await prisma.$transaction(async tx=>{
    await tx.auditLog.create({data:{actorUserId:user.id,action:'ADMIN_BUSINESS_DELETED',entity:'Business',entityId:business.id,metadata:{businessName:business.name,memberCount:business.members.length}}});
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
  });
  res.json({ok:true});
}catch(e){next(e)}});

 originalPost.call(app,'/api/admin/businesses/:businessId/reset-password',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const body=await readAdminJsonBody(req);
  const password=typeof body?.password==='string'?body.password:'';
  if(password.length<8||password.length>200)return res.status(400).json({error:'Password must be between 8 and 200 characters'});
  const business=await prisma.business.findUnique({where:{id:req.params.businessId},include:{members:{where:{role:'OWNER'},select:{userId:true}}}});
  if(!business)return res.status(404).json({error:'Business not found'});
  const ownerIds=business.members.map(m=>m.userId).filter(Boolean);
  if(!ownerIds.length)return res.status(400).json({error:'No business owner account found'});
  const passwordHash=hashPassword(password);
  const adminToken=getCookie(req,'rp_admin_session');
  const adminTokenHash=adminToken?tokenHash(adminToken):null;
  await prisma.$transaction(async tx=>{
    await tx.user.updateMany({where:{id:{in:ownerIds}},data:{passwordHash}});
    await tx.session.deleteMany({
      where:{
        userId:{in:ownerIds},
        ...(adminTokenHash?{tokenHash:{not:adminTokenHash}}:{})
      }
    });
    await tx.auditLog.create({data:{actorUserId:user.id,action:'ADMIN_OWNER_PASSWORD_CHANGED',entity:'Business',entityId:business.id,metadata:{ownerCount:ownerIds.length}}});
  });
  res.json({ok:true});
}catch(e){next(e)}});

 originalPost.call(app,'/api/admin/plan-requests/:requestId/payment-status',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const body=await readAdminJsonBody(req);
  const paymentStatus=String(body?.paymentStatus||'').trim().toUpperCase();
  const allowed=['PENDING','PAID','FAILED','EXPIRED'];
  if(paymentStatus==='MANUAL')return res.status(400).json({error:'MANUAL is no longer a valid payment status; use PENDING'});
  if(!allowed.includes(paymentStatus))return res.status(400).json({error:'Invalid payment status'});
  const request=await prisma.planRequest.findUnique({where:{id:req.params.requestId}});
  if(!request)return res.status(404).json({error:'Plan request not found'});
  const updated=await prisma.planRequest.update({where:{id:request.id},data:{paymentStatus}});
  await prisma.auditLog.create({data:{actorUserId:user.id,action:'ADMIN_PLAN_PAYMENT_STATUS_CHANGED',entity:'PlanRequest',entityId:request.id,metadata:{businessId:request.businessId,paymentStatus}}});
  res.json({ok:true,request:updated});
}catch(e){next(e)}});

 originalPost.call(app,'/api/admin/pending-plan-requests/:requestId/reject',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const reason=String(req.body?.reason||'').trim();
  if(!reason)return res.status(400).json({error:'Rejection reason is required'});
  const request=await prisma.planRequest.findUnique({where:{id:req.params.requestId}});
  if(!request)return res.status(404).json({error:'Plan request not found'});
  if(request.status!=='PENDING')return res.status(400).json({error:'This plan request is no longer pending'});
  const rejected=await prisma.planRequest.update({where:{id:request.id},data:{status:'REJECTED',rejectionReason:reason,rejectedAt:new Date()}});
  await prisma.auditLog.create({data:{actorUserId:user.id,action:'REJECT_PLAN_REQUEST',entity:'PlanRequest',entityId:request.id,metadata:{businessId:request.businessId,reason}}});
  res.json({ok:true,request:rejected});
}catch(e){next(e)}});

 originalGet.call(app,'/api/admin/trials',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const subs=await prisma.subscription.findMany({where:{status:'TRIAL'},include:{business:{include:{members:{where:{role:'OWNER'},include:{user:{select:{name:true,email:true}}}}}}},orderBy:{trialEndsAt:'asc'}});
  const now=Date.now();
  const trials=subs.map(s=>{const owner=s.business.members[0]?.user;const daysRemaining=Math.max(0,Math.ceil((new Date(s.trialEndsAt||0).getTime()-now)/(24*60*60*1000)));return {id:s.id,businessId:s.businessId,businessName:s.business.name,businessType:s.business.type,isOpen:s.business.isOpen,ownerName:owner?.name||null,ownerEmail:owner?.email||null,plan:s.plan,billingInterval:s.billingInterval,monthlyPrice:s.monthlyPrice,trialStartedAt:s.trialStartedAt,trialEndsAt:s.trialEndsAt,daysRemaining}});
  res.json({trials});
 }catch(e){next(e)}});

 originalGet.call(app,'/api/admin/pending-plan-requests',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const requests=await prisma.planRequest.findMany({where:{status:'PENDING',isCustom:false},include:{business:{include:{members:{where:{role:'OWNER'},include:{user:{select:{name:true,email:true}}}}}},user:{select:{name:true,email:true}}},orderBy:{createdAt:'asc'}});
  const mapped=requests.map(x=>{const owner=x.business.members[0]?.user;return {id:x.id,businessId:x.businessId,businessName:x.business.name,businessType:x.business.type,ownerName:owner?.name||null,ownerEmail:owner?.email||null,requesterName:x.user?.name||null,requesterEmail:x.user?.email||null,planCode:x.planCode,planName:x.planName,price:x.price,billingInterval:x.billingInterval,status:x.status,paymentStatus:x.paymentStatus,createdAt:x.createdAt}});
  res.json({requests:mapped});
 }catch(e){next(e)}});

 originalPost.call(app,'/api/admin/custom-plan-requests/:requestId/quote',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  await prisma.$executeRawUnsafe(\`ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT FALSE\`);
  await prisma.$executeRawUnsafe(\`ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "customDetails" TEXT\`);
  const body=await readAdminJsonBody(req);const planName=String(body?.planName||'').trim();const billingInterval=String(body?.billingInterval||'').trim().toUpperCase();const price=Number(body?.price);const customDetails=String(body?.customDetails||'').trim().slice(0,1500);
  if(!planName||planName.length>80||!['MONTH','YEAR'].includes(billingInterval)||!Number.isFinite(price)||price<0)return res.status(400).json({error:'Invalid custom quotation'});
  const request=await prisma.planRequest.findUnique({where:{id:req.params.requestId}});
  if(!request||!request.isCustom)return res.status(404).json({error:'Custom plan request not found'});
  if(request.status!=='PENDING')return res.status(400).json({error:'This custom plan request is no longer pending'});
  const updated=await prisma.planRequest.update({where:{id:request.id},data:{planName,price,billingInterval,customDetails}});
  await prisma.auditLog.create({data:{actorUserId:user.id,action:'UPDATE_CUSTOM_PLAN_QUOTE',entity:'PlanRequest',entityId:request.id,metadata:{businessId:request.businessId,planName,billingInterval,price}}});
  res.json({ok:true,request:updated});
 }catch(e){next(e)}});

 originalGet.call(app,'/api/admin/custom-plan-requests',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  await prisma.$executeRawUnsafe(\`ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT FALSE\`);
  await prisma.$executeRawUnsafe(\`ALTER TABLE "PlanRequest" ADD COLUMN IF NOT EXISTS "customDetails" TEXT\`);
  const requests=await prisma.planRequest.findMany({where:{isCustom:true},include:{business:{include:{members:{where:{role:'OWNER'},include:{user:{select:{name:true,email:true}}}}}},user:{select:{name:true,email:true}}},orderBy:{createdAt:'desc'}});
  const mapped=requests.map(x=>{const owner=x.business.members[0]?.user;return {id:x.id,businessId:x.businessId,businessName:x.business.name,businessType:x.business.type,ownerName:owner?.name||null,ownerEmail:owner?.email||null,requesterName:x.user?.name||null,requesterEmail:x.user?.email||null,planCode:x.planCode,planName:x.planName,price:x.price,billingInterval:x.billingInterval,status:x.status,paymentStatus:x.paymentStatus,customDetails:x.customDetails||'',createdAt:x.createdAt}});
  res.json({requests:mapped});
 }catch(e){next(e)}});

 originalGet.call(app,'/api/admin/active-subscriptions',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const subs=await prisma.subscription.findMany({where:{status:'ACTIVE'}});
  const businessIds=[...new Set(subs.map(s=>s.businessId).filter(Boolean))];
  const businesses=businessIds.length?await prisma.business.findMany({where:{id:{in:businessIds}},include:{members:{where:{role:'OWNER'},include:{user:{select:{name:true,email:true}}}}}}):[];
  const businessMap=new Map(businesses.map(b=>[b.id,b]));
  const now=Date.now();
  const subscriptions=subs.map(s=>{const business=businessMap.get(s.businessId);const owner=business?.members?.[0]?.user;const daysRemaining=Math.max(0,Math.ceil((new Date(s.currentPeriodEnd||0).getTime()-now)/(24*60*60*1000)));return {id:s.id,businessId:s.businessId,businessName:business?.name||'Unknown Business',businessType:business?.type||null,isOpen:business?.isOpen??false,ownerName:owner?.name||null,ownerEmail:owner?.email||null,plan:s.plan,billingInterval:s.billingInterval,monthlyPrice:s.monthlyPrice,currentPeriodEnd:s.currentPeriodEnd,daysRemaining,status:s.status}});
  res.json({subscriptions});
 }catch(e){next(e)}});

 originalGet.call(app,'/api/admin/unpaid-bills',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const requests=await prisma.planRequest.findMany({
   where:{paymentStatus:{not:'PAID'},status:'APPROVED'},
   include:{business:{include:{members:{where:{role:'OWNER'},include:{user:{select:{name:true,email:true}}}}}},user:{select:{name:true,email:true}}},
   orderBy:{createdAt:'asc'}
  });
  const bills=requests.map(x=>{
   const owner=x.business.members[0]?.user;
   return {
    id:x.id,businessId:x.businessId,businessName:x.business.name,businessType:x.business.type,
    ownerName:owner?.name||x.ownerName||x.user?.name||null,
    ownerEmail:owner?.email||x.user?.email||null,
    planCode:x.planCode,planName:x.planName,price:x.price,billingInterval:x.billingInterval,
    status:x.status,paymentStatus:x.paymentStatus==='MANUAL'?'PENDING':x.paymentStatus,contact:x.contact,createdAt:x.createdAt,updatedAt:x.updatedAt
   };
  });
  const totalAmount=bills.reduce((sum,x)=>sum+Number(x.price||0),0);
  res.json({bills,totalAmount});
 }catch(e){next(e)}});

 originalPost.call(app,'/api/admin/pending-plan-requests/:requestId/approve',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const request=await prisma.planRequest.findUnique({where:{id:req.params.requestId},include:{business:true}});
  if(!request)return res.status(404).json({error:'Plan request not found'});
  if(request.status!=='PENDING')return res.status(400).json({error:'This plan request is no longer pending'});
  const now=new Date();
  const periodEnd=new Date(now);
  if(request.billingInterval==='YEAR')periodEnd.setFullYear(periodEnd.getFullYear()+1);
  else periodEnd.setMonth(periodEnd.getMonth()+1);
  const result=await prisma.$transaction(async tx=>{
    const subscription=await tx.subscription.upsert({
      where:{businessId:request.businessId},
      create:{businessId:request.businessId,plan:request.planCode,status:'ACTIVE',monthlyPrice:request.price,billingInterval:request.billingInterval,provider:'manual',currentPeriodEnd:periodEnd},
      update:{plan:request.planCode,status:'ACTIVE',monthlyPrice:request.price,billingInterval:request.billingInterval,provider:'manual',currentPeriodEnd:periodEnd,trialStartedAt:null,trialEndsAt:null}
    });
    const approved=await tx.planRequest.update({where:{id:request.id},data:{status:'APPROVED',approvedAt:now,approvedByUserId:user.id,paymentStatus:'PENDING'}});
    await tx.auditLog.create({data:{actorUserId:user.id,action:'APPROVE_PLAN_REQUEST',entity:'PlanRequest',entityId:request.id,metadata:{businessId:request.businessId,planCode:request.planCode}}});
    return {subscription,approved};
  });
  res.json({ok:true,subscription:result.subscription,request:result.approved});
 }catch(e){next(e)}});

 originalGet.call(app,'/api/admin/users',async(req,res,next)=>{
  try {
   const user=await requireAdmin(req,res); if(!user)return;
   const users=await prisma.user.findMany({include:{memberships:true},orderBy:{createdAt:'desc'}});
   const mapped=users.map(u=>({id:u.id,name:u.name,email:u.email,role:u.role,businessCount:u.memberships.length,createdAt:u.createdAt}));
   res.json({users:mapped});
  } catch(e) { next(e); }
 });
 originalGet.call(app,'/api/admin/plans',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const plans=await prisma.planCatalog.findMany({orderBy:{price:'asc'}});
  const pending=await prisma.planRequest.count({where:{status:'PENDING'}});
  res.json({plans,pending});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/analytics',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const istYear=parts.find(x=>x.type==='year').value;
  const istMonth=parts.find(x=>x.type==='month').value;
  const istDay=parts.find(x=>x.type==='day').value;
  const monthStart=new Date(istYear+'-'+istMonth+'-01T00:00:00+05:30');
  const yearStart=new Date(istYear+'-01-01T00:00:00+05:30');
  const istMidnightUtc=Date.UTC(Number(istYear),Number(istMonth)-1,Number(istDay));
  const istWeekday=new Date(istMidnightUtc).getUTCDay();
  const weekStart=new Date(istMidnightUtc-((istWeekday+6)%7)*86400000-330*60000);
  const [businesses,activeSubscriptions,trialSubscriptions,pendingRequests,users,paidOrderAgg,monthOrderAgg,yearOrderAgg,paidSubscriptionAgg,weekSubscriptionAgg,monthSubscriptionAgg,yearSubscriptionAgg,paidSubscriptionRequests]=await Promise.all([
   prisma.business.count(),
   prisma.subscription.count({where:{status:'ACTIVE'}}),
   prisma.subscription.count({where:{status:'TRIAL'}}),
   prisma.planRequest.count({where:{status:'PENDING'}}),
   prisma.user.count(),
   prisma.order.aggregate({where:{paymentStatus:'PAID'},_sum:{total:true},_count:{_all:true}}),
   prisma.order.aggregate({where:{paymentStatus:'PAID',createdAt:{gte:monthStart}},_sum:{total:true}}),
   prisma.order.aggregate({where:{paymentStatus:'PAID',createdAt:{gte:yearStart}},_sum:{total:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID'},_sum:{price:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID',createdAt:{gte:weekStart}},_sum:{price:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID',createdAt:{gte:monthStart}},_sum:{price:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID',createdAt:{gte:yearStart}},_sum:{price:true}}),
   prisma.planRequest.findMany({where:{status:'APPROVED',paymentStatus:'PAID'},select:{planCode:true,planName:true,billingInterval:true,price:true}})
  ]);
  const paidOrders=paidOrderAgg._count._all;
  const paidOrderRevenue=Number(paidOrderAgg._sum.total||0);
  const paidSubscriptionRevenue=Number(paidSubscriptionAgg._sum.price||0);
  const thisWeekSubscriptionRevenue=Number(weekSubscriptionAgg._sum.price||0);
  const thisMonthOrderRevenue=Number(monthOrderAgg._sum.total||0);
  const thisMonthSubscriptionRevenue=Number(monthSubscriptionAgg._sum.price||0);
  const thisYearOrderRevenue=Number(yearOrderAgg._sum.total||0);
  const thisYearSubscriptionRevenue=Number(yearSubscriptionAgg._sum.price||0);
  const monthlyRevenue=paidSubscriptionRequests.filter(x=>x.billingInterval==='MONTH').reduce((sum,x)=>sum+Number(x.price||0),0);
  const yearlyRevenue=paidSubscriptionRequests.filter(x=>x.billingInterval==='YEAR').reduce((sum,x)=>sum+Number(x.price||0),0);
  const byPlan={};
  paidSubscriptionRequests.forEach(x=>{
   const key=x.planName||x.planCode||'Unknown';
   if(!byPlan[key])byPlan[key]={plan:key,revenue:0,count:0};
   byPlan[key].revenue+=Number(x.price||0);byPlan[key].count++;
  });
  res.json({businesses,activeSubscriptions,trialSubscriptions,pendingRequests,users,orders:paidOrders,paidOrders,paidOrderRevenue,paidSubscriptionRevenue,thisWeekSubscriptionRevenue,thisMonthSubscriptionRevenue,thisYearSubscriptionRevenue,totalRevenue:paidOrderRevenue+paidSubscriptionRevenue,thisMonthRevenue:thisMonthOrderRevenue+thisMonthSubscriptionRevenue,thisYearRevenue:thisYearOrderRevenue+thisYearSubscriptionRevenue,monthlyRevenue,yearlyRevenue,byPlan:Object.values(byPlan).sort((a,b)=>b.revenue-a.revenue)});
 }catch(e){next(e);}});
 originalGet.call(app,'/api/admin/orders',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const now=new Date();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(now);
  const istYear=parts.find(x=>x.type==='year').value;
  const istMonth=parts.find(x=>x.type==='month').value;
  const monthStart=new Date(istYear+'-'+istMonth+'-01T00:00:00+05:30');
  const yearStart=new Date(istYear+'-01-01T00:00:00+05:30');
  const [count,pending,paid,sum,paidOrderAgg,monthOrderAgg,yearOrderAgg,subscriptionRevenue,monthSub,yearSub]=await Promise.all([
   prisma.order.count(),
   prisma.order.count({where:{status:'PENDING'}}),
   prisma.order.count({where:{paymentStatus:'PAID'}}),
   prisma.order.aggregate({_sum:{total:true}}),
   prisma.order.aggregate({where:{paymentStatus:'PAID'},_sum:{total:true}}),
   prisma.order.aggregate({where:{paymentStatus:'PAID',createdAt:{gte:monthStart}},_sum:{total:true}}),
   prisma.order.aggregate({where:{paymentStatus:'PAID',createdAt:{gte:yearStart}},_sum:{total:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID'},_sum:{price:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID',createdAt:{gte:monthStart}},_sum:{price:true}}),
   prisma.planRequest.aggregate({where:{status:'APPROVED',paymentStatus:'PAID',createdAt:{gte:yearStart}},_sum:{price:true}})
  ]);
  const orderValue=Number(sum._sum.total||0);
  const paidOrderRevenue=Number(paidOrderAgg._sum.total||0);
  const paidSubscriptionRevenue=Number(subscriptionRevenue._sum.price||0);
  const thisMonthOrderRevenue=Number(monthOrderAgg._sum.total||0);
  const thisMonthSubscriptionRevenue=Number(monthSub._sum.price||0);
  const thisYearOrderRevenue=Number(yearOrderAgg._sum.total||0);
  const thisYearSubscriptionRevenue=Number(yearSub._sum.price||0);
  res.json({count,pending,paid,value:orderValue,paidOrderRevenue,subscriptionRevenue:paidSubscriptionRevenue,paidSubscriptionRevenue,totalRevenue:paidOrderRevenue+paidSubscriptionRevenue,thisMonthRevenue:thisMonthOrderRevenue+thisMonthSubscriptionRevenue,thisYearRevenue:thisYearOrderRevenue+thisYearSubscriptionRevenue});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/reviews',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [count,approved,published,failed]=await Promise.all([
   prisma.review.count(),
   prisma.review.count({where:{replyStatus:'APPROVED'}}),
   prisma.review.count({where:{replyStatus:'PUBLISHED'}}),
   prisma.review.count({where:{replyStatus:'FAILED'}})
  ]);
  res.json({count,approved,published,failed});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/ai-usage',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [reviews,generated,pending,published,failed]=await Promise.all([
   prisma.review.count(),
   prisma.review.count({where:{aiReply:{not:null}}}),
   prisma.review.count({where:{replyStatus:'PENDING_APPROVAL',aiReply:{not:null}}}),
   prisma.review.count({where:{replyStatus:'PUBLISHED',aiReply:{not:null}}}),
   prisma.review.count({where:{replyStatus:'FAILED',aiReply:{not:null}}})
  ]);
  const [activity,businesses,allReviews]=await Promise.all([
   prisma.review.findMany({where:{aiReply:{not:null}},select:{businessId:true,replyStatus:true},take:10000}),
   prisma.business.findMany({select:{id:true,name:true},orderBy:{name:'asc'}}),
   prisma.review.findMany({select:{businessId:true}})
  ]);
  const stats=new Map(businesses.map(b=>[b.id,{businessId:b.id,reviewsProcessed:0,aiReplies:0,pending:0,published:0,businessName:b.name||'Unnamed business'}]));
  for(const x of allReviews){if(!x.businessId)continue;const s=stats.get(x.businessId);if(s)s.reviewsProcessed++;}
  for(const x of activity){if(!x.businessId)continue;const s=stats.get(x.businessId)||{businessId:x.businessId,reviewsProcessed:0,aiReplies:0,pending:0,published:0,businessName:'Unnamed business'};s.aiReplies++;if(x.replyStatus==='PENDING_APPROVAL')s.pending++;if(x.replyStatus==='PUBLISHED')s.published++;stats.set(x.businessId,s)}
  const rows=[...stats.values()].sort((a,b)=>b.aiReplies-a.aiReplies||a.businessName.localeCompare(b.businessName));
  res.json({reviewsProcessed:reviews,aiRepliesGenerated:generated,pendingApproval:pending,publishedAiReplies:published,failedReplies:failed,businessCount:rows.length,businesses:rows,providerMode:process.env.OPENAI_API_KEY?'OPENAI':'LOCAL FALLBACK',tokenTelemetry:'Not available from the current AI provider response; no token values are fabricated.'});
 }catch(e){next(e)}});
 originalGet.call(app,'/api/admin/business-health',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const now=new Date(), soon=new Date(now.getTime()+7*24*60*60*1000), stale=new Date(now.getTime()-30*24*60*60*1000);
  const [businesses,subs,payments,orders,reviews,flagRows]=await Promise.all([
   prisma.business.findMany({select:{id:true,name:true,type:true,isOpen:true,members:{where:{role:'OWNER'},select:{userId:true,user:{select:{name:true,email:true}}}}},orderBy:{name:'asc'}}),
   prisma.subscription.findMany({select:{businessId:true,status:true,plan:true,billingInterval:true,trialEndsAt:true,currentPeriodEnd:true}}),
   prisma.planRequest.findMany({where:{status:'APPROVED',paymentStatus:{not:'PAID'}},select:{businessId:true,paymentStatus:true,price:true,billingInterval:true,planName:true}}),
   prisma.order.findMany({select:{businessId:true,createdAt:true},orderBy:{createdAt:'desc'},take:10000}),
   prisma.review.findMany({select:{businessId:true,createdAt:true},orderBy:{createdAt:'desc'},take:10000}),
   prisma.$queryRawUnsafe('SELECT "id", COALESCE("adminFeatureFlags", \'{}\'::jsonb) AS flags FROM "Business"')
  ]);
  const subMap=new Map(subs.map(x=>[x.businessId,x]));
  const payMap=new Map(payments.map(x=>[x.businessId,x]));
  const latest=new Map();
  for(const x of [...orders,...reviews]){if(!x.businessId)continue;const t=new Date(x.createdAt).getTime();if(!latest.has(x.businessId)||t>new Date(latest.get(x.businessId)).getTime())latest.set(x.businessId,x.createdAt);}
  const flagsMap=new Map((flagRows||[]).map(x=>{let f=x.flags||{};if(typeof f==='string'){try{f=JSON.parse(f)}catch{f={}}}return [x.id,f]}));
  const rows=businesses.map(b=>{
   const sub=subMap.get(b.id), payment=payMap.get(b.id), last=latest.get(b.id);
   const risks=[];
   if(payment)risks.push('PAYMENT DUE');
   if(sub?.status==='TRIAL'&&sub.trialEndsAt&&new Date(sub.trialEndsAt)<=soon)risks.push('TRIAL ENDING');
   if(!sub||(!['ACTIVE','TRIAL'].includes(sub.status)))risks.push('NO ACTIVE SUBSCRIPTION');
   if(last&&new Date(last)<stale)risks.push('LOW ACTIVITY');
   if(!last)risks.push('NO ACTIVITY');
   if(!b.isOpen)risks.push('BUSINESS CLOSED');
   const flags=flagsMap.get(b.id)||{};
   const blocked=Object.entries(flags).filter(([k,v])=>v===false).map(([k])=>k);
   if(blocked.length)risks.push(blocked.length+' FEATURE'+(blocked.length>1?'S':'')+' BLOCKED');
   let riskLevel='HEALTHY';
   if(risks.some(x=>['PAYMENT DUE','NO ACTIVE SUBSCRIPTION','NO ACTIVITY','BUSINESS CLOSED'].includes(x)||x.includes('FEATURE')))riskLevel='HIGH';
   else if(risks.length)riskLevel='MEDIUM';
   const owner=b.members?.[0]?.user;
   return {businessId:b.id,businessName:b.name||'Unnamed business',businessType:b.type||'',ownerName:owner?.name||'',ownerEmail:owner?.email||'',riskLevel,risks,blockedFeatures:blocked,subscriptionLabel:sub?(String(sub.plan||'').replace(/_/g,' ')+' · '+(sub.billingInterval||'')):'No subscription',paymentLabel:payment?('Payment '+String(payment.paymentStatus||'PENDING')):'Paid / none pending',activityLabel:last?('Last activity '+new Date(last).toLocaleDateString('en-IN')):'No recorded order/review activity'};
  });
  const summary={attention:rows.filter(x=>x.riskLevel!=='HEALTHY').length,paymentIssues:rows.filter(x=>x.risks.includes('PAYMENT DUE')).length,trialsEndingSoon:rows.filter(x=>x.risks.includes('TRIAL ENDING')).length,blockedFeatures:rows.filter(x=>x.blockedFeatures.length>0).length};
  res.json({summary,businesses:rows});
 }catch(e){next(e)}});
 originalGet.call(app,'/api/admin/integrations',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [google,googleAccounts,whatsapp,whatsappConnected]=await Promise.all([
   prisma.googleConnection.count(),
   prisma.googleConnection.count({where:{googleAccountId:{not:null}}}),
   prisma.whatsAppConnection.count(),
   prisma.whatsAppConnection.count({where:{status:'CONNECTED'}})
  ]);
  res.json({google,googleAccounts,whatsapp,whatsappConnected});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/menus',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const [menus,published,qr,scans]=await Promise.all([
   prisma.menu.count(),
   prisma.menu.count({where:{isPublished:true}}),
   prisma.smartQr.count(),
   prisma.qrScan.count()
  ]);
  res.json({menus,published,qr,scans});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/webhooks-event-bus',async(req,res,next)=>{try{
 const user=await requireAdmin(req,res);if(!user)return;await ensureWebhookTables();const since=new Date(Date.now()-86400000);
 const [eventCount24h,logs,endpoints,deliveries,retry]=await Promise.all([
  prisma.auditLog.count({where:{createdAt:{gte:since}}}),prisma.auditLog.findMany({orderBy:{createdAt:'desc'},take:25}),
  prisma.$queryRawUnsafe(`SELECT "id","url","enabled" FROM "AdminWebhookEndpoint" ORDER BY "createdAt" DESC LIMIT 1`),
  prisma.$queryRawUnsafe(`SELECT "eventType","status","attempts","responseCode","error","createdAt" FROM "AdminWebhookDelivery" ORDER BY "createdAt" DESC LIMIT 25`),
  prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "count" FROM "AdminWebhookDelivery" WHERE "status"='FAILED' AND "nextAttemptAt"<=CURRENT_TIMESTAMP`)
 ]);
 const endpoint=endpoints[0]||null;const ids=[...new Set(logs.map(x=>x.actorUserId).filter(Boolean))];const actors=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,email:true}}):[];const map=new Map(actors.map(x=>[x.id,x.name||x.email]));await prisma.$queryRawUnsafe('SELECT 1');
 res.json({eventCount24h,webhookConfigured:Boolean(endpoint?.enabled),endpoint:endpoint?{url:endpoint.url,enabled:endpoint.enabled}:null,retryQueue:Number(retry[0]?.count||0),gateway:true,recentDeliveries:deliveries,recentEvents:logs.map(x=>({...x,actor:x.actorUserId?map.get(x.actorUserId)||'Unknown':'System'}))});
}catch(e){next(e)}});
 originalPost.call(app,'/api/admin/webhooks-event-bus/config',async(req,res,next)=>{try{
 const user=await requireAdmin(req,res);if(!user)return;await ensureWebhookTables();const body=await readAdminJsonBody(req),url=String(body?.url||'').trim(),secret=String(body?.secret||'').trim();let parsed;try{parsed=new URL(url)}catch{parsed=null}
 if(!parsed||parsed.protocol!=='https:')return res.status(400).json({error:'Webhook URL must be a valid HTTPS URL'});
 const existing=await prisma.$queryRawUnsafe(`SELECT "id","secret" FROM "AdminWebhookEndpoint" ORDER BY "createdAt" DESC LIMIT 1`),endpointSecret=secret||existing[0]?.secret||crypto.randomBytes(32).toString('hex'),id=existing[0]?.id||webhookId();
 await prisma.$executeRawUnsafe(`INSERT INTO "AdminWebhookEndpoint"("id","url","secret","enabled","lastEventAt") VALUES($1,$2,$3,true,CURRENT_TIMESTAMP) ON CONFLICT ("id") DO UPDATE SET "url"=$2,"secret"=$3,"enabled"=true,"updatedAt"=CURRENT_TIMESTAMP`,id,url,endpointSecret);
 res.json({ok:true});
}catch(e){next(e)}});
 originalPost.call(app,'/api/admin/webhooks-event-bus/test',async(req,res,next)=>{try{
 const user=await requireAdmin(req,res);if(!user)return;await ensureWebhookTables();const endpoint=(await prisma.$queryRawUnsafe(`SELECT "id","url","secret" FROM "AdminWebhookEndpoint" WHERE "enabled"=true ORDER BY "createdAt" DESC LIMIT 1`))[0];if(!endpoint)return res.status(400).json({error:'Configure and enable a webhook endpoint first'});
 const payload={event:'WEBHOOK_TEST',version:1,id:webhookId(),occurredAt:new Date().toISOString(),entity:'Platform',entityId:null,actorUserId:user.id,metadata:{source:'reputetechs.in admin dashboard'}},result=await webhookRequest(endpoint.url,endpoint.secret,payload);
 await prisma.$executeRawUnsafe(`INSERT INTO "AdminWebhookDelivery"("id","endpointId","auditId","eventType","payload","status","attempts","responseCode","error","deliveredAt") VALUES($1,$2,$3,$4,$5::jsonb,$6,1,$7,$8,$9)`,webhookId(),endpoint.id,payload.id,payload.event,JSON.stringify(payload),result.ok?'DELIVERED':'FAILED',result.status,result.error,result.ok?new Date():null);
 if(!result.ok)return res.status(502).json({error:'Webhook test failed'+(result.status?' (HTTP '+result.status+')':'' )+(result.error?': '+result.error:'')});res.json({ok:true});
}catch(e){next(e)}});
 originalGet.call(app,'/api/admin/audit',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  const logs=await prisma.auditLog.findMany({orderBy:{createdAt:'desc'},take:100});
  const ids=[...new Set(logs.map(x=>x.actorUserId).filter(Boolean))];
  const actors=ids.length?await prisma.user.findMany({where:{id:{in:ids}},select:{id:true,name:true,email:true}}):[];
  const map=new Map(actors.map(x=>[x.id,x.name||x.email]));
  res.json({logs:logs.map(x=>({...x,actor:x.actorUserId?map.get(x.actorUserId)||'Unknown':'System'}))});
 }catch(e){ next(e); }
 });
 originalGet.call(app,'/api/admin/system',async(req,res,next)=>{try{
  const user=await requireAdmin(req,res);if(!user)return;
  await prisma.$queryRawUnsafe('SELECT 1');
  res.json({database:true,environment:process.env.NODE_ENV||'production'});
 }catch(e){res.json({database:false,environment:process.env.NODE_ENV||'production'})}});

}
express.application.get=function(path,...handlers){install(this);return originalGet.call(this,path,...handlers)};
express.application.post=function(path,...handlers){install(this);return originalPost.call(this,path,...handlers)};
