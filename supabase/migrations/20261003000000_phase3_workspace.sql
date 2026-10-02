-- PATHWAYS Phase 3: workspace controls, verified addresses, and phone handoff.

-- ---------------------------------------------------------------------------
-- actions: "Not now" and "Remove" are soft states owned by the person.
-- Removed steps are kept so the AI does not suggest them again.
-- ---------------------------------------------------------------------------

alter table actions
  add column postponed_until timestamptz,
  add column removed_at      timestamptz;

create index actions_pathway_visible_idx on actions (pathway_id, display_order) where removed_at is null;

-- ---------------------------------------------------------------------------
-- programs: street addresses from the source, for verified map links
-- ---------------------------------------------------------------------------

alter table programs
  add column street_address text,
  add column postal_code    text;

drop function if exists search_programs(text[], double precision, double precision, double precision, integer);

create function search_programs(
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
  street_address   text,
  city             text,
  county           text,
  state            text,
  postal_code      text,
  latitude         double precision,
  longitude        double precision,
  source_authority text,
  source_url       text,
  source_as_of     date,
  distance_miles   double precision
)
language sql stable as $$
  select * from (
    select
      p.id, p.title, p.provider_name, p.credential_type,
      p.street_address, p.city, p.county, p.state, p.postal_code, p.latitude, p.longitude,
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

-- ---------------------------------------------------------------------------
-- handoff_tokens: single-use, short-lived links that continue a session on
-- another device (desktop QR -> phone). Only a SHA-256 of the token is stored.
-- ---------------------------------------------------------------------------

create table handoff_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  token_hash  text not null unique,
  target_path text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint handoff_tokens_relative_target check (target_path like '/%' and target_path not like '//%')
);

create index handoff_tokens_user_idx on handoff_tokens (user_id);

alter table handoff_tokens enable row level security;
