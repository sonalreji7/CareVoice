-- Priority status is derived in the database, never trusted from an LLM or a
-- browser-provided status/reason. A caregiver callback flag is an explicit
-- request; the text rule below is clinician-owned, deterministic, and auditable.
alter table public.care_updates
  add column caregiver_callback_requested boolean not null default false;

create or replace function private.apply_care_update_priority()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  current_role public.care_role;
  normal_daily_care_cannot_continue boolean;
begin
  select private.current_care_role() into current_role;

  -- Only a caregiver can make this explicit callback request.
  if current_role <> 'caregiver' then
    new.caregiver_callback_requested := false;
  end if;

  -- This clinician-approved rule intentionally matches only an explicit
  -- statement that normal daily care cannot continue. It does not infer
  -- priority from urgent-sounding language or model-generated text.
  normal_daily_care_cannot_continue :=
    lower(new.original_message) ~ '(cannot|can.t|unable to|not able to)[[:space:]]+(continue|provide)[[:space:]]+(normal[[:space:]]+)?(daily[[:space:]]+)?care'
    or lower(new.original_message) ~ '(normal[[:space:]]+)?daily[[:space:]]+care[[:space:]]+(cannot|can.t|is not able to)[[:space:]]+continue';

  new.priority_reasons := coalesce(array_remove(array[
    case when current_role = 'caregiver' and new.caregiver_callback_requested
      then 'Caregiver explicitly requested a priority callback.' end,
    case when normal_daily_care_cannot_continue
      then 'Clinician-owned deterministic rule: normal daily care cannot continue.' end
  ]::text[], null), array[]::text[]);

  new.status := case when cardinality(new.priority_reasons) > 0
    then 'priority_review_requested'::public.update_status
    else 'new'::public.update_status
  end;
  new.acknowledged_at := null;
  new.closed_at := null;
  return new;
end;
$$;

revoke all on function private.apply_care_update_priority() from public;

create trigger set_care_update_priority_before_insert
before insert on public.care_updates
for each row execute procedure private.apply_care_update_priority();
