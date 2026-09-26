import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const PUBLISHABLE_KEYS = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const SERVICE_KEY = SECRET_KEYS.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PUBLISHABLE_KEY = PUBLISHABLE_KEYS.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const BASE = { "1m": 0.12, "5m": 0.20, "15m": 0.28, "1h": 0.40 };
const VERSION = "opportunity-v2";

function authorized(req: Request) {
  const key = req.headers.get("apikey") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i,"") ?? "";
  return key === PUBLISHABLE_KEY;
}
function signal(feature: any) {
  return Number(feature?.trend_score ?? 0) * 0.42 + Number(feature?.momentum_score ?? 0) * 0.33 + Number(feature?.structure_score ?? 0) * 0.25;
}
function normalize(weights: Record<string,number>) {
  const sum = Object.values(weights).reduce((a,b)=>a+b,0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,Number((v/sum).toFixed(6))]));
}

Deno.serve(async(req)=>{
  if(req.method!=="POST") return Response.json({error:"POST required"},{status:405});
  if(!authorized(req)) return Response.json({error:"Unauthorized"},{status:401});

  const {data:instruments,error:instrumentError}=await supabase.from("market_instruments").select("symbol").eq("active",true);
  if(instrumentError) throw instrumentError;

  const results=[];
  for(const instrument of instruments??[]){
    const {data:rows,error}=await supabase.from("opportunity_evaluation_dataset")
      .select("symbol,model_version,direction,outcome,outcome_label,signal_score,feature_snapshot,created_at")
      .eq("symbol",instrument.symbol).eq("model_version",VERSION).in("outcome",["won","lost"])
      .order("created_at",{ascending:false}).limit(200);
    if(error) throw error;

    const weights:Record<string,number>={...BASE};
    const stats:Record<string,{samples:number,wins:number,losses:number}>={};
    for(const interval of Object.keys(BASE)) stats[interval]={samples:0,wins:0,losses:0};

    for(const row of rows??[]){
      const features=(row.feature_snapshot as any)?.features ?? {};
      for(const interval of Object.keys(BASE)){
        const f=features[interval];
        if(!f) continue;
        const s=signal(f);
        if(Math.abs(s)<0.05) continue;
        const predicted=(s>0?"up":"down");
        stats[interval].samples++;
        if(predicted===row.direction && row.outcome==="won") stats[interval].wins++;
        else if(predicted!==row.direction && row.outcome==="lost") stats[interval].wins++;
        else stats[interval].losses++;
      }
    }

    let totalSamples=0;
    for(const interval of Object.keys(BASE)){
      const s=stats[interval];
      totalSamples+=s.samples;
      if(s.samples>=20){
        const accuracy=s.wins/s.samples;
        // Guardrails: learn gradually and never let one timeframe dominate.
        const multiplier=Math.max(0.80,Math.min(1.20,0.70 + accuracy));
        weights[interval]=BASE[interval]*multiplier;
      }
      const sample=s.samples, wins=s.wins, losses=s.losses;
      await supabase.from("model_performance_stats").upsert({
        model_version:VERSION,symbol:instrument.symbol,interval,sample_size:sample,wins,losses,voids:0,
        win_rate:sample?Number((wins/sample).toFixed(6)):0,
        avg_price_change_pct:0,calculated_at:new Date().toISOString()
      },{onConflict:"model_version,symbol,interval"});
    }

    const normalized=normalize(weights);
    const confidenceFloor=totalSamples>=50?0.62:0.64;
    await supabase.from("adaptive_model_weights").upsert({
      model_version:VERSION,symbol:instrument.symbol,weights:normalized,confidence_floor:confidenceFloor,
      sample_size:totalSamples,calculated_at:new Date().toISOString()
    },{onConflict:"model_version,symbol"});

    results.push({symbol:instrument.symbol,sample_size:totalSamples,weights:normalized,confidence_floor:confidenceFloor});
  }

  return Response.json({ok:true,engine:"adaptive-learning-v1",model_version:VERSION,processed_at:new Date().toISOString(),results});
});