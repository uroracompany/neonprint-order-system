-- Keep the legacy participant trigger aligned with the Semi-Admin stage model.
-- Authorization remains in the command functions; this trigger only validates
-- that the selected stage participant has a compatible active profile.

create or replace function public.validate_order_assignment_roles()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.designer_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = new.designer_id
      and p.role in ('designer', 'semi_admin')
      and coalesce(p.employment_status, true) = true
      and p.deleted_at is null
  ) then
    raise exception 'designer_id must reference an active designer or semi-admin profile';
  end if;

  if new.quote_id is not null and not exists (
    select 1
    from public.profiles p
    where p.id = new.quote_id
      and p.role in ('quote', 'semi_admin')
      and coalesce(p.employment_status, true) = true
      and p.deleted_at is null
  ) then
    raise exception 'quote_id must reference an active quote or semi-admin profile';
  end if;

  return new;
end;
$$;
