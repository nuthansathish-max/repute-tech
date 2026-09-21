import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getCookie, tokenHash } from './auth.js';

const prisma = new PrismaClient();
const originalListen = express.application.listen;
const originalSend = express.response.send;
const installedApps = new WeakSet();

const BUCKET = 'menu-images';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg','image/png','image/webp']);

function config(){
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/,''),
    key: String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  };
}

async function userFrom(req){
  const token=getCookie(req,'rp_session');
  if(!token)return null;
  const s=await prisma.session.findUnique({where:{tokenHash:tokenHash(token)},include:{user:true}});
  if(!s || s.expiresAt<new Date())return null;
  return s.user;
}

async function businessAccess(req,businessId){
  const user=await userFrom(req);
  if(!user)return {error:'Authentication required',status:401};
  const business=await prisma.business.findFirst({
    where:{id:String(businessId),...(['ADMIN','SUPER_ADMIN'].includes(user.role)?{}:{members:{some:{userId:user.id}}})}
  });
  if(!business)return {error:'Business access denied',status:403};
  return {user,business};
}

async function ensureBucket(url,key){
  const r=await fetch(url+'/storage/v1/bucket',{
    method:'POST',
    headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify({
      id:BUCKET,name:BUCKET,public:true,
      allowed_mime_types:['image/jpeg','image/png','image/webp'],
      file_size_limit:MAX_BYTES
    })
  });
  if(r.ok || r.status===409)return true;
  const text=await r.text().catch(()=> '');
  throw new Error('Unable to prepare image storage: '+(text||r.status));
}

async function uploadImage(url,key,path,mime,bytes){
  const r=await fetch(url+'/storage/v1/object/'+BUCKET+'/'+path,{
    method:'POST',
    headers:{
      apikey:key,
      Authorization:'Bearer '+key,
      'content-type':mime,
      'cache-control':'31536000',
      'x-upsert':'true'
    },
    body:bytes
  });
  if(!r.ok){
    const text=await r.text().catch(()=> '');
    throw new Error('Image upload failed: '+(text||r.status));
  }
  return url+'/storage/v1/object/public/'+BUCKET+'/'+path;
}

function injectClientScript(app){
  if(!app || installedApps.has(app))return;
  installedApps.add(app);
  const previous = app.__reputeMenuImageSendPatched;
  if(previous)return;
  app.__reputeMenuImageSendPatched=true;
  const send=originalSend;
  express.response.send=function(body){
    try{
      const req=this.req;
      if(req && req.method==='GET' && req.path==='/' && typeof body==='string' &&
         body.includes('id="addItem"') && !body.includes('/menu-image-ui.js')){
        body=body.replace('</body>','<script src="/menu-image-ui.js"></script></body>');
      }
    }catch(_){}
    return send.call(this,body);
  };
}

function register(app){
  if(!app)return;
  injectClientScript(app);

  if(app.__reputeMenuImageRouteRegistered)return;
  app.__reputeMenuImageRouteRegistered=true;

  app.get('/api/businesses/:businessId/menu-images/status',async(req,res)=>{ const access=await businessAccess(req,req.params.businessId); if(access.error)return res.status(access.status).json({error:access.error}); const c=config(); res.json({configured:Boolean(c.url&&c.key),bucket:BUCKET}); });

  app.post('/api/businesses/:businessId/menu-images',async(req,res,next)=>{
    try{
      const access=await businessAccess(req,req.params.businessId);
      if(access.error)return res.status(access.status).json({error:access.error});

      const itemId=String(req.body?.menuItemId||'').trim();
      const mime=String(req.body?.mimeType||'').toLowerCase();
      const raw=String(req.body?.dataBase64||'').trim();

      if(!itemId)return res.status(400).json({error:'Menu item is required'});
      if(!ALLOWED.has(mime))return res.status(400).json({error:'Only JPG, PNG and WebP images are allowed'});
      if(!raw)return res.status(400).json({error:'Image is required'});

      const bytes=Buffer.from(raw,'base64');
      if(!bytes.length)return res.status(400).json({error:'Invalid image data'});
      if(bytes.length>MAX_BYTES)return res.status(413).json({error:'Image must be 2MB or smaller'});

      const item=await prisma.menuItem.findFirst({
        where:{id:itemId,menu:{businessId:access.business.id}},
        include:{menu:true}
      });
      if(!item)return res.status(404).json({error:'Menu item not found'});

      const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
      const path=access.business.id+'/'+item.menuId+'/'+item.id+'-'+Date.now()+'.'+ext;
      const {url,key}=config();
      if(!url || !key)return res.status(503).json({error:'Image storage is not configured yet'});

      await ensureBucket(url,key);
      const imageUrl=await uploadImage(url,key,path,mime,bytes);
      const updated=await prisma.menuItem.update({where:{id:item.id},data:{imageUrl}});
      return res.json({ok:true,imageUrl,menuItem:updated});
    }catch(e){next(e)}
  });
}

express.application.listen=function menuImageStorageListen(...args){
  register(this);
  return originalListen.apply(this,args);
};

export { register };
