import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './auth.js';
const prisma=new PrismaClient();
const plans=[
  {code:'STARTER',name:'Starter',price:199,billingInterval:'MONTH',description:'Essential reputation tools for small local businesses',features:['Reviews','AI reply suggestions','Smart QR','Basic analytics']},
  {code:'GROWTH',name:'Growth',price:499,billingInterval:'MONTH',description:'Growth tools for active local businesses',features:['Everything in Starter','Digital menu','Customer CRM','WhatsApp marketing']},
  {code:'PRO',name:'Pro',price:999,billingInterval:'MONTH',description:'Advanced automation for growing businesses',features:['Everything in Growth','Advanced analytics','AI insights','Higher usage limits']},
  {code:'HIGH_TRAFFIC',name:'High Traffic',price:1999,billingInterval:'MONTH',description:'For theatres, grocery stores, supermarkets and high-traffic shops',features:['Everything in Pro','High-volume usage','Priority support','Multi-location ready']},
  {code:'ALL_IN_ONE_YEARLY',name:'All-in-One Yearly',price:8999,billingInterval:'YEAR',description:'All features in one yearly package',features:['Everything in High Traffic','All features','Best yearly value','Priority support']}
];
for(const p of plans) await prisma.planCatalog.upsert({where:{code:p.code},update:{name:p.name,price:p.price,billingInterval:p.billingInterval,description:p.description,features:p.features,active:true},create:p});
const user=await prisma.user.upsert({where:{email:'demo@repute-tech.in.local'},update:{},create:{name:'Demo Owner',email:'demo@repute-tech.in.local',passwordHash:hashPassword('DemoPass123!'),role:'OWNER'}});
const business=await prisma.business.upsert({where:{slug:'spice-garden'},update:{},create:{name:'Spice Garden Restaurant',type:'RESTAURANT',slug:'spice-garden',phone:'+91 90000 00000'}});
await prisma.businessMember.upsert({where:{userId_businessId:{userId:user.id,businessId:business.id}},update:{role:'OWNER'},create:{userId:user.id,businessId:business.id,role:'OWNER'}});
let location=await prisma.location.findFirst({where:{businessId:business.id}});if(!location)location=await prisma.location.create({data:{businessId:business.id,name:'Bengaluru Main Location',address:'Bengaluru'}});
await prisma.subscription.upsert({where:{businessId:business.id},update:{},create:{businessId:business.id,plan:'GROWTH',monthlyPrice:499,billingInterval:'MONTH'}});
if(await prisma.review.count({where:{businessId:business.id}})===0){for(const [name,rating,text] of [['Rahul K.',5,'Great food and quick service. Will visit again.'],['Priya S.',3,'Food was good, but waiting time was longer than expected.'],['Arun M.',5,'Loved the ambience and desserts!']]) await prisma.review.create({data:{businessId:business.id,locationId:location.id,authorName:name,rating,text}})}
console.log('Seeded demo login: demo@repute-tech.in.local / DemoPass123!');await prisma.$disconnect();
