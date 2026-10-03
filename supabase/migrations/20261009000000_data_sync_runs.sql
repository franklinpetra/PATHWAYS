-- One row per data refresh (scheduled or manual), so freshness and failures are visible
-- in the health check rather than discovered in a conversation.

create table data_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('apprenticeships', 'wages', 'places')),
  trigger       text not null check (trigger in ('cron', 'manual')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  rows_written  integer,
  rows_removed  integer,
  source_as_of  date,
  message       text
);

create index data_sync_runs_source_idx on data_sync_runs (source, started_at desc);

alter table data_sync_runs enable row level security;
