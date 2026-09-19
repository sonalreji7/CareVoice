-- Existing records may be rebuilt only by trusted server code. Original words,
-- status, priority, and review timestamps remain unchanged.
alter table public.care_update_events
  drop constraint if exists care_update_events_action_check;

alter table public.care_update_events
  add constraint care_update_events_action_check
  check (action in ('created', 'handover_rebuilt', 'acknowledged', 'closed'));

create or replace function public.refresh_care_update_handover_from_server(
  p_update_id uuid,
  p_actor_id uuid,
  p_agent_summary jsonb
)
returns public.care_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_update public.care_updates;
begin
  update public.care_updates
  set agent_summary = p_agent_summary
  where id = p_update_id
  returning * into refreshed_update;

  if not found then
    raise exception 'care update not found' using errcode = 'P0001';
  end if;

  insert into public.care_update_events (update_id, actor_id, action)
  values (p_update_id, p_actor_id, 'handover_rebuilt');

  return refreshed_update;
end;
$$;

revoke all on function public.refresh_care_update_handover_from_server(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.refresh_care_update_handover_from_server(uuid, uuid, jsonb) to service_role;
