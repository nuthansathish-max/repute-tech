import express from 'express';
import { sendText, whatsappConfigured } from './whatsapp.js';

const originalListen = express.application.listen;
let installed = false;

function install(app){
  if(installed) return;
  installed = true;

  app.use((req,res,next)=>{
    if(req.method !== 'PATCH' || req.path !== '/api/orders/:id/status'){
      return next();
    }

    const originalJson = res.json.bind(res);
    res.json = function(body){
      try{
        if(
          res.statusCode >= 200 &&
          res.statusCode < 300 &&
          String(req.body?.status || '').toUpperCase() === 'DELIVERED' &&
          body?.ok &&
          body?.order?.status === 'DELIVERED'
        ){
          const order = body.order;
          if(whatsappConfigured() && order.customerPhone){
            const lines = [
              'Final Bill / Invoice',
              '',
              `Business: ${order.business?.name || 'Business'}`,
              `Bill: ${order.orderNumber}`,
              `Customer: ${order.customerName || 'Customer'}`,
              '',
              ...(Array.isArray(order.items) ? order.items.map(item =>
                `${item.itemName} × ${item.quantity} = ₹${Number(item.lineTotal || 0).toFixed(2)}`
              ) : []),
              '',
              `Total: ₹${Number(order.total || 0).toFixed(2)}`,
              `Payment: ${order.paymentStatus === 'PAID' ? 'Paid' : 'Pending'}`,
              '',
              'Thank you for your business.'
            ];

            sendText(order.customerPhone, lines.join('\n')).catch(error=>{
              console.error('WhatsApp final bill send failed:', error?.message || error);
            });
          }
        }
      }catch(error){
        console.error('WhatsApp final bill automation error:', error?.message || error);
      }
      return originalJson(body);
    };

    next();
  });
}

express.application.listen = function finalBillWhatsAppListen(...args){
  const server = originalListen.apply(this,args);
  install(this);
  return server;
};
