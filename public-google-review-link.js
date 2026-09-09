import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getValidGoogleAccessToken } from './reviewPipeline.js';

const prisma = new PrismaClient();

async function findGoogleReviewUrl(location){
  const connections=location.googleAccountId
    ? await prisma.googleConnection.findMany({where:{googleAccountId:location.googleAccountId},orderBy:{createdAt:'desc'}})
    : await prisma.googleConnection.findMany({orderBy:{createdAt:'desc'},take:10});

  for(const connection of connections){
    try{
      const access=await getValidGoogleAccessToken(prisma,connection);
      const accountsRes=await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts',{headers:{authorization:`Bearer ${access}`}});
      if(!accountsRes.ok)continue;
      const accounts=await accountsRes.json();
      for(const account of accounts.accounts||[]){
        const accountName=String(account.name||'');
        if(!accountName)continue;
        const url=`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?pageSize=100&readMask=name,title,metadata`;
        const locationsRes=await fetch(url,{headers:{authorization:`Bearer ${access}`}});
        if(!locationsRes.ok)continue;
        const data=await locationsRes.json();
        const match=(data.locations||[]).find(x=>String(x.name||'').endsWith(`/locations/${location.googleLocationId}`));
        const reviewUrl=match?.metadata?.newReviewUri||match?.metadata?.newReviewUrl;
        if(reviewUrl)return reviewUrl;
      }
    }catch{}
  }
  return null;
}

function registerPublicGoogleReviewLink(app){
  if(app.__publicGoogleReviewLinkRegistered)return;
  app.__publicGoogleReviewLinkRegistered=true;
  app.get('/public/google-review/:slug',async(req,res)=>{
    try{
      const slug=String(req.params.slug||'').trim();
      const qr=await prisma.smartQr.findFirst({where:{slug},select:{businessId:true}});
      if(!qr?.businessId)return res.status(404).send('Google review link is not available.');
      const location=await prisma.location.findFirst({where:{businessId:qr.businessId,googleLocationId:{not:null}},orderBy:{lastReviewSyncAt:'desc'}});
      if(!location)return res.status(404).send('Connect this business to Google Business Profile first.');
      const reviewUrl=await findGoogleReviewUrl(location);
      if(!reviewUrl)return res.status(404).send('Google review link is not available yet. Please sync the connected Google Business Profile.');
      return res.redirect(reviewUrl);
    }catch{ return res.status(502).send('Google review link is temporarily unavailable. Please try again.'); }
  });
}

const previousGet=express.application.get;
if(!express.application.__publicGoogleReviewGetPatched){
  express.application.__publicGoogleReviewGetPatched=true;
  express.application.get=function patchedPublicGoogleReviewGet(path,...handlers){
    if(!this.__publicGoogleReviewRegistering&&!this.__publicGoogleReviewLinkRegistered){
      this.__publicGoogleReviewRegistering=true;
      registerPublicGoogleReviewLink(this);
      this.__publicGoogleReviewRegistering=false;
    }
    return previousGet.call(this,path,...handlers);
  };
}

const previousSend=express.response.send;
if(!express.response.__publicGoogleReviewSendPatched){
  express.response.__publicGoogleReviewSendPatched=true;
  express.response.send=function patchedPublicGoogleReviewSend(body){
    try{
      const path=String(this.req?.path||'');
      const match=path.match(/^\/(?:q|public\/qr|public\/q\/qr)\/([^/]+)$/);
      if(match&&typeof body==='string'&&body.includes('openFeedback()')){
        const slug=decodeURIComponent(match[1]);
        const href=`/public/google-review/${encodeURIComponent(slug)}`;
        body=body.replace('onclick="openFeedback()"',`onclick="window.location.href='${href}'"`);
        body=body.replace('⭐ Rate Experience','⭐ Review us on Google');
        body=body.replace('Your feedback helps us serve you better.','Your review will open directly on Google.');
        body=body.replace('No account is required. Your review is sent to the business review inbox.','You will be taken directly to this business on Google to leave your review.');
      }
    }catch{}
    return previousSend.call(this,body);
  };
}
