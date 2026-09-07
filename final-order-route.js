import express from 'express';

// The legacy orderRoutes.js is loaded by bootstrap.js before server.js. Several
// compatibility modules then add newer /q/:slug/order handlers. Express uses
// the first matching route, so the legacy handler can still win even though the
// unified handler was installed earlier in the compatibility chain.
//
// After the complete listen chain has registered its routes, move the first
// (unified) public-order handlers to the end of the router stack. This makes
// the unified all-menus page and its matching POST endpoint authoritative while
// leaving the legacy owner/order APIs intact.
const previousListen = express.application.listen;

function stackFor(app){
  return app.router?.stack || app._router?.stack || [];
}

function moveFirstMatchToEnd(app, path, method){
  const stack = stackFor(app);
  const index = stack.findIndex(layer => layer?.route?.path === path && layer?.route?.methods?.[method]);
  if(index < 0 || index === stack.length - 1) return;
  const [layer] = stack.splice(index, 1);
  stack.push(layer);
}

express.application.listen = function(...args){
  const result = previousListen.apply(this,args);

  // Route registration in the compatibility installers is synchronous up to
  // their listen wrapper return, so the router stack is ready here.
  moveFirstMatchToEnd(this, '/q/:slug/order', 'get');
  moveFirstMatchToEnd(this, '/api/public/orders', 'post');

  return result;
};
