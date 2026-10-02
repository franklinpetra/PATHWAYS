-- PATHWAYS Phase 4: Washington source tables and claim traceability.
--
-- Every source row carries a uniform attribution:
--   source_name             what the data is (e.g. "Career Bridge")
--   observation_period      the period the figures describe (e.g. "2022-23 completers"), if any
--   source_as_of            the date the data was current / retrieved
--   verification_authority  the public body that stands behind it
--   source_url              where it can be checked
-- Rows are loaded only by the connectors in lib/data/washington/; nothing is seeded here.

-- ---------------------------------------------------------------------------
-- occupations (O*NET): adopt the uniform attribution columns
-- ---------------------------------------------------------------------------

alter table occupations rename column source_authority to source_name;
alter table occupations alter column source_name set default 'O*NET OnLine';
alter table occupations
  add column observation_period     text,
  add column verification_authority text not null
    default 'U.S. Department of Labor, Employment and Training Administration';

-- ---------------------------------------------------------------------------
-- training_programs (Career Bridge / SBCTC), formerly programs
-- ---------------------------------------------------------------------------

drop function if exists search_programs(text[], double precision, double precision, double precision, integer);

alter table programs rename to training_programs;
alter index programs_soc_codes_idx rename to training_programs_soc_codes_idx;
alter table training_programs rename column source_authority to source_name;

alter table training_programs
  add column source_record_id       text,
  add column cip_code               text,
  -- Estimated cost in US dollars, exactly as published; cost_basis says what it covers.
  add column estimated_cost_usd     numeric(10, 2),
  add column cost_basis             text,
  -- Share of students completing, 0..1, for the observation period.
  add column completion_rate        numeric(5, 4),
  add column observation_period     text,
  add column verification_authority text,
  add column updated_at             timestamptz not null default now();

update training_programs set verification_authority = source_name where verification_authority is null;
alter table training_programs alter column verification_authority set not null;

alter table training_programs
  add constraint training_programs_cost_nonnegative check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  add constraint training_programs_completion_range check (completion_rate is null or completion_rate between 0 and 1);

create unique index training_programs_source_record_idx on training_programs (source_name, source_record_id);

create trigger training_programs_set_updated_at
  before update on training_programs
  for each row execute function set_updated_at();

create function search_training_programs(
  p_soc_codes    text[],
  p_latitude     double precision default null,
  p_longitude    double precision default null,
  p_radius_miles double precision default null,
  p_limit        integer default 8
)
returns table (
  id                     uuid,
  title                  text,
  provider_name          text,
  credential_type        text,
  street_address         text,
  city                   text,
  county                 text,
  state                  text,
  postal_code            text,
  latitude               double precision,
  longitude              double precision,
  estimated_cost_usd     numeric,
  cost_basis             text,
  completion_rate        numeric,
  source_name            text,
  source_url             text,
  observation_period     text,
  source_as_of           date,
  verification_authority text,
  distance_miles         double precision
)
language sql stable as $$
  select * from (
    select
      p.id, p.title, p.provider_name, p.credential_type,
      p.street_address, p.city, p.county, p.state, p.postal_code, p.latitude, p.longitude,
      p.estimated_cost_usd, p.cost_basis, p.completion_rate,
      p.source_name, p.source_url, p.observation_period, p.source_as_of, p.verification_authority,
      case
        when p_latitude is null or p.latitude is null then null
        else 3958.8 * 2 * asin(sqrt(
          power(sin(radians(p.latitude - p_latitude) / 2), 2)
          + cos(radians(p_latitude)) * cos(radians(p.latitude))
            * power(sin(radians(p.longitude - p_longitude) / 2), 2)
        ))
      end as distance_miles
    from training_programs p
    where p.onet_soc_codes && p_soc_codes
  ) matches
  where p_latitude is null
     or (distance_miles is not null and distance_miles <= coalesce(p_radius_miles, 25))
  order by distance_miles nulls last, title
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- apprenticeships (Washington L&I ARTS)
-- ---------------------------------------------------------------------------

create table apprenticeships (
  id                     uuid primary key default gen_random_uuid(),
  source_record_id       text not null,
  trade                  text not null,
  sponsor                text not null,
  -- County names without the word "County", e.g. {'Pierce','King'}.
  counties               text[] not null default '{}',
  onet_soc_codes         text[] not null default '{}',
  requirements           text,
  term_hours             integer check (term_hours is null or term_hours > 0),
  contact_name           text,
  contact_phone          text,
  contact_email          text,
  contact_url            text,
  source_name            text not null,
  source_url             text not null,
  observation_period     text,
  source_as_of           date not null,
  verification_authority text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source_name, source_record_id)
);

create index apprenticeships_counties_idx on apprenticeships using gin (counties);
create index apprenticeships_soc_codes_idx on apprenticeships using gin (onet_soc_codes);

create trigger apprenticeships_set_updated_at
  before update on apprenticeships
  for each row execute function set_updated_at();

-- Apprenticeships matching the occupations (or a trade phrase), optionally in one county.
create function search_apprenticeships(
  p_soc_codes text[],
  p_trade     text default null,
  p_county    text default null,
  p_limit     integer default 6
)
returns setof apprenticeships
language sql stable as $$
  select *
  from apprenticeships a
  where (a.onet_soc_codes && p_soc_codes or (p_trade is not null and a.trade ilike '%' || p_trade || '%'))
    and (p_county is null or lower(p_county) = any (select lower(c) from unnest(a.counties) c))
  order by a.trade, a.sponsor
  limit p_limit;
$$;

alter table apprenticeships enable row level security;

-- ---------------------------------------------------------------------------
-- messages: the sourced claims each reply cited, for expandable attribution
-- ---------------------------------------------------------------------------

alter table messages add column citations jsonb not null default '[]';
