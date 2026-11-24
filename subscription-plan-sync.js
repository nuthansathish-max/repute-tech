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
  for (const p of plans) {
    await prisma.planCatalog.upsert({
      where:{ code:p.code },
      // Seed only missing catalogue rows. Admin edits and deactivations are authoritative.
      update:{},
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
} finally {
  await prisma.$disconnect();
}
