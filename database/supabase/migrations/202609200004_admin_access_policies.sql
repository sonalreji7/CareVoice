-- Administrators manage application roles and caregiver links only. They do
-- not inherit clinician access to care updates.
grant update (role) on public.profiles to authenticated;
grant insert, delete on public.caregiver_patient_assignments to authenticated;

create policy "admins read user directory"
on public.profiles for select to authenticated
using ((select private.current_care_role()) = 'admin');

create policy "admins change non-admin roles"
on public.profiles for update to authenticated
using (
  (select private.current_care_role()) = 'admin'
  and id <> (select auth.uid())
)
with check (
  id <> (select auth.uid())
  and role in ('patient', 'caregiver', 'clinician')
);

create policy "admins read patient links"
on public.patients for select to authenticated
using ((select private.current_care_role()) = 'admin');

create policy "admins read caregiver links"
on public.caregiver_patient_assignments for select to authenticated
using ((select private.current_care_role()) = 'admin');

create policy "admins create valid caregiver links"
on public.caregiver_patient_assignments for insert to authenticated
with check (
  (select private.current_care_role()) = 'admin'
  and exists (
    select 1 from public.profiles caregiver
    where caregiver.id = caregiver_id and caregiver.role = 'caregiver'
  )
  and exists (
    select 1 from public.patients patient
    join public.profiles patient_profile on patient_profile.id = patient.profile_id
    where patient.id = patient_id and patient_profile.role = 'patient'
  )
);

create policy "admins remove caregiver links"
on public.caregiver_patient_assignments for delete to authenticated
using ((select private.current_care_role()) = 'admin');
