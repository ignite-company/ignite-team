import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};
const response = (payload: unknown, status=200) => new Response(JSON.stringify(payload), {status,headers});
const fail = (message: string, status=400) => response({error:message},status);
const uuid = (x: unknown) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const clean = (value: unknown, limit=200) => String(value ?? "").trim().slice(0,limit);
const numeric = (value: unknown, max=10000000) => { const n=Number(value); if(!Number.isFinite(n)||n<0||n>max) throw Error("Invalid amount or count"); return n; };
const validDate = (input: unknown) => { const d=new Date(String(input)); if(!Number.isFinite(d.getTime())) throw Error("Invalid date");return d.toISOString(); };
const check = (error: {message:string}|null) => { if(error) throw Error(error.message); };
const tomorrow = (days: number) => new Date(Date.now()+days*86400000).toISOString();
const validEmail=(e:string)=>!e||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const selectFields = {
  members:"id,full_name,email,role,status,ghl_user_id,daily_dial_goal,created_at,updated_at",
  activity:"id,member_id,activity_date,dials,pickups,pitches,interested,source,updated_at",
  calls:"id,member_id,external_id,contact_name,outcome,pitched,interested,occurred_at",
  appointments:"id,member_id,company_name,contact_name,scheduled_at,status,source,notes,created_at,updated_at",
  deals:"id,company_name,setter_id,closer_id,appointment_id,stage,contract_value,notes,won_at,created_at,updated_at",
  paymentLinks:"id,revenue_event_id,deal_id,created_at",
  ledger:"external_id,provider,event_type,customer_name,customer_email,product_title,amount,paid_at"
};
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  if(req.method!=="POST") return fail("POST required",405);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return fail("Sign in required",401);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return fail("Server not configured",503);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authErr}=await db.auth.getUser(token);
  if(authErr||!auth?.user) return fail("Session expired",401);
  const {data:profile,error:profileErr}=await db.from("user_profiles").select("role,full_name,email").eq("id",auth.user.id).maybeSingle();
  if(profileErr||profile?.role!=="admin") return fail("Ignite admin permission required",403);
  const body=await req.json().catch(()=>({}));
  const action=clean(body.action,60)||"snapshot";
  try {
    if(action==="snapshot") {
      const cutoff=tomorrow(-120),ledgerCutoff=tomorrow(-365);
      const [members,activity,calls,appointments,deals,links,ledger]=await Promise.all([
        db.from("ignite_team_members").select(selectFields.members).order("created_at",{ascending:true}).limit(250),
        db.from("ignite_team_daily_activity").select(selectFields.activity).gte("activity_date",cutoff.slice(0,10)).limit(10000),
        db.from("ignite_team_call_events").select(selectFields.calls).gte("occurred_at",cutoff).order("occurred_at",{ascending:false}).limit(10000),
        db.from("ignite_team_appointments").select(selectFields.appointments).order("scheduled_at",{ascending:false}).limit(5000),
        db.from("ignite_team_deals").select(selectFields.deals).order("created_at",{ascending:false}).limit(5000),
        db.from("ignite_team_payment_links").select(selectFields.paymentLinks).limit(5000),
        db.from("hq_revenue_events").select(selectFields.ledger).gte("paid_at",ledgerCutoff).eq("event_type","payment.succeeded").order("paid_at",{ascending:false}).limit(5000)
      ]);
      for(const x of [members,activity,calls,appointments,deals,links,ledger]) check(x.error);
      return response({success:true,viewer:profile.full_name||profile.email||"Ignite Admin",data:{
        members:members.data||[],activity:activity.data||[],calls:calls.data||[],
        appointments:appointments.data||[],deals:deals.data||[],links:links.data||[],
        ledger:ledger.data||[],syncedAt:new Date().toISOString(),
        windows:{activityDays:120,revenueDays:365}
      }});
    }
    if(action==="save_member"){
      const input=body.member||{};
      const id=uuid(input.id)?input.id:null;
      const name=clean(input.full_name,120);
      if(name.length<2) return fail("Enter a team member name");
      const email=clean(input.email,180).toLowerCase()||null;
      if(email&&!validEmail(email)) return fail("Invalid email address");
      const role=clean(input.role,40)||"Setter",status=clean(input.status,30)||"active";
      if(!["Setter","Closer","Setter & Closer","Manager"].includes(role)) return fail("Invalid team role");
      if(!["active","inactive"].includes(status)) return fail("Invalid team status");
      const record={full_name:name,email,role,status,ghl_user_id:clean(input.ghl_user_id,180)||null,daily_dial_goal:numeric(input.daily_dial_goal??100,2000),updated_at:new Date().toISOString()};
      const q=id?db.from("ignite_team_members").update(record).eq("id",id):db.from("ignite_team_members").insert(record);
      const {data,error}=await q.select("id").single();check(error);
      return response({success:true,id:data.id});
    }
    if(action==="save_activity"){
      const entry=body.entry||{};
      if(!uuid(entry.member_id)) return fail("Select a team member");
      const date=clean(entry.activity_date,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+"T12:00:00Z"))) return fail("Invalid activity date");
      const dials=numeric(entry.dials??0,10000),pickups=numeric(entry.pickups??0,10000),pitches=numeric(entry.pitches??0,10000),interested=numeric(entry.interested??0,10000);
      if(![dials,pickups,pitches,interested].every(Number.isInteger)||pickups>dials||pitches>pickups||interested>pitches) return fail("Activity funnel counts must be whole numbers in descending order");
      const {error}=await db.from("ignite_team_daily_activity").upsert({member_id:entry.member_id,activity_date:date,dials,pickups,pitches,interested,source:"manual",updated_at:new Date().toISOString()},{onConflict:"member_id,activity_date,source"});check(error);
      return response({success:true});
    }
    if(action==="save_appointment"){
      const e=body.entry||{},id=uuid(e.id)?e.id:null;
      if(!uuid(e.member_id)||!clean(e.company_name)) return fail("Member and business are required");
      const status=clean(e.status,30)||"booked";
      if(!["booked","confirmed","showed","no_show","canceled"].includes(status)) return fail("Invalid appointment status");
      const record={member_id:e.member_id,company_name:clean(e.company_name),contact_name:clean(e.contact_name)||null,
        scheduled_at:validDate(e.scheduled_at),status,source:"manual",notes:clean(e.notes,2000)||null,updated_at:new Date().toISOString()};
      const q=id?db.from("ignite_team_appointments").update(record).eq("id",id):db.from("ignite_team_appointments").insert(record);
      const {data,error}=await q.select("id").single();check(error);
      return response({success:true,id:data.id});
    }
    if(action==="save_deal"){
      const e=body.entry||{},id=uuid(e.id)?e.id:null;
      const stage=clean(e.stage,30)||"open";
      if(!clean(e.company_name)) return fail("Business name required");
      if(!["open","proposal","won","lost"].includes(stage)) return fail("Invalid deal stage");
      for(const k of ["setter_id","closer_id","appointment_id"]) if(e[k]&&!uuid(e[k])) return fail("Invalid "+k);
      const record={company_name:clean(e.company_name),setter_id:e.setter_id||null,closer_id:e.closer_id||null,
        appointment_id:e.appointment_id||null,stage,contract_value:numeric(e.contract_value??0,100000000),
        notes:clean(e.notes,2000)||null,updated_at:new Date().toISOString(),
        won_at:stage==="won"?(e.won_at?validDate(e.won_at):new Date().toISOString()):null};
      const q=id?db.from("ignite_team_deals").update(record).eq("id",id):db.from("ignite_team_deals").insert(record);
      const {data,error}=await q.select("id").single();check(error);
      return response({success:true,id:data.id});
    }
    if(action==="link_payment"){
      const eventId=clean(body.revenue_event_id,300),dealId=body.deal_id;
      if(!uuid(dealId)||!eventId) return fail("Choose a deal and an actual payment");
      const {data:paid,error:readErr}=await db.from("hq_revenue_events").select("external_id,event_type").eq("external_id",eventId).maybeSingle();
      check(readErr);
      if(!paid||paid.event_type!=="payment.succeeded") return fail("Verified successful payment not found in HQ ledger");
      const {error}=await db.from("ignite_team_payment_links").insert({revenue_event_id:eventId,deal_id:dealId});check(error);
      return response({success:true});
    }
    if(action==="unlink_payment"){
      const id=body.id;
      if(!uuid(id)) return fail("Invalid attribution");
      const {error}=await db.from("ignite_team_payment_links").delete().eq("id",id);check(error);
      return response({success:true});
    }
    return fail("Unknown action",404);
  } catch (err) {
    console.error("ignite-team-api",action,err);
    const msg=err instanceof Error?err.message:"Unexpected error";
    return fail(msg,500);
  }
});
