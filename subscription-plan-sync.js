import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const plans = [
  { code:'STARTER', name:'Starter', price:499, billingInterval:'MONTH' },
  { code:'GROWTH', name:'Growth Pro', price:999, billingInterval:'MONTH' },
  { code:'PRO', name:'Pro Plus', price:1499, billingInterval:'MONTH' },
  { code:'STARTER_YEARLY', name:'Starter Yearly', price:4999, billingInterval:'YEAR' },
  { code:'GROWTH_PRO_YEARLY', name:'Growth Pro Yearly', price:9999, billingInterval:'YEAR' },
  { code:'PRO_YEARLY', name:'Pro Yearly', price:12999, billingInterval:'YEAR' }
];

try {
  const existing = await prisma.planCatalog.findMany({ where:{ active:true } });
  const byCode = new Map(existing.map(p => [p.code, p]));

  for (const p of plans) {
    const source = byCode.get(p.code) || byCode.get(
      p.code === 'STARTER_YEARLY' ? 'STARTER' :
      p.code === 'GROWTH_PRO_YEARLY' ? 'GROWTH' :
      p.code === 'PRO_YEARLY' ? 'PRO' : p.code
    );
    await prisma.planCatalog.upsert({
      where:{ code:p.code },
      update:{
        name:p.name,
        price:p.price,
        billingInterval:p.billingInterval,
        active:true
      },
      create:{
        code:p.code,
        name:p.name,
        price:p.price,
        billingInterval:p.billingInterval,
        description:source?.description || null,
        features:source?.features || []
      }
    });
  }

  await prisma.planCatalog.updateMany({
    where:{ code:{ notIn:plans.map(p=>p.code) } },
    data:{ active:false }
  });
} finally {
  await prisma.$disconnect();
}
