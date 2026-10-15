import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalize(value){
  return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function featureAliases(feature){
  const key=normalize(feature);
  const groups={
    BILLING:['BILLING','BILLINGPOS','POS'],
    BILLINGPOS:['BILLING','BILLINGPOS','POS'],
    POS:['BILLING','BILLINGPOS','POS'],
    ORDER:['ORDER','ORDERS'],
    ORDERS:['ORDER','ORDERS'],
    AI:['AI','AIASSISTANT','AIREPLIES','AIREPLYSUGGESTIONS'],
    AIASSISTANT:['AI','AIASSISTANT','AIREPLIES','AIREPLYSUGGESTIONS'],
    AIINSIGHTS:['AIINSIGHTS'],
    BASICANALYTICS:['BASICANALYTICS'],
    ADVANCEDANALYTICS:['ADVANCEDANALYTICS','ANALYTICS'],
    QR:['QR','SMARTQR'],
    SMARTQR:['QR','SMARTQR'],
    MENU:['MENU','DIGITALMENU'],
    DIGITALMENU:['MENU','DIGITALMENU'],
    CUSTOMERS:['CUSTOMERS','CUSTOMERCRM','CRM'],
    CUSTOMERCRM:['CUSTOMERS','CUSTOMERCRM','CRM'],
    CRM:['CUSTOMERS','CUSTOMERCRM','CRM'],
    ANALYTICS:['ANALYTICS','BASICANALYTICS','ADVANCEDANALYTICS'],
    GOOGLE:['GOOGLE','GOOGLEBUSINESS','GOOGLEBUSINESSPROFILE'],
    WHATSAPP:['WHATSAPP','WHATSAPPMARKETING','WHATSAPPCAMPAIGNS'],
    REVIEWS:['REVIEWS','REVIEW']
  };
  return groups[key]||[key];
}
function labelFeatureAliases(label){
  const key=normalize(label);
  const labels={
    REVIEWS:['REVIEWS'],
    AIREPLYSUGGESTIONS:['AI'],
    AIREPLYDRAFTS:['AI'],
    AIREPLIES:['AI'],
    AIINSIGHTS:['AIINSIGHTS'],
    SMARTQR:['QR'],
    BASICANALYTICS:['BASICANALYTICS'],
    ADVANCEDANALYTICS:['ADVANCEDANALYTICS'],
    DIGITALMENU:['MENU'],
    CUSTOMERCRM:['CUSTOMERS'],
    WHATSAPPMARKETING:['WHATSAPP'],
    WHATSAPPCAMPAIGNS:['WHATSAPP'],
    MULTILOCATION:['MULTILOCATION'],
    PRIORITYSUPPORT:['PRIORITYSUPPORT'],
    HIGHERUSAGELIMITS:['USAGELIMITS']
  };
  return labels[key]||[key];
}
function arrayPlanHasFeature(plan, plans, aliases, seen=new Set()){
  if(!plan||seen.has(plan.code))return false;
  seen.add(plan.code);
  const features=Array.isArray(plan.features)?plan.features:[];
  for(const item of features){
    const key=normalize(item);
    if(labelFeatureAliases(key).some(alias=>aliases.includes(alias)))return true;
    if(key==='EVERYTHINGINSTARTER'){
      const base=plans.find(p=>normalize(p.code)==='STARTER'||normalize(p.name)==='STARTER');
      if(arrayPlanHasFeature(base,plans,aliases,seen))return true;
    }
    if(key==='EVERYTHINGINGROWTHPRO'){
      const base=plans.find(p=>normalize(p.code)==='GROWTH'||normalize(p.name)==='GROWTHPRO');
      if(arrayPlanHasFeature(base,plans,aliases,seen))return true;
    }
  }
  return false;
}

/**
 * Resolve a feature for a business: an explicit business override wins,
 * then the subscription plan's feature list/defaults. Accepts both legacy
 * feature arrays and newer ON/OFF objects.
 */
export async function isPlanFeatureEnabled(businessId, feature, options={}){
  const fallback=options?.failClosed===true?false:true;
  const aliases=featureAliases(feature);
  if(!businessId||!aliases.length)return fallback;
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
    if(!subscription?.plan)return fallback;
    const wanted=normalize(subscription.plan);
    const plans=await prisma.planCatalog.findMany({
      where:{active:true},
      select:{code:true,name:true,features:true}
    });
    const plan=plans.find(p=>normalize(p.code)===wanted||normalize(p.name)===wanted);
    if(!plan||plan.features==null)return fallback;
    let features=plan.features;
    if(typeof features==='string'){try{features=JSON.parse(features)}catch{return fallback}}
    if(Array.isArray(features)){
      // Older catalog records store display labels rather than stable entitlement keys.
      // Resolve those labels (and explicit "Everything in ..." inheritance) without
      // changing the catalog data itself.
      return arrayPlanHasFeature({...plan,features},plans,aliases);
    }
    if(features&&typeof features==='object'){
      let matched=false;
      for(const [savedKey,value] of Object.entries(features)){
        if(aliases.includes(normalize(savedKey))&&typeof value==='boolean'){
          matched=true;
          if(value)return true;
        }
      }
      if(matched)return false;
      // An explicitly configured feature-toggle object treats missing feature keys as OFF.
      // Preserve legacy behavior only when the object has no recognizable feature-toggle keys.
      const knownFeatureKeys=new Set(['DASHBOARD','REVIEWS','AI','AIASSISTANT','AIINSIGHTS','BASICANALYTICS','ADVANCEDANALYTICS','QR','SMARTQR','MENU','DIGITALMENU','WHATSAPP','ORDERS','ORDER','BILLING','BILLINGPOS','POS','CUSTOMERS','CUSTOMERCRM','ANALYTICS','GOOGLE','USAGELIMITS','PRICING','STAFF','SETTINGS']);
      if(Object.keys(features).some(key=>knownFeatureKeys.has(normalize(key))))return false;
    }
    return fallback;
  }catch(error){
    console.error('Plan feature entitlement check failed:',error?.message||error);
    return fallback;
  }
}
