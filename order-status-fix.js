import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalPatch = express.application.patch;
let tablesReady = false;

async function ensureOrderTables(){
  if(tablesReady) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Order" ("id" TEXT PRIMARY KEY,"businessId" TEXT NOT NULL,"menuId" TEXT,"customerId" TEXT,"orderNumber" TEXT NOT NULL UNIQUE,"customerName" TEXT NOT NULL,"customerPhone" TEXT,"fulfilmentType" TEXT NOT NULL DEFAULT 'IN_STORE',"status" TEXT NOT NULL DEFAULT 'PENDING',"paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',"paymentMethod" TEXT NOT NULL DEFAULT 'MANUAL',"notes" TEXT,"total" DECIMAL(10,2) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OrderItem" ("id" TEXT PRIMARY KEY,"orderId" TEXT NOT NULL,"menuItemId" TEXT,"itemName" TEXT NOT NULL,"quantity" INTEGER NOT NULL,"unitPrice" DECIMAL(10,2) NOT NULL,"lineTotal" DECIMAL(10,2) NOT NULL)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_businessId_status_createdAt_idx" ON "Order" ("businessId","status","createdAt")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem" ("orderId")`);
  tablesReady = true;
}

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date())return null;
  return s.user;
}

async function updateOrderStatus(req,res,next){
  try{
    await ensureOrderTables();
    const order=await prisma.order.findUnique({where:{id:req.params.id},include:{items:true}});
    if(!order)return res.status(404).json({error:'Order not found'});
    const user=await userFrom(req);
    if(!user)return res.status(401).json({error:'Authentication required'});
    if(!['ADMIN','SUPER_ADMIN'].includes(user.role)){
      const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId:order.businessId}}});
      if(!member)return res.status(403).json({error:'Business access denied'});
    }
    const status=String(req.body?.status||'').toUpperCase();
    const allowed=['PENDING','ACCEPTED','DELIVERED','CANCELLED'];
    if(!allowed.includes(status))return res.status(400).json({error:'Invalid order status. Use PENDING, ACCEPTED, DELIVERED or CANCELLED.'});
    const transitions={PENDING:['PENDING','ACCEPTED','CANCELLED'],ACCEPTED:['ACCEPTED','DELIVERED','CANCELLED'],DELIVERED:['DELIVERED'],CANCELLED:['CANCELLED']};
    if(!transitions[order.status]?.includes(status)){
      if(order.status==='DELIVERED')return res.status(400).json({error:'Delivered orders cannot be changed.'});
      if(order.status==='CANCELLED')return res.status(400).json({error:'Cancelled orders cannot be changed.'});
      return res.status(400).json({error:`Order cannot be changed from ${order.status} to ${status}.`});
    }
    if(status===order.status)return res.json({ok:true,order});
    const updated=await prisma.order.update({where:{id:order.id},data:{status},include:{items:true}});
    if(order.customerId){
      await prisma.customerInteraction.create({data:{customerId:order.customerId,type:`ORDER_${status}`,channel:'DIGITAL_MENU',metadata:{orderId:order.id,orderNumber:order.orderNumber}}}).catch(()=>{});
    }
    res.json({ok:true,order:updated});
  }catch(e){next(e)}
}

express.application.patch=function(path,...handlers){
  if(path==='/api/orders/:id/status'){
    const middleware=handlers.length>1?handlers.slice(0,-1):[];
    return originalPatch.call(this,path,...middleware,updateOrderStatus);
  }
  return originalPatch.call(this,path,...handlers);
};
