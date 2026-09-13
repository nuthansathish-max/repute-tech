import express from 'express';

const originalGet = express.application.get;
let installed = false;

function cleanHtml(body){
  if(typeof body !== 'string') return body;
  body = body.replace('</head>', `<style id="billingHistoryClean">
    .tabs{display:none!important}
    .billrow .pill{display:none!important}
    .billrow [class*="pill"]{display:none!important}
  </style></head>`);
  body = body.replace('Recent bills and payment status.', 'Recent bills.');
  body = body.replace('Your recent bills and invoices.', 'Recent bills.');
  return body;
}

function wrapResponse(res){
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  res.send = body => originalSend(cleanHtml(body));
  res.end = (chunk, encoding, callback) => originalEnd(cleanHtml(chunk), encoding, callback);
}

function install(){
  if(installed) return;
  installed = true;

  express.application.get = function(path,...handlers){
    if(path === '/billing-pos'){
      const wrapped = handlers.map(handler => async (req,res,next)=>{
        wrapResponse(res);
        return handler(req,res,next);
      });
      return originalGet.call(this,path,...wrapped);
    }
    return originalGet.call(this,path,...handlers);
  };
}

install();
