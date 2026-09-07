import express from 'express';

// The legacy orderRoutes.js is loaded by bootstrap.js before server.js. The
// unified public-all-order-route is registered later through the compatibility
// listen chain, but Express still uses the first matching route. Make the
// unified handler explicitly authoritative instead of guessing that it is the
// first match.
const previousListen = express.application.listen;

function stackFor(app){
  return app.router?.stack || app._router?.stack || [];
}

function routeHandlers(layer){
  return layer?.route?.stack || [];
}

function handlerSource(layer){
  return routeHandlers(layer).map(x => {
    try { return String(x?.handle || ''); } catch { return ''; }
  }).join('\n');
}

function moveUnifiedToFront(app, path, method, marker){
  const stack = stackFor(app);
  const index = stack.findIndex(layer =>
    layer?.route?.path === path &&
    layer?.route?.methods?.[method] &&
    handlerSource(layer).includes(marker)
  );
  if(index < 0 || index === 0) return;
  const [layer] = stack.splice(index, 1);
  stack.unshift(layer);
}

express.application.listen = function(...args){
  const result = previousListen.apply(this,args);

  // public-all-order-route.js marks its handlers with these log prefixes.
  // Move those exact handlers to the front so the old single-menu renderer
  // can never win for the customer order page.
  moveUnifiedToFront(this, '/q/:slug/order', 'get', '[public-all-order-route]');
  moveUnifiedToFront(this, '/api/public/orders', 'post', '[public-all-order-route POST]');

  return result;
};
