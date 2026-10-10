import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient, Role, RideStatus } from "@prisma/client";

dotenv.config();
const app=express(), prisma=new PrismaClient();
const allowedOrigins=(process.env.CORS_ORIGIN||"*").split(",").map(v=>v.trim()).filter(Boolean);
app.use(cors({origin:allowedOrigins.includes("*")?true:allowedOrigins}));
app.use(express.json({limit:"1mb"}));
const secret=process.env.JWT_SECRET||"";
if(!secret&&process.env.NODE_ENV==="production") throw new Error("JWT_SECRET é obrigatório em produção");
const jwtSecret=secret||"development-secret";
const commissionPercent=Math.min(100,Math.max(0,Number(process.env.BORA_COMMISSION_PERCENT||20)));
function validCoordinate(lat:number,lng:number){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;}
function publicDriver(d:any){return d?{id:d.id,userId:d.userId,online:d.online,latitude:d.latitude,longitude:d.longitude,rating:d.rating,updatedAt:d.updatedAt}:null;}
function makeToken(u:{id:string;role:Role}){return jwt.sign({id:u.id,role:u.role},jwtSecret,{expiresIn:"7d"});}
function auth(req:express.Request,res:express.Response,next:express.NextFunction){const h=req.headers.authorization;if(!h?.startsWith("Bearer "))return res.status(401).json({error:"Não autorizado"});try{(req as any).user=jwt.verify(h.slice(7),jwtSecret);next();}catch{return res.status(401).json({error:"Token inválido"});}}
function role(req:express.Request,r:Role){return (req as any).user?.role===r;}
app.get("/health",(_req,res)=>res.json({ok:true,service:"BORA Backend",version:"2.1"}));

