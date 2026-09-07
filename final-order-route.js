import express from 'express';

// The authoritative-public-order.js module registers the unified customer
// order routes before the legacy server routes are loaded. Do NOT reorder
// /q/:slug/order or /api/public/orders here: moving a later legacy route to
// the front causes the old single-menu page to win and breaks its controls.
// Keep this compatibility module as a no-op listen wrapper for older startup
// chains without changing Express route order.
const previousListen = express.application.listen;

express.application.listen = function(...args){
  return previousListen.apply(this,args);
};
