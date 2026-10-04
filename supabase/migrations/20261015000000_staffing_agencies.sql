-- Day-labor and staffing agencies (fast, often same-day pay) sit beside training routes as
-- help, like support services; second-chance hiring is claimed only where their own site says so.
alter table stepping_stones drop constraint stepping_stones_kind_check;
alter table stepping_stones add constraint stepping_stones_kind_check
  check (kind in ('pre_apprenticeship', 'returnship', 'transitional_employment', 'paid_training', 'job_training',
                  'support_service', 'second_chance_employer', 'staffing_agency'));
