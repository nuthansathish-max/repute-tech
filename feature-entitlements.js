import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(value){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}

/**
 * Resolves a feature for a tenant. An explicit business-level flag wins;
 * otherwise the active subscription's PlanCatalog default is applied.
 * Missing subscription/catalog settings preserve the existing allow behavior.
 */
export async function isPlanFeatureEnabled(businessId, feature){
  const key=String(feature||'').toUpperCase();
  if(!businessId||!key)return true;
  try{
    const rows=await prisma.$queryRawUnsafe(
      'SELECT COALESCE("adminFeatureFlags", \'{}\'::jsonb) AS flags FROM "Business" WHERE "id"=$1 LIMIT 1',
      String(businessId)
    );
    let flags=rows?.[0]?.flags??{};
    if(typeof flags==='string'){try{flags=JSON.parse(flags)}catch{flags={}}}
    if(flags&&typeof flags==='object'&&!Array.isArray(flags)&&typeof flags[key]==='boolean'){
      return flags[key];
    }
    const subscription=await prisma.subscription.findUnique({
      where:{businessId:String(businessId)},
      select:{plan:true}
    });
    if(!subscription?.plan)return true;
    const wanted=normalize(subscription.plan);
    const plans=await prisma.planCatalog.findMany({
      where:{active:true},
      select:{code:true,name:true,features:true}
    });
    const plan=plans.find(p=>normalize(p.code)===wanted||normalize(p.name)===wanted);
    if(!plan||!plan.features||typeof plan.features!=='object'||Array.isArray(plan.features))return true;
    return plan.features[key]===false?false:true;
  }catch(error){
    console.error('Plan feature entitlement check failed:',error?.message||error);
    // Fail open on lookup errors to avoid unexpectedly locking existing businesses.
    return true;
  }
}
