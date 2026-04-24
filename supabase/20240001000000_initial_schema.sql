-- =============================================================================
-- SlimBloom – Initial Database Schema
-- Migration: 20240001000000_initial_schema.sql
--
-- Tables created:
--   1. memberships    – Whop subscriptions linked to Supabase Auth users
--   2. phone_leads    – SMS lead capture (quiz / landing page opt-ins)
--   3. sms_campaigns  – Drip-campaign message definitions
--   4. sms_log        – Record of every SMS that was sent / attempted
-- =============================================================================


-- ─────────────────────────────────────────────
-- 1. MEMBERSHIPS
-- ─────────────────────────────────────────────
-- Stores Whop subscription records. Rows arrive via the whop-webhook API and
-- can be created manually via activate-coupon. The user_id is linked lazily
-- (email match or phone match) when a Supabase Auth user first signs in.
-- ─────────────────────────────────────────────
create table if not exists public.memberships (
  -- Internal primary key
  id                   uuid        primary key default gen_random_uuid(),

  -- Whop identifiers (membership is the unique business key)
  whop_membership_id   text        not null unique,
  whop_plan_id         text        not null default '',
  whop_user_id         text,                        -- Whop's own user ID (may be null)
  whop_user_email      text        not null default '',

  -- Link to Supabase Auth user (nullable until lazy-linked)
  user_id              uuid        references auth.users (id) on delete set null,

  -- Subscription status:
  --   active | trialing | canceling | canceled | expired
  status               text        not null default 'active',

  -- Human-readable plan details
  plan_name            text        not null default '',
  plan_price_cents     integer     not null default 0,
  plan_interval        text        not null default 'month',  -- month | 3-months | 6-months | unknown

  -- Billing period
  renewal_period_start timestamptz,
  renewal_period_end   timestamptz,

  -- Cancellation tracking
  cancel_at_period_end boolean     not null default false,
  canceled_at          timestamptz,

  -- Audit timestamps
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Keep updated_at current on every write
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger memberships_updated_at
  before update on public.memberships
  for each row execute procedure public.set_updated_at();

-- Indexes for common query patterns
create index if not exists memberships_user_id_idx    on public.memberships (user_id);
create index if not exists memberships_email_idx      on public.memberships (whop_user_email);
create index if not exists memberships_status_idx     on public.memberships (status);
create index if not exists memberships_created_at_idx on public.memberships (created_at desc);


-- ─────────────────────────────────────────────
-- 2. PHONE LEADS
-- ─────────────────────────────────────────────
-- Captures phone numbers entered on the landing page / quiz.
-- The send-sms edge function fires on INSERT to send the first welcome SMS.
-- The process-sms-queue function uses converted / converted_at to switch
-- a lead from the non_converter campaign flow to the converter flow.
-- ─────────────────────────────────────────────
create table if not exists public.phone_leads (
  id           uuid        primary key default gen_random_uuid(),

  -- E.164 US phone number e.g. +11234567890
  phone        text        not null unique,

  -- Conversion tracking
  converted    boolean     not null default false,
  converted_at timestamptz,

  -- Audit timestamps
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger phone_leads_updated_at
  before update on public.phone_leads
  for each row execute procedure public.set_updated_at();

create index if not exists phone_leads_phone_idx       on public.phone_leads (phone);
create index if not exists phone_leads_converted_idx   on public.phone_leads (converted);
create index if not exists phone_leads_created_at_idx  on public.phone_leads (created_at desc);


-- ─────────────────────────────────────────────
-- 3. SMS CAMPAIGNS
-- ─────────────────────────────────────────────
-- Defines the drip-SMS sequences. Each row is one step in a campaign.
-- campaign_type: 'non_converter' (lead hasn't bought yet) | 'converter' (lead bought)
-- delay_hours:   hours after the base timestamp to wait before sending this step
-- step_number:   ordering within a campaign (1 = first message)
-- ─────────────────────────────────────────────
create table if not exists public.sms_campaigns (
  id                uuid    primary key default gen_random_uuid(),

  campaign_type     text    not null,               -- non_converter | converter
  step_number       integer not null,               -- 1, 2, 3 …
  delay_hours       numeric not null default 0,     -- hours from base time to send
  message_template  text    not null,               -- SMS body (plain text)
  active            boolean not null default true,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (campaign_type, step_number)               -- one step per position per type
);

create trigger sms_campaigns_updated_at
  before update on public.sms_campaigns
  for each row execute procedure public.set_updated_at();

create index if not exists sms_campaigns_type_step_idx
  on public.sms_campaigns (campaign_type, step_number);
create index if not exists sms_campaigns_active_idx
  on public.sms_campaigns (active);


-- ─────────────────────────────────────────────
-- 4. SMS LOG
-- ─────────────────────────────────────────────
-- Audit trail for every SMS attempted.
-- Used by process-sms-queue to skip already-sent steps (deduplication key:
-- phone_lead_id + campaign_id).
-- ─────────────────────────────────────────────
create table if not exists public.sms_log (
  id             uuid        primary key default gen_random_uuid(),

  phone_lead_id  uuid        not null references public.phone_leads (id) on delete cascade,
  campaign_id    uuid        not null references public.sms_campaigns (id) on delete cascade,

  phone          text        not null,
  message_body   text        not null,

  -- sent | failed | pending
  status         text        not null default 'pending',

  -- Twilio message SID (null if send failed)
  twilio_sid     text,

  sent_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- Composite unique index prevents duplicate sends for the same lead × campaign step
create unique index if not exists sms_log_lead_campaign_uidx
  on public.sms_log (phone_lead_id, campaign_id);

create index if not exists sms_log_phone_lead_id_idx on public.sms_log (phone_lead_id);
create index if not exists sms_log_campaign_id_idx   on public.sms_log (campaign_id);
create index if not exists sms_log_status_idx        on public.sms_log (status);


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Enable RLS on all tables. The service-role key used by API routes bypasses
-- RLS automatically. The policies below control what a logged-in user can see
-- via the anon / authenticated keys (e.g. the client-side dashboard).
-- =============================================================================

alter table public.memberships   enable row level security;
alter table public.phone_leads   enable row level security;
alter table public.sms_campaigns enable row level security;
alter table public.sms_log       enable row level security;


-- ── memberships ──────────────────────────────
-- Users can read only their own membership rows.
-- Writes always go through the service-role key (API routes), so no INSERT
-- policy is needed for the authenticated role.
create policy "Users can view own membership"
  on public.memberships
  for select
  to authenticated
  using (user_id = auth.uid());


-- ── phone_leads ──────────────────────────────
-- Phone leads are private; only the service role reads/writes them.
-- No policies needed for authenticated users — admin panel uses service role.


-- ── sms_campaigns ────────────────────────────
-- Allow authenticated users (including the admin UI) to read campaigns.
create policy "Authenticated users can read campaigns"
  on public.sms_campaigns
  for select
  to authenticated
  using (true);


-- ── sms_log ──────────────────────────────────
-- Only admin (service role) accesses the log table.
-- No public policies needed.
