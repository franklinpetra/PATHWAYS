-- Footsteps on Your Route: wins are done or under way, and remember which stretch of the
-- route they were on (the stop the person had reached), so they settle onto the road behind
-- them as they move forward. person_edited marks a route the person has changed themselves.

alter table progress_events
  add column stage text not null default 'done' check (stage in ('done', 'underway')),
  add column route_stop integer check (route_stop is null or route_stop >= 0);

alter table pathway_routes
  add column person_edited boolean not null default false;
