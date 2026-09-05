import express from 'express';

const originalPost = express.application.post;

function validIndianPhone(value){
  return /^[6-9]\d{9}$/.test(String(value ?? '').trim());
}

express.application.post = function(path, ...handlers){
  if(path === '/api/public/orders'){
    const phoneGuard = (req,res,next)=>{
      const phone=String(req.body?.customerPhone ?? '').trim();
      if(!validIndianPhone(phone)){
        return res.status(400).json({error:'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.'});
      }
      next();
    };
    return originalPost.call(this,path,phoneGuard,...handlers);
  }
  return originalPost.call(this,path,...handlers);
};

export { validIndianPhone };
