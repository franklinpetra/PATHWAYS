-- Registered apprenticeship wages from L&I open data: the hourly wage at the first step
-- and at journey level, as filed with each program occupation.

alter table apprenticeships
  add column starting_wage_hourly numeric(8, 2) check (starting_wage_hourly is null or starting_wage_hourly > 0),
  add column journey_wage_hourly  numeric(8, 2) check (journey_wage_hourly is null or journey_wage_hourly > 0);
