import express from 'express';

const originalGet = express.application.get;
let installed = false;

function install() {
  if (installed) return;
  installed = true;

  express.application.get = function(path, ...handlers) {
    if (path === '/{*splat}' && handlers.length) {
      handlers = handlers.map(handler => async (req, res, next) => {
        if (req.path.startsWith('/billing-pos/invoice/')) return next();
        return handler(req, res, next);
      });
    }
    return originalGet.call(this, path, ...handlers);
  };
}

install();
