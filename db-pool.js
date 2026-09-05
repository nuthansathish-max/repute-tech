// Keep every PrismaClient in this Node process on a small shared database pool.
// This service loads several route modules, each of which has its own PrismaClient.
// Supabase Session Pooler is the database transport, so one connection per client
// prevents the route modules from collectively exhausting the pool.
import 'dotenv/config';

const raw=String(process.env.DATABASE_URL||'').trim();
if(raw){
  try{
    const u=new URL(raw);
    u.searchParams.set('connection_limit','1');
    u.searchParams.set('pool_timeout','30');
    process.env.DATABASE_URL=u.toString();
  }catch{}
}
