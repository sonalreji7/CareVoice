-- User-entered report text and optional blood-pressure measurements. Browser
-- clients can read only records already within their patient access scope;
-- writes are performed by the trusted server function below.
create table public.patient_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  report_label text not null check (char_length(btrim(report_label)) between 1 and 120),
  reported_at date not null default current_date,
  results_text text not null default '' check (char_length(results_text) <= 5000),
  systolic smallint,
  diastolic smallint,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (systolic is null and diastolic is null)
    or (systolic between 40 and 300 and diastolic between 20 and 200)
  ),
  check (char_length(btrim(results_text)) > 0 or (systolic is not null and diastolic is not null))
);

create index patient_reports_patient_reported_idx
  on public.patient_reports(patient_id, reported_at desc, created_at desc);

create index patient_reports_author_idx
  on public.patient_reports(author_id);

alter table public.patient_reports enable row level security;
revoke all on public.patient_reports from anon;
grant select on public.patient_reports to authenticated;

create policy "care teams read permitted patient reports"
on public.patient_reports for select to authenticated
using (private.can_access_patient(patient_id));

create or replace function public.create_patient_report_from_server(
  p_patient_id uuid,
  p_author_id uuid,
  p_report_label text,
  p_reported_at date,
  p_results_text text,
  p_systolic integer default null,
  p_diastolic integer default null
)
returns public.patient_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.care_role;
  created_report public.patient_reports;
  cleaned_results text := btrim(coalesce(p_results_text, ''));
begin
  select role into actor_role
  from public.profiles
  where id = p_author_id;

  if actor_role = 'patient' then
    if not exists (
      select 1 from public.patients
      where id = p_patient_id and profile_id = p_author_id
    ) then
      raise exception 'patient may only create their own report' using errcode = 'P0001';
    end if;
  elsif actor_role = 'caregiver' then
    if not exists (
      select 1 from public.caregiver_patient_assignments
      where caregiver_id = p_author_id and patient_id = p_patient_id
    ) then
      raise exception 'caregiver is not assigned to this patient' using errcode = 'P0001';
    end if;
  else
    raise exception 'actor cannot create patient reports' using errcode = 'P0001';
  end if;

  if char_length(btrim(coalesce(p_report_label, ''))) not between 1 and 120 then
    raise exception 'report label must contain 1 to 120 characters' using errcode = '22023';
  end if;
  if char_length(cleaned_results) > 5000 then
    raise exception 'report text must contain at most 5000 characters' using errcode = '22023';
  end if;
  if (p_systolic is null) <> (p_diastolic is null) then
    raise exception 'enter both blood-pressure values together' using errcode = '22023';
  end if;
  if p_systolic is not null and (p_systolic not between 40 and 300 or p_diastolic not between 20 and 200) then
    raise exception 'blood-pressure values are outside the supported entry range' using errcode = '22023';
  end if;
  if cleaned_results = '' and p_systolic is null then
    raise exception 'enter report text or both blood-pressure values' using errcode = '22023';
  end if;

  insert into public.patient_reports (
    patient_id, author_id, report_label, reported_at, results_text, systolic, diastolic
  ) values (
    p_patient_id, p_author_id, btrim(p_report_label), coalesce(p_reported_at, current_date), cleaned_results, p_systolic, p_diastolic
  ) returning * into created_report;

  return created_report;
end;
$$;

revoke all on function public.create_patient_report_from_server(uuid, uuid, text, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.create_patient_report_from_server(uuid, uuid, text, date, text, integer, integer) to service_role;
