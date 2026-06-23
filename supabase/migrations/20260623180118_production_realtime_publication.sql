-- Ensure production workflow tables emit Realtime events.
-- Visibility remains governed by each table's existing RLS policies.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_production_assignments'
  ) then
    alter publication supabase_realtime add table public.order_production_assignments;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_production_files'
  ) then
    alter publication supabase_realtime add table public.order_production_files;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_production_user_archives'
  ) then
    alter publication supabase_realtime add table public.order_production_user_archives;
  end if;
end
$$;
