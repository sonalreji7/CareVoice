-- Clinician quality feedback is deliberately separate from the immutable care
-- update. Only the trusted server may call this function after authenticating
-- and authorizing the assigned clinician.
create type public.handover_feedback_outcome as enum (
  'useful_as_is',
  'needed_original_words',
  'missing_relevant_detail',
  'incorrect_tagging',
  'other'
);

create table public.care_update_handover_feedback (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.care_updates(id) on delete cascade,
  clinician_id uuid not null references public.profiles(id) on delete cascade,
  outcome public.handover_feedback_outcome not null,
  note text check (note is null or char_length(btrim(note)) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);

create index care_update_handover_feedback_update_created_idx
  on public.care_update_handover_feedback(update_id, created_at);

create index care_update_handover_feedback_clinician_idx
  on public.care_update_handover_feedback(clinician_id);

alter table public.care_update_handover_feedback enable row level security;
revoke all on public.care_update_handover_feedback from anon, authenticated;

create policy "deny browser access to handover feedback"
on public.care_update_handover_feedback
as restrictive
for all to authenticated
using (false)
with check (false);

create or replace function public.create_care_update_handover_feedback_from_server(
  p_update_id uuid,
  p_clinician_id uuid,
  p_outcome public.handover_feedback_outcome,
  p_note text default null
)
returns public.care_update_handover_feedback
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_update public.care_updates;
  created_feedback public.care_update_handover_feedback;
  cleaned_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into target_update
  from public.care_updates
  where id = p_update_id;

  if not found then
    raise exception 'care update not found' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles as profile
    where profile.id = p_clinician_id and profile.role = 'clinician'
  ) or not exists (
    select 1 from public.clinician_patient_assignments as assignment
    where assignment.clinician_id = p_clinician_id
      and assignment.patient_id = target_update.patient_id
  ) then
    raise exception 'actor is not an assigned clinician' using errcode = 'P0001';
  end if;

  if cleaned_note is not null and char_length(cleaned_note) > 500 then
    raise exception 'feedback note must be at most 500 characters' using errcode = '22023';
  end if;

  insert into public.care_update_handover_feedback (update_id, clinician_id, outcome, note)
  values (p_update_id, p_clinician_id, p_outcome, cleaned_note)
  returning * into created_feedback;

  return created_feedback;
end;
$$;

revoke all on function public.create_care_update_handover_feedback_from_server(uuid, uuid, public.handover_feedback_outcome, text) from public, anon, authenticated;
grant execute on function public.create_care_update_handover_feedback_from_server(uuid, uuid, public.handover_feedback_outcome, text) to service_role;
