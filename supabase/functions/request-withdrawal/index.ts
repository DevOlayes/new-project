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

  const body=await req.json().catch(()=>({}));
  const asset=String(body.asset||"").toUpperCase();
  const network=String(body.network||"");
  const amount=Number(body.amount);
  const address=String(body.address||"").trim();
  if(!asset||!network||!Number.isFinite(amount)||amount<=0||!address)
    return Response.json({error:"Asset, network, amount and destination address are required."},{status:400,headers:corsHeaders});

  const {data:result,error:rpcError}=await admin.schema("private").rpc("request_withdrawal",{
    p_user_id:data.user.id,p_asset:asset,p_network:network,p_amount:amount,p_address:address
  });
  if(rpcError) return Response.json({error:rpcError.message},{status:400,headers:corsHeaders});
  return Response.json({ok:true,withdrawal:result},{headers:{...corsHeaders,"Content-Type":"application/json"}});
});