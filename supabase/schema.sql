-- Ignite Team Performance OS
-- Run against the same Supabase project as Ignite HQ.
-- Tables are intentionally not directly accessible to anon/authenticated clients.
-- The authenticated Edge API enforces admin access and performs all operations.
CREATE TABLE IF NOT EXISTS public.ignite_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120),
  email text,
  role text NOT NULL DEFAULT 'Setter' CHECK (role IN ('Setter','Closer','Setter & Closer','Manager')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  ghl_user_id text UNIQUE,
  daily_dial_goal integer NOT NULL DEFAULT 100 CHECK (daily_dial_goal BETWEEN 0 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ignite_team_members_email_unique ON public.ignite_team_members(lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE TABLE IF NOT EXISTS public.ignite_team_daily_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.ignite_team_members(id) ON DELETE RESTRICT,
  activity_date date NOT NULL DEFAULT current_date,
  dials integer NOT NULL DEFAULT 0 CHECK (dials>=0),
  pickups integer NOT NULL DEFAULT 0 CHECK (pickups>=0 AND pickups<=dials),
  pitches integer NOT NULL DEFAULT 0 CHECK (pitches>=0 AND pitches<=pickups),
  interested integer NOT NULL DEFAULT 0 CHECK (interested>=0 AND interested<=pitches),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(member_id,activity_date,source)
);
CREATE TABLE IF NOT EXISTS public.ignite_team_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  member_id uuid NOT NULL REFERENCES public.ignite_team_members(id) ON DELETE RESTRICT,
  ghl_contact_id text,
  contact_name text,
  outcome text NOT NULL DEFAULT 'no_answer' CHECK (outcome IN ('answered','no_answer','voicemail','busy','failed')),
  pitched boolean NOT NULL DEFAULT false,
  interested boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ignite_team_call_events_member_at ON public.ignite_team_call_events(member_id,occurred_at DESC);
CREATE TABLE IF NOT EXISTS public.ignite_team_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE,
  member_id uuid NOT NULL REFERENCES public.ignite_team_members(id) ON DELETE RESTRICT,
  company_name text NOT NULL,
  contact_name text,
  ghl_contact_id text,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','showed','no_show','canceled')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ghl')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ignite_team_appointments_member_at ON public.ignite_team_appointments(member_id,scheduled_at DESC);
CREATE TABLE IF NOT EXISTS public.ignite_team_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  setter_id uuid REFERENCES public.ignite_team_members(id) ON DELETE SET NULL,
  closer_id uuid REFERENCES public.ignite_team_members(id) ON DELETE SET NULL,
  appointment_id uuid UNIQUE REFERENCES public.ignite_team_appointments(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'open' CHECK (stage IN ('open','proposal','won','lost')),
  contract_value numeric(12,2) NOT NULL DEFAULT 0 CHECK(contract_value>=0),
  notes text,
  won_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.ignite_team_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_event_id text NOT NULL UNIQUE,
  deal_id uuid NOT NULL REFERENCES public.ignite_team_deals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ignite_team_payment_links_deal ON public.ignite_team_payment_links(deal_id);
CREATE TABLE IF NOT EXISTS public.ignite_team_integrations (
  id text PRIMARY KEY,
  webhook_key_hash text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ignite_team_integrations(id,enabled) VALUES('ghl',false) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.ignite_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignite_team_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ignite_team_members,public.ignite_team_daily_activity,public.ignite_team_call_events,public.ignite_team_appointments,public.ignite_team_deals,public.ignite_team_payment_links,public.ignite_team_integrations FROM anon,authenticated;
