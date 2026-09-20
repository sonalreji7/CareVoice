-- Migration 012 was applied before this duplicate policy was identified.
-- The narrower existing policy from migration 005 already governs this access.
drop policy if exists "care teams read linked patient profiles" on public.profiles;