function oauthState(driverUserId:string){return jwt.sign({driverUserId,purpose:"mp-connect"},jwtSecret,{expiresIn:"10m"});}
app.get("/api/mercadopago/connect",auth,async(req,res)=>{
 if(!role(req,Role.DRIVER)) return res.status(403).json({error:"Apenas motoristas"});
 const appId=process.env.MP_APP_ID, redirect=process.env.MP_REDIRECT_URI;
 if(!appId||!redirect) return res.status(503).json({error:"Mercado Pago ainda não configurado no servidor"});
 const url=new URL("https://auth.mercadopago.com.br/authorization");
 url.searchParams.set("client_id",appId);url.searchParams.set("response_type","code");url.searchParams.set("platform_id","mp");url.searchParams.set("state",oauthState((req as any).user.id));url.searchParams.set("redirect_uri",redirect);
 res.json({authorizationUrl:url.toString()});
});
app.get("/api/mercadopago/callback",async(req,res)=>{
 try{
  const {code,state}=req.query as {code?:string;state?:string}; if(!code||!state) return res.status(400).send("Autorização incompleta");
  const payload:any=jwt.verify(state,jwtSecret); if(payload.purpose!=="mp-connect") throw new Error("Estado inválido");
  const body=new URLSearchParams({client_id:process.env.MP_APP_ID||"",client_secret:process.env.MP_CLIENT_SECRET||"",grant_type:"authorization_code",code,redirect_uri:process.env.MP_REDIRECT_URI||""});
  const mp=await fetch("https://api.mercadopago.com/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const data:any=await mp.json(); if(!mp.ok) return res.status(502).json(data);
  await prisma.driver.update({where:{userId:payload.driverUserId},data:{mpAccessToken:data.access_token,mpRefreshToken:data.refresh_token,mpUserId:String(data.user_id),mpTokenExpiresAt:new Date(Date.now()+Number(data.expires_in||15552000)*1000)}});
  res.send("Mercado Pago conectado com sucesso. Você já pode fechar esta página e voltar ao BORA.");
 }catch(e){res.status(400).send("Não foi possível conectar o Mercado Pago.");}
});
app.post("/api/payments/checkout/:rideId",auth,async(req,res)=>{
 if(!role(req,Role.PASSENGER)) return res.status(403).json({error:"Apenas passageiros"});
 const ride=await prisma.ride.findUnique({where:{id:req.params.rideId},include:{driver:true}});
 if(!ride||ride.passengerId!==(req as any).user.id) return res.status(404).json({error:"Corrida não encontrada"});
 if(!ride.driver?.mpAccessToken) return res.status(409).json({error:"Motorista ainda não conectou o Mercado Pago"});
 const fee=Number((ride.estimatedFare*Number(process.env.MP_MARKETPLACE_FEE_PERCENT||process.env.BORA_COMMISSION_PERCENT||20)/100).toFixed(2));
 const preference={items:[{id:ride.id,title:"Corrida BORA",currency_id:"BRL",quantity:1,unit_price:ride.estimatedFare}],marketplace_fee:fee,external_reference:ride.id,notification_url:process.env.MP_NOTIFICATION_URL||undefined};
 const mp=await fetch("https://api.mercadopago.com/checkout/preferences",{method:"POST",headers:{Authorization:`Bearer ${ride.driver.mpAccessToken}`,"Content-Type":"application/json"},body:JSON.stringify(preference)});
 const data:any=await mp.json(); if(!mp.ok) return res.status(502).json({error:"Mercado Pago recusou a preferência",details:data});
 await prisma.ride.update({where:{id:ride.id},data:{mpPreferenceId:String(data.id),paymentStatus:"PENDING"}}); res.json({id:data.id,init_point:data.init_point,sandbox_init_point:data.sandbox_init_point,marketplaceFee:fee});
});


app.post("/api/payments/webhook",async(req,res)=>{
 try{
  const type=String(req.body?.type||req.query?.type||"");
  const paymentId=String(req.body?.data?.id||req.query?.data_id||"");
  if(type!=="payment"||!paymentId) return res.sendStatus(200);
  const rides=await prisma.ride.findMany({where:{mpPaymentId:null},include:{driver:true}});
  for(const ride of rides){
   if(!ride.driver?.mpAccessToken) continue;
   const r=await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{headers:{Authorization:`Bearer ${ride.driver.mpAccessToken}`}});
   if(!r.ok) continue; const pay:any=await r.json();
   if(String(pay.external_reference||"")===ride.id){
    await prisma.ride.update({where:{id:ride.id},data:{mpPaymentId:paymentId,paymentStatus:String(pay.status||"UNKNOWN")}}); break;
   }
  }
  res.sendStatus(200);
 }catch{res.sendStatus(200);}
});
app.get("/api/payments/status/:rideId",auth,async(req,res)=>{
 const ride=await prisma.ride.findUnique({where:{id:req.params.rideId},include:{driver:true}});
 if(!ride)return res.status(404).json({error:"Corrida não encontrada"});
 const uid=(req as any).user.id; if(ride.passengerId!==uid&&ride.driver?.userId!==uid)return res.status(403).json({error:"Sem acesso"});
 if(ride.mpPaymentId&&ride.driver?.mpAccessToken){
  const r=await fetch(`https://api.mercadopago.com/v1/payments/${ride.mpPaymentId}`,{headers:{Authorization:`Bearer ${ride.driver.mpAccessToken}`}});
  if(r.ok){const p:any=await r.json(); await prisma.ride.update({where:{id:ride.id},data:{paymentStatus:String(p.status||ride.paymentStatus)}}); return res.json({status:p.status,id:p.id});}
 }
 res.json({status:ride.paymentStatus,id:ride.mpPaymentId});
});

