import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const HEADERS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-ignite-team-key,authorization,apikey","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const text=(x:unknown,max=250)=>String(x??"").trim().slice(0,max);
const bool=(x:unknown)=>x===true||x===1||x==="true"||x==="1";
const iso=(x:unknown)=>{const d=new Date(String(x));if(!Number.isFinite(d.getTime()))throw Error("Invalid event timestamp");return d.toISOString()};
const cleanStatus=(x:unknown)=>{const s=text(x,50).toLowerCase().replace(/[\s-]/g,"_");return ["completed","answered","success"].includes(s)?"answered":["voicemail","voice_mail"].includes(s)?"voicemail":["busy"].includes(s)?"busy":["failed","canceled","cancelled"].includes(s)?"failed":"no_answer"};
const appointmentStatus=(x:unknown)=>{const s=text(x,60).toLowerCase().replace(/[\s-]/g,"_");return ["showed","attended","completed"].includes(s)?"showed":["no_show","noshow","not_shown"].includes(s)?"no_show":["cancelled","canceled","deleted"].includes(s)?"canceled":["confirmed"].includes(s)?"confirmed":"booked"};
const hashKey=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,"0")).join("");
const constantEqual=(a:string,b:string)=>{if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0};
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:HEADERS});
  if(req.method!=="POST")return reply({error:"POST required"},405);
  const key=text(req.headers.get("x-ignite-team-key"),200);
  if(!key)return reply({error:"Webhook key required"},401);
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return reply({error:"Service unavailable"},503);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:config,error:configError}=await db.from("ignite_team_integrations").select("webhook_key_hash,enabled").eq("id","ghl").maybeSingle();
  if(configError||!config?.enabled||!config.webhook_key_hash)return reply({error:"GHL integration not enabled"},403);
  if(!constantEqual(await hashKey(key),config.webhook_key_hash))return reply({error:"Invalid webhook key"},403);
  let payload:Record<string,any>;try{payload=await req.json()}catch(_){return reply({error:"Invalid JSON body"},400)}
  try{
    const type=text(payload.type||payload.event_type,80).toLowerCase();
    const isCall=type==="call"||(type==="outboundmessage"&&String(payload.messageType||"").toUpperCase()==="CALL");
    const isAppointment=type==="appointment"||/^appointment(create|update)$/.test(type);
    if(!isCall&&!isAppointment)return reply({error:"Only outbound calls and appointment events supported"},422);
    if(isCall&&String(payload.direction||"outbound").toLowerCase()!=="outbound")return reply({skipped:true,reason:"Not an outbound call"});
    const a=payload.appointment||payload.calendar||{};
    const memberId=text(isAppointment?(payload.ghl_user_id||a.assignedUserId||a.created_by_user_id||payload.userId):(payload.ghl_user_id||payload.userId||payload.assignedUserId),150);
    if(!memberId)return reply({error:"Missing explicit GHL user ID for attribution"},422);
    const {data:member,error:memberError}=await db.from("ignite_team_members").select("id,full_name").eq("ghl_user_id",memberId).eq("status","active").maybeSingle();
    if(memberError)throw Error(memberError.message);
    if(!member)return reply({error:"GHL user ID not mapped to active Ignite Team member",received_ghl_user_id:memberId},422);
    if(isCall){
      const eventId=text(payload.event_id||payload.external_id||payload.messageId,220);
      if(!eventId)return reply({error:"A stable event_id or messageId is required to avoid double counting"},422);
      const source=text(payload.call_status||payload.callStatus||payload.outcome||payload.status,70);
      const outcome=cleanStatus(source);
      const row={external_id:"ghl-call:"+eventId,member_id:member.id,ghl_contact_id:text(payload.ghl_contact_id||payload.contactId)||null,
        contact_name:text(payload.contact_name||payload.contactName)||null,outcome,
        pitched:bool(payload.pitched),interested:bool(payload.interested),
        occurred_at:iso(payload.occurred_at||payload.dateAdded||payload.timestamp||new Date().toISOString())};
      const {error}=await db.from("ignite_team_call_events").upsert(row,{onConflict:"external_id"});
      if(error)throw Error(error.message);
      return reply({success:true,kind:"call",member:member.full_name,outcome});
    }
    const appointmentId=text(payload.appointment_id||payload.external_id||a.id||a.appointmentId,200);
    if(!appointmentId)return reply({error:"Stable appointment id required"},422);
    const scheduledAt=payload.scheduled_at||a.startTime||a.start_time;
    if(!scheduledAt)return reply({error:"Scheduled time required"},422);
    const company=text(payload.company_name||payload.companyName||a.title||payload.contact?.companyName,250)||"GHL Appointment";
    const row={external_id:"ghl-appointment:"+appointmentId,member_id:member.id,company_name:company,
      contact_name:text(payload.contact_name||payload.contactName||payload.full_name||payload.contact?.name,250)||null,
      ghl_contact_id:text(payload.ghl_contact_id||payload.contactId||a.contactId,200)||null,
      scheduled_at:iso(scheduledAt),status:appointmentStatus(payload.appointment_status||payload.status||a.appointmentStatus||a.appoinmentStatus),
      source:"ghl",updated_at:new Date().toISOString()};
    const {error}=await db.from("ignite_team_appointments").upsert(row,{onConflict:"external_id"});
    if(error)throw Error(error.message);
    return reply({success:true,kind:"appointment",member:member.full_name,status:row.status});
  }catch(e){console.error("ignite-team-ghl",e);return reply({error:e instanceof Error?e.message:"Ingest error"},500)}
});
