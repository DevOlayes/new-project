import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const admin = createClient(url, serviceKey);

const SYMBOLS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","EURUSD","GBPUSD","USDJPY","AUDUSD"];
const INTERVALS = ["1m","5m","15m","1h"];
const WEIGHTS: Record<string, number> = {"1m":0.12,"5m":0.20,"15m":0.28,"1h":0.40};
const VERSION = "opportunity-v3";
const DURATION_SECONDS = 3600;

const clamp = (v:number,min=-1,max=1) => Math.max(min, Math.min(max,v));
const num = (v:unknown) => Number.isFinite(Number(v)) ? Number(v) : null;
const signal = (row:any) => {
  const trend=num(row.trend_score) ?? 0;
  const momentum=num(row.momentum_score) ?? 0;
  const structure=num(row.structure_score) ?? 0;
  return clamp(trend*.42 + momentum*.33 + structure*.25);
};
const freshness=(row:any, minutes:number) => {
  const t=new Date(String(row.candle_open_time)).getTime();
  return Number.isFinite(t) && Date.now()-t <= minutes*60000;
};
const quality=(row:any) => {
  const v=num(row.volatility_20);
  if(v===null) return 0.5;
  const a=Math.abs(v);
  if(a<0.0001) return 0.25;
  if(a<0.001) return 0.55;
  if(a<=0.008) return 1;
  if(a<=0.015) return 0.7;
  return 0.3;
};
const volumeQuality=(row:any) => {
  const v=num(row.volume_change_20);
  if(v===null) return 0.55;
  return clamp(0.65 + v*.25, .2, 1);
};

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS"
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{status:200,headers:cors});
  if(req.method!=="POST") return Response.json({error:"POST required"},{status:405,headers:cors});

  const supplied=req.headers.get("apikey") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") ?? "";
  if(!supplied || supplied!==publishableKey) return Response.json({error:"Unauthorized"},{status:401,headers:cors});

  const body=await req.json().catch(()=>({}));
  const requestSource=String(body?.source||"user");
  const authHeader=req.headers.get("authorization") || "";
  const bearer=authHeader.replace(/^Bearer\s+/i,"");
  let userId:string|null=null;
  if(bearer && bearer!==publishableKey){
    const {data:authData}=await admin.auth.getUser(bearer);
    userId=authData.user?.id || null;
  }
  if(!userId && requestSource!=="cron") return Response.json({error:"A signed-in FLEXAR account is required."},{status:401,headers:cors});

  const now=new Date();
  await admin.from("ai_opportunities")
    .update({status:"expired",updated_at:now.toISOString()})
    .in("status",["scheduled","open"])
    .lte("entry_window_end",now.toISOString());

  const {data:live,error:liveError}=await admin.from("ai_opportunities")
    .select("id,symbol,direction,entry_window_start,entry_window_end,signal_score")
    .in("status",["scheduled","open"])
    .gt("entry_window_end",now.toISOString())
    .order("signal_score",{ascending:false})
    .limit(1);
  if(liveError) return Response.json({error:liveError.message},{status:500,headers:cors});
  if(live?.length){
    return Response.json({
      engine:VERSION,generated_at:now.toISOString(),
      results:[{symbol:live[0].symbol,status:"already_exists",opportunity:live[0]}]
    },{headers:cors});
  }

  const intervalResults=await Promise.all(INTERVALS.map(async (interval)=>{
    const response=await admin.from("market_features")
      .select("symbol,interval,candle_open_time,close_price,volatility_20,volume_change_20,trend_score,momentum_score,structure_score")
      .in("symbol",SYMBOLS)
      .eq("interval",interval)
      .order("candle_open_time",{ascending:false})
      .limit(1000);
    return {interval,...response};
  }));
  const failedInterval=intervalResults.find((item)=>item.error);
  if(failedInterval?.error) return Response.json({error:failedInterval.error.message},{status:500,headers:cors});

  const bySymbol:Record<string,Record<string,any>>={};
  for(const result of intervalResults){
    for(const row of result.data||[]){
      if(!bySymbol[row.symbol]) bySymbol[row.symbol]={};
      if(!bySymbol[row.symbol][row.interval]) bySymbol[row.symbol][row.interval]=row;
    }
  }

  const candidates:any[]=[];
  for(const symbol of SYMBOLS){
    const f=bySymbol[symbol]||{};
    if(!INTERVALS.every(i=>f[i])) continue;
    if(!freshness(f["1m"],5)||!freshness(f["5m"],10)||!freshness(f["15m"],25)||!freshness(f["1h"],90)) continue;

    const per=INTERVALS.map(i=>signal(f[i]));
    const weighted=INTERVALS.reduce((sum,i)=>sum+per[INTERVALS.indexOf(i)]*WEIGHTS[i],0);
    const abs= Math.abs(weighted);
    const direction=weighted>=0 ? "up" : "down";
    const positives=per.filter(v=>v>0.08).length;
    const negatives=per.filter(v=>v<-0.08).length;
    const aligned=Math.max(positives,negatives)/INTERVALS.length;
    const vol=INTERVALS.reduce((s,i)=>s+quality(f[i])*WEIGHTS[i],0);
    const volume=INTERVALS.reduce((s,i)=>s+volumeQuality(f[i])*WEIGHTS[i],0);
    const confidence=clamp(abs*.55+aligned*.25+vol*.10+volume*.10,0,1);
    const price=num(f["1m"].close_price);
    if(price===null || price<=0) continue;

    if(abs>=0.25 && aligned>=0.75 && confidence>=0.42){
      candidates.push({
        symbol,direction,duration_seconds:DURATION_SECONDS,
        signal_score:Number(confidence.toFixed(4)),
        entry_price:price,
        model_version:VERSION,
        metadata:{
          engine:VERSION,
          combined_signal:Number(weighted.toFixed(6)),
          timeframe_alignment:Number(aligned.toFixed(3)),
          volatility_quality:Number(vol.toFixed(3)),
          volume_quality:Number(volume.toFixed(3)),
          reason:"Multi-timeframe alignment, regime consistency, volatility and volume quality",
          feature_snapshot:{features:f,direction}
        }
      });
    }
  }

  candidates.sort((a,b)=>b.signal_score-a.signal_score);
  const best=candidates[0];
  if(!best){
    return Response.json({
      engine:VERSION,generated_at:now.toISOString(),
      status:"no_high_quality_opportunity",
      results:[]
    },{headers:cors});
  }

  const entryStart=new Date(Math.floor(Date.now()/60000)*60000);
  const entryEnd=new Date(entryStart.getTime()+DURATION_SECONDS*1000);
  const {data:created,error:createError}=await admin.from("ai_opportunities").insert({
    symbol:best.symbol,direction:best.direction,duration_seconds:DURATION_SECONDS,
    entry_window_start:entryStart.toISOString(),entry_window_end:entryEnd.toISOString(),
    signal_score:best.signal_score,model_version:best.model_version,status:"scheduled",
    entry_price:best.entry_price,metadata:best.metadata
  }).select("id,symbol,direction,duration_seconds,entry_window_start,entry_window_end,signal_score,model_version,status,entry_price,metadata").single();

  if(createError) return Response.json({error:createError.message},{status:500,headers:cors});

  return Response.json({
    engine:VERSION,generated_at:now.toISOString(),
    results:[{symbol:best.symbol,status:"created",opportunity:created}]
  },{headers:cors});
});