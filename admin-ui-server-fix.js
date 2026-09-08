// Server-side Admin UI compatibility patch.
// Keeps the browser page unchanged for every other section while adjusting
// only the Admin overview requested for individual business owners.
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const originalGet = express.application.get;
let registered = false;

function patchHtml(html){
  let out = html;

  // Remove the two Admin-only sections from the rendered page.
  out = out.replace(
    /<div class="card"><div class="section-title">Plan catalog<\/div><div id="planCatalog" class="list"><\/div><\/div>/,
    ''
  );
  out = out.replace(
    /<div class="card" style="margin-top:14px"><div class="section-title">Pending plan requests<\/div><div id="adminPlanRequests" class="list"><\/div><\/div>/,
    ''
  );

  // Business owners should see their business name instead of a platform-wide
  // business count in the Admin overview.
  out = out.replace(
    '<div class="label">Businesses</div><div class="value" id="adminBusinesses">—</div>',
    '<div class="label">Business</div><div class="value" id="adminBusinesses">—</div>'
  );

  // The removed Admin sections must not be queried/rendered by the page loader.
  out = out.replace(
    /async function loadAdminPlans\(\)\{.*?\}\nasync function loadAdminPlanRequests\(\)\{.*?\}\n/s,
    'async function loadAdminPlans(){}\nasync function loadAdminPlanRequests(){}\n'
  );

  out = out.replace(
    "$('adminBusinesses').textContent=bs.length;",
    "$('adminBusinesses').textContent=bs[0].name||'Business';"
  );

  return out;
}

function register(app){
  if(registered)return;
  registered=true;
  const root=path.dirname(fileURLToPath(import.meta.url));
  originalGet.call(app,'/',async(_req,res,next)=>{
    try{
      const html=await fs.readFile(path.join(root,'index.html'),'utf8');
      res.type('html').send(patchHtml(html));
    }catch(e){next(e)}
  });
}

express.application.listen=function adminUiFixListen(...args){
  register(this);
  return express.application.__adminUiOriginalListen.apply(this,args);
};

// Preserve the listener implementation installed by server.js.
if(!express.application.__adminUiOriginalListen){
  express.application.__adminUiOriginalListen=express.application.listen;
  express.application.listen=function adminUiFixListen(...args){
    register(this);
    return express.application.__adminUiOriginalListen.apply(this,args);
  };
}
