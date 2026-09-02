import { decrypt, encrypt } from './auth.js';
import { analyzeReview, generateReply } from './ai.js';

const GOOGLE_REVIEWS_BASE='https://mybusiness.googleapis.com/v4';

export async function getValidGoogleAccessToken(prisma,connection){
 let access=decrypt(connection.accessTokenEnc);
 if(!connection.expiresAt || connection.expiresAt.getTime()>Date.now()+60_000) return access;
 if(!connection.refreshTokenEnc) throw new Error('Google connection expired and no refresh token is available. Reconnect Google.');
 const refresh=decrypt(connection.refreshTokenEnc);
 const body=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID||'',client_secret:process.env.GOOGLE_CLIENT_SECRET||'',refresh_token:refresh,grant_type:'refresh_token'});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
 if(!r.ok) throw new Error(`Google token refresh failed: ${await r.text()}`);
 const data=await r.json(); access=data.access_token;
 await prisma.googleConnection.update({where:{id:connection.id},data:{accessTokenEnc:encrypt(access),expiresAt:new Date(Date.now()+(data.expires_in||3600)*1000)}});
 return access;
}
function normalizeGoogleReview(raw){
 const stars={ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5};
 return {googleReviewId:raw.reviewId||raw.name?.split('/').pop(),authorName:raw.reviewer?.displayName||'Anonymous',rating:stars[raw.starRating]||3,text:raw.comment||'',reply:raw.reviewReply?.comment||null,replyState:raw.reviewReply?.reviewReplyState||null,policyViolation:raw.reviewReply?.policyViolation||null,reviewReplyUrl:raw.reviewReplyUrl||null,googleUpdatedAt:raw.updateTime?new Date(raw.updateTime):null};
}
export async function listGoogleReviews(accessToken,accountId,locationId){
 const url=`${GOOGLE_REVIEWS_BASE}/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews?pageSize=100&orderBy=updateTime%20desc`;
 const r=await fetch(url,{headers:{authorization:`Bearer ${accessToken}`}}); if(!r.ok) throw new Error(`Google review list failed: ${await r.text()}`); return r.json();
}
export async function syncLocationReviews({prisma,businessId,location,connection}){
 const access=await getValidGoogleAccessToken(prisma,connection);
 if(!location.googleLocationId||!location.googleAccountId) throw new Error('Location is not linked to a Google account and location ID.');
 const data=await listGoogleReviews(access,location.googleAccountId,location.googleLocationId);
 let imported=0,updated=0;
 for(const raw of data.reviews||[]){
  const x=normalizeGoogleReview(raw); const existing=x.googleReviewId?await prisma.review.findFirst({where:{googleReviewId:x.googleReviewId}}):null; const ai=analyzeReview(x);
  const payload={businessId,locationId:location.id,googleReviewId:x.googleReviewId,authorName:x.authorName,rating:x.rating,text:x.text,source:'GOOGLE',sentiment:ai.sentiment,topics:ai.topics,replyState:x.replyState,policyViolation:x.policyViolation,reviewReplyUrl:x.reviewReplyUrl,googleUpdatedAt:x.googleUpdatedAt,syncedAt:new Date()};
  if(existing){ await prisma.review.update({where:{id:existing.id},data:payload}); updated++; } else { await prisma.review.create({data:payload}); imported++; }
 }
 await prisma.location.update({where:{id:location.id},data:{lastReviewSyncAt:new Date()}});
 await prisma.reviewSyncLog.create({data:{businessId,locationId:location.id,status:'SUCCESS',imported,updated}});
 return {imported,updated,total:(data.reviews||[]).length};
}
export async function publishGoogleReply({prisma,review,connection,replyText}){
 if(!review.googleReviewId||!review.locationId) throw new Error('This review is not linked to Google.');
 const location=await prisma.location.findUnique({where:{id:review.locationId}}); if(!location?.googleAccountId||!location.googleLocationId) throw new Error('Google location mapping is incomplete.');
 const access=await getValidGoogleAccessToken(prisma,connection);
 const url=`${GOOGLE_REVIEWS_BASE}/accounts/${encodeURIComponent(location.googleAccountId)}/locations/${encodeURIComponent(location.googleLocationId)}/reviews/${encodeURIComponent(review.googleReviewId)}/reply`;
 const r=await fetch(url,{method:'PUT',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},body:JSON.stringify({comment:replyText})});
 if(!r.ok) throw new Error(`Google reply publish failed: ${await r.text()}`); const out=await r.json();
 await prisma.review.update({where:{id:review.id},data:{aiReply:replyText,replyStatus:'PUBLISHED',publishedAt:new Date(),replyState:out.reviewReplyState||'PUBLISHED',policyViolation:out.policyViolation||null}});
 return out;
}
export async function mockSyncLocationReviews({prisma,businessId,location}){
 const demo=[
  {reviewId:'demo-google-001',reviewer:{displayName:'Ananya S.'},starRating:'FIVE',comment:'Amazing food and very friendly staff. Loved the ambience.',updateTime:new Date().toISOString()},
  {reviewId:'demo-google-002',reviewer:{displayName:'Kiran P.'},starRating:'TWO',comment:'The food was okay but waiting time was too long and service felt slow.',updateTime:new Date().toISOString()},
  {reviewId:'demo-google-003',reviewer:{displayName:'Maya R.'},starRating:'FOUR',comment:'Good coffee and clean place. Prices are a little high.',updateTime:new Date().toISOString()}
 ];
 let imported=0,updated=0; for(const raw of demo){ const x=normalizeGoogleReview(raw); const ai=analyzeReview(x); const existing=await prisma.review.findFirst({where:{googleReviewId:x.googleReviewId}}); const payload={businessId,locationId:location.id,googleReviewId:x.googleReviewId,authorName:x.authorName,rating:x.rating,text:x.text,source:'GOOGLE',sentiment:ai.sentiment,topics:ai.topics,googleUpdatedAt:x.googleUpdatedAt,syncedAt:new Date()}; if(existing){await prisma.review.update({where:{id:existing.id},data:payload});updated++;}else{await prisma.review.create({data:payload});imported++;}}
 await prisma.location.update({where:{id:location.id},data:{lastReviewSyncAt:new Date()}}); await prisma.reviewSyncLog.create({data:{businessId,locationId:location.id,status:'MOCK_SUCCESS',provider:'MOCK_GOOGLE',imported,updated}}); return {imported,updated,total:demo.length,mock:true};
}
export async function analyzeAndDraft({prisma,review,businessName,tone}){ const ai=analyzeReview(review); const reply=generateReply(review,{businessName,tone}); return prisma.review.update({where:{id:review.id},data:{sentiment:ai.sentiment,topics:ai.topics,aiReply:reply,replyStatus:'PENDING_APPROVAL'}}); }
