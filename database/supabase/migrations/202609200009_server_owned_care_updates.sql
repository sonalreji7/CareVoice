-- Server-owned writes, explicit clinician assignment, and immutable review
-- events. Apply only after the backend has SUPABASE_SERVICE_ROLE_KEY set.

create table public.clinician_patient_assignments (
  clinician_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clinician_id, patient_id)
);

create index clinician_patient_assignments_patient_idx
  on public.clinician_patient_assignments(patient_id);

alter table public.clinician_patient_assignments enable row level security;
revoke all on public.clinician_patient_assignments from anon;
grant select, insert, delete on public.clinician_patient_assignments to authenticated;

create policy "admins read clinician links"
on public.clinician_patient_assignments for select to authenticated
using ((select private.current_care_role()) = 'admin');

create policy "admins create valid clinician links"
on public.clinician_patient_assignments for insert to authenticated
with check (
  (select private.current_care_role()) = 'admin'
  and exists (
    select 1 from public.profiles clinician
    where clinician.id = clinician_id and clinician.role = 'clinician'
  )
  and exists (
    select 1 from public.patients patient
    join public.profiles patient_profile on patient_profile.id = patient.profile_id
    where patient.id = patient_id and patient_profile.role = 'patient'
  )
);

create policy "admins remove clinician links"
on public.clinician_patient_assignments for delete to authenticated
using ((select private.current_care_role()) = 'admin');

-- Administrators manage access but do not read care updates. Clinicians only
-- see people explicitly assigned to them; patients and caregivers retain their
-- existing scoped access.
create or replace function private.can_access_patient(target_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.patients patient
      where patient.id = target_patient and patient.profile_id = (select auth.uid())
    )
    or exists (
      select 1 from public.caregiver_patient_assignments assignment
      where assignment.patient_id = target_patient and assignment.caregiver_id = (select auth.uid())
    )
    or exists (
      select 1 from public.clinician_patient_assignments assignment
      where assignment.patient_id = target_patient and assignment.clinician_id = (select auth.uid())
    )
  )
$$;

revoke insert, update, delete on public.care_updates from authenticated;
drop policy if exists "patients and caregivers create permitted updates" on public.care_updates;
drop policy if exists "clinicians update review status" on public.care_updates;

-- Priority is a separate deterministic queue signal. Status is reserved for a
-- review lifecycle so only new -> acknowledged -> closed is possible.
update public.care_updates set status = 'new' where status = 'priority_review_requested';

create or replace function private.apply_care_update_priority()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  author_care_role public.care_role;
  priority_rule_message text;
  normal_daily_care_cannot_continue boolean;
begin
  select profile.role into author_care_role
  from public.profiles as profile
  where profile.id = new.author_id;

  if author_care_role is distinct from 'caregiver' then
    new.caregiver_callback_requested := false;
  end if;

  priority_rule_message := regexp_replace(
    lower(new.original_message),
    '\mnot[[:space:]]+unable to[[:space:]]+(continue|provide)[[:space:]]+(normal[[:space:]]+)?(daily[[:space:]]+)?care\M',
    '',
    'g'
  );
  normal_daily_care_cannot_continue :=
    priority_rule_message ~ '(cannot|can.t|unable to|not able to)[[:space:]]+(continue|provide)[[:space:]]+(normal[[:space:]]+)?(daily[[:space:]]+)?care'
    or priority_rule_message ~ '(normal[[:space:]]+)?daily[[:space:]]+care[[:space:]]+(cannot|can.t|is not able to)[[:space:]]+continue';

  new.priority_reasons := coalesce(array_remove(array[
    case when author_care_role = 'caregiver' and new.caregiver_callback_requested
      then 'Caregiver explicitly requested a priority callback.' end,
    case when normal_daily_care_cannot_continue
      then 'Clinician-owned deterministic rule: normal daily care cannot continue.' end
  ]::text[], null), array[]::text[]);
  new.status := 'new';
  new.acknowledged_at := null;
  new.closed_at := null;
  return new;
end;
$$;

create table public.care_update_events (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.care_updates(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('created', 'acknowledged', 'closed')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default clock_timestamp()
);

create index care_update_events_update_created_idx
  on public.care_update_events(update_id, created_at);

alter table public.care_update_events enable row level security;
revoke all on public.care_update_events from anon, authenticated;

create or replace function public.create_care_update_from_server(
  p_patient_id uuid,
  p_author_id uuid,
  p_original_message text,
  p_agent_summary jsonb,
  p_caregiver_callback_requested boolean default false
)
returns public.care_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_update public.care_updates;
begin
  if char_length(btrim(p_original_message)) not between 1 and 10000 then
    raise exception 'original_message must contain 1 to 10000 characters' using errcode = '22023';
  end if;

  insert into public.care_updates (
    patient_id, author_id, original_message, agent_summary, caregiver_callback_requested
  ) values (
    p_patient_id, p_author_id, btrim(p_original_message), p_agent_summary, coalesce(p_caregiver_callback_requested, false)
  ) returning * into created_update;

  insert into public.care_update_events (update_id, actor_id, action)
  values (created_update.id, p_author_id, 'created');

  return created_update;
end;
$$;

create or replace function public.transition_care_update_from_server(
  p_update_id uuid,
  p_actor_id uuid,
  p_next_status public.update_status,
  p_reason text default null
)
returns public.care_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_update public.care_updates;
  transitioned_update public.care_updates;
begin
  select * into current_update
  from public.care_updates
  where id = p_update_id
  for update;

  if not found then
    raise exception 'care update not found' using errcode = 'P0001';
  end if;

  if current_update.status = 'new' and p_next_status = 'acknowledged' then
    update public.care_updates
    set status = 'acknowledged', acknowledged_at = clock_timestamp()
    where id = p_update_id
    returning * into transitioned_update;
  elsif current_update.status = 'acknowledged' and p_next_status = 'closed' then
    update public.care_updates
    set status = 'closed', closed_at = clock_timestamp()
    where id = p_update_id
    returning * into transitioned_update;
  else
    raise exception 'invalid care update status transition' using errcode = 'P0001';
  end if;

  insert into public.care_update_events (update_id, actor_id, action, reason)
  values (p_update_id, p_actor_id, p_next_status::text, nullif(btrim(p_reason), ''));

  return transitioned_update;
end;
$$;

revoke all on function public.create_care_update_from_server(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.transition_care_update_from_server(uuid, uuid, public.update_status, text) from public, anon, authenticated;
grant execute on function public.create_care_update_from_server(uuid, uuid, text, jsonb, boolean) to service_role;
grant execute on function public.transition_care_update_from_server(uuid, uuid, public.update_status, text) to service_role;
