import crypto from 'node:crypto';
export async function ensureAnnouncementTable(prisma){
 await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminAnnouncement" ("id" TEXT PRIMARY KEY,"title" TEXT NOT NULL,"message" TEXT NOT NULL,"audience" TEXT NOT NULL DEFAULT 'ALL',"businessIds" JSONB NOT NULL DEFAULT '[]'::jsonb,"status" TEXT NOT NULL DEFAULT 'DRAFT',"publishAt" TIMESTAMP(3),"expiresAt" TIMESTAMP(3),"publishedAt" TIMESTAMP(3),"createdByUserId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AdminAnnouncement_status_publishAt_idx" ON "AdminAnnouncement"("status","publishAt")`);
}
export async function publishDueAnnouncements(prisma){
 await ensureAnnouncementTable(prisma);
 const due=await prisma.$queryRawUnsafe(`SELECT "id" FROM "AdminAnnouncement" WHERE "status" IN ('SCHEDULED','PUBLISHED') AND ("publishAt" IS NULL OR "publishAt"<=CURRENT_TIMESTAMP) AND ("expiresAt" IS NULL OR "expiresAt">CURRENT_TIMESTAMP) ORDER BY "publishAt" ASC LIMIT 50`);
 for(const item of due) await prisma.$transaction(async tx=>{
  const rows=await tx.$queryRawUnsafe(`SELECT * FROM "AdminAnnouncement" WHERE "id"=$1 FOR UPDATE`,item.id),a=rows[0];
  if(!a||!['SCHEDULED','PUBLISHED'].includes(a.status)||(a.expiresAt&&new Date(a.expiresAt)<=new Date()))return;
  const ids=Array.isArray(a.businessIds)?a.businessIds:[];
  const businesses=await tx.business.findMany({where:a.audience==='ALL'?{}:{id:{in:ids}},select:{id:true,members:{where:{role:'OWNER',user:{role:'OWNER'}},select:{userId:true}}}});
  const recipients=[];for(const b of businesses)for(const m of b.members)recipients.push({userId:m.userId,businessId:b.id});
  const type='ANNOUNCEMENT:'+a.id;
  if(recipients.length){
   const existing=await tx.notification.findMany({where:{type,userId:{in:[...new Set(recipients.map(x=>x.userId))]}},select:{userId:true,businessId:true}});
   const seen=new Set(existing.map(x=>x.userId+':'+(x.businessId||'')));
   const data=recipients.filter(x=>!seen.has(x.userId+':'+x.businessId)).map(x=>({id:crypto.randomUUID(),userId:x.userId,businessId:x.businessId,type,title:a.title,message:a.message}));
   if(data.length)await tx.notification.createMany({data});
  }
  await tx.$executeRawUnsafe(`UPDATE "AdminAnnouncement" SET "status"='PUBLISHED',"publishedAt"=COALESCE("publishedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,a.id);
 });
 await prisma.$executeRawUnsafe(`UPDATE "AdminAnnouncement" SET "status"='EXPIRED',"updatedAt"=CURRENT_TIMESTAMP WHERE "status" IN ('PUBLISHED','SCHEDULED') AND "expiresAt" IS NOT NULL AND "expiresAt"<=CURRENT_TIMESTAMP`);
}
