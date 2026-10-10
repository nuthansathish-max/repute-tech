import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(value){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function featureAliases(feature){
  const key=normalize(feature);
  if(['BILLING','BILLINGPOS','POS'].includes(key))return ['BILLING','BILLINGPOS','POS'];
  if(['ORDER','ORDERS'].includes(key))return ['ORDER','ORDERS'];
  return [key];
}

/**
 * Resolve a feature for a business: an explicit business override wins,
 * then the subscription plan's feature list/defaults. Accepts both legacy
 * feature arrays and newer ON/OFF objects.
 */
export async function isPlanFeatureEnabled(businessId, feature){
  const aliases=featureAliases(feature);
  if(!businessId||!aliases.length)return true;
  try{
    const rows=await prisma.$queryRawUnsafe(
      'SELECT COALESCE("adminFeatureFlags", \'{}\'::jsonb) AS flags FROM "Business" WHERE "id"=$1 LIMIT 1',
      String(businessId)
    );
    let flags=rows?.[0]?.flags??{};
    if(typeof flags==='string'){try{flags=JSON.parse(flags)}catch{flags={}}}
    if(flags&&typeof flags==='object'&&!Array.isArray(flags)){
      for(const [savedKey,value] of Object.entries(flags)){
        if(aliases.includes(normalize(savedKey))&&typeof value==='boolean')return value;
      }
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
    if(!plan||plan.features==null)return true;
    let features=plan.features;
    if(typeof features==='string'){try{features=JSON.parse(features)}catch{return true}}
    if(Array.isArray(features)){
      const enabled=new Set(features.map(normalize));
      return aliases.some(alias=>enabled.has(alias));
    }
    if(features&&typeof features==='object'){
      for(const [savedKey,value] of Object.entries(features)){
        if(aliases.includes(normalize(savedKey))&&typeof value==='boolean')return value;
      }
    }
    return true;
  }catch(error){
    console.error('Plan feature entitlement check failed:',error?.message||error);
    return true;
  }
}
