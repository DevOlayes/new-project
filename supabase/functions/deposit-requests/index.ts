import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!;
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const secretKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=createClient(url,secretKey,{auth:{autoRefreshToken:false,persistSession:false}});
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!publishableKey) return json({error:"Unauthorized"},401);
  const auth=createClient(url,publishableKey,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authError}=await auth.auth.getUser(token);
  if(authError||!user) return json({error:"Invalid session"},401);
  const body=await req.json().catch(()=>({}));
  if(body.action==="list"){
    const {data,error}=await admin.from("deposit_requests").select("id,amount,tx_hash,status,admin_note,created_at,reviewed_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(30);
    if(error) return json({error:"Could not load deposit requests."},500);
    return json({ok:true,requests:data||[]});
  }
  const amount=Number(body.amount);
  const txHash=String(body.tx_hash||"").trim().toLowerCase();
  if(!Number.isFinite(amount)||amount<=0||amount>1000000000) return json({error:"Enter a valid USDT amount."},400);
  if(!/^[a-f0-9]{64}$/.test(txHash)) return json({error:"Enter the transaction hash (TXID) from the TRON transaction. It should be 64 hexadecimal characters."},400);
  const {data,error}=await admin.from("deposit_requests").insert({user_id:user.id,asset:"USDT",network:"TRC-20",amount,tx_hash:txHash}).select("id,amount,tx_hash,status,created_at").single();
  if(error){
    if(error.code==="23505") return json({error:"This transaction hash has already been submitted. Each transaction can only be claimed once."},409);
    return json({error:"Could not submit deposit request. Please try again."},500);
  }
  return json({ok:true,request:data});
});