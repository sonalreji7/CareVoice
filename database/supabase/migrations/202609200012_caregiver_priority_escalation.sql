-- An explicit caregiver escalation is a separate, audited action. It does not
-- use model output and can only be invoked by the trusted application server.
alter table public.care_update_events
  drop constraint if exists care_update_events_action_check;

alter table public.care_update_events
  add constraint care_update_events_action_check
  check (action in ('created', 'handover_rebuilt', 'caregiver_requested_priority_review', 'acknowledged', 'closed'));

create or replace function public.request_care_update_priority_from_server(
  p_update_id uuid,
  p_actor_id uuid
)
returns public.care_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_update public.care_updates;
  escalated_update public.care_updates;
  caregiver_priority_reason constant text := 'Caregiver explicitly requested a priority callback.';
begin
  select * into current_update
  from public.care_updates
  where id = p_update_id
  for update;

  if not found then
    raise exception 'care update not found' using errcode = 'P0001';
  end if;

  if current_update.status = 'closed' then
    raise exception 'closed care updates cannot be escalated' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id and profile.role = 'caregiver'
  ) or not exists (
    select 1
    from public.caregiver_patient_assignments as assignment
    where assignment.caregiver_id = p_actor_id and assignment.patient_id = current_update.patient_id
  ) then
    raise exception 'actor is not an assigned caregiver' using errcode = 'P0001';
  end if;

  if caregiver_priority_reason = any(coalesce(current_update.priority_reasons, array[]::text[])) then
    return current_update;
  end if;

  update public.care_updates
  set caregiver_callback_requested = true,
      priority_reasons = array_append(coalesce(priority_reasons, array[]::text[]), caregiver_priority_reason)
  where id = p_update_id
  returning * into escalated_update;

  insert into public.care_update_events (update_id, actor_id, action, reason)
  values (p_update_id, p_actor_id, 'caregiver_requested_priority_review', caregiver_priority_reason);

  return escalated_update;
end;
$$;

revoke all on function public.request_care_update_priority_from_server(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_care_update_priority_from_server(uuid, uuid) to service_role;
