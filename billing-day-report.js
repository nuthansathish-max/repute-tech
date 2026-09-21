import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalGet=express.application.get;
let installed=false;

const money=v=>Number(v||0).toFixed(2);
const startOfDay=()=>{const d=new Date();d.setHours(0,0,0,0);return d};

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({
    where:{tokenHash:tokenHash(token)},
    select:{user:true,expiresAt:true}
  }).catch(()=>null);
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}

async function access(req,businessId){
  const user=await userFrom(req);
  if(!user)return{status:401,error:'Authentication required'};
  const business=await prisma.business.findFirst({
    where:{
      id:String(businessId),
      ...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})
    },
    select:{id:true,name:true}
  });
  return business?{user,business}:{status:403,error:'Business access denied'};
}

function clean(v){
  return String(v??'')
    .split('\\').join('\\\\')
    .split('(').join('\\(')
    .split(')').join('\\)')
    .replace(/[\\r\\n]+/g,' ');
}

function makePdf(lines){
  const pages=[];
  for(let i=0;i<lines.length;i+=48)pages.push(lines.slice(i,i+48));
  if(!pages.length)pages.push([]);

  const o=[];
  o[0]='<< /Type /Catalog /Pages 2 0 R >>';
  o[1]='';
  o[2]='';
  o[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  const kids=[];
  pages.forEach((p,n)=>{
    const pn=5+n*2,cn=pn+1;
    kids.push(pn);
    const t=['BT','/F1 10 Tf','50 800 Td'];
    p.forEach((line,i)=>{
      if(i)t.push('0 -15 Td');
      t.push('('+clean(line)+') Tj');
    });
    t.push('ET');
    const s=t.join('\\n');
    o[pn-1]=`<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents ${cn} 0 R >>`;
    o[cn-1]=`<< /Length ${Buffer.byteLength(s,'binary')} >>\\nstream\\n${s}\\nendstream`;
  });

  o[1]=`<< /Type /Pages /Kids [${kids.map(x=>x+' 0 R').join(' ')}] /Count ${kids.length} >>`;

  let out='%PDF-1.4\\n',offs=[0];
  for(let i=0;i<o.length;i++){
    if(!o[i])continue;
    offs[i]=Buffer.byteLength(out,'binary');
    out+=`${i+1} 0 obj\\n${o[i]}\\nendobj\\n`;
  }
  const x=Buffer.byteLength(out,'binary');
  out+=`xref\\n0 ${o.length+1}\\n0000000000 65535 f \\n`;
  for(let i=1;i<=o.length;i++)out+=String(offs[i]||0).padStart(10,'0')+' 00000 n \\n';
  out+=`trailer\\n<< /Size ${o.length+1} /Root 1 0 R >>\\nstartxref\\n${x}\\n%%EOF`;
  return Buffer.from(out,'binary');
}

async function handle(req,res,next){
  try{
    const a=await access(req,req.params.businessId);
    if(a.error)return res.status(a.status).json({error:a.error});

    const start=startOfDay();
    const orders=await prisma.order.findMany({
      where:{businessId:a.business.id,createdAt:{gte:start}},
      include:{items:true},
      orderBy:{createdAt:'asc'}
    });

    const paid=orders.filter(o=>o.paymentStatus==='PAID');
    const total=paid.reduce((s,o)=>s+Number(o.total||0),0);
    const sum=m=>paid.filter(o=>o.paymentMethod===m).reduce((s,o)=>s+Number(o.total||0),0);

    const lines=[
      a.business.name,
      'FULL-DAY BILLING REPORT',
      'Date: '+start.toLocaleDateString('en-IN'),
      '',
      'Total bills: '+paid.length,
      'Total revenue: Rs '+money(total),
      'Cash: Rs '+money(sum('CASH')),
      'UPI: Rs '+money(sum('UPI')),
      'Card: Rs '+money(sum('CARD')),
      '',
      'BILL HISTORY',
      '------------------------------------------------------------'
    ];

    for(const o of paid){
      lines.push(
        o.orderNumber+' | '+
        new Date(o.createdAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})+' | '+
        (o.customerName||'Walk-in Customer')+' | '+
        (o.paymentMethod||'MANUAL')+' | Rs '+money(o.total)
      );
      for(const i of o.items){
        lines.push('  - '+i.itemName+' x'+i.quantity+' @ Rs '+money(i.unitPrice)+' = Rs '+money(i.lineTotal));
      }
    }

    lines.push('','FINAL TOTAL: Rs '+money(total));

    res.status(200).set({
      'Content-Type':'application/pdf',
      'Content-Disposition':'attachment; filename="billing-report-'+start.toISOString().slice(0,10)+'.pdf"',
      'Cache-Control':'no-store'
    }).send(makePdf(lines));
  }catch(e){next(e)}
}

function install(){
  if(installed)return;
  installed=true;
  originalGet.call(express.application,'/api/businesses/:businessId/billing/daily/pdf',handle);
}

express.application.get=function(path,...handlers){
  install();
  return originalGet.call(this,path,...handlers);
};
