import express from 'express';

const originalRoute = express.application.route;

function normalizeIndianPhone(value){
  let phone=String(value ?? '').trim().replace(/[\s()-]/g,'');
  if(phone.startsWith('+91')) phone=phone.slice(3);
  else if(phone.startsWith('91') && phone.length===12) phone=phone.slice(2);
  else if(phone.startsWith('0') && phone.length===11) phone=phone.slice(1);
  return phone;
}

function validIndianPhone(value){
  return /^[6-9]\d{9}$/.test(normalizeIndianPhone(value));
}

function validation(req,res,next){
  const body=req.body||{};
  const name=String(body.customerName??'').trim();
  const phone=normalizeIndianPhone(body.customerPhone);
  const notes=String(body.notes??'').trim();
  if(name.length<2) return res.status(400).json({error:'Please enter your name.'});
  if(!validIndianPhone(phone)) return res.status(400).json({error:'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.'});
  if(!notes) return res.status(400).json({error:'Please enter your table number, seat number, or instructions.'});
  req.body.customerPhone=phone;
  req.body.notes=notes;
  next();
}

express.application.route=function(path){
  const route=originalRoute.call(this,path);
  if(path==='/api/public/orders'){
    const originalPost=route.post;
    route.post=function(...handlers){
      const parserCount=handlers.findIndex(h=>h && h.json===undefined && h.length>=2);
      const index=parserCount>0?parserCount:Math.min(1,handlers.length);
      const nextHandlers=[...handlers.slice(0,index+1),validation,...handlers.slice(index+1)];
      return originalPost.apply(this,nextHandlers);
    };
  }
  if(path==='/q/:slug/order'){
    const originalGet=route.get;
    route.get=function(...handlers){
      const pageGuard=async(req,res,next)=>{
        const send=res.send.bind(res);
        res.send=function(body){
          if(typeof body==='string' && body.includes('id="phone"')){
            body=body
              .replace('placeholder="Phone number"','placeholder="Phone number (10 digits)" required inputmode="tel" autocomplete="tel"')
              .replace('placeholder="Seat no / Table no / Instructions"','placeholder="Table number / Seat number / Instructions (required)" required')
              .replace('placeholder="Table number or special instructions (optional)"','placeholder="Table number / Seat number / Instructions (required)" required')
              .replace('</body>',`<script>(function(){const phone=document.getElementById('phone'),notes=document.getElementById('notes'),msg=document.getElementById('msg');document.addEventListener('click',function(e){const b=e.target.closest&&e.target.closest('#submit');if(!b)return;let p=String(phone?.value||'').trim().replace(/[\\s()-]/g,'');if(p.startsWith('+91'))p=p.slice(3);else if(p.startsWith('91')&&p.length===12)p=p.slice(2);else if(p.startsWith('0')&&p.length===11)p=p.slice(1);if(!/^[6-9]\\d{9}$/.test(p)){e.preventDefault();e.stopImmediatePropagation();if(msg)msg.textContent='Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';phone?.focus();return}if(!String(notes?.value||'').trim()){e.preventDefault();e.stopImmediatePropagation();if(msg)msg.textContent='Please enter your table number, seat number, or instructions.';notes?.focus();return}if(phone)phone.value=p},true)})();</script></body>`);
          }
          return send(body);
        };
        next();
      };
      return originalGet.call(this,pageGuard,...handlers);
    };
  }
  return route;
};

export { validIndianPhone, normalizeIndianPhone };
