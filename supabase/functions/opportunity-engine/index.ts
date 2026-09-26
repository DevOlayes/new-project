import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!;
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const serviceKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=createClient(url,serviceKey);
const SYMBOLS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","EURUSD","GBPUSD","USDJPY","AUDUSD"], VERSION="opportunity-v2", DURATION_SECONDS=3600;
const clamp=(v:number,min=-1,max=1)=>Math.max(min,Math.min(max,v));
const n=(v:unknown)=>typeof v==="number"?v:Number(v??0);
const strength=(r:Record<string,unknown>)=>clamp(n(r.trend_score)*.42+n(r.momentum_score)*.33+n(r.structure_score)*.25);
const quality=(r:Record<string,unknown>)=>{const v=Math.abs(n(r.volatility_20));if(!v)return .5;if(v<.001)return .35;if(v<=.008)return 1;if(v<=.015)return .65;return .25;};
const volume=(r:Record<string,unknown>)=>{const v=n(r.volume_change_20);return v>=0?Math.min(1,.65+v*.25):Math.max(.2,.65+v*.5);};
const fresh=(r:Record<string,unknown>,m:number)=>Date.now()-new Date(String(r.candle_open_time)).getTime()<=m*60000;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{status:200,headers:cors});
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405,headers:cors});
 const supplied=req.headers.get("apikey")??req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
 if(!supplied||supplied!==publishableKey)return Response.json({error:"Unauthorized"},{status:401});
 const now=new Date(),starts=new Date(Math.floor(Date.now()/60000)*60000),closes=new Date(starts.getTime()+DURATION_SECONDS*1000),results=[];

 // Expire old signals first so they can never remain selectable after their entry window closes.
 await admin.from("ai_opportunities")
  .update({status:"expired"})
  .in("status",["scheduled","open"])
  .lte("entry_window_end",now.toISOString());

 // Never flood the market with multiple simultaneous AI selections. If one live
 // opportunity already exists, keep it as the single canonical signal.
 const {data:liveOpportunity,error:liveError}=await admin.from("ai_opportunities")
  .select("id,symbol,direction,entry_window_start,entry_window_end,signal_score")
  .in("status",["scheduled","open"])
  .gt("entry_window_end",now.toISOString())
  .order("signal_score",{ascending:false})
  .limit(1);
 if(liveError)throw liveError;
 if(liveOpportunity?.length){
  return Response.json({
   engine:VERSION,
   generated_at:now.toISOString(),
   target_start:starts.toISOString(),
   target_close:closes.toISOString(),
   results:[{symbol:liveOpportunity[0].symbol,status:"already_exists",opportunity:liveOpportunity[0]}]
  },{headers:cors});
 }

 const candidates:Record<string,unknown>[]=[];
 return Response.json({engine:VERSION,generated_at:now.toISOString(),target_start:starts.toISOString(),target_close:closes.toISOString(),results},{headers:cors});
});