import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const corsHeaders = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type", "Access-Control-Allow-Methods":"POST,OPTIONS" };
const json = (data: unknown, status=200) => new Response(JSON.stringify(data), {status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const idTypes = new Set(["passport","national_id","drivers_license","voters_card","residence_permit"]);
const countries = new Set("AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW".split(" "));
async function digest(value: string) {
  // Keyed hashing prevents easy offline guessing of low-entropy government ID numbers.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(serviceKey), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"POST required"},405);
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token||!publishableKey||!serviceKey) return json({error:"Authentication service unavailable"},503);
  const auth=createClient(url,publishableKey,{global:{headers:{Authorization:"Bearer "+token}},auth:{autoRefreshToken:false,persistSession:false}});
  const {data:{user},error:authError}=await auth.auth.getUser(token);
  if(authError||!user) return json({error:"Please sign in again."},401);
  const body=await req.json().catch(()=>({}));
  if(body.action==="status"){
    const {data,error}=await admin.from("identity_verifications").select("status,legal_name,country_code,id_type,duplicate_flag,review_notes,submitted_at,reviewed_at").eq("user_id",user.id).maybeSingle();
    if(error)return json({error:"Could not load identity verification status."},500);
    return json({ok:true,verification:data||null});
  }
  if(body.action!=="submit") return json({error:"Unsupported action"},400);
  const legalName=String(body.legal_name||"").trim().replace(/\s+/g," ");
  const countryCode=String(body.country_code||"").toUpperCase();
  const idType=String(body.id_type||"");
  const idNumber=String(body.id_number||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  const documentPath=String(body.id_document_path||"");
  const facePath=String(body.face_scan_path||"");
  if(body.consent!==true) return json({error:"Please confirm consent for manual identity review."},400);
  if(legalName.length<2||legalName.length>160) return json({error:"Enter your full legal name as shown on your government ID."},400);
  if(!countries.has(countryCode)) return json({error:"Select a valid country."},400);
  if(!idTypes.has(idType)) return json({error:"Select a supported government ID type."},400);
  if(idNumber.length<5||idNumber.length>80) return json({error:"Enter a valid government ID number."},400);
  if(!documentPath.startsWith(user.id+"/")||!facePath.startsWith(user.id+"/")||documentPath===facePath) return json({error:"Upload both your government ID and a separate live face photo."},400);
  const {data:files,error:fileError}=await admin.storage.from("identity-documents").list(user.id,{limit:100});
  if(fileError) return json({error:"Could not verify uploaded identity files. Please retry."},503);
  const paths=new Set((files||[]).map((item:any)=>user.id+"/"+item.name));
  if(!paths.has(documentPath)||!paths.has(facePath)) return json({error:"Both identity images must finish uploading before you submit."},400);
  const idHash=await digest(idNumber);
  const {data:duplicates,error:duplicateError}=await admin.from("identity_verifications").select("user_id,status").eq("id_number_hash",idHash).neq("user_id",user.id).limit(5);
  if(duplicateError) return json({error:"Could not complete duplicate-account screening. Please retry."},503);
  const duplicateFlag=(duplicates||[]).length>0;
  const {data:existing,error:existingError}=await admin.from("identity_verifications").select("status").eq("user_id",user.id).maybeSingle();
  if(existingError) return json({error:"Could not load your existing verification request."},500);
  if(existing?.status==="approved") return json({error:"Your identity has already been approved. Contact support if your details need to change."},409);
  if(existing?.status==="pending") return json({error:"Your identity submission is already awaiting admin review."},409);
  const now=new Date().toISOString();
  const {data,error}=await admin.from("identity_verifications").upsert({
    user_id:user.id,legal_name:legalName,country_code:countryCode,id_type:idType,id_number_hash:idHash,
    id_document_path:documentPath,face_scan_path:facePath,status:"pending",duplicate_flag:duplicateFlag,
    duplicate_reviewed:false,review_notes:null,consent_at:now,submitted_at:now,reviewed_at:null,reviewed_by:null,updated_at:now
  },{onConflict:"user_id"}).select("status,duplicate_flag,submitted_at").single();
  if(error) { console.error("identity verification submit failed",error.message); return json({error:"Could not submit your identity details. Please retry."},500); }
  return json({ok:true,verification:data,message:duplicateFlag?"Your documents were submitted for additional manual review. Withdrawals remain locked until approval.":"Your documents were submitted. Withdrawals remain locked until admin approval."});
});