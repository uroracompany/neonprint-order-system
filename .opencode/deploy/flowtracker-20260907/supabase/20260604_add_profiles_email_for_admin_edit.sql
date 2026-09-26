-- Keep the public profile email in syncable app data so Admin can list,
-- search, and validate employee email edits without exposing auth.users.

alter table public.profiles
  add column if not exists email text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id
  and p.email is null
  and u.email is not null;

create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email))
  where email is not null;
