import express from 'express';

// customer-order-and-owner-management registers its routes before the canonical
// server starts. Its registration is asynchronous because it uses Prisma only
// inside request handlers; the actual route registration itself is synchronous.
// Keep Express listen compatible with callers that expect the normal Server return value.
const currentListen = express.application.listen;
if(!express.application.__listenReturnFixed){
  express.application.__listenReturnFixed=true;
  express.application.listen=function fixedListen(...args){
    const result=currentListen.apply(this,args);
    return result && typeof result.then==='function' ? this : result;
  };
}
