-- PATHWAYS Phase 2: deterministic access-code lookup, supersession links,
-- and the authoritative source tables the Fact-Finder reads from.
--
-- Source tables hold only imported, attributable records. Every row carries the
-- named authority, a URL, and the date the data was current. Nothing is seeded here.

-- ---------------------------------------------------------------------------
-- users: access codes are now an HMAC-SHA256 digest, so they can be looked up
-- ---------------------------------------------------------------------------

comment on column users.access_code_hash is
  'HMAC-SHA256 (hex) of the normalized access code, keyed by ACCESS_CODE_SECRET. See lib/auth/access-code.ts.';

create unique index users_access_code_hash_unique on users (access_code_hash);

-- ---------------------------------------------------------------------------
-- context_items: record which item replaced a superseded one
-- ---------------------------------------------------------------------------

alter table context_items
  add column superseded_by uuid references context_items (id) on delete set null;

-- ---------------------------------------------------------------------------
-- occupations (O*NET)
-- ---------------------------------------------------------------------------

create table occupations (
  onet_soc_code    text primary key,
  title            text not null,
  description      text,
  source_authority text not null default 'O*NET OnLine (U.S. Department of Labor)',
  source_url       text not null,
  source_as_of     date not null
);

create index occupations_title_idx on occupations (lower(title));

-- ---------------------------------------------------------------------------
-- places: resolves a named location to coordinates without guessing
-- ---------------------------------------------------------------------------

create table places (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  county    text,
  state     text not null default 'WA',
  latitude  double precision not null,
  longitude double precision not null,
  unique (name, state)
);

create index places_name_idx on places (lower(name));

-- ---------------------------------------------------------------------------
-- programs: education and training offerings from authoritative sources
-- ---------------------------------------------------------------------------

create table programs (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  provider_name    text not null,
  onet_soc_codes   text[] not null default '{}',
  credential_type  text,
  city             text,
  county           text,
  state            text not null default 'WA',
  latitude         double precision,
  longitude        double precision,
  source_authority text not null,
  source_url       text not null,
  source_as_of     date not null,
  created_at       timestamptz not null default now()
);

create index programs_soc_codes_idx on programs using gin (onet_soc_codes);

-- Programs matching any of the given occupations, optionally within a radius.
-- A null origin skips the distance filter.
create or replace function search_programs(
  p_soc_codes    text[],
  p_latitude     double precision default null,
  p_longitude    double precision default null,
  p_radius_miles double precision default null,
  p_limit        integer default 8
)
returns table (
  id               uuid,
  title            text,
  provider_name    text,
  credential_type  text,
  city             text,
  county           text,
  state            text,
  source_authority text,
  source_url       text,
  source_as_of     date,
  distance_miles   double precision
)
language sql stable as $$
  select * from (
    select
      p.id, p.title, p.provider_name, p.credential_type, p.city, p.county, p.state,
      p.source_authority, p.source_url, p.source_as_of,
      case
        when p_latitude is null or p.latitude is null then null
        else 3958.8 * 2 * asin(sqrt(
          power(sin(radians(p.latitude - p_latitude) / 2), 2)
          + cos(radians(p_latitude)) * cos(radians(p.latitude))
            * power(sin(radians(p.longitude - p_longitude) / 2), 2)
        ))
      end as distance_miles
    from programs p
    where p.onet_soc_codes && p_soc_codes
  ) matches
  where p_latitude is null
     or (distance_miles is not null and distance_miles <= coalesce(p_radius_miles, 25))
  order by distance_miles nulls last, title
  limit p_limit;
$$;

alter table occupations enable row level security;
alter table places      enable row level security;
alter table programs    enable row level security;
