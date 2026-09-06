import express from 'express';

// Add a real menu-specific URL without replacing the stable existing order page.
// /q/:slug/order/:menuId is translated to the existing /q/:slug/order?menuId=...
// handler, which already validates that the menu belongs to the QR's business.
const previousGet = express.application.get;

if (!express.application.__menuSpecificOrderGetPatched) {
  express.application.__menuSpecificOrderGetPatched = true;

  express.application.get = function patchedMenuSpecificOrderGet(path, ...handlers) {
    if (!this.__menuSpecificOrderRouteRegistered) {
      this.__menuSpecificOrderRouteRegistered = true;
      previousGet.call(this, '/q/:slug/order/:menuId', (req, res) => {
        const slug = encodeURIComponent(String(req.params.slug || '').trim());
        const menuId = encodeURIComponent(String(req.params.menuId || '').trim());
        if (!slug || !menuId) return res.status(404).send('Menu not found');

        const query = new URLSearchParams(req.query || {});
        query.set('menuId', String(req.params.menuId || '').trim());
        return res.redirect(302, `/q/${slug}/order?${query.toString()}`);
      });
    }

    return previousGet.call(this, path, ...handlers);
  };
}
