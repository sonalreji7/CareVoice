-- The audit log remains intentionally inaccessible to browser roles. The
-- restrictive policy documents that deny-by-default boundary for RLS tooling.
create policy "deny browser access to care update events"
on public.care_update_events
as restrictive
for all
to authenticated
using (false)
with check (false);

create index care_update_events_actor_idx
  on public.care_update_events(actor_id);
