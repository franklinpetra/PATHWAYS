-- Your Route becomes a branching map: the trunk (confirmed_stops) runs from where the person
-- has been to "you are here" and on to their main goal; branches fork from any trunk stop
-- toward the other goals they pursue at the same time. Wins remember which branch they grew on.

alter table pathway_routes
  add column branches jsonb not null default '[]'::jsonb;

alter table progress_events
  add column route_branch text check (route_branch is null or char_length(route_branch) <= 40);
