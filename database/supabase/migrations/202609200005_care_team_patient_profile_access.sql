-- Care-team users may resolve the basic display name only for a patient they
-- already have access to. Care updates remain governed by their own policy.
create policy "care team read accessible patient profiles"
on public.profiles for select to authenticated
using (
  exists (
    select 1
    from public.patients as patient
    where patient.profile_id = profiles.id
      and private.can_access_patient(patient.id)
  )
);
