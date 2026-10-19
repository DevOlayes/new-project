import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url=Deno.env.get("SUPABASE_URL")!;
const secret=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,secret,{auth:{autoRefreshToken:false,persistSession:false}});
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

async function requireAdmin(req:Request){
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) throw new Error("Unauthorized");
  const {data:{user},error}=await admin.auth.getUser(token);
  if(error||!user) throw new Error("Unauthorized");
  const {data:profile}=await admin.from("profiles").select("is_admin").eq("id",user.id).single();
  if(!profile?.is_admin) throw new Error("Forbidden");
  return user;
}
const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
async function recordAudit(adminUserId:string,action:string,targetType:string,targetId:string|null,details:Record<string,unknown>={}){const {error}=await admin.from("admin_audit_log").insert({admin_user_id:adminUserId,action,target_type:targetType,target_id:targetId,details});if(error)console.error("Admin audit write failed:",error.message);}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  try{
    const user=await requireAdmin(req);
    if(req.method!=="POST") return json({error:"POST required"},405);
    const body=await req.json().catch(()=>({}));
    const action=body.action||"overview";

    if(action==="overview"){
      const [users,transactions,trades,opportunities,learning,markets,plans,subs,rewards,referrals,settings,jobs,wallets,depositRequests,paymentOrders,diagnostics,creditTransactions,modelStats,audit,usersCount,transactionsCount,tradesCount,opportunitiesCount]=await Promise.all([
        admin.from("profiles").select("id,display_name,telegram_username,email,is_admin,created_at,last_login_provider").order("created_at",{ascending:false}).limit(500),
        admin.from("wallet_transactions").select("id,user_id,type,direction,amount,status,reference,tx_hash,metadata,created_at,completed_at").order("created_at",{ascending:false}).limit(500),
        admin.from("trades").select("id,user_id,asset,direction,stake,status,result_amount,opened_at,settled_at").order("opened_at",{ascending:false}).limit(500),
        admin.from("ai_opportunities").select("id,symbol,direction,signal_score,status,outcome,model_version,entry_window_start,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("opportunity_evaluation_dataset").select("id,symbol,direction,outcome,signal_score,price_change_pct,evaluated_at").order("evaluated_at",{ascending:false}).limit(300),
        admin.from("market_instruments").select("*").order("market_type").order("symbol"),
        admin.from("subscription_plans").select("*").order("monthly_price"),
        admin.from("user_subscriptions").select("id,user_id,plan_id,billing_cycle,status,trial_started_at,trial_ends_at,starts_at,ends_at,auto_renew,payment_provider,payment_reference,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("user_rewards").select("id,user_id,reward_amount,profit_earned,profit_withdrawable,status,expires_at,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("referrals").select("id,referrer_id,referred_user_id,reward_amount,status,created_at,rewarded_at").order("created_at",{ascending:false}).limit(300),
        admin.from("app_settings").select("*").order("key"),
        admin.from("adaptive_model_weights").select("*").order("symbol"),
        admin.from("wallets").select("id,user_id,asset,network,available_balance,locked_balance,updated_at").order("updated_at",{ascending:false}).limit(1000),
        admin.from("deposit_requests").select("id,user_id,asset,network,amount,tx_hash,status,admin_note,reviewed_by,reviewed_at,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("payment_orders").select("id,user_id,purpose,base_amount,payment_amount,credits,status,tx_hash,block_number,created_at,expires_at,paid_at").order("created_at",{ascending:false}).limit(300),
        admin.from("client_diagnostic_events").select("id,created_at,event_time,diagnostic_id,session_id,level,source,event_name,message,stack,page_path,request_path,http_status,duration_ms,browser_family,metadata").order("created_at",{ascending:false}).limit(300),
        admin.from("ai_credit_transactions").select("id,user_id,type,credits,amount_usd,reference,metadata,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("model_performance_stats").select("id,model_version,symbol,interval,sample_size,wins,losses,voids,win_rate,avg_price_change_pct,calculated_at").order("calculated_at",{ascending:false}).limit(300),
        admin.from("admin_audit_log").select("id,admin_user_id,action,target_type,target_id,details,created_at").order("created_at",{ascending:false}).limit(300),
        admin.from("profiles").select("id",{count:"exact",head:true}),
        admin.from("wallet_transactions").select("id",{count:"exact",head:true}),
        admin.from("trades").select("id",{count:"exact",head:true}),
        admin.from("ai_opportunities").select("id",{count:"exact",head:true})
      ]);
      const all=[users,transactions,trades,opportunities,learning,markets,plans,subs,rewards,referrals,settings,jobs,wallets,depositRequests,paymentOrders,diagnostics,creditTransactions,modelStats,audit,usersCount,transactionsCount,tradesCount,opportunitiesCount];
      return json({
        users:users.data||[],transactions:transactions.data||[],trades:trades.data||[],opportunities:opportunities.data||[],learning:learning.data||[],markets:markets.data||[],
        plans:plans.data||[],subscriptions:subs.data||[],rewards:rewards.data||[],referrals:referrals.data||[],settings:settings.data||[],adaptive:jobs.data||[],wallets:wallets.data||[],
        depositRequests:depositRequests.data||[],paymentOrders:paymentOrders.data||[],diagnostics:diagnostics.data||[],creditTransactions:creditTransactions.data||[],modelStats:modelStats.data||[],audit:audit.data||[],
        counts:{users:usersCount.count??users.data?.length??0,transactions:transactionsCount.count??transactions.data?.length??0,trades:tradesCount.count??trades.data?.length??0,opportunities:opportunitiesCount.count??opportunities.data?.length??0},
        errors:all.filter(x=>x.error).map(x=>x.error.message)
      });
    }
    if(action==="review_withdrawal"){
      const {transaction_id,review_action,reason,tx_hash}=body;
      if(!transaction_id||!["approve","reject","complete"].includes(review_action)||typeof reason!=="string")
        return json({error:"A withdrawal, valid review action and reason are required."},400);
      const {data:review,error}=await admin.schema("private").rpc("admin_review_withdrawal",{
        p_admin_user_id:user.id,
        p_transaction_id:transaction_id,
        p_action:review_action,
        p_reason:reason,
        p_tx_hash:tx_hash||null
      });
      if(error)return json({error:error.message},400);
      await recordAudit(user.id,"review_withdrawal","wallet_transaction",String(transaction_id),{review_action,reason,tx_hash:tx_hash||null});
      return json({ok:true,review});
    }
    if(action==="adjust_wallet"){
      const {user_id,asset="USDT",network="TRC-20",amount,direction,reason,request_id}=body;
      const numericAmount=Number(amount);
      const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if(!user_id||!Number.isFinite(numericAmount)||numericAmount<=0||!["credit","debit"].includes(direction)||typeof reason!=="string"||!uuidPattern.test(String(request_id||"")))
        return json({error:"A target user, positive amount, credit/debit direction, reason and valid request ID are required."},400);
      const {data:adjustment,error}=await admin.schema("private").rpc("admin_adjust_wallet",{
        p_admin_user_id:user.id,
        p_user_id:user_id,
        p_asset:asset,
        p_network:network,
        p_amount:numericAmount,
        p_direction:direction,
        p_reason:reason,
        p_request_id:request_id
      });
      if(error)return json({error:error.message},400);
      await recordAudit(user.id,"adjust_wallet","wallet",String(user_id),{asset,network,amount:numericAmount,direction,reason,adjustment_id:adjustment?.id||null});
      return json({ok:true,adjustment});
    }
    if(action==="update_setting"){
      const {key,value}=body; if(!key) return json({error:"key required"},400);
      const {error}=await admin.from("app_settings").upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"});
      if(error) return json({error:error.message},400); await recordAudit(user.id,"update_setting","app_setting",String(key),{value}); return json({ok:true});
    }
    if(action==="update_market"){
      const {symbol,active,tradable}=body; if(!symbol) return json({error:"symbol required"},400);
      const patch:any={updated_at:new Date().toISOString()}; if(typeof active==="boolean")patch.active=active;if(typeof tradable==="boolean")patch.tradable=tradable;
      const {error}=await admin.from("market_instruments").update(patch).eq("symbol",symbol);
      if(error)return json({error:error.message},400);await recordAudit(user.id,"update_market","market_instrument",String(symbol),{patch});return json({ok:true});
    }
    if(action==="update_plan"){
      const {id,patch}=body;if(!id||!patch)return json({error:"id and patch required"},400);
      const allowed=["name","description","monthly_price","quarterly_price","annual_price","currency","trial_days","active","features"];
      const clean:any={};for(const k of allowed)if(k in patch)clean[k]=patch[k];clean.updated_at=new Date().toISOString();
      const {error}=await admin.from("subscription_plans").update(clean).eq("id",id);
      if(error)return json({error:error.message},400);await recordAudit(user.id,"update_plan","subscription_plan",String(id),{patch:clean});return json({ok:true});
    }
    if(action==="grant_subscription"){
      const {user_id,plan_id,billing_cycle="monthly",days=30}=body;if(!user_id||!plan_id)return json({error:"user_id and plan_id required"},400);
      const starts=new Date(),ends=new Date(Date.now()+Number(days)*86400000);
      const {error:cancelError}=await admin.from("user_subscriptions").update({status:"cancelled",updated_at:starts.toISOString()}).eq("user_id",user_id).in("status",["trialing","active","past_due"]);
      if(cancelError)return json({error:cancelError.message},400);
      const {error}=await admin.from("user_subscriptions").insert({user_id,plan_id,billing_cycle,status:"active",starts_at:starts.toISOString(),ends_at:ends.toISOString(),auto_renew:false,payment_provider:"admin_grant"});
      if(error)return json({error:error.message},400);await recordAudit(user.id,"grant_subscription","user_subscription",String(user_id),{plan_id,billing_cycle,days:Number(days)});return json({ok:true});
    }
    if(action==="cancel_subscription"){
      const {subscription_id}=body;if(!subscription_id)return json({error:"subscription_id required"},400);
      const {error}=await admin.from("user_subscriptions").update({status:"cancelled",auto_renew:false,updated_at:new Date().toISOString()}).eq("id",subscription_id);
      if(error)return json({error:error.message},400);await recordAudit(user.id,"cancel_subscription","user_subscription",String(subscription_id),{});return json({ok:true});
    }
    if(action==="set_user_admin"){
      const {user_id,is_admin}=body;if(!user_id||typeof is_admin!=="boolean")return json({error:"invalid request"},400);
      if(user_id===user.id&&is_admin===false)return json({error:"You cannot remove your own admin access from this panel."},400);
      const {error}=await admin.from("profiles").update({is_admin,updated_at:new Date().toISOString()}).eq("id",user_id);
      if(error)return json({error:error.message},400);await recordAudit(user.id,"set_user_admin","profile",String(user_id),{is_admin});return json({ok:true});
    }
    return json({error:"Unknown action"},400);
  }catch(e){return json({error:e instanceof Error?e.message:"Request failed"},401);}
});