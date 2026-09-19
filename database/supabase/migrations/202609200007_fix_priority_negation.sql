-- Preserve explicit negation: "not unable to continue normal daily care"
-- must not match the clinician-owned priority rule.
create or replace function private.apply_care_update_priority()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  current_role public.care_role;
  priority_rule_message text;
  normal_daily_care_cannot_continue boolean;
begin
  select private.current_care_role() into current_role;

  if current_role <> 'caregiver' then
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
