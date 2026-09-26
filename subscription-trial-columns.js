import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.$executeRawUnsafe('ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3)');
await prisma.$executeRawUnsafe('ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3)');

await prisma.$disconnect();
