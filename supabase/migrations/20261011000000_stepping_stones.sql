-- Stepping-stone programs: the connective tissue into formal careers. Pre-apprenticeships,
-- returnships, transitional employment, and paid-to-learn programs, each with who it serves,
-- whether it's paid, and how to reach it.
--
-- provenance distinguishes an official list (e.g. L&I's recognized apprenticeship preparation
-- programs) from facts taken from a program's own website after human review.

create table stepping_stones (
  id                     uuid primary key default gen_random_uuid(),
  source_record_id       text not null,
  kind                   text not null check (kind in ('pre_apprenticeship', 'returnship', 'transitional_employment', 'paid_training')),
  name                   text not null,
  organization           text,
  summary                text,
  -- Who it is designed for, e.g. {'women','youth','veterans','returning_citizens','returning_parents'}.
  audiences              text[] not null default '{}',
  -- Career fields it leads into, e.g. {'construction','manufacturing','healthcare','technology','culinary'}.
  fields                 text[] not null default '{}',
  paid                   boolean,
  open_enrollment        boolean not null default true,
  street_address         text,
  city                   text,
  county                 text,
  state                  text not null default 'WA',
  postal_code            text,
  statewide              boolean not null default false,
  contact_name           text,
  contact_phone          text,
  contact_email          text,
  website                text,
  provenance             text not null check (provenance in ('official', 'program')),
  source_name            text not null,
  source_url             text not null,
  observation_period     text,
  source_as_of           date not null,
  verification_authority text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source_name, source_record_id)
);

create index stepping_stones_fields_idx on stepping_stones using gin (fields);
create index stepping_stones_audiences_idx on stepping_stones using gin (audiences);

create trigger stepping_stones_set_updated_at
  before update on stepping_stones
  for each row execute function set_updated_at();

alter table stepping_stones enable row level security;

alter table data_sync_runs drop constraint data_sync_runs_source_check;
alter table data_sync_runs add constraint data_sync_runs_source_check
  check (source in ('apprenticeships', 'wages', 'places', 'stepping_stones'));
