import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import swaggerUi from "swagger-ui-express";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "caruser",
  password: process.env.MYSQL_PASSWORD || "carpass",
  database: process.env.MYSQL_DATABASE || "car_rental",
  waitForConnections: true, connectionLimit: 10
});

const aiUrl = process.env.AI_SERVICE_URL || "http://localhost:8000";

function auth(req,res,next){
  const token = req.headers.authorization?.replace("Bearer ","");
  if(!token) return res.status(401).json({error:"Authentication required"});
  try { req.user=jwt.verify(token,process.env.JWT_SECRET||"dev-secret"); next(); }
  catch { res.status(401).json({error:"Invalid or expired token"}); }
}
function admin(req,res,next){ if(req.user?.role!=="ADMIN") return res.status(403).json({error:"Admin access required"}); next(); }

app.get("/api/health",(req,res)=>res.json({status:"ok",service:"car-rental-api"}));

app.post("/api/auth/register", async (req,res)=>{
  try{
    const {name,email,password}=req.body;
    if(!name||!email||!password||password.length<6) return res.status(400).json({error:"Name, valid email and password of at least 6 characters are required"});
    const hash=await bcrypt.hash(password,12);
    const [r]=await pool.execute("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)",[name,email.toLowerCase(),hash]);
    res.status(201).json({message:"Registration successful",id:r.insertId});
  }catch(e){ res.status(400).json({error:e.code==="ER_DUP_ENTRY"?"Email already registered":"Registration failed"}); }
});

app.post("/api/auth/login", async (req,res)=>{
  const {email,password}=req.body;
  const [rows]=await pool.execute("SELECT * FROM users WHERE email=?",[email?.toLowerCase()]);
  const user=rows[0];
  if(!user || !(await bcrypt.compare(password||"",user.password_hash))) return res.status(401).json({error:"Invalid credentials"});
  const token=jwt.sign({id:user.id,email:user.email,role:user.role,name:user.name},process.env.JWT_SECRET||"dev-secret",{expiresIn:"7d"});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});

app.get("/api/vehicles", async (req,res)=>{
  const {category,search,minPrice,maxPrice}=req.query;
  let sql="SELECT * FROM vehicles WHERE available=1", p=[];
  if(category){sql+=" AND category=?";p.push(category)}
  if(search){sql+=" AND (make LIKE ? OR model LIKE ?)";p.push(`%${search}%`,`%${search}%`)}
  if(minPrice){sql+=" AND base_price>=?";p.push(minPrice)}
  if(maxPrice){sql+=" AND base_price<=?";p.push(maxPrice)}
  sql+=" ORDER BY created_at DESC";
  const [rows]=await pool.execute(sql,p);
  res.json(rows);
});

app.post("/api/vehicles",auth,admin,async(req,res)=>{
  const {make,model,year,category,transmission,fuel_type,seats,base_price,image_url}=req.body;
  const [r]=await pool.execute("INSERT INTO vehicles(make,model,year,category,transmission,fuel_type,seats,base_price,image_url) VALUES(?,?,?,?,?,?,?,?,?)",
    [make,model,year,category,transmission,fuel_type,seats,base_price,image_url||null]);
  res.status(201).json({id:r.insertId});
});
app.put("/api/vehicles/:id",auth,admin,async(req,res)=>{
  const {make,model,year,category,transmission,fuel_type,seats,base_price,image_url,available}=req.body;
  await pool.execute("UPDATE vehicles SET make=?,model=?,year=?,category=?,transmission=?,fuel_type=?,seats=?,base_price=?,image_url=?,available=? WHERE id=?",
  [make,model,year,category,transmission,fuel_type,seats,base_price,image_url,available??true,req.params.id]);
  res.json({message:"Vehicle updated"});
});
app.delete("/api/vehicles/:id",auth,admin,async(req,res)=>{
  await pool.execute("UPDATE vehicles SET available=0 WHERE id=?",[req.params.id]);
  res.json({message:"Vehicle removed"});
});

app.get("/api/recommendations",auth,async(req,res)=>{
  try{
    const [history]=await pool.execute("SELECT b.vehicle_id,v.category,v.base_price FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id WHERE b.user_id=?",[req.user.id]);
    const [cars]=await pool.execute("SELECT * FROM vehicles WHERE available=1");
    const r=await fetch(`${aiUrl}/recommend`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({history,cars})});
    res.json(await r.json());
  }catch{ res.json({recommendations:[]}); }
});

