-- Run with: supabase db push (or apply in the Supabase SQL editor).
-- All self-registered accounts start as patients. Caregiver and clinician roles are admin-only.
create schema private;
revoke all on schema private from public;
create type public.care_role as enum ('patient', 'caregiver', 'clinician');
create type public.update_status as enum ('new', 'priority_review_requested', 'acknowledged', 'closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'CareVoice user',
  role public.care_role not null default 'patient',
  created_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete cascade,
  quick_summary text,
  created_at timestamptz not null default now()
);

create table public.caregiver_patient_assignments (
  caregiver_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (caregiver_id, patient_id)
);

create table public.care_updates (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  original_message text not null check (char_length(original_message) between 1 and 10000),
  agent_summary jsonb not null,
  status public.update_status not null default 'new',
  priority_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  closed_at timestamptz
);

create index care_updates_patient_created_idx on public.care_updates(patient_id, created_at desc);
create index assignments_caregiver_idx on public.caregiver_patient_assignments(caregiver_id);

create or replace function private.current_care_role()
returns public.care_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid()) and (select auth.uid()) is not null
$$;

create or replace function private.can_access_patient(target_patient uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (select auth.uid()) is not null and (
    (select private.current_care_role()) = 'clinician'
    or exists (select 1 from public.patients p where p.id = target_patient and p.profile_id = (select auth.uid()))
    or exists (select 1 from public.caregiver_patient_assignments a where a.patient_id = target_patient and a.caregiver_id = (select auth.uid()))
  )
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'CareVoice user'), 'patient');
  insert into public.patients (profile_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
revoke all on function public.handle_new_user() from public;
grant usage on schema private to authenticated;
revoke all on function private.current_care_role(), private.can_access_patient(uuid) from public;
grant execute on function private.current_care_role(), private.can_access_patient(uuid) to authenticated;

revoke all on public.profiles, public.patients, public.caregiver_patient_assignments, public.care_updates from anon;
grant select on public.profiles, public.patients, public.caregiver_patient_assignments, public.care_updates to authenticated;
grant insert on public.care_updates to authenticated;
grant update(status, acknowledged_at, closed_at) on public.care_updates to authenticated;

alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.caregiver_patient_assignments enable row level security;
alter table public.care_updates enable row level security;

create policy "users read their profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "users read accessible patient profiles" on public.patients for select to authenticated using (private.can_access_patient(id));
create policy "caregivers read their assignments" on public.caregiver_patient_assignments for select to authenticated using (caregiver_id = (select auth.uid()));
create policy "users read permitted updates" on public.care_updates for select to authenticated using (private.can_access_patient(patient_id));
create policy "patients and caregivers create permitted updates" on public.care_updates for insert to authenticated with check (
  author_id = (select auth.uid()) and private.current_care_role() in ('patient', 'caregiver') and private.can_access_patient(patient_id)
);
create policy "clinicians update review status" on public.care_updates for update to authenticated using (private.current_care_role() = 'clinician') with check (private.current_care_role() = 'clinician');

-- Keep profile role changes and caregiver assignments to an admin/service workflow; never expose writes to clients.
