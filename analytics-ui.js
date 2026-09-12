import express from 'express';

const originalGet = express.application.get;
let installed = false;

const extraCss = `
<style>
:root{--rt-navy:#10182f;--rt-purple:#5b4be7;--rt-border:#e7eaf2;--rt-text:#182033;--rt-muted:#7b8496}
body{background:linear-gradient(180deg,#f8f9fc 0%,#f1f4f9 100%);color:var(--rt-text)}
.wrap{max-width:1280px;padding:28px 24px 44px}
.top{background:linear-gradient(135deg,#111a35 0%,#222b4d 100%);border-radius:22px;padding:22px 24px;margin-bottom:22px;box-shadow:0 14px 35px rgba(16,24,47,.14)}
.brand{color:#fff;font-size:27px;letter-spacing:-.4px}.muted{color:#b9c1d2}.controls{gap:9px}.btn{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.1);color:#fff;padding:10px 15px;border-radius:11px;transition:.18s}.btn:hover{transform:translateY(-1px);background:rgba(255,255,255,.17)}.btn.active{background:#fff;color:var(--rt-navy);border-color:#fff}
.grid{gap:15px}.card{border:1px solid var(--rt-border);border-radius:18px;padding:19px;box-shadow:0 8px 25px rgba(30,42,70,.055);transition:transform .18s,box-shadow .18s}.card:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(30,42,70,.09)}
.kpi{position:relative;overflow:hidden;min-height:112px}.kpi:after{content:'';position:absolute;right:-25px;top:-25px;width:82px;height:82px;border-radius:50%;background:rgba(91,75,231,.07)}.kpi .label{font-weight:650;color:var(--rt-muted);font-size:12px;text-transform:uppercase;letter-spacing:.55px}.kpi .value{font-size:29px;letter-spacing:-.7px;color:var(--rt-navy)}
.section{margin-top:18px}.two{gap:18px}.section-card{min-height:250px}.title{font-size:17px;letter-spacing:-.15px}.sub{color:var(--rt-muted)}
.chart{height:270px;padding:20px 4px 0;gap:7px;border-top:1px solid #f0f2f6}.bar{background:linear-gradient(180deg,#6658ed,#3f36b7);border-radius:7px 7px 3px 3px;box-shadow:0 4px 10px rgba(91,75,231,.18)}.barlabel{font-size:9px;color:#9aa2b2}
.row{padding:13px 0;border-bottom:1px solid #eef1f5}.row b{color:var(--rt-navy)}
@media(max-width:1000px){.wrap{padding:18px}.top{padding:20px}.section-card{min-height:220px}}
@media(max-width:520px){.wrap{padding:10px 10px 28px}.top{padding:18px;border-radius:18px}.brand{font-size:23px}.controls{display:grid;grid-template-columns:repeat(2,1fr);width:100%}.btn{width:100%;padding:10px 8px}.grid{gap:9px}.card{border-radius:15px;padding:13px}.kpi{min-height:101px}.kpi .label{font-size:10px}.kpi .value{font-size:20px;margin-top:7px}.section{margin-top:12px}.two{gap:12px}.section-card{min-height:0}.chart{height:210px;padding-top:12px;gap:3px}.barlabel{font-size:8px}.title{font-size:16px}.sub{font-size:12px}.row{padding:10px 0;font-size:13px}}
</style>`;

function install(app){
  if(installed)return;
  installed=true;
  originalGet.call(app,'/analytics-ui-patch',async(req,res)=>res.sendStatus(204));
}

express.application.get=function(path,...handlers){
  install(this);
  if(path==='/analytics'){
    const wrapped=handlers.map((handler,index)=>async(req,res,next)=>{
      if(index===handlers.length-1){
        const send=res.send.bind(res);
        res.send=function(body){
          if(typeof body==='string') body=body.replace('</style>',extraCss+'</style>');
          return send(body);
        };
      }
      return handler(req,res,next);
    });
    return originalGet.call(this,path,...wrapped);
  }
  return originalGet.call(this,path,...handlers);
};