app.post("/api/auth/register",async(req,res)=>{const{name,email,password,role:r}=req.body;if(typeof name!=="string"||typeof email!=="string"||typeof password!=="string"||password.length<6||!["PASSENGER","DRIVER"].includes(r)||!email.includes("@"))return res.status(400).json({error:"Dados inválidos"});try{const u=await prisma.user.create({data:{name:name.trim(),email:email.trim().toLowerCase(),passwordHash:await bcrypt.hash(password,10),role:r}});if(r==="DRIVER")await prisma.driver.create({data:{userId:u.id}});res.status(201).json({id:u.id,name:u.name,email:u.email,role:u.role,token:makeToken(u)});}catch{return res.status(400).json({error:"E-mail pode já estar cadastrado"});}});
app.post("/api/auth/login",async(req,res)=>{const u=await prisma.user.findUnique({where:{email:String(req.body.email||"").trim().toLowerCase()}});if(!u||!(await bcrypt.compare(req.body.password,u.passwordHash)))return res.status(401).json({error:"Login inválido"});res.json({id:u.id,name:u.name,role:u.role,token:makeToken(u)});});
app.post("/api/drivers/online",auth,async(req,res)=>{if(!role(req,Role.DRIVER))return res.status(403).json({error:"Apenas motoristas"});const d=await prisma.driver.update({where:{userId:(req as any).user.id},data:{online:Boolean(req.body.online)}});res.json(publicDriver(d));});
app.post("/api/drivers/location",auth,async(req,res)=>{if(!role(req,Role.DRIVER))return res.status(403).json({error:"Apenas motoristas"});const{latitude,longitude}=req.body;if(!validCoordinate(latitude,longitude))return res.status(400).json({error:"Localização inválida"});const d=await prisma.driver.update({where:{userId:(req as any).user.id},data:{latitude,longitude,online:true}});res.json(publicDriver(d));});
app.get("/api/rides/available",auth,async(req,res)=>{if(!role(req,Role.DRIVER))return res.status(403).json({error:"Apenas motoristas"});const d=await prisma.driver.findUnique({where:{userId:(req as any).user.id}});if(!d||!d.online)return res.json([]);const rides=await prisma.ride.findMany({where:{status:RideStatus.SEARCHING_DRIVER,driverId:null},orderBy:{createdAt:"asc"},take:20,include:{passenger:{select:{name:true}}}});res.json(rides);});
function haversineKm(lat1:number,lng1:number,lat2:number,lng2:number){
 const R=6371, toRad=(v:number)=>v*Math.PI/180;
 const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
 const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
 return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function fareFor(distanceKm:number){
 const base=Number(process.env.BORA_BASE_FARE||5);
 const perKm=Number(process.env.BORA_PRICE_PER_KM||2);
 const avgSpeed=Number(process.env.BORA_AVG_SPEED_KMH||30);
 const minutes=(distanceKm/Math.max(avgSpeed,1))*60;
 const perMinute=Number(process.env.BORA_PRICE_PER_MINUTE||0.35);
 const fare=base+distanceKm*perKm+minutes*perMinute;
 return {distanceKm:Number(distanceKm.toFixed(2)),durationMin:Math.max(1,Math.round(minutes)),estimatedFare:Number(fare.toFixed(2))};
}
app.get("/api/rides/estimate",auth,async(req,res)=>{
 if(!role(req,Role.PASSENGER))return res.status(403).json({error:"Apenas passageiros"});
 const originLat=Number(req.query.originLat),originLng=Number(req.query.originLng),destinationLat=Number(req.query.destinationLat),destinationLng=Number(req.query.destinationLng);
 if(!validCoordinate(originLat,originLng)||!validCoordinate(destinationLat,destinationLng))return res.status(400).json({error:"Coordenadas inválidas"});
 res.json(fareFor(haversineKm(originLat,originLng,destinationLat,destinationLng)));
});
app.post("/api/rides",auth,async(req,res)=>{if(!role(req,Role.PASSENGER))return res.status(403).json({error:"Apenas passageiros"});const{originLat,originLng,destinationLat,destinationLng}=req.body;if(!validCoordinate(originLat,originLng)||!validCoordinate(destinationLat,destinationLng))return res.status(400).json({error:"Dados da corrida inválidos"});const quote=fareFor(haversineKm(originLat,originLng,destinationLat,destinationLng));const estimatedFare=quote.estimatedFare;const commission=Number((estimatedFare*commissionPercent/100).toFixed(2));const payout=Number((estimatedFare-commission).toFixed(2));const ride=await prisma.ride.create({data:{passengerId:(req as any).user.id,originLat,originLng,destinationLat,destinationLng,estimatedFare,commission,driverPayout:payout,status:RideStatus.SEARCHING_DRIVER}});res.status(201).json({...ride,distanceKm:quote.distanceKm,durationMin:quote.durationMin});});
app.get("/api/rides/:id",auth,async(req,res)=>{const ride=await prisma.ride.findUnique({where:{id:req.params.id},include:{passenger:{select:{id:true,name:true,email:true}},driver:{select:{id:true,userId:true,online:true,latitude:true,longitude:true,rating:true,updatedAt:true,user:{select:{id:true,name:true}}}}}});if(!ride)return res.status(404).json({error:"Corrida não encontrada"});const uid=(req as any).user.id;if(ride.passengerId!==uid&&ride.driver?.userId!==uid)return res.status(403).json({error:"Sem acesso a esta corrida"});res.json(ride);});
app.post("/api/rides/:id/accept",auth,async(req,res)=>{if(!role(req,Role.DRIVER))return res.status(403).json({error:"Apenas motoristas"});const d=await prisma.driver.findUnique({where:{userId:(req as any).user.id}});if(!d||!d.online)return res.status(403).json({error:"Motorista precisa estar online"});const current=await prisma.ride.findUnique({where:{id:req.params.id}});if(!current||current.status!==RideStatus.SEARCHING_DRIVER||current.driverId)return res.status(409).json({error:"Corrida já foi aceita ou não está disponível"});const updated=await prisma.ride.updateMany({where:{id:req.params.id,status:RideStatus.SEARCHING_DRIVER,driverId:null},data:{driverId:d.id,status:RideStatus.DRIVER_ACCEPTED}});if(updated.count!==1)return res.status(409).json({error:"Outro motorista aceitou primeiro"});res.json(await prisma.ride.findUnique({where:{id:req.params.id}}));});
async function changeRide(req:express.Request,res:express.Response,status:RideStatus){const ride=await prisma.ride.findUnique({where:{id:req.params.id},include:{driver:true}});if(!ride)return res.status(404).json({error:"Corrida não encontrada"});const uid=(req as any).user.id;if(ride.driver?.userId!==uid)return res.status(403).json({error:"Apenas o motorista da corrida"});const allowed=(status===RideStatus.IN_PROGRESS&&ride.status===RideStatus.DRIVER_ACCEPTED)||(status===RideStatus.COMPLETED&&ride.status===RideStatus.IN_PROGRESS);if(!allowed)return res.status(409).json({error:"Transição de status inválida"});res.json(await prisma.ride.update({where:{id:ride.id},data:{status}}));}
app.post("/api/rides/:id/start",auth,(req,res)=>changeRide(req,res,RideStatus.IN_PROGRESS));
app.post("/api/rides/:id/finish",auth,(req,res)=>changeRide(req,res,RideStatus.COMPLETED));
app.post("/api/rides/:id/cancel",auth,async(req,res)=>{const ride=await prisma.ride.findUnique({where:{id:req.params.id},include:{driver:true}});if(!ride)return res.status(404).json({error:"Corrida não encontrada"});const uid=(req as any).user.id;if(ride.passengerId!==uid&&ride.driver?.userId!==uid)return res.status(403).json({error:"Sem permissão"});if([RideStatus.COMPLETED,RideStatus.CANCELLED].includes(ride.status))return res.status(409).json({error:"Corrida já encerrada"});res.json(await prisma.ride.update({where:{id:ride.id},data:{status:RideStatus.CANCELLED}}));});
const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log("BORA Backend v2.1 rodando na porta "+port));
