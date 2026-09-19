-- Follow-up hardening based on Supabase security and performance advisors.
revoke execute on function public.handle_new_user() from anon, authenticated;
create index care_updates_author_idx on public.care_updates(author_id);
create index assignments_patient_idx on public.caregiver_patient_assignments(patient_id);
