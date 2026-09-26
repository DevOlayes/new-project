import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")!;
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const serviceKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=createClient(url,serviceKey);
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{status:200,headers:cors});
  if(req.method!=="POST") return Response.json({error:"POST required"},{status:405,headers:cors});

  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token||!publishableKey) return Response.json({error:"Unauthorized"},{status:401,headers:cors});

  const auth=createClient(url,publishableKey,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data,error}=await auth.auth.getUser(token);
  if(error||!data.user) return Response.json({error:"Invalid session"},{status:401,headers:cors});

  const body=await req.json().catch(()=>({}));
  const mode=String(body.mode||"ai").toLowerCase();
  const stake=Number(body.stake||0);

  if(!Number.isFinite(stake)||stake<=0) return Response.json({error:"A valid stake is required."},{status:400,headers:cors});

  if(mode==="manual"){
    const symbol=String(body.symbol||"").toUpperCase().trim();
    const direction=String(body.direction||"").toLowerCase().trim();
    const durationSeconds=Number(body.duration_seconds||0);

    if(!symbol||!["up","down"].includes(direction)||![900,1800,3600].includes(durationSeconds)){
      return Response.json({error:"Select a market, UP or DOWN, and a valid 15, 30, or 60 minute duration."},{status:400,headers:cors});
    }

    const {data:trade,error:tradeError}=await auth.rpc("execute_manual_trade",{
      p_user_id:data.user.id,
      p_symbol:symbol,
      p_direction:direction,
      p_duration_seconds:durationSeconds,
      p_stake:stake
    });

    if(tradeError) return Response.json({error:tradeError.message},{status:400,headers:cors});
    return Response.json({ok:true,trade,mode:"manual"},{headers:cors});
  }

  const opportunityId=String(body.opportunity_id||"");
  if(!opportunityId) return Response.json({error:"Select a valid AI opportunity."},{status:400,headers:cors});

  const {data:trade,error:tradeError}=await auth.rpc("execute_trade",{
    p_user_id:data.user.id,
    p_opportunity_id:opportunityId,
    p_stake:stake
  });

  if(tradeError) return Response.json({error:tradeError.message},{status:400,headers:cors});
  return Response.json({ok:true,trade,mode:"ai"},{headers:cors});
});