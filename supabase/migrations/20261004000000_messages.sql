-- PATHWAYS: persisted conversation history.
--
-- The transcript is the Memory Agent's source material and the history each reply is
-- built from. Messages are append-only; they are written only through the state guard.

create type message_role as enum ('user', 'assistant');
create type message_status as enum ('complete', 'interrupted');

create table messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  pathway_id uuid references pathways (id) on delete cascade,
  role       message_role not null,
  content    text not null,
  -- 'interrupted' when a reply was stopped or failed partway through.
  status     message_status not null default 'complete',
  -- Sourced places cited in an assistant reply (see lib/workspace/events.ts VerifiedPlace).
  places     jsonb not null default '[]',
  created_at timestamptz not null default now(),
  constraint messages_content_not_blank check (length(trim(content)) > 0)
);

create index messages_thread_idx on messages (user_id, pathway_id, created_at desc);

alter table messages enable row level security;
