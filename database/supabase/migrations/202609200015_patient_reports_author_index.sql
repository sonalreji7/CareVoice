-- Migration 014 was applied before the database advisor identified this
-- foreign-key index. Keep delete and author-based lookups efficient.
create index if not exists patient_reports_author_idx
  on public.patient_reports(author_id);
