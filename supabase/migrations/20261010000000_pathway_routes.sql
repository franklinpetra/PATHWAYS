-- Your Route: a person's path as a few stops from where they stand to their goal.
-- The AI may only write suggested_stops; confirmed_stops and position change only through
-- the person's own actions (lib/validation/state-guard.ts).

create table pathway_routes (
  pathway_id       uuid primary key references pathways (id) on delete cascade,
  -- [{ label, pay, paySource, gate }]; pay appears only when a verified source states it.
  confirmed_stops  jsonb,
  suggested_stops  jsonb,
  -- Index into confirmed_stops of where the person is now.
  position         integer not null default 0 check (position >= 0),
  updated_at       timestamptz not null default now()
);

create trigger pathway_routes_set_updated_at
  before update on pathway_routes
  for each row execute function set_updated_at();

alter table pathway_routes enable row level security;
