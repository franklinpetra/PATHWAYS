-- Voice: PATHWAYS listens and speaks, but only text is kept. Audio is never stored.
--   messages.spoken    the short conversational line spoken aloud for an assistant reply
--   messages.via_voice whether a person's message was spoken (transcribed) rather than typed
--   voice_usage        per-person daily totals that enforce the voice limits

alter table messages
  add column spoken text check (spoken is null or char_length(spoken) <= 600),
  add column via_voice boolean not null default false;

create table voice_usage (
  user_id             uuid not null references users (id) on delete cascade,
  day                 date not null,
  transcribe_seconds  integer not null default 0 check (transcribe_seconds >= 0),
  speak_chars         integer not null default 0 check (speak_chars >= 0),
  primary key (user_id, day)
);

alter table voice_usage enable row level security;

-- Adds to today's totals atomically and returns them.
create function add_voice_usage(p_user uuid, p_day date, p_seconds integer, p_chars integer)
returns voice_usage
language sql as $$
  insert into voice_usage (user_id, day, transcribe_seconds, speak_chars)
  values (p_user, p_day, p_seconds, p_chars)
  on conflict (user_id, day) do update
    set transcribe_seconds = voice_usage.transcribe_seconds + excluded.transcribe_seconds,
        speak_chars = voice_usage.speak_chars + excluded.speak_chars
  returning *;
$$;
