-- PATHWAYS: licensure requirements and fees, normalized and historically versioned.
--
-- Authority model: the body that issues or regulates a credential (usually a state board)
-- is the ultimate authority ('governing'). Aggregators such as CareerOneStop are a
-- 'discovery' layer: their records say where to look, never what the facts are.
--
-- Versioning: requirements and fees change over time. Each credential_version covers a
-- date range [effective_from, effective_to) for one source authority; ranges for the same
-- credential and authority may not overlap. Fees belong to a version.
--
-- Money: every fee states what kind of amount it is. 'known' and 'zero' carry an amount
-- and an ISO 4217 currency; 'unknown', 'variable', and 'not_applicable' carry no amount.

create extension if not exists btree_gist;

create type authority_role as enum ('governing', 'discovery');
create type jurisdiction_level as enum ('national', 'federal', 'state');
create type credential_kind as enum ('license', 'certification', 'registration', 'permit', 'endorsement');
create type fee_type as enum (
  'application', 'exam', 'background_check', 'fingerprinting', 'initial_license',
  'renewal', 'late_renewal', 'credential_evaluation', 'other'
);
create type amount_status as enum ('known', 'zero', 'unknown', 'variable', 'not_applicable');
create type authority_relationship as enum ('issuer', 'exam_administrator', 'listed_by');

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------

