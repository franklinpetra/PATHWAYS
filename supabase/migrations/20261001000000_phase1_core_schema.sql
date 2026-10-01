-- PATHWAYS Phase 1: core relational schema
--
-- Access model: all reads/writes go through the server using the service role,
-- behind the application-level validation layer. Model output never writes here
-- directly. RLS is enabled with no policies, so anon/authenticated keys are denied.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enumerated states
-- ---------------------------------------------------------------------------

create type readiness_state as enum ('exploring', 'evaluating', 'acting', 'returning');
create type pathway_status as enum (
  'exploratory', 'active', 'paused', 'completed', 'abandoned', 'superseded'
);

create type provenance as enum ('user_authored', 'user_approved', 'ai_inferred', 'source_confirmed');
create type semantic_status as enum (
  'thought', 'inference', 'possibility', 'confirmed_context', 'saved_interest', 'confirmed_goal'
);
create type temporal_status as enum ('current', 'stale', 'superseded', 'archived');

create type action_status as enum (
  'suggested', 'user_selected', 'user_reported_complete', 'externally_verified'
);
create type actor as enum ('system', 'user');

create type evidence_status as enum ('user_reported', 'advisor_confirmed', 'system_verified');

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create table users (
  id               uuid primary key default gen_random_uuid(),
  -- Salted scrypt hash of the access code (see lib/auth/access-code.ts). Never the code itself.
  access_code_hash text not null,
  username         text not null unique,
  email            text,
  created_at       timestamptz not null default now(),
  constraint users_username_not_blank check (length(trim(username)) > 0)
);

create unique index users_email_unique on users (lower(email)) where email is not null;

-- ---------------------------------------------------------------------------
-- pathways
-- ---------------------------------------------------------------------------

create table pathways (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users (id) on delete cascade,
  title                    text not null,
  -- Stable identifier for the destination (e.g. O*NET-SOC code, program id).
  canonical_destination_id text,
  destination_type         text,
  readiness_state          readiness_state not null default 'exploring',
  status                   pathway_status not null default 'exploratory',
  current_question         text,
  why_considered           text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index pathways_user_id_idx on pathways (user_id);

create trigger pathways_set_updated_at
  before update on pathways
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- context_items (Conversational Mastery Record)
-- ---------------------------------------------------------------------------

create table context_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  type            text not null,
  -- The person's own words, preserved verbatim.
  user_language   text,
  -- Concise rendering shown back in the UI.
  display_text    text not null,
  provenance      provenance not null,
  semantic_status semantic_status not null,
  temporal_status temporal_status not null default 'current',
  confidence      numeric(3, 2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint context_items_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- AI inferences stay provisional: they cannot be stored as confirmed states.
  constraint context_items_inference_is_provisional check (
    provenance <> 'ai_inferred'
    or semantic_status in ('thought', 'inference', 'possibility')
  )
);

create index context_items_user_current_idx on context_items (user_id, temporal_status);

create trigger context_items_set_updated_at
  before update on context_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- actions (Next Steps)
-- ---------------------------------------------------------------------------

create table actions (
  id            uuid primary key default gen_random_uuid(),
  pathway_id    uuid not null references pathways (id) on delete cascade,
  title         text not null,
  why           text,
  how           text,
  due_at        timestamptz,
  status        action_status not null default 'suggested',
  display_order integer not null default 0,
  created_by    actor not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index actions_pathway_order_idx on actions (pathway_id, display_order);

create trigger actions_set_updated_at
  before update on actions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- progress_events (Recent Wins)
-- ---------------------------------------------------------------------------

create table progress_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  -- Nullable: some wins are not tied to a single pathway.
  pathway_id      uuid references pathways (id) on delete set null,
  event_type      text not null,
  title           text not null,
  evidence_status evidence_status not null default 'user_reported',
  source          text,
  learning        text,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index progress_events_user_recent_idx on progress_events (user_id, occurred_at desc);
create index progress_events_pathway_id_idx on progress_events (pathway_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny-by-default for client keys
-- ---------------------------------------------------------------------------

alter table users           enable row level security;
alter table pathways        enable row level security;
alter table context_items   enable row level security;
alter table actions         enable row level security;
alter table progress_events enable row level security;
