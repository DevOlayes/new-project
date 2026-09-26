import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")!;
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const secretKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=createClient(url,secretKey);
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return Response.json({error:"POST required"},{status:405,headers:corsHeaders});
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token||!publishableKey) return Response.json({error:"Unauthorized"},{status:401,headers:corsHeaders});
  const auth=createClient(url,publishableKey,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data,error}=await auth.auth.getUser(token);
  if(error||!data.user) return Response.json({error:"Invalid session"},{status:401,headers:corsHeaders});

  const {data:settings,error:settingsError}=await admin.from("app_settings").select("key,value").in("key",["deposit_addresses","supported_assets"]);
  if(settingsError) return Response.json({error:"Could not load wallet settings."},{status:500,headers:corsHeaders});
  const map=Object.fromEntries((settings||[]).map((item)=>[item.key,item.value]));
  return Response.json({ok:true,deposit_addresses:map.deposit_addresses||{},supported_assets:map.supported_assets||{}},{headers:{...corsHeaders,"Content-Type":"application/json"}});
});