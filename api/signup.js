const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = global.__nexoraPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__nexoraPrisma = prisma;
module.exports = async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    const {name,email,password}=req.body||{};
    const cleanName=String(name||'').trim(); const cleanEmail=String(email||'').trim().toLowerCase();
    if(!cleanName || !/^\S+@\S+\.\S+$/.test(cleanEmail) || String(password||'').length<8) return res.status(400).json({error:'Enter a business/name, valid email, and password of at least 8 characters.'});
    const exists=await prisma.user.findUnique({where:{email:cleanEmail}}); if(exists) return res.status(409).json({error:'An account with this email already exists.'});
    const passwordHash=await bcrypt.hash(password,12);
    const user=await prisma.user.create({data:{name:cleanName,email:cleanEmail,passwordHash},select:{id:true,name:true,email:true}});
    return res.status(201).json({ok:true,user});
  }catch(e){ console.error(e); return res.status(500).json({error:'Signup is temporarily unavailable.'}); }
}