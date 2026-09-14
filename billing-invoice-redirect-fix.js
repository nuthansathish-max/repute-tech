import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma=new PrismaClient();
const originalUse=express.application.use;
let installed=false;

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=v=>Number(v||0).toFixed(2);

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}}).catch(()=>null);
  if(!s||s.expiresAt<new Date())return null;
  return s.user;
}

async function access(req,businessId){
  const user=await userFrom(req);
  if(!user)return {status:401,error:'Authentication required'};
  const business=await prisma.business.findFirst({where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})},select:{id:true,name:true,phone:true}});
  if(!business)return {status:403,error:'Business access denied'};
  return {user,business};
}

async function billingMeta(orderId){
  const row=await prisma.auditLog.findFirst({where:{entity:'Order',entityId:orderId,action:'BILL_CREATED'},orderBy:{createdAt:'desc'}}).catch(()=>null);
  return row?.metadata&&typeof row.metadata==='object'?row.metadata:null;
}

function invoicePage(business,order,meta){
  const subtotal=Number(meta?.subtotal??order.items.reduce((s,i)=>s+Number(i.lineTotal||0),0));
  const discount=Number(meta?.discount||0),taxRate=Number(meta?.taxRate||0),tax=Number(meta?.tax||0),total=Number(order.total||0);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(order.orderNumber)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#111827;font-family:Arial,sans-serif}.paper{width:min(760px,100%);margin:20px auto;background:#fff;padding:32px;border:1px solid #e5e7eb}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:18px}.brand{font-size:25px;font-weight:800}.muted{color:#667085;font-size:12px}.bill{text-align:right}.items{margin-top:22px}.line{display:grid;grid-template-columns:1fr 80px 110px 110px;gap:10px;padding:10px 0;border-bottom:1px solid #eee}.line b{text-align:right}.totals{margin-left:auto;width:min(360px,100%);margin-top:18px}.total{display:flex;justify-content:space-between;padding:7px 0}.grand{font-size:20px;font-weight:800;border-top:2px solid #111827;margin-top:5px;padding-top:10px}.actions{margin-top:24px;display:flex;gap:10px}.btn{border:0;border-radius:9px;padding:11px 16px;font-weight:700;cursor:pointer;background:#111827;color:#fff}.btn.secondary{background:#fff;color:#111827;border:1px solid #d1d5db}@media print{body{background:#fff}.paper{border:0;margin:0;padding:15px}.actions{display:none}}@media(max-width:560px){.paper{padding:18px}.head{flex-direction:column}.bill{text-align:left}.line{grid-template-columns:1fr 55px 85px 85px;font-size:12px}}</style></head><body><main class="paper"><header class="head"><div><div class="brand">${esc(business.name)}</div><div class="muted">${esc(business.phone||'')}</div><div class="muted">GST / Tax invoice</div></div><div class="bill"><b>Bill #${esc(order.orderNumber)}</b><div class="muted">${new Date(order.createdAt).toLocaleString('en-IN')}</div><div class="muted">Payment: ${esc(order.paymentMethod||'MANUAL')} · ${esc(order.paymentStatus||'UNPAID')}</div></div></header><section style="margin-top:18px"><b>Customer</b><div>${esc(order.customerName||'Walk-in Customer')}</div><div class="muted">${esc(order.customerPhone||'')}</div></section><section class="items"><div class="line"><b>Item</b><b>Qty</b><b>Rate</b><b>Amount</b></div>${order.items.map(i=>`<div class="line"><span>${esc(i.itemName)}</span><span>${i.quantity}</span><span>₹${money(i.unitPrice)}</span><b>₹${money(i.lineTotal)}</b></div>`).join('')}</section><section class="totals"><div class="total"><span>Subtotal</span><b>₹${money(subtotal)}</b></div><div class="total"><span>Discount</span><b>- ₹${money(discount)}</b></div><div class="total"><span>GST / Tax (${money(taxRate)}%)</span><b>₹${money(tax)}</b></div><div class="total grand"><span>Total</span><b>₹${money(total)}</b></div></section><div class="muted" style="margin-top:18px">Thank you for your business.</div><div class="actions"><button class="btn" onclick="window.print()">Print / Save PDF</button><button class="btn secondary" onclick="history.back()">Back</button></div></main></body></html>`;
}

async function handleInvoice(req,res,next){
  try{
    const u=await userFrom(req);
    if(!u)return res.status(401).send('Authentication required');
    const orderId=String(req.path).split('/').pop();
    if(!orderId)return res.status(404).send('Bill not found');
    const order=await prisma.order.findUnique({where:{id:orderId},include:{items:true,business:true}});
    if(!order)return res.status(404).send('Bill not found');
    const a=await access(req,order.businessId);
    if(a.error)return res.status(a.status).send(a.error);
    const meta=await billingMeta(order.id)||{subtotal:order.items.reduce((s,i)=>s+Number(i.lineTotal||0),0),discount:0,taxRate:0,tax:0};
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.set('Pragma','no-cache');
    res.set('Expires','0');
    res.set('Surrogate-Control','no-store');
    return res.status(200).type('html').send(invoicePage(order.business,order,meta));
  }catch(e){next(e)}
}

function install(app){
  if(installed)return;
  installed=true;
  originalUse.call(app,(req,res,next)=>{
    if(req.path.startsWith('/billing-pos/invoice/')) return handleInvoice(req,res,next);
    next();
  });
}

express.application.use=function(...args){
  install(this);
  return originalUse.call(this,...args);
};
