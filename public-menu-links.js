import express from 'express';

// Normalize customer-hub menu links to the canonical public ordering endpoint.
// Each link carries its menu id as a query parameter so the selected menu is
// preserved instead of falling back to the newest/first published menu.
const previousSend = express.response.send;

if (!express.response.__publicMenuLinksPatched) {
  express.response.__publicMenuLinksPatched = true;
  express.response.send = function patchedPublicMenuLinks(body) {
    try {
      const req = this.req;
      const isPublicHub = req && /^\/q\/[^/]+$/.test(String(req.path || '')) && typeof body === 'string' && body.includes('Customer Hub');
      if (isPublicHub) {
        body = body.replace(/\/q\/([^"'\\s]+)\/order\/([^"'\\s?#]+)/g, '/q/$1/order?menuId=$2');
      }
    } catch (_) {}
    return previousSend.call(this, body);
  };
}
