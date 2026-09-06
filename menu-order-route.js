import express from 'express';

// Menu-specific public ordering must be registered before the orderRoutes module
// adds its fallback /q/:slug/order handler. We internally rewrite the request to
// that stable handler instead of redirecting the browser to a generic-looking URL.
const previousGet = express.application.get;
const previousListen = express.application.listen;

function registerMenuSpecificOrderRoute(app) {
  if (app.__menuSpecificOrderRouteRegistered) return;
  app.__menuSpecificOrderRouteRegistered = true;

  previousGet.call(app, '/q/:slug/order/:menuId', (req, res, next) => {
    const slug = String(req.params.slug || '').trim();
    const menuId = String(req.params.menuId || '').trim();
    if (!slug || !menuId) return res.status(404).send('Menu not found');

    const query = new URLSearchParams(req.query || '');
    query.set('menuId', menuId);

    // Continue through Express to the existing /q/:slug/order handler.
    // That handler validates businessId + isPublished and renders only this menu.
    req.url = `/q/${encodeURIComponent(slug)}/order?${query.toString()}`;
    return next();
  });
}

if (!express.application.__menuSpecificOrderGetPatched) {
  express.application.__menuSpecificOrderGetPatched = true;

  express.application.get = function patchedMenuSpecificOrderGet(path, ...handlers) {
    registerMenuSpecificOrderRoute(this);
    return previousGet.call(this, path, ...handlers);
  };
}

if (!express.application.__menuSpecificOrderListenPatched) {
  express.application.__menuSpecificOrderListenPatched = true;

  express.application.listen = function patchedMenuSpecificOrderListen(...args) {
    registerMenuSpecificOrderRoute(this);
    return previousListen.apply(this, args);
  };
}
