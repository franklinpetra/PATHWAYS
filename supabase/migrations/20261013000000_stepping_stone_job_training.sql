-- Free, supported job training (e.g. FareStart) is its own kind: it isn't employment and,
-- unless a source says so, participants aren't paid.
alter table stepping_stones drop constraint stepping_stones_kind_check;
alter table stepping_stones add constraint stepping_stones_kind_check
  check (kind in ('pre_apprenticeship', 'returnship', 'transitional_employment', 'paid_training', 'job_training'));
