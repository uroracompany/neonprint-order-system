-- Durable, person-to-person return cycles for the existing Caja -> Ventas/Diseño flow.
create table if not exists public.order_return_handoffs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  cashier_id uuid not null references public.profiles(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  recipient_role text not null check (recipient_role in ('seller', 'designer')),
  return_reason text not null check (length(trim(return_reason)) > 0),
  returned_at timestamptz not null default now(),
  source_status text not null default 'in_Quote',
  response_note text,
  responded_by uuid references public.profiles(id) on delete set null,
  responded_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  check (
    (response_note is null and responded_by is null and responded_at is null)
    or (length(trim(coalesce(response_note, ''))) > 0 and responded_by is not null and responded_at is not null)
  )
);

create unique index if not exists idx_order_return_handoffs_one_open_cycle
  on public.order_return_handoffs(order_id)
  where acknowledged_at is null;

create index if not exists idx_order_return_handoffs_recipient_pending
  on public.order_return_handoffs(recipient_id, responded_at, returned_at desc);

create index if not exists idx_order_return_handoffs_cashier_acknowledgement
  on public.order_return_handoffs(cashier_id, acknowledged_at, responded_at desc);

alter table public.order_return_handoffs enable row level security;

drop policy if exists order_return_handoffs_select_participant_or_admin on public.order_return_handoffs;
create policy order_return_handoffs_select_participant_or_admin
  on public.order_return_handoffs for select to authenticated
  using (
    cashier_id = auth.uid()
    or recipient_id = auth.uid()
    or public.current_profile_is_admin()
  );

revoke all on public.order_return_handoffs from public, anon, authenticated;
grant select on public.order_return_handoffs to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.order_return_handoffs;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create or replace function public.return_quote_order_for_correction(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := lower(coalesce(public.current_profile_role(), ''));
  v_order public.orders%rowtype;
  v_recipient_id uuid;
  v_recipient_role text;
  v_target_status text;
  v_updated public.orders%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if v_role not in ('quote', 'cashier', 'caja', 'cotizador') then
    raise exception 'Solo Caja puede devolver órdenes para corrección';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'El motivo de la devolución es obligatorio';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if lower(coalesce(v_order.status, '')) <> 'in_quote' then
    raise exception 'La orden debe estar en Caja para devolverla';
  end if;
  if v_order.quote_id is distinct from v_actor then
    raise exception 'La orden no está asignada a tu bandeja de Caja';
  end if;
  if exists (select 1 from public.order_return_handoffs where order_id = p_order_id and acknowledged_at is null) then
    raise exception 'Esta orden ya tiene una devolución pendiente';
  end if;

  if v_order.order_design_type = 'EXTERNAL_DESING' then
    v_recipient_id := coalesce(v_order.seller_id, v_order.created_by);
    v_recipient_role := 'seller';
    v_target_status := 'Pending';
  else
    v_recipient_id := v_order.designer_id;
    v_recipient_role := 'designer';
    v_target_status := 'in_Design';
  end if;

  if v_recipient_id is null then raise exception 'La orden no tiene un destinatario válido para la devolución'; end if;

  insert into public.order_return_handoffs (
    order_id, cashier_id, recipient_id, recipient_role, return_reason, source_status
  ) values (
    p_order_id, v_actor, v_recipient_id, v_recipient_role, trim(p_reason), v_order.status
  );

  update public.orders
     set status = v_target_status,
         return_reason = trim(p_reason),
         returned_to_designer_at = now()
   where id = p_order_id
   returning * into v_updated;

  return to_jsonb(v_updated);
end;
$$;

create or replace function public.return_order_to_cashier(
  p_handoff_id uuid,
  p_correction_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_handoff public.order_return_handoffs%rowtype;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_correction_note, ''))) = 0 then
    raise exception 'Debes indicar exactamente qué corregiste';
  end if;

  select * into v_handoff from public.order_return_handoffs where id = p_handoff_id for update;
  if not found then raise exception 'Devolución no encontrada'; end if;
  if v_handoff.recipient_id <> v_actor then raise exception 'No puedes responder una devolución ajena'; end if;
  if v_handoff.responded_at is not null then raise exception 'Esta devolución ya fue regresada a Caja'; end if;
  if v_handoff.acknowledged_at is not null then raise exception 'Esta devolución ya fue cerrada'; end if;

  select * into v_order from public.orders where id = v_handoff.order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_order.return_reason is null then raise exception 'La orden ya no está pendiente de corrección'; end if;

  update public.orders
     set status = v_handoff.source_status,
         quote_id = v_handoff.cashier_id,
         return_reason = null,
         returned_to_designer_at = null
   where id = v_order.id
   returning * into v_updated;

  update public.order_return_handoffs
     set response_note = trim(p_correction_note),
         responded_by = v_actor,
         responded_at = now()
   where id = p_handoff_id;

  perform public.notify_many(
    array[v_handoff.cashier_id],
    'order_returned',
    'Orden regresada',
    'La orden fue corregida y regresada a Caja. Revisa el detalle para conocer los cambios.',
    v_order.id,
    jsonb_build_object('event_kind', 'order_returned_to_cashier', 'return_handoff_id', p_handoff_id)
  );

  return to_jsonb(v_updated);
end;
$$;

create or replace function public.acknowledge_order_return(p_handoff_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  update public.order_return_handoffs
     set acknowledged_by = v_actor,
         acknowledged_at = now()
   where id = p_handoff_id
     and cashier_id = v_actor
     and responded_at is not null
     and acknowledged_at is null;

  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'No hay una devolución pendiente para confirmar'; end if;

  update public.notifications
     set is_read = true,
         read_at = coalesce(read_at, now())
   where user_id = v_actor
     and is_read = false
     and metadata->>'event_kind' = 'order_returned_to_cashier'
     and metadata->>'return_handoff_id' = p_handoff_id::text;

  return v_count;
end;
$$;

revoke all on function public.return_quote_order_for_correction(uuid, text) from public, anon;
revoke all on function public.return_order_to_cashier(uuid, text) from public, anon;
revoke all on function public.acknowledge_order_return(uuid) from public, anon;
grant execute on function public.return_quote_order_for_correction(uuid, text) to authenticated;
grant execute on function public.return_order_to_cashier(uuid, text) to authenticated;
grant execute on function public.acknowledge_order_return(uuid) to authenticated;
