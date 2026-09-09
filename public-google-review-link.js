import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getValidGoogleAccessToken } from './reviewPipeline.js';

const prisma = new PrismaClient();

function registerPublicGoogleReviewLink(app){
  if(app.__publicGoogleReviewLinkRegistered)return;
  app.__publicGoogleReviewLinkRegistered=true;

  app.get('/public/google-review/:slug', async (req,res)=>{
    try{
      const slug=String(req.params.slug||'').trim();
      const qr=await prisma.smartQr.findFirst({where:{slug},select:{businessId:true}});
      if(!qr?.businessId)return res.status(404).send('Google review link is not available.');

      const location=await prisma.location.findFirst({
        where:{businessId:qr.businessId,googleAccountId:{not:null},googleLocationId:{not:null}},
        orderBy:{lastReviewSyncAt:'desc'}
      });
      if(!location?.googleAccountId||!location.googleLocationId){
        return res.status(404).send('Google Business Profile is not connected for this business.');
      }

      const connection=await prisma.googleConnection.findFirst({
        where:{googleAccountId:location.googleAccountId},
        orderBy:{createdAt:'desc'}
      });
      if(!connection)return res.status(404).send('Google Business Profile is not connected for this business.');

      const access=await getValidGoogleAccessToken(prisma,connection);
      const locationName=`locations/${encodeURIComponent(location.googleLocationId)}`;
      const url=`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=metadata.newReviewUri`;
      const r=await fetch(url,{headers:{authorization:`Bearer ${access}`}});
      if(!r.ok)throw new Error(await r.text());
      const data=await r.json();
      const reviewUrl=data?.metadata?.newReviewUri||data?.metadata?.newReviewUrl;
      if(!reviewUrl)throw new Error('Google did not return a review URL.');
      return res.redirect(reviewUrl);
    }catch(error){
      return res.status(502).send('Google review link is temporarily unavailable. Please try again.');
    }
  });
}

const previousGet=express.application.get;
if(!express.application.__publicGoogleReviewGetPatched){
  express.application.__publicGoogleReviewGetPatched=true;
  express.application.get=function patchedPublicGoogleReviewGet(path,...handlers){
    if(!this.__publicGoogleReviewRegistering && !this.__publicGoogleReviewLinkRegistered){
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
      const req=this.req;
      const match=String(req?.path||'').match(/^\/q\/([^/]+)$/);
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
