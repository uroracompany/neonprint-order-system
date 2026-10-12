-- Financial write ownership is restricted to the assigned Cashier. The
-- invoice_assignment_mode continues to decide whether Sales or Caja assigns
-- the invoice number; it does not grant payment-status or receipt authority.


create or replace function public.assert_assigned_cashier_order(
  p_order_id uuid,
  p_expected_updated_at timestamptz default null,
  p_require_quote_stage boolean default true
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'quote'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo Caja puede gestionar pagos, comprobantes o crédito.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is not null and v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_order.quote_id is distinct from v_actor then
    raise exception 'Solo el responsable asignado de Caja puede gestionar esta orden.';
  end if;
  if coalesce(v_order.is_archived, false) or coalesce(v_order.is_archived_admin, false)
     or coalesce(v_order.is_archived_quote, false) or v_order.operational_status = 'blocked'
     or v_order.status = 'cancelled' then
    raise exception 'La orden está archivada, cancelada o bloqueada.';
  end if;
  if p_require_quote_stage and v_order.status <> 'in_Quote' then
    raise exception 'La orden debe estar en Caja para modificar este dato financiero.';
  end if;
  return v_order;
end;
$$;

revoke all on function public.assert_assigned_cashier_order(uuid, timestamptz, boolean)
  from public, anon, authenticated;

-- Keep the proven payment implementation behind a narrow role/ownership gate.
alter function public.quote_set_order_payment(uuid, text, text, timestamptz)
  rename to quote_set_order_payment_before_cashier_gate;
revoke all on function public.quote_set_order_payment_before_cashier_gate(uuid, text, text, timestamptz)
  from public, anon, authenticated;

create function public.quote_set_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_assigned_cashier_order(p_order_id, p_expected_updated_at, true);
  return public.quote_set_order_payment_before_cashier_gate(
    p_order_id, p_payment_status, p_invoice_payment, p_expected_updated_at
  );
end;
$$;

revoke all on function public.quote_set_order_payment(uuid, text, text, timestamptz)
  from public, anon;
grant execute on function public.quote_set_order_payment(uuid, text, text, timestamptz)
  to authenticated;
-- Retire the pre-concurrency overload; it must not remain an alternate route.
revoke all on function public.quote_set_order_payment(uuid, text, text)
  from public, anon, authenticated;

alter function public.quote_assign_invoice_code(uuid, text, timestamptz)
  rename to quote_assign_invoice_code_before_cashier_gate;
revoke all on function public.quote_assign_invoice_code_before_cashier_gate(uuid, text, timestamptz)
  from public, anon, authenticated;

create function public.quote_assign_invoice_code(
  p_order_id uuid,
  p_invoice_number text,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  v_order := public.assert_assigned_cashier_order(p_order_id, p_expected_updated_at, true);
  if not public.order_requires_invoice_code(v_order.invoice_assignment_mode) then
    raise exception 'Esta orden está configurada para que Ventas asigne el código de facturación.';
  end if;
  return public.quote_assign_invoice_code_before_cashier_gate(
    p_order_id, p_invoice_number, p_expected_updated_at
  );
end;
$$;

revoke all on function public.quote_assign_invoice_code(uuid, text, timestamptz)
  from public, anon;
grant execute on function public.quote_assign_invoice_code(uuid, text, timestamptz)
  to authenticated;

alter function public.mark_order_as_credit(uuid, timestamptz, timestamptz)
  rename to mark_order_as_credit_before_cashier_gate;
revoke all on function public.mark_order_as_credit_before_cashier_gate(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create function public.mark_order_as_credit(
  p_order_id uuid,
  p_due_date timestamptz,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_assigned_cashier_order(p_order_id, p_expected_updated_at, true);
  return public.mark_order_as_credit_before_cashier_gate(
    p_order_id, p_due_date, p_expected_updated_at
  );
end;
$$;

revoke all on function public.mark_order_as_credit(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.mark_order_as_credit(uuid, timestamptz, timestamptz)
  to authenticated;
revoke all on function public.mark_order_as_credit(uuid, timestamptz),
  public.mark_order_as_credit(uuid, timestamptz, numeric)
  from public, anon, authenticated;

-- Credit settlement is still a Caja workflow, but was not scoped to the
-- assigned cashier. Check every order while locked before delegating to the
-- existing batch implementation.
alter function public.settle_credit_orders(uuid[], text, text)
  rename to settle_credit_orders_before_cashier_assignment_gate;
revoke all on function public.settle_credit_orders_before_cashier_assignment_gate(uuid[], text, text)
  from public, anon, authenticated;

create function public.settle_credit_orders(
  p_order_ids uuid[],
  p_notes text default null,
  p_receipt_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'quote'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo Caja puede cerrar seguimientos de crédito.'; end if;

  select coalesce(array_agg(distinct requested.id), '{}'::uuid[])
    into v_ids from unnest(coalesce(p_order_ids, '{}'::uuid[])) requested(id)
    where requested.id is not null;
  if cardinality(v_ids) = 0 then raise exception 'Debes seleccionar al menos una orden pendiente.'; end if;

  perform 1 from public.orders o where o.id = any(v_ids) order by o.id for update;
  select count(*) into v_count from public.orders o
  where o.id = any(v_ids) and o.quote_id = v_actor and o.payment_status = 'credito'
    and o.status <> 'cancelled' and not coalesce(o.is_archived, false)
    and not coalesce(o.is_archived_admin, false) and not coalesce(o.is_archived_quote, false)
    and o.operational_status is distinct from 'blocked';
  if v_count <> cardinality(v_ids) then
    raise exception 'Solo el responsable asignado de Caja puede cerrar créditos abiertos de sus órdenes.';
  end if;
  return public.settle_credit_orders_before_cashier_assignment_gate(v_ids, p_notes, p_receipt_url);
end;
$$;

revoke all on function public.settle_credit_orders(uuid[], text, text) from public, anon;
grant execute on function public.settle_credit_orders(uuid[], text, text) to authenticated;

-- A database trigger closes direct table-update/admin-command bypasses. Invoice
-- numbers remain governed by invoice_assignment_mode, while payment status and
-- receipts are exclusively owned by the assigned Caja profile.
create or replace function public.guard_order_financial_write_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_credit_settlement boolean := false;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.payment_status, 'Pending_Payment') <> 'Pending_Payment'
       or new.invoice_payment is not null then
      raise exception 'Una orden nueva no puede incluir cambios de pago o comprobantes; Caja debe gestionarlos después de la asignación.';
    end if;
    return new;
  end if;
  if new.payment_status is not distinct from old.payment_status
     and new.invoice_payment is not distinct from old.invoice_payment
     and new.invoice_number is not distinct from old.invoice_number then
    return new;
  end if;

  select p.role into v_role from public.profiles p
  where p.id = v_actor and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_actor is null or v_role is null then
    raise exception 'No hay un usuario activo autorizado para modificar datos financieros.';
  end if;

  if new.payment_status is distinct from old.payment_status
     or new.invoice_payment is distinct from old.invoice_payment then
    v_credit_settlement := old.payment_status = 'credito'
      and new.payment_status = 'pagado'
      and old.status is not distinct from new.status;
    if v_role <> 'quote' or old.quote_id is distinct from v_actor
       or new.quote_id is distinct from v_actor
       or (not v_credit_settlement and (old.status <> 'in_Quote' or new.status <> 'in_Quote'))
       or old.status = 'cancelled' or new.status = 'cancelled'
       or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
       or coalesce(old.is_archived_admin, false) or coalesce(new.is_archived_admin, false)
       or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
      raise exception 'Solo el responsable asignado de Caja puede modificar el pago o comprobante.';
    end if;
  end if;

  if new.invoice_number is distinct from old.invoice_number then
    if coalesce(new.invoice_assignment_mode, old.invoice_assignment_mode, 'seller') = 'cashier' then
      if v_role <> 'quote' or old.quote_id is distinct from v_actor
         or new.quote_id is distinct from v_actor
         or old.status <> 'in_Quote' or new.status <> 'in_Quote'
         or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
         or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
        raise exception 'Solo la Caja asignada puede registrar este código de facturación.';
      end if;
    elsif coalesce(new.invoice_assignment_mode, old.invoice_assignment_mode, 'seller') = 'seller' then
      if v_role <> 'seller'
         or (old.seller_id is distinct from v_actor and old.created_by is distinct from v_actor)
         or (new.seller_id is distinct from v_actor and new.created_by is distinct from v_actor)
         or old.status not in ('Pending', 'pending') or new.status not in ('Pending', 'pending')
         or coalesce(old.is_archived, false) or coalesce(new.is_archived, false)
         or old.operational_status = 'blocked' or new.operational_status = 'blocked' then
        raise exception 'Solo Ventas responsable puede asignar el código cuando la factura pertenece a Ventas.';
      end if;
    else
      raise exception 'Responsabilidad de facturación inválida.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_order_financial_write_ownership on public.orders;
create trigger trg_guard_order_financial_write_ownership
before update of payment_status, invoice_payment, invoice_number on public.orders
for each row execute function public.guard_order_financial_write_ownership();
drop trigger if exists trg_guard_order_financial_insert_ownership on public.orders;
create trigger trg_guard_order_financial_insert_ownership
before insert on public.orders
for each row execute function public.guard_order_financial_write_ownership();
revoke all on function public.guard_order_financial_write_ownership() from public, anon, authenticated;

-- Keep the compatibility wrapper callable for non-financial admin actions,
-- while making every former Admin payment command fail closed.
alter function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text)
  rename to admin_execute_order_command_before_cashier_ownership;
revoke all on function public.admin_execute_order_command_before_cashier_ownership(uuid, text, jsonb, text, text, timestamptz, text)
  from public, anon, authenticated;

create function public.admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb, p_reason_category text,
  p_reason_detail text, p_expected_updated_at timestamptz, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo un administrador activo puede intervenir una orden.'; end if;
  if lower(coalesce(p_action, '')) in ('register_payment', 'set_payment', 'mark_credit', 'grant_credit', 'payment_operations') then
    raise exception 'Solo el responsable asignado de Caja puede gestionar pagos, comprobantes o crédito.';
  end if;
  return public.admin_execute_order_command_before_cashier_ownership(
    p_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_idempotency_key
  );
end;
$$;

revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text)
  from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text)
  to authenticated;
revoke all on function public.admin_execute_order_command_legacy(uuid, text, jsonb, text, text, timestamptz, text)
  from public, anon, authenticated;

-- Semi-Admin's old payment RPCs and command branch are no longer public.
alter function public.semi_admin_execute_order_command(uuid, text, jsonb, timestamptz)
  rename to semi_admin_execute_order_command_before_cashier_ownership;
revoke all on function public.semi_admin_execute_order_command_before_cashier_ownership(uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

create function public.semi_admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'semi_admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo Semi-Administración puede ejecutar operaciones operativas.'; end if;
  if lower(coalesce(p_action, '')) in ('register_payment', 'set_payment', 'mark_credit', 'grant_credit', 'payment_operations') then
    raise exception 'Solo el responsable asignado de Caja puede gestionar pagos, comprobantes o crédito.';
  end if;
  return public.semi_admin_execute_order_command_before_cashier_ownership(
    p_order_id, p_action, p_payload, p_expected_updated_at
  );
end;
$$;

revoke all on function public.semi_admin_execute_order_command(uuid, text, jsonb, timestamptz)
  from public, anon;
grant execute on function public.semi_admin_execute_order_command(uuid, text, jsonb, timestamptz)
  to authenticated;
revoke all on function public.semi_admin_register_order_payment(uuid, text, text, text, timestamptz),
  public.semi_admin_set_order_payment(uuid, text, text, timestamptz),
  public.semi_admin_mark_order_credit(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

-- The database catalog is the UI authority. Preserve unrelated operational
-- commands, remove financial actions, and expose routing to Semi-Admin only
-- when its functional responsibility matches the design type.
alter function public.semi_admin_get_order_command_catalog(uuid)
  rename to semi_admin_get_order_command_catalog_before_cashier_routing;
revoke all on function public.semi_admin_get_order_command_catalog_before_cashier_routing(uuid)
  from public, anon, authenticated;

create function public.semi_admin_is_order_routing_responsible(p_order_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id = auth.uid() and exists (
    select 1 from public.orders o join public.profiles p on p.id = p_actor_id
    where o.id = p_order_id and p.role = 'semi_admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
      and ((o.order_design_type = 'INTERNAL_DESING' and o.designer_id = p_actor_id)
        or (o.order_design_type = 'EXTERNAL_DESING' and (o.seller_id = p_actor_id or o.created_by = p_actor_id)))
  );
$$;
revoke all on function public.semi_admin_is_order_routing_responsible(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.can_send_order_to_production(
  p_order_id uuid, p_actor_id uuid default auth.uid()
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
begin
  if v_actor is null or p_actor_id is distinct from v_actor then return false; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or coalesce(v_order.is_archived, false) or coalesce(v_order.is_archived_admin, false)
     or coalesce(v_order.is_archived_quote, false) or coalesce(v_order.is_archived_designer, false)
     or coalesce(v_order.is_archived_production, false) or coalesce(v_order.is_archived_delivery, false)
     or v_order.operational_status = 'blocked' or v_order.status <> 'in_Quote'
     or v_order.payment_status not in ('pagado', 'parcial', 'credito')
     or v_order.production_authorized_at is null or v_order.production_authorized_by is null then
    return false;
  end if;
  select p.role into v_role from public.profiles p where p.id = v_actor
    and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_role = 'admin' then return true; end if;
  if v_role = 'designer' then return v_order.order_design_type = 'INTERNAL_DESING' and v_order.designer_id = v_actor; end if;
  if v_role = 'seller' then return v_order.order_design_type = 'EXTERNAL_DESING' and (v_order.seller_id = v_actor or v_order.created_by = v_actor); end if;
  if v_role = 'semi_admin' then return public.semi_admin_is_order_routing_responsible(p_order_id, v_actor); end if;
  return false;
end;
$$;

create or replace function public.semi_admin_route_order_to_production_v2(
  p_order_id uuid, p_area_assignments jsonb, p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'semi_admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo Semi-Administración puede ejecutar esta acción.'; end if;
  if jsonb_typeof(coalesce(p_area_assignments, '{}'::jsonb)) <> 'object' then
    raise exception 'Las asignaciones de Producción son inválidas.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not public.semi_admin_is_order_routing_responsible(p_order_id, v_actor) then
    raise exception 'Solo el responsable Semi-Admin de Diseño interno o Ventas externo puede rutear esta orden.';
  end if;
  if not public.can_send_order_to_production(p_order_id, v_actor) then
    raise exception 'La orden requiere pago elegible, autorización de Caja, archivos completos y responsabilidad vigente.';
  end if;
  return public.send_order_to_production(p_order_id, p_area_assignments);
end;
$$;

create function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_ready boolean;
begin
  v_catalog := public.semi_admin_get_order_command_catalog_before_cashier_routing(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  if not found then return v_catalog; end if;

  v_actions := coalesce(v_catalog->'actions', '[]'::jsonb);
  select coalesce(jsonb_agg(action.value), '[]'::jsonb) into v_actions
  from jsonb_array_elements(v_actions) action(value)
  where action.value->>'key' not in ('register_payment', 'set_payment', 'mark_credit', 'grant_credit', 'payment_operations', 'route_production');

  select exists (select 1 from public.order_production_files f where f.order_id = p_order_id)
    and not exists (
      select 1 from public.order_production_files f
      left join public.production_areas a on a.code = f.production_area_code and a.is_active = true
      where f.order_id = p_order_id and (a.code is null or coalesce(cardinality(f.material_names), 0) = 0
        or nullif(btrim(coalesce(f.termination_name, '')), '') is null)
    ) into v_ready;

  if not coalesce((v_catalog->>'locked')::boolean, false)
     and v_actor is not null
     and v_order.status = 'in_Quote'
     and v_order.payment_status in ('pagado', 'parcial', 'credito')
     and v_order.production_authorized_at is not null and v_order.production_authorized_by is not null
     and not coalesce(v_order.is_archived, false) and not coalesce(v_order.is_archived_admin, false)
     and not coalesce(v_order.is_archived_quote, false) and not coalesce(v_order.is_archived_designer, false)
     and not coalesce(v_order.is_archived_production, false) and not coalesce(v_order.is_archived_delivery, false)
     and v_order.operational_status is distinct from 'blocked'
     and v_ready
     and public.semi_admin_is_order_routing_responsible(p_order_id, v_actor) then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Enviar a Producción'));
  end if;
  v_catalog := jsonb_set(v_catalog, '{actions}', v_actions, true);
  return v_catalog;
end;
$$;

revoke all on function public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid) to authenticated;

create or replace function public.semi_admin_get_orders_command_catalog(p_order_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_allowed text;
  v_result jsonb := '{}'::jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'semi_admin'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo Semi-Administración puede consultar este catálogo.'; end if;
  if p_order_ids is null or cardinality(p_order_ids) > 100 then raise exception 'La lista debe contener hasta 100 órdenes.'; end if;
  if exists (select 1 from unnest(p_order_ids) requested(id) where requested.id is null) then raise exception 'La lista contiene un ID inválido.'; end if;
  if cardinality(p_order_ids) = 0 then return '{}'::jsonb; end if;

  for v_order_id in select distinct requested.id from unnest(p_order_ids) requested(id) order by requested.id loop
    select * into v_order from public.orders o where o.id = v_order_id
      and v_actor in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id);
    if not found then continue; end if;
    v_catalog := public.semi_admin_get_order_command_catalog(v_order.id);
    v_allowed := null;
    if v_order.status in ('Pending', 'pending') and v_order.order_design_type = 'INTERNAL_DESING'
       and v_order.designer_id = v_actor then v_allowed := 'send_to_designer';
    elsif v_order.status in ('Pending', 'pending') and v_order.order_design_type = 'EXTERNAL_DESING'
       and (v_order.seller_id = v_actor or v_order.created_by = v_actor) then v_allowed := 'send_to_quote';
    elsif v_order.status = 'in_Quote' and public.semi_admin_is_order_routing_responsible(v_order.id, v_actor) then
      v_allowed := 'route_production';
    end if;
    if v_allowed is null or coalesce((v_catalog->>'locked')::boolean, false) then continue; end if;
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key', action.value->'key', 'title', action.value->'title')) order by action.ordinality), '[]'::jsonb)
      into v_actions
    from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) with ordinality action(value, ordinality)
    where action.value->>'key' = v_allowed;
    if jsonb_array_length(v_actions) > 0 then
      v_result := jsonb_set(v_result, array[v_order.id::text], jsonb_build_object(
        'order_id', v_order.id, 'order_updated_at', v_order.updated_at, 'actions', v_actions
      ), true);
    end if;
  end loop;
  return v_result;
end;
$$;

revoke all on function public.semi_admin_get_orders_command_catalog(uuid[]) from public, anon;
grant execute on function public.semi_admin_get_orders_command_catalog(uuid[]) to authenticated;

-- Storage RLS has a wide historical reader, which is intentionally preserved.
-- Mutations now use a separate assigned-Caja predicate for all four write paths.
create or replace function public.can_write_payment_invoice_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o join public.profiles p on p.id = auth.uid()
    where o.id::text = (storage.foldername(object_name))[2]
      and object_name ~ ('^orders/' || o.id::text || '/payment-[^/]+$')
      and o.quote_id = auth.uid() and o.status = 'in_Quote'
      and not coalesce(o.is_archived, false) and not coalesce(o.is_archived_admin, false)
      and o.operational_status is distinct from 'blocked'
      and p.role = 'quote' and coalesce(p.employment_status, true) and p.deleted_at is null
  );
$$;
revoke all on function public.can_write_payment_invoice_path(text) from public, anon;
grant execute on function public.can_write_payment_invoice_path(text) to authenticated;

drop policy if exists payment_invoice_insert_authenticated on storage.objects;
create policy payment_invoice_insert_authenticated on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-invoice' and public.can_write_payment_invoice_path(name));
drop policy if exists payment_invoice_update_authenticated on storage.objects;
create policy payment_invoice_update_authenticated on storage.objects for update to authenticated
  using (bucket_id = 'payment-invoice' and public.can_write_payment_invoice_path(name))
  with check (bucket_id = 'payment-invoice' and public.can_write_payment_invoice_path(name));
drop policy if exists payment_invoice_delete_authenticated on storage.objects;
create policy payment_invoice_delete_authenticated on storage.objects for delete to authenticated
  using (bucket_id = 'payment-invoice' and public.can_write_payment_invoice_path(name));

-- Restrictive guards compose with any existing permissive policies so a broad
-- legacy Storage policy cannot authorize a non-Caja payment write.
drop policy if exists payment_invoice_insert_ownership_guard on storage.objects;
create policy payment_invoice_insert_ownership_guard on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'payment-invoice' or public.can_write_payment_invoice_path(name));
drop policy if exists payment_invoice_update_ownership_guard on storage.objects;
create policy payment_invoice_update_ownership_guard on storage.objects as restrictive for update to public
  using (bucket_id <> 'payment-invoice' or public.can_write_payment_invoice_path(name))
  with check (bucket_id <> 'payment-invoice' or public.can_write_payment_invoice_path(name));
drop policy if exists payment_invoice_delete_ownership_guard on storage.objects;
create policy payment_invoice_delete_ownership_guard on storage.objects as restrictive for delete to public
  using (bucket_id <> 'payment-invoice' or public.can_write_payment_invoice_path(name));

revoke all on function public.admin_execute_order_command_legacy(uuid, text, jsonb, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.semi_admin_execute_order_command_before_cashier_ownership(uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
