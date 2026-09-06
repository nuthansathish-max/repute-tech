import express from 'express';

// Keep menu-specific customer links public. The previous implementation rewrote
// req.url and called next(), which could fall through into the dashboard SPA
// catch-all instead of reaching the public order renderer. Use a real HTTP
// redirect to the existing public /q/:slug/order handler instead.
const previousGet = express.application.get;
const previousListen = express.application.listen;

function registerMenuSpecificOrderRoute(app) {
  if (app.__menuSpecificOrderRouteRegistered) return;
  app.__menuSpecificOrderRouteRegistered = true;

  previousGet.call(app, '/q/:slug/order/:menuId', (req, res) => {
    const slug = String(req.params.slug || '').trim();
    const menuId = String(req.params.menuId || '').trim();
    if (!slug || !menuId) return res.status(404).send('Menu not found');

    const query = new URLSearchParams(req.query || '');
    query.set('menuId', menuId);

    const target = `/q/${encodeURIComponent(slug)}/order?${query.toString()}`;
    return res.redirect(302, target);
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