app.post("/api/bookings",auth,async(req,res)=>{
  const {vehicleId,startDate,endDate}=req.body;
  if(!vehicleId||!startDate||!endDate) return res.status(400).json({error:"Vehicle and dates are required"});
  const [vrows]=await pool.execute("SELECT * FROM vehicles WHERE id=? AND available=1",[vehicleId]);
  const v=vrows[0]; if(!v) return res.status(404).json({error:"Vehicle unavailable"});
  const [overlap]=await pool.execute(
    "SELECT id FROM bookings WHERE vehicle_id=? AND status IN('PENDING','CONFIRMED') AND NOT(end_date<? OR start_date>?)",
    [vehicleId,startDate,endDate]);
  if(overlap.length) return res.status(409).json({error:"Vehicle is already booked for these dates"});
  const days=Math.max(1,Math.ceil((new Date(endDate)-new Date(startDate))/86400000));
  let price=v.base_price;
  try{
    const r=await fetch(`${aiUrl}/pricing`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({base_price:v.base_price,availability:v.available,demand:1,days})});
    price=(await r.json()).price;
  }catch{}
  const total=price*days;
  const [r]=await pool.execute("INSERT INTO bookings(user_id,vehicle_id,start_date,end_date,price_per_day,total_price,status) VALUES(?,?,?,?,?,?,?)",
    [req.user.id,vehicleId,startDate,endDate,price,total,"CONFIRMED"]);
  await pool.execute("INSERT INTO payments(booking_id,amount,status,provider,transaction_ref) VALUES(?,?,?,'DEMO',?)",[r.insertId,total,"PAID",`DEMO-${Date.now()}`]);
  await pool.execute("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)",[req.user.id,"Booking confirmed",`Your booking #${r.insertId} has been confirmed.`]);
  try{
    const fr=await fetch(`${aiUrl}/fraud`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({days,total_price:total,booking_count:1})});
    const f=await fr.json();
    if(f.risk_score>=70) await pool.execute("INSERT INTO fraud_alerts(booking_id,risk_score,reason) VALUES(?,?,?)",[r.insertId,f.risk_score,f.reason]);
  }catch{}
  res.status(201).json({id:r.insertId,total,pricePerDay:price,status:"CONFIRMED"});
});

app.get("/api/bookings",auth,async(req,res)=>{
  const sql=req.user.role==="ADMIN"
    ?"SELECT b.*,u.name,u.email,v.make,v.model FROM bookings b JOIN users u ON u.id=b.user_id JOIN vehicles v ON v.id=b.vehicle_id ORDER BY b.created_at DESC"
    :"SELECT b.*,v.make,v.model,v.image_url FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id WHERE b.user_id=? ORDER BY b.created_at DESC";
  const [rows]=await pool.execute(sql,req.user.role==="ADMIN"?[]:[req.user.id]); res.json(rows);
});
app.patch("/api/bookings/:id/cancel",auth,async(req,res)=>{
  await pool.execute("UPDATE bookings SET status='CANCELLED' WHERE id=? AND (user_id=? OR ?='ADMIN')",[req.params.id,req.user.id,req.user.role]);
  res.json({message:"Booking cancelled"});
});

app.get("/api/notifications",auth,async(req,res)=>{
  const [rows]=await pool.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC",[req.user.id]); res.json(rows);
});

app.get("/api/admin/stats",auth,admin,async(req,res)=>{
  const [[users]]=await pool.query("SELECT COUNT(*) count FROM users WHERE role='CUSTOMER'");
  const [[cars]]=await pool.query("SELECT COUNT(*) count FROM vehicles WHERE available=1");
  const [[bookings]]=await pool.query("SELECT COUNT(*) count FROM bookings");
  const [[revenue]]=await pool.query("SELECT COALESCE(SUM(amount),0) value FROM payments WHERE status='PAID'");
  const [alerts]=await pool.query("SELECT fa.*,b.user_id FROM fraud_alerts fa JOIN bookings b ON b.id=fa.booking_id WHERE fa.status='OPEN' ORDER BY fa.created_at DESC");
  res.json({users:users.count,cars:cars.count,bookings:bookings.count,revenue:revenue.value,alerts});
});

const openapi={openapi:"3.0.0",info:{title:"AI Car Rental API",version:"1.0.0"},paths:{
  "/api/health":{get:{responses:{"200":{description:"OK"}}}},
  "/api/auth/register":{post:{responses:{"201":{description:"Created"}}}},
  "/api/auth/login":{post:{responses:{"200":{description:"JWT returned"}}}},
  "/api/vehicles":{get:{responses:{"200":{description:"Vehicle list"}}},post:{responses:{"201":{description:"Created"}}}},
  "/api/bookings":{get:{responses:{"200":{description:"Bookings"}}},post:{responses:{"201":{description:"Created"}}}}
}};
app.use("/api/docs",swaggerUi.serve,swaggerUi.setup(openapi));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:"Internal server error"})});
app.listen(process.env.PORT||5000,()=>console.log(`API running on ${process.env.PORT||5000}`));
