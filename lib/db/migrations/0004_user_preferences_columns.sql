-- Notification and schedule preferences that the preferences API reads and
-- writes; they predate the migration history in this repository.
alter table public.user_preferences
  add column if not exists email_notifications boolean not null default true,
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists schedule_frequency text;
