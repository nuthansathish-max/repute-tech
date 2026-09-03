export function createTenantGuard({prisma, sessionUser}){
  const adminRoles=new Set(['ADMIN','SUPER_ADMIN']);
  const publicApiPrefixes=['/api/auth/','/api/customer','/api/whatsapp/webhook','/api/plans'];
  const publicApiExact=new Set(['/api/auth/config-status','/api/auth/login','/api/auth/signup','/api/auth/logout','/api/auth/me']);

  const isPublic=(path)=>{
    if(publicApiExact.has(path)) return true;
    if(publicApiPrefixes.some(prefix=>path.startsWith(prefix))) return true;
    if(path==='/api/qr' || path==='/api/qr/') return false;
    if(path.startsWith('/api/qr/') && path.endsWith('/scan')) return true;
    return false;
  };

  const needsTenant=(req)=>{
    const path=req.path;
    if(!path.startsWith('/api/')) return false;
    if(isPublic(path)) return false;
    if(path==='/api/businesses' || path==='/api/me/businesses') return false;
    if(path==='/api/google/status') return false;
    if(path==='/api/notifications' || path.startsWith('/api/notifications/')) return false;
    if(path==='/api/plan-requests' && req.method==='GET') return false;
    if(path.startsWith('/api/admin/')) return false;
    return true;
  };

  async function resolveBusinessId(req){
    if(req.params.businessId) return req.params.businessId;
    if(req.body?.businessId) return String(req.body.businessId);

    if(req.params.id){
      const id=String(req.params.id);
      if(req.path.includes('/reviews/')){
        const row=await prisma.review.findUnique({where:{id},select:{businessId:true}});
        return row?.businessId||null;
      }
      if(req.path.includes('/plan-requests/')){
        const row=await prisma.planRequest.findUnique({where:{id},select:{businessId:true}});
        return row?.businessId||null;
      }
      if(req.path.includes('/qr/')){
        const row=await prisma.smartQr.findUnique({where:{id},select:{businessId:true}});
        return row?.businessId||null;
      }
    }

    if(req.params.qrId){
      const row=await prisma.smartQr.findUnique({where:{id:String(req.params.qrId)},select:{businessId:true}});
      return row?.businessId||null;
    }
    if(req.params.menuId){
      const row=await prisma.menu.findUnique({where:{id:String(req.params.menuId)},select:{businessId:true}});
      return row?.businessId||null;
    }
    if(req.params.customerId){
      const row=await prisma.customer.findUnique({where:{id:String(req.params.customerId)},select:{businessId:true}});
      return row?.businessId||null;
    }
    return null;
  }

  return async function tenantGuard(req,res,next){
    try{
      if(!needsTenant(req)) return next();
      const user=await sessionUser(req);
      if(!user) return res.status(401).json({error:'Authentication required'});
      req.user=req.user||user;
      if(adminRoles.has(user.role)) return next();
      const businessId=await resolveBusinessId(req);
      if(!businessId) return res.status(400).json({error:'Business context is required'});
      const member=await prisma.businessMember.findUnique({where:{userId_businessId:{userId:user.id,businessId}},select:{id:true,role:true}});
      if(!member) return res.status(403).json({error:'Business access denied'});
      req.businessId=businessId;
      req.businessMember=member;
      next();
    }catch(err){next(err)}
  };
}
