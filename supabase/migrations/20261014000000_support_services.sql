-- Support services (record relief, legal help, ID, employer incentives) and second-chance
-- employers sit beside training programs: wrap-around help, not a career route.
alter table stepping_stones drop constraint stepping_stones_kind_check;
alter table stepping_stones add constraint stepping_stones_kind_check
  check (kind in ('pre_apprenticeship', 'returnship', 'transitional_employment', 'paid_training', 'job_training',
                  'support_service', 'second_chance_employer'));
