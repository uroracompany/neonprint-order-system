-- Private, single-row proof of who physically completed a Delivery order.
-- `orders.delivery_id` remains the operational assignment and is intentionally
-- not replaced by this receipt.
create table if not exists public.delivery_confirmations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  assigned_delivery_id uuid not null references public.profiles(id) on delete restrict,
  executor_type text not null check (executor_type in ('assigned_delivery', 'other_person')),
  executor_name text not null check (char_length(btrim(executor_name)) between 1 and 200),
  delivery_comment text null check (delivery_comment is null or char_length(btrim(delivery_comment)) between 1 and 500),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_confirmations_assigned_delivery_order_idx
  on public.delivery_confirmations (assigned_delivery_id, order_id);

alter table public.delivery_confirmations enable row level security;

revoke all on table public.delivery_confirmations from public, anon, authenticated;
grant select on table public.delivery_confirmations to authenticated;

create policy "delivery confirmations are visible to admin or assigned delivery"
  on public.delivery_confirmations
  for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      join public.profiles p on p.id = auth.uid()
      where o.id = delivery_confirmations.order_id
        and o.delivery_id = auth.uid()
        and p.role = 'delivery'
        and coalesce(p.employment_status, true) = true
        and p.deleted_at is null
    )
  );

-- Retire the note-only signature so every Delivery confirmation uses the
-- structured, validated receipt below.
drop function if exists public.delivery_mark_order_delivered(uuid, text);

create function public.delivery_mark_order_delivered(
  p_order_id uuid,
  p_executor_type text,
  p_other_executor_name text,
  p_delivery_comment text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_actor_name text;
  v_executor_name text;
  v_other_executor_name text := nullif(btrim(coalesce(p_other_executor_name, '')), '');
  v_delivery_comment text := nullif(btrim(coalesce(p_delivery_comment, '')), '');
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if v_actor is null then
    raise exception 'Solo Delivery puede entregar';
  end if;

  select btrim(name) into v_actor_name
  from public.profiles
  where id = v_actor
    and role = 'delivery'
    and coalesce(employment_status, true) = true
    and deleted_at is null;

  if not found then
    raise exception 'Solo Delivery puede entregar';
  end if;

  if v_order.id is null
    or v_order.delivery_id is distinct from v_actor
    or v_order.status <> 'in_Completed' then
    raise exception 'La orden no esta disponible para entrega';
  end if;

  if coalesce(v_order.is_archived_delivery, false) then
    raise exception 'La orden esta archivada para Delivery';
  end if;

  if v_order.payment_status not in ('pagado', 'credito') then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a credito.';
  end if;

  if p_executor_type is null or p_executor_type not in ('assigned_delivery', 'other_person') then
    raise exception 'Tipo de ejecutor invalido';
  end if;

  if v_delivery_comment is not null and char_length(v_delivery_comment) > 500 then
    raise exception 'El comentario de entrega debe tener entre 1 y 500 caracteres';
  end if;

  if p_executor_type = 'assigned_delivery' then
    if v_actor_name is null or char_length(v_actor_name) not between 1 and 200 then
      raise exception 'El perfil Delivery debe tener un nombre valido para confirmar la entrega';
    end if;
    v_executor_name := v_actor_name;
  else
    if v_other_executor_name is null or char_length(v_other_executor_name) not between 1 and 200 then
      raise exception 'Indica el nombre de la otra persona que realizo la entrega';
    end if;
    v_executor_name := v_other_executor_name;
  end if;

  insert into public.delivery_confirmations (
    order_id,
    assigned_delivery_id,
    executor_type,
    executor_name,
    delivery_comment,
    confirmed_by,
    confirmed_at
  ) values (
    v_order.id,
    v_order.delivery_id,
    p_executor_type,
    v_executor_name,
    v_delivery_comment,
    v_actor,
    now()
  ) on conflict (order_id) do update set
    assigned_delivery_id = excluded.assigned_delivery_id,
    executor_type = excluded.executor_type,
    executor_name = excluded.executor_name,
    delivery_comment = excluded.delivery_comment,
    confirmed_by = excluded.confirmed_by,
    confirmed_at = excluded.confirmed_at,
    updated_at = now();

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Delivered', updated_at = now()
  where id = v_order.id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.delivery_mark_order_delivered(uuid, text, text, text) from public, anon;
grant execute on function public.delivery_mark_order_delivered(uuid, text, text, text) to authenticated;
