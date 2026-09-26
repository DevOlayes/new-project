import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const url=Deno.env.get("SUPABASE_URL")!;
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
const serviceKey=secretKeys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const publishableKeys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const publishableKey=publishableKeys.default||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
const admin=createClient(url,serviceKey);
Deno.serve(async(req)=>{
 const supplied=req.headers.get("apikey")||req.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
 if(!supplied||supplied!==publishableKey)return Response.json({error:"Unauthorized"},{status:401});
 const {data,error}=await admin.schema("private").rpc("settle_due_trades");
 if(error)return Response.json({error:error.message},{status:500});
 return Response.json({ok:true,...data});
});