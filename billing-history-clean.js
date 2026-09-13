import express from 'express';

const originalGet = express.application.get;
let installed = false;

function install(){
  if(installed) return;
  installed = true;

  express.application.get = function(path,...handlers){
    if(path === '/billing-pos'){
      const wrapped = handlers.map(handler => async (req,res,next)=>{
        const send = res.send.bind(res);
        res.send = body => {
          if(typeof body === 'string'){
            body = body.replace('</head>', `<style>
              .tabs{display:none!important}
              .billrow .pill{display:none!important}
            </style></head>`);
            body = body.replace('Recent bills and payment status.', 'Recent bills.');
          }
          return send(body);
        };
        return handler(req,res,next);
      });
      return originalGet.call(this,path,...wrapped);
    }
    return originalGet.call(this,path,...handlers);
  };
}

install();
