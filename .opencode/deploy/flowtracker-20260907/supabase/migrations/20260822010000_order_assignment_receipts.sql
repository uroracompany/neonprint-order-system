-- Per-user acknowledgement queue for newly assigned orders.
-- This intentionally does not alter order status or the existing notifications.

create table if not exists public.order_assignment_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assignment_module text not null check (assignment_module in ('design', 'quote', 'production', 'delivery')),
  assignment_source text not null,
  source_assignment_id uuid,
  assigned_at timestamptz not null default now(),
  seen_at timestamptz,
  seen_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_order_assignment_receipts_pending_user_module
  on public.order_assignment_receipts(user_id, assignment_module, assigned_at desc)
  where seen_at is null;

create index if not exists idx_order_assignment_receipts_order_user_module
  on public.order_assignment_receipts(order_id, user_id, assignment_module, seen_at);

alter table public.order_assignment_receipts enable row level security;

drop policy if exists order_assignment_receipts_select_own_or_admin on public.order_assignment_receipts;
create policy order_assignment_receipts_select_own_or_admin
  on public.order_assignment_receipts for select
  to authenticated
  using (user_id = auth.uid() or public.current_profile_is_admin());

revoke all on public.order_assignment_receipts from anon;
revoke all on public.order_assignment_receipts from authenticated;
grant select on public.order_assignment_receipts to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.order_assignment_receipts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create or replace function public.record_order_assignment_receipt(
  p_order_id uuid,
  p_user_id uuid,
  p_assignment_module text,
  p_assignment_source text,
  p_source_assignment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_order_id is null
    or p_user_id is null
    or p_assignment_module not in ('design', 'quote', 'production', 'delivery') then
    return;
  end if;

  insert into public.order_assignment_receipts (
    order_id,
    user_id,
    assignment_module,
    assignment_source,
    source_assignment_id
  ) values (
    p_order_id,
    p_user_id,
    p_assignment_module,
    p_assignment_source,
    p_source_assignment_id
  );
end;
$$;

revoke all on function public.record_order_assignment_receipt(uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.handle_order_assignment_receipts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_order_assignment_receipt(new.id, new.designer_id, 'design', 'orders.designer_id');
    perform public.record_order_assignment_receipt(new.id, new.quote_id, 'quote', 'orders.quote_id');
    perform public.record_order_assignment_receipt(new.id, new.production_id, 'production', 'orders.production_id');
    perform public.record_order_assignment_receipt(new.id, new.delivery_id, 'delivery', 'orders.delivery_id');
    return new;
  end if;

  if new.designer_id is distinct from old.designer_id and new.designer_id is not null then
    perform public.record_order_assignment_receipt(new.id, new.designer_id, 'design', 'orders.designer_id');
  end if;

  if new.quote_id is distinct from old.quote_id and new.quote_id is not null then
    perform public.record_order_assignment_receipt(new.id, new.quote_id, 'quote', 'orders.quote_id');
  end if;

  if new.production_id is distinct from old.production_id and new.production_id is not null then
    perform public.record_order_assignment_receipt(new.id, new.production_id, 'production', 'orders.production_id');
  end if;

  if new.delivery_id is distinct from old.delivery_id and new.delivery_id is not null then
    perform public.record_order_assignment_receipt(new.id, new.delivery_id, 'delivery', 'orders.delivery_id');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_assignment_receipts on public.orders;
create trigger trg_order_assignment_receipts
  after insert or update of designer_id, quote_id, production_id, delivery_id on public.orders
  for each row
  execute function public.handle_order_assignment_receipts();

revoke all on function public.handle_order_assignment_receipts() from public, anon, authenticated;

create or replace function public.handle_production_assignment_receipts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_order_assignment_receipt(
      new.order_id,
      new.assigned_to,
      'production',
      'order_production_assignments',
      new.id
    );
  elsif new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    perform public.record_order_assignment_receipt(
      new.order_id,
      new.assigned_to,
      'production',
      'order_production_assignments',
      new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_production_assignment_receipts on public.order_production_assignments;
create trigger trg_production_assignment_receipts
  after insert or update of assigned_to on public.order_production_assignments
  for each row
  execute function public.handle_production_assignment_receipts();

revoke all on function public.handle_production_assignment_receipts() from public, anon, authenticated;

create or replace function public.mark_order_assignment_receipts_seen(
  p_order_id uuid,
  p_assignment_module text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_seen_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_assignment_module not in ('design', 'quote', 'production', 'delivery') then
    raise exception 'Invalid assignment module';
  end if;

  with seen as (
    update public.order_assignment_receipts
       set seen_at = now(),
           seen_by = v_user_id
     where order_id = p_order_id
       and user_id = v_user_id
       and assignment_module = p_assignment_module
       and seen_at is null
     returning id
  )
  select count(*)::integer into v_seen_count from seen;

  return v_seen_count;
end;
$$;

revoke all on function public.mark_order_assignment_receipts_seen(uuid, text) from public, anon;
grant execute on function public.mark_order_assignment_receipts_seen(uuid, text) to authenticated;