create table jurisdictions (
  id    uuid primary key default gen_random_uuid(),
  -- ISO 3166: 'US' or a subdivision such as 'US-WA'.
  code  text not null unique check (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  name  text not null,
  level jurisdiction_level not null
);

-- Definitional rows, not claims.
insert into jurisdictions (code, name, level) values
  ('US', 'United States', 'national'),
  ('US-WA', 'Washington', 'state');

create table issuing_authorities (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  role            authority_role not null,
  jurisdiction_id uuid references jurisdictions (id),
  website_url     text check (website_url is null or website_url ~ '^https?://')
);

create table credentials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       credential_kind not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Join tables (no comma-separated arrays)
-- ---------------------------------------------------------------------------

create table credential_occupations (
  credential_id uuid not null references credentials (id) on delete cascade,
  onet_soc_code text not null references occupations (onet_soc_code) on delete cascade,
  primary key (credential_id, onet_soc_code)
);
create index credential_occupations_soc_idx on credential_occupations (onet_soc_code);

create table credential_jurisdictions (
  credential_id   uuid not null references credentials (id) on delete cascade,
  jurisdiction_id uuid not null references jurisdictions (id) on delete cascade,
  primary key (credential_id, jurisdiction_id)
);
create index credential_jurisdictions_jurisdiction_idx on credential_jurisdictions (jurisdiction_id);

create table credential_authorities (
  credential_id uuid not null references credentials (id) on delete cascade,
  authority_id  uuid not null references issuing_authorities (id) on delete cascade,
  relationship  authority_relationship not null,
  primary key (credential_id, authority_id, relationship)
);

-- ---------------------------------------------------------------------------
-- Versioned requirements and fees
-- ---------------------------------------------------------------------------

create table credential_versions (
  id                  uuid primary key default gen_random_uuid(),
  credential_id       uuid not null references credentials (id) on delete cascade,
  effective_from      date not null,
  -- Exclusive end; null while the version is in effect.
  effective_to        date,
  requirements        text,
  -- Time to obtain, exactly as the source states it (e.g. "Approved training program of at least 520 hours").
  duration_note       text,
  source_name         text not null,
  source_url          text not null check (source_url ~ '^https?://'),
  observation_period  text,
  source_as_of        date not null,
  source_authority_id uuid not null references issuing_authorities (id),
  created_at          timestamptz not null default now(),
  constraint credential_versions_range check (effective_to is null or effective_to > effective_from),
  constraint credential_versions_no_overlap exclude using gist (
    credential_id with =,
    source_authority_id with =,
    daterange(effective_from, effective_to, '[)') with &&
  )
);

create table credential_fees (
  id                    uuid primary key default gen_random_uuid(),
  credential_version_id uuid not null references credential_versions (id) on delete cascade,
  fee_type              fee_type not null,
  -- Overrides the default label for fee_type, e.g. "Jurisprudence exam".
  label                 text,
  amount_status         amount_status not null,
  amount                numeric(10, 2),
  currency              char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- For recurring fees such as renewals.
  recurrence_months     integer check (recurrence_months is null or recurrence_months > 0),
  notes                 text,
  source_name           text not null,
  source_url            text not null check (source_url ~ '^https?://'),
  observation_period    text,
  source_as_of          date not null,
  source_authority_id   uuid not null references issuing_authorities (id),
  constraint credential_fees_amount_matches_status check (
    (amount_status = 'known' and amount > 0 and currency is not null)
    or (amount_status = 'zero' and amount = 0 and currency is not null)
    or (amount_status in ('unknown', 'variable', 'not_applicable') and amount is null)
  )
);

create unique index credential_fees_unique_idx
  on credential_fees (credential_version_id, fee_type, coalesce(label, ''));

-- ---------------------------------------------------------------------------
-- Lookup: versions in effect on a date, for occupations in a jurisdiction.
-- Governing versions sort before discovery versions.
-- ---------------------------------------------------------------------------

create function search_credentials(
  p_soc_codes         text[],
  p_jurisdiction_code text default 'US-WA',
  p_on                date default current_date,
  p_limit             integer default 8
)
returns table (
  credential_id     uuid,
  credential_name   text,
  credential_kind   credential_kind,
  jurisdiction_code text,
  jurisdiction_name text,
  version           jsonb,
  fees              jsonb,
  authorities       jsonb
)
language sql stable as $$
  select
    c.id, c.name, c.kind, j.code, j.name,
    jsonb_build_object(
      'id', v.id,
      'effective_from', v.effective_from,
      'effective_to', v.effective_to,
      'requirements', v.requirements,
      'duration_note', v.duration_note,
      'source_name', v.source_name,
      'source_url', v.source_url,
      'observation_period', v.observation_period,
      'source_as_of', v.source_as_of,
      'source_authority', jsonb_build_object('name', sa.name, 'role', sa.role)
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'fee_type', f.fee_type,
        'label', f.label,
        'amount_status', f.amount_status,
        'amount', f.amount,
        'currency', f.currency,
        'recurrence_months', f.recurrence_months,
        'notes', f.notes,
        'source_name', f.source_name,
        'source_url', f.source_url,
        'observation_period', f.observation_period,
        'source_as_of', f.source_as_of,
        'source_authority', jsonb_build_object('name', fa.name, 'role', fa.role)
      ) order by f.fee_type, f.label)
      from credential_fees f
      join issuing_authorities fa on fa.id = f.source_authority_id
      where f.credential_version_id = v.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.name, 'role', a.role, 'relationship', ca.relationship, 'website_url', a.website_url
      ) order by ca.relationship, a.name)
      from credential_authorities ca
      join issuing_authorities a on a.id = ca.authority_id
      where ca.credential_id = c.id
    ), '[]'::jsonb)
  from credentials c
  join credential_jurisdictions cj on cj.credential_id = c.id
  join jurisdictions j on j.id = cj.jurisdiction_id and j.code = p_jurisdiction_code
  join credential_versions v
    on v.credential_id = c.id
   and v.effective_from <= p_on
   and (v.effective_to is null or v.effective_to > p_on)
  join issuing_authorities sa on sa.id = v.source_authority_id
  where exists (
    select 1 from credential_occupations co
    where co.credential_id = c.id and co.onet_soc_code = any (p_soc_codes)
  )
  order by c.name, sa.role, v.source_as_of desc
  limit p_limit;
$$;

alter table jurisdictions            enable row level security;
alter table issuing_authorities      enable row level security;
alter table credentials              enable row level security;
alter table credential_occupations   enable row level security;
alter table credential_jurisdictions enable row level security;
alter table credential_authorities   enable row level security;
alter table credential_versions      enable row level security;
alter table credential_fees          enable row level security;

-- ---------------------------------------------------------------------------
-- messages: figures in a reply that matched no verified source
-- ---------------------------------------------------------------------------

alter table messages add column unverified_figures text[] not null default '{}';
