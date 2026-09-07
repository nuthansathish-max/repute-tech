import express from 'express';

// Some legacy compatibility modules wrap app.listen() with an async installer.
// Express/Node expects listen() to return the actual HTTP server synchronously.
// Keep those installers running, but expose a small synchronous proxy so the
// canonical server can safely call server.on(...) and server.close(...).
const previousListen = express.application.listen;

express.application.listen = function(...args){
  const result = previousListen.apply(this,args);
  if(!result || typeof result.then !== 'function') return result;

  const pending = Promise.resolve(result);
  const proxy = {
    on(event,handler){
      pending.then(server=>server.on(event,handler)).catch(err=>console.error('Server error',err));
      return proxy;
    },
    once(event,handler){
      pending.then(server=>server.once(event,handler)).catch(err=>console.error('Server error',err));
      return proxy;
    },
    close(callback){
      pending.then(server=>server.close(callback)).catch(err=>{
        console.error('Server close error',err);
        if(typeof callback==='function')callback(err);
      });
      return proxy;
    },
    address(){
      return null;
    }
  };
  return proxy;
};
