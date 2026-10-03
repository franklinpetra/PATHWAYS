-- Occupational employment and wage estimates (OEWS) from the Washington State Employment
-- Security Department: hourly wage percentiles and the annual mean wage for each occupation,
-- statewide and for each Washington metropolitan and nonmetropolitan area.

create table occupation_wages (
  id                     uuid primary key default gen_random_uuid(),
  area_name              text not null,
  -- Washington counties the area covers, without the word "County"; empty for statewide.
  area_counties          text[] not null default '{}',
  soc_code               text not null check (soc_code ~ '^\d{2}-\d{4}$'),
  title                  text not null,
  employment             integer check (employment is null or employment >= 0),
  p25_hourly             numeric(8, 2) check (p25_hourly is null or p25_hourly > 0),
  median_hourly          numeric(8, 2) check (median_hourly is null or median_hourly > 0),
  p75_hourly             numeric(8, 2) check (p75_hourly is null or p75_hourly > 0),
  mean_annual            numeric(10, 0) check (mean_annual is null or mean_annual > 0),
  source_name            text not null,
  source_url             text not null,
  observation_period     text,
  source_as_of           date not null,
  verification_authority text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source_name, area_name, soc_code)
);

create index occupation_wages_soc_idx on occupation_wages (soc_code);
create index occupation_wages_counties_idx on occupation_wages using gin (area_counties);

create trigger occupation_wages_set_updated_at
  before update on occupation_wages
  for each row execute function set_updated_at();

alter table occupation_wages enable row level security;
