import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!, serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, publishableKey=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")??"";
const admin=createClient(url,serviceKey);
const SYMBOLS=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","EURUSD","GBPUSD","USDJPY","AUDUSD"], VERSION="opportunity-v2", DURATION_SECONDS=3600;
const clamp=(v:number,min=-1,max=1)=>Math.max(min,Math.min(max,v));
const n=(v:unknown)=>typeof v==="number"?v:Number(v??0);
const strength=(r:Record<string,unknown>)=>clamp(n(r.trend_score)*.42+n(r.momentum_score)*.33+n(r.structure_score)*.25);
const quality=(r:Record<string,unknown>)=>{const v=Math.abs(n(r.volatility_20));if(!v)return .5;if(v<.001)return .35;if(v<=.008)return 1;if(v<=.015)return .65;return .25;};
const volume=(r:Record<string,unknown>)=>{const v=n(r.volume_change_20);return v>=0?Math.min(1,.65+v*.25):Math.max(.2,.65+v*.5);};
const fresh=(r:Record<string,unknown>,m:number)=>Date.now()-new Date(String(r.candle_open_time)).getTime()<=m*60000;
Deno.serve(async(req)=>{
 if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
 const supplied=req.headers.get("apikey")??req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
 if(!supplied||supplied!==publishableKey)return Response.json({error:"Unauthorized"},{status:401});
 const now=new Date(),starts=new Date(Math.ceil((Date.now()+3600000)/60000)*60000),closes=new Date(starts.getTime()+DURATION_SECONDS*1000),results=[];
 for(const symbol of SYMBOLS){
  const {data:rows,error}=await admin.from("market_features").select("*").eq("symbol",symbol).in("interval",["1m","5m","15m","1h"]).order("candle_open_time",{ascending:false}).limit(100);
  if(error)throw error;
  const latest:Record<string,Record<string,unknown>>={};for(const row of rows??[]){const i=String(row.interval);if(!latest[i])latest[i]=row;}
  const reqd=["1m","5m","15m","1h"];if(reqd.some(i=>!latest[i])){results.push({symbol,status:"insufficient_features"});continue;}
  const freshness:[string,number][]=[["1m",3],["5m",12],["15m",35],["1h",90]];
  if(freshness.some(([i,m])=>!fresh(latest[i],m))){results.push({symbol,status:"stale_market_features"});continue;}
  const scores=reqd.map(i=>strength(latest[i])),weighted=clamp(scores[0]*.12+scores[1]*.20+scores[2]*.28+scores[3]*.40);
  const positives=scores.filter(v=>v>.08).length,negatives=scores.filter(v=>v<-.08).length,alignment=Math.max(positives,negatives)/4;
  const regime=Math.abs(n(latest["1h"].trend_score)-n(latest["15m"].trend_score))<=.45?1:.55;
  const vol=quality(latest["1m"])*.15+quality(latest["5m"])*.20+quality(latest["15m"])*.25+quality(latest["1h"])*.40;
  const volm=volume(latest["1m"])*.15+volume(latest["5m"])*.20+volume(latest["15m"])*.25+volume(latest["1h"])*.40;
  const abs=Math.abs(weighted),confidence=clamp(abs*.50+alignment*.25+vol*.10+volm*.10+regime*.05,0,1);
  if(abs<.25||alignment<.75||regime<.75||confidence<.64){results.push({symbol,status:"no_high_quality_opportunity",signal:+weighted.toFixed(4),confidence:+confidence.toFixed(4),alignment:+alignment.toFixed(4)});continue;}
  const direction=weighted>0?"up":"down",entry=n(latest["1m"].close_price);
  const snapshot={generated_at:now.toISOString(),direction,combined_signal:+weighted.toFixed(6),timeframe_alignment:+alignment.toFixed(6),regime_consistency:+regime.toFixed(6),volatility_quality:+vol.toFixed(6),volume_quality:+volm.toFixed(6),features:Object.fromEntries(reqd.map(i=>[i,{candle_open_time:latest[i].candle_open_time,close_price:latest[i].close_price,trend_score:latest[i].trend_score,momentum_score:latest[i].momentum_score,structure_score:latest[i].structure_score,volatility_20:latest[i].volatility_20,volume_change_20:latest[i].volume_change_20}]))};
  const {data:existing}=await admin.from("ai_opportunities").select("id").eq("symbol",symbol).eq("entry_window_start",starts.toISOString()).eq("model_version",VERSION).limit(1);if(existing?.length){results.push({symbol,status:"already_exists"});continue;}
  const {data,error:ie}=await admin.from("ai_opportunities").insert({symbol,direction,duration_seconds:DURATION_SECONDS,entry_window_start:starts.toISOString(),entry_window_end:closes.toISOString(),signal_score:+confidence.toFixed(6),model_version:VERSION,status:"scheduled",entry_price:entry,metadata:{engine:VERSION,reason:String(Math.round(alignment*100))+"% timeframe alignment • regime consistency • volatility and volume quality",signal:+weighted.toFixed(6),feature_snapshot:snapshot}}).select("id,symbol,direction,entry_window_start,entry_window_end,signal_score").single();
  if(ie)throw ie;results.push({symbol,status:"created",opportunity:data});
 }
 return Response.json({engine:VERSION,generated_at:now.toISOString(),target_start:starts.toISOString(),target_close:closes.toISOString(),results});
});