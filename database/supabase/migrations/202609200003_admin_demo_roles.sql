-- Adds the administrator role. Policies must be added in a subsequent
-- migration because PostgreSQL requires a transaction commit before a newly
-- added enum value may be used.
alter type public.care_role add value if not exists 'admin';
