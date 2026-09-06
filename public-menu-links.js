import express from 'express';

// Normalize customer-hub menu links to the canonical public ordering endpoint.
// The hub currently renders /q/:slug/order/:menuId links, while the canonical
// order page selects a menu with ?menuId=. Convert only the public hub HTML.
const previousSend = express.response.send;

if (!express.response.__publicMenuLinksPatched) {
  express.response.__publicMenuLinksPatched = true;
  express.response.send = function patchedPublicMenuLinks(body) {
    try {
      const req = this.req;
      const isPublicHub =
        req &&
        /^\/q\/[^/]+$/.test(String(req.path || '')) &&
        typeof body === 'string' &&
        body.includes('Customer Hub');

      if (isPublicHub) {
        body = body.replace(
          /href="(\/q\/[^"?#]+\/order)\/([^"?#\s]+)"/g,
          'href="$1?menuId=$2"'
        );
      }
    } catch (_) {}

    return previousSend.call(this, body);
  };
}
