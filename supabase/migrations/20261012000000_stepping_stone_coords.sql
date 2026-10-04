-- Coordinates for stepping-stone programs (from the Census places table at sync time), so
-- matching can prefer programs a person can actually reach.
alter table stepping_stones
  add column latitude  double precision,
  add column longitude double precision;
