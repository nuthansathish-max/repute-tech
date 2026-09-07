import express from 'express';

// The legacy orderRoutes.js is loaded before the compatibility modules. The
// unified all-menu order route is registered later, so at startup make the
// LAST matching /q/:slug/order GET and /api/public/orders POST route the first
// one Express evaluates. Do not depend on handler source text, which can vary
// between wrappers.
const previousListen = express.application.listen;

function stackFor(app){
  return app.router?.stack || app._router?.stack || [];
}

function isRoute(layer, path, method){
  return layer?.route?.path === path && layer?.route?.methods?.[method];
}

function moveLastMatchingToFront(app, path, method){
  const stack = stackFor(app);
  let index = -1;
  for(let i=stack.length-1;i>=0;i--){
    if(isRoute(stack[i],path,method)){ index=i; break; }
  }
  if(index <= 0) return;
  const [layer]=stack.splice(index,1);
  stack.unshift(layer);
}

express.application.listen = function(...args){
  const result = previousListen.apply(this,args);

  moveLastMatchingToFront(this,'/q/:slug/order','get');
  moveLastMatchingToFront(this,'/api/public/orders','post');

  return result;
};
