import express from 'express';

// The legacy orderRoutes.js is loaded by bootstrap.js before server.js. The
// unified public order handlers are registered later. Express uses the first
// matching route, so make either authoritative all-menu implementation win.
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

function moveUnifiedToFront(app, path, method, markers){
  const stack = stackFor(app);
  const index = stack.findIndex(layer => {
    if(layer?.route?.path !== path || !layer?.route?.methods?.[method]) return false;
    const source=handlerSource(layer);
    return markers.some(marker=>source.includes(marker));
  });
  if(index < 0 || index === 0) return;
  const [layer] = stack.splice(index, 1);
  stack.unshift(layer);
}

express.application.listen = function(...args){
  const result = previousListen.apply(this,args);

  moveUnifiedToFront(this, '/q/:slug/order', 'get', [
    '[public-all-order-route]',
    'All published menus are available in one order page.'
  ]);
  moveUnifiedToFront(this, '/api/public/orders', 'post', [
    '[public-all-order-route POST]',
    "const slug=String(req.body?.slug||'').trim()"
  ]);

  return result;
};
