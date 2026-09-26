-- Payment confirmation and production authorization are deliberately separate.
-- A verified payment is financial evidence; the persisted authorization records
-- that Caja/Administración released that exact order for operational routing.

alter table public.orders
  add column if not exists production_authorized_at timestamptz,
  add column if not exists production_authorized_by uuid references public.profiles(id);

alter table public.orders
  drop constraint if exists orders_production_authorization_pair;
alter table public.orders
  add constraint orders_production_authorization_pair
  check ((production_authorized_at is null) = (production_authorized_by is null));

create or replace function public.order_has_confirmable_payment(
  p_order_id uuid,
  p_invoice_number text,
  p_invoice_payment text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(coalesce(p_invoice_number, '')), '') is not null
    and public.quote_has_uploaded_payment_receipt(p_order_id, p_invoice_payment);
$$;

-- Keep direct table writes from manufacturing a production approval. All normal
-- order commands set this transaction-local context after their authorization.
create or replace function public.enforce_production_authorization_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.production_authorized_at is distinct from old.production_authorized_at
     or new.production_authorized_by is distinct from old.production_authorized_by then
    if current_setting('app.neonprint_production_authorization', true) is distinct from 'on' then
      raise exception 'La autorización de Producción solo puede gestionarse mediante un comando autorizado.';
    end if;
  end if;

  -- A historical approval may never survive a payment reversal, an order
  -- cancellation/block, or moving out of Caja before it has been routed.
  if (old.payment_status in ('pagado', 'parcial', 'credito')
        and new.payment_status not in ('pagado', 'parcial', 'credito'))
      or new.status in ('cancelled', 'in_Delivered')
      or new.operational_status = 'blocked'
      -- Archiving is a deliberate pause of responsibility. A release must be
      -- reviewed again after restore, never silently revived from history.
      or (not coalesce(old.is_archived, false) and coalesce(new.is_archived, false))
      or (not coalesce(old.is_archived_admin, false) and coalesce(new.is_archived_admin, false))
      or (not coalesce(old.is_archived_designer, false) and coalesce(new.is_archived_designer, false))
      or (not coalesce(old.is_archived_quote, false) and coalesce(new.is_archived_quote, false))
      or (not coalesce(old.is_archived_production, false) and coalesce(new.is_archived_production, false))
      or (not coalesce(old.is_archived_delivery, false) and coalesce(new.is_archived_delivery, false))
      or (old.status = 'in_Quote' and new.status <> 'in_Quote' and new.status <> 'in_Production') then
    new.production_authorized_at := null;
    new.production_authorized_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_production_authorization_lifecycle on public.orders;
create trigger trg_enforce_production_authorization_lifecycle
before update of production_authorized_at, production_authorized_by, payment_status, status, operational_status,
  is_archived, is_archived_admin, is_archived_designer, is_archived_quote,
  is_archived_production, is_archived_delivery
on public.orders
for each row execute function public.enforce_production_authorization_lifecycle();

-- This existing lifecycle trigger is the last database line of defence for
-- every payment writer (including future ones): `pagado` always needs a stored
-- billing identifier and a verified image, regardless of who assigns the code.
create or replace function public.enforce_invoice_assignment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_mode text := nullif(lower(btrim(coalesce(current_setting('app.neonprint_invoice_assignment_mode', true), ''))), '');
  v_is_cashier boolean;
  v_has_code boolean;
  v_is_admin boolean := public.current_profile_is_admin();
begin
  if tg_op = 'INSERT' and v_requested_mode in ('seller', 'cashier') then
    new.invoice_assignment_mode := v_requested_mode;
  end if;
  if coalesce(new.invoice_assignment_mode, 'seller') not in ('seller', 'cashier') then
    raise exception 'Responsabilidad de facturación inválida.';
  end if;
  if tg_op = 'UPDATE' and new.invoice_assignment_mode is distinct from old.invoice_assignment_mode and not v_is_admin then
    raise exception 'Solo Administración puede cambiar la responsabilidad de facturación.';
  end if;

  v_is_cashier := public.order_requires_invoice_code(new.invoice_assignment_mode);
  v_has_code := nullif(btrim(coalesce(new.invoice_number, '')), '') is not null;
  if tg_op = 'INSERT' and not v_is_cashier and not v_has_code then
    raise exception 'El número de facturación es requerido.';
  end if;

  if new.payment_status = 'pagado'
     and not public.order_has_confirmable_payment(new.id, new.invoice_number, new.invoice_payment) then
    raise exception 'Para marcar la orden como pagada debes registrar el código de facturación y adjuntar un comprobante de imagen verificado.';
  end if;
  if v_is_cashier and new.payment_status = 'credito' and not v_has_code then
    raise exception 'Caja debe registrar el código de facturación antes de aprobar crédito.';
  end if;
  if v_is_cashier and new.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered') and not v_has_code then
    raise exception 'Caja debe registrar el código de facturación antes de continuar la orden.';
  end if;
  return new;
end;
$$;

create or replace function public.quote_set_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_invoice_payment text := nullif(btrim(coalesce(p_invoice_payment, '')), '');
begin
  select role into v_role from public.profiles where id = v_actor and coalesce(employment_status, true) and deleted_at is null;
  if v_actor is null or v_role not in ('quote', 'admin') then raise exception 'Solo Caja puede actualizar pagos'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (v_role <> 'admin' and v_order.quote_id is distinct from v_actor)
     or v_order.status <> 'in_Quote' or coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
    raise exception 'No tienes acceso a esta orden';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado') then raise exception 'Estado de pago invalido'; end if;
  if (v_order.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado'))
     or (v_order.payment_status = 'pagado' and p_payment_status <> 'pagado')
     or v_order.payment_status = 'credito' then raise exception 'Transicion de pago no permitida'; end if;

  v_invoice_payment := coalesce(v_invoice_payment, v_order.invoice_payment);
  if p_payment_status = 'pagado'
     and not public.order_has_confirmable_payment(p_order_id, v_order.invoice_number, v_invoice_payment) then
    raise exception 'Para marcar la orden como pagada debes registrar el código de facturación y adjuntar un comprobante de imagen verificado.';
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    payment_status = p_payment_status,
    invoice_payment = case when p_payment_status = 'parcial' then null when p_payment_status = 'pagado' then v_invoice_payment else coalesce(v_invoice_payment, invoice_payment) end,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_updated;
  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_actor, 'payment_confirmed', v_order.payment_status, v_updated.payment_status,
    jsonb_build_object('invoice_number', v_updated.invoice_number, 'receipt_verified', p_payment_status = 'pagado'));
  return v_updated;
end;
$$;

create or replace function public.semi_admin_register_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_invoice_number text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_invoice_payment text;
  v_invoice_number text;
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status <> 'in_Quote' then raise exception 'La orden no está disponible para actualizar el pago.'; end if;
  if v_old.designer_id is distinct from v_actor and v_old.quote_id is distinct from v_actor and v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor then raise exception 'Debes ser responsable de Diseño/Caja o creador de la orden para gestionar el pago.'; end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado', 'credito') then raise exception 'Selecciona un estado de pago válido.'; end if;
  if v_old.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado') then raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.'; end if;
  if v_old.payment_status = 'credito' and p_payment_status not in ('credito', 'pagado') then raise exception 'Una orden a crédito solo puede mantenerse a crédito o cambiarse a pagado mediante un cierre registrado.'; end if;
  v_invoice_payment := coalesce(nullif(btrim(coalesce(p_invoice_payment, '')), ''), v_old.invoice_payment);
  v_invoice_number := coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), v_old.invoice_number);
  if p_payment_status = 'pagado'
     and not public.order_has_confirmable_payment(p_order_id, v_invoice_number, v_invoice_payment) then
    raise exception 'Para marcar la orden como pagada debes registrar el código de facturación y adjuntar un comprobante de imagen verificado.';
  end if;
  if p_payment_status = 'credito' and (v_old.client_id is null or nullif(btrim(coalesce(v_invoice_number, '')), '') is null) then raise exception 'Para vender a crédito debes registrar cliente y factura.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set payment_status = p_payment_status,
    invoice_payment = case when p_payment_status in ('Pending_Payment', 'parcial', 'credito') then null else v_invoice_payment end,
    invoice_number = v_invoice_number, updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_actor, 'semi_admin_payment_updated', v_old.payment_status, v_new.payment_status,
    jsonb_build_object('invoice_number', v_new.invoice_number, 'receipt_verified', p_payment_status = 'pagado'));
  return v_new;
end;
$$;

create or replace function public.authorize_order_for_production(
  p_order_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  select role into v_role from public.profiles where id = v_actor and coalesce(employment_status, true) and deleted_at is null;
  if v_actor is null or v_role not in ('quote', 'admin') then raise exception 'Solo Caja o Administración pueden autorizar Producción.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_role <> 'admin' and v_order.quote_id is distinct from v_actor then raise exception 'Solo la Caja responsable puede autorizar esta orden.'; end if;
  if v_order.status <> 'in_Quote'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_admin, false)
     or coalesce(v_order.is_archived_designer, false)
     or coalesce(v_order.is_archived_quote, false)
     or coalesce(v_order.is_archived_production, false)
     or coalesce(v_order.is_archived_delivery, false)
     or v_order.operational_status = 'blocked' then
    raise exception 'La orden no está disponible para autorizar Producción.';
  end if;
  if v_order.payment_status not in ('pagado', 'parcial', 'credito') then raise exception 'El pago debe estar pagado, parcial o a crédito antes de autorizar Producción.'; end if;
  if v_order.payment_status = 'pagado'
     and not public.order_has_confirmable_payment(v_order.id, v_order.invoice_number, v_order.invoice_payment) then
    raise exception 'El pago confirmado requiere código de facturación y comprobante de imagen verificado.';
  end if;
  if not exists (
    select 1
    from public.order_production_files opf
    join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active = true
    where opf.order_id = p_order_id
  ) then
    raise exception 'La orden requiere al menos un archivo clasificado en un área de Producción activa antes de autorizarla.';
  end if;
  if exists (
    select 1
    from public.order_production_files opf
    left join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active = true
    where opf.order_id = p_order_id
      and (
        pa.code is null
        or coalesce(cardinality(opf.material_names), 0) = 0
        or nullif(btrim(coalesce(opf.termination_name, '')), '') is null
      )
  ) then
    raise exception 'Cada archivo requiere área activa, materiales y terminación válidos antes de autorizar Producción.';
  end if;
  if v_order.production_authorized_at is not null then return v_order; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.neonprint_production_authorization', 'on', true);
  update public.orders set production_authorized_at = now(), production_authorized_by = v_actor, updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_updated;
  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (p_order_id, v_actor, 'production_authorized', jsonb_build_object('payment_status', v_updated.payment_status));
  perform public.notify_many(
    array_remove(array[
      case when v_updated.order_design_type = 'INTERNAL_DESING' then v_updated.designer_id else null end,
      case when v_updated.order_design_type = 'EXTERNAL_DESING' then coalesce(v_updated.seller_id, v_updated.created_by) else null end,
      v_actor
    ], null),
    'order_assigned', 'Orden autorizada para Producción',
    'La orden #' || substring(p_order_id::text, 1, 8) || ' fue autorizada y está lista para que el responsable operativo la envíe a Producción.', p_order_id,
    jsonb_build_object('event_kind', 'production_authorized', 'status', v_updated.status, 'authorized_by', v_actor)
  );
  return v_updated;
end;
$$;

create or replace function public.can_send_order_to_production(
  p_order_id uuid,
  p_actor_id uuid default auth.uid()
) returns boolean
language plpgsql security definer set search_path = public stable as $$
declare v_actor uuid := auth.uid(); v_role text; v_order public.orders;
begin
  if v_actor is null or p_actor_id is distinct from v_actor then return false; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found or coalesce(v_order.is_archived, false) or coalesce(v_order.is_archived_quote, false)
     or coalesce(v_order.is_archived_designer, false) or v_order.operational_status = 'blocked'
     or v_order.status <> 'in_Quote' or v_order.payment_status not in ('pagado', 'parcial', 'credito')
     or v_order.production_authorized_at is null or v_order.production_authorized_by is null then return false; end if;
  select p.role into v_role from public.profiles p where p.id = v_actor and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_role = 'admin' then return true; end if;
  if v_role = 'designer' then return v_order.order_design_type = 'INTERNAL_DESING' and v_order.designer_id = v_actor; end if;
  if v_role = 'seller' then return v_order.order_design_type = 'EXTERNAL_DESING' and (v_order.seller_id = v_actor or v_order.created_by = v_actor); end if;
  if v_role = 'semi_admin' then return public.semi_admin_can_operate_stage(p_order_id, 'quote', null); end if;
  return false;
end;
$$;

-- Sales may only hand internal-design work to Design. The visible row/card
-- action is therefore protected by the same database boundary.
create or replace function public.seller_send_order_to_designer(
  p_order_id uuid, p_designer_id uuid, p_expected_updated_at timestamptz
)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true) and deleted_at is null) then raise exception 'Solo Ventas puede enviar a Diseño.'; end if;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden.'; end if;
  if v_order.order_design_type <> 'INTERNAL_DESING' then raise exception 'Solo las órdenes de Diseño Interno pueden enviarse a Diseño.'; end if;
  if v_order.status <> 'Pending' or p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status='blocked' then raise exception 'La orden no está disponible para Diseño.'; end if;
  if not exists (select 1 from public.profiles where id=p_designer_id and role='designer' and coalesce(employment_status,true) and deleted_at is null) then raise exception 'Diseñador no disponible.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Design',designer_id=p_designer_id,return_reason=null,returned_to_designer_at=null,updated_at=now(),updated_by=v_actor where id=p_order_id returning * into v_updated;
  insert into public.order_events(order_id,actor_id,event_type,old_status,new_status,changes) values(p_order_id,v_actor,'seller_sent_to_design','Pending','in_Design',jsonb_build_object('designer_id',p_designer_id));
  return v_updated;
end;
$$;

-- Explicit implementation replaces the prior fragile pg_get_functiondef patch.
create or replace function public.send_order_to_production(p_order_id uuid, p_area_assignments jsonb)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_profile_role text; v_area_assignments jsonb := coalesce(p_area_assignments, '{}'::jsonb);
  v_area record; v_extra_area text; v_assigned_user_id uuid; v_assignment_id uuid; v_order public.orders;
  classified_count integer; unclassified_count integer; participating_area_count integer; updated_order public.orders;
begin
  if v_uid is null then raise exception 'No tienes una sesión activa.'; end if;
  select p.role into v_profile_role from public.profiles p where p.id = v_uid and coalesce(p.employment_status, true);
  if v_profile_role is null or v_profile_role not in ('admin', 'designer', 'seller', 'semi_admin') then raise exception 'Este rol no puede enviar órdenes a Producción.'; end if;
  if jsonb_typeof(v_area_assignments) <> 'object' then raise exception 'Las asignaciones de Producción son inválidas.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if not public.can_send_order_to_production(p_order_id, v_uid) then raise exception 'La orden requiere autorización vigente de Caja o Administración antes de enviarse a Producción.'; end if;
  if v_order.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled') then raise exception 'Esta orden no está en un estado válido para enviarse a Producción.'; end if;
  select count(*) filter (where production_area_code is not null), count(*) filter (where production_area_code is null) into classified_count, unclassified_count from public.order_production_files where order_id = p_order_id;
  if coalesce(classified_count, 0) = 0 then raise exception 'La orden no tiene archivos clasificados para Producción.'; end if;
  if coalesce(unclassified_count, 0) > 0 then raise exception 'Todos los archivos deben tener tipo de Producción antes de enviar.'; end if;
  if exists (select 1 from public.order_production_files opf left join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active = true where opf.order_id = p_order_id and (pa.code is null or coalesce(cardinality(opf.material_names),0)=0 or nullif(btrim(coalesce(opf.termination_name,'')),'') is null)) then raise exception 'Cada archivo requiere área, materiales y terminación válidos antes de enviarse a Producción.'; end if;
  select count(distinct opf.production_area_code) into participating_area_count from public.order_production_files opf join public.production_areas pa on pa.code=opf.production_area_code and pa.is_active=true where opf.order_id=p_order_id and opf.production_area_code is not null;
  if coalesce(participating_area_count,0)=0 then raise exception 'La orden no tiene áreas activas para Producción.'; end if;
  select key into v_extra_area from jsonb_object_keys(v_area_assignments) as provided(key) where not exists (select 1 from public.order_production_files opf join public.production_areas pa on pa.code=opf.production_area_code and pa.is_active=true where opf.order_id=p_order_id and opf.production_area_code=provided.key) limit 1;
  if v_extra_area is not null then raise exception 'El área % no participa en esta orden.', v_extra_area; end if;
  for v_area in select distinct pa.code, pa.label, pa.producer_role from public.order_production_files opf join public.production_areas pa on pa.code=opf.production_area_code and pa.is_active=true where opf.order_id=p_order_id and opf.production_area_code is not null order by pa.code loop
    if not (v_area_assignments ? v_area.code) then raise exception 'Debes asignar un responsable para el área %.', v_area.label; end if;
    begin v_assigned_user_id := nullif(btrim(v_area_assignments ->> v_area.code),'')::uuid; exception when invalid_text_representation then raise exception 'El responsable seleccionado para el área % no es válido.', v_area.label; end;
    if v_assigned_user_id is null or not exists (select 1 from public.profiles p where p.id=v_assigned_user_id and p.role=v_area.producer_role and coalesce(p.employment_status,true)) then raise exception 'El responsable seleccionado para el área % no está activo o no pertenece a esa área.', v_area.label; end if;
    insert into public.order_production_assignments(order_id,production_area_code,assigned_to,assigned_by) values(p_order_id,v_area.code,v_assigned_user_id,v_uid)
    on conflict(order_id,production_area_code) do update set assigned_to=excluded.assigned_to,assigned_by=excluded.assigned_by,updated_at=now() returning id into v_assignment_id;
    perform public.notify_many(array[v_assigned_user_id], 'order_assigned', 'Nueva orden de producción', 'La orden #'||substring(p_order_id::text,1,8)||' de '||coalesce(v_order.client_name,'cliente')||' fue asignada a tu área de '||coalesce(v_area.label,v_area.code)||'.', p_order_id, jsonb_build_object('event_kind','production_assigned','production_area_code',v_area.code,'assignment_id',v_assignment_id,'assigned_by',v_uid,'status','in_Production'));
  end loop;
  delete from public.order_production_assignments opa where opa.order_id=p_order_id and not exists(select 1 from public.order_production_files opf where opf.order_id=opa.order_id and opf.production_area_code=opa.production_area_code);
  update public.order_production_files opf set status=case when opf.status='pending' then 'in_production' else opf.status end, started_at=case when opf.status='pending' then coalesce(opf.started_at,now()) else opf.started_at end, assigned_to=opa.assigned_to, updated_by=v_uid from public.order_production_assignments opa where opf.order_id=p_order_id and opa.order_id=opf.order_id and opa.production_area_code=opf.production_area_code;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Production', production_id=null, updated_at=now() where id=p_order_id returning * into updated_order;
  insert into public.order_events(order_id,actor_id,event_type,old_status,new_status,changes) values(p_order_id,v_uid,'production_routed','in_Quote','in_Production',jsonb_build_object('authorized_by',v_order.production_authorized_by));
  perform public.notify_many(array[v_uid], 'order_assigned','Orden enviada a Producción','La orden #'||substring(p_order_id::text,1,8)||' fue enviada a Producción.',p_order_id,jsonb_build_object('event_kind','production_routed','status','in_Production'));
  return updated_order;
end;
$$;

-- Protect the active admin public entrypoint without relying on the legacy
-- compatibility engine for payment writes. Other commands keep delegating.
create or replace function public.admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb, p_reason_category text,
  p_reason_detail text, p_expected_updated_at timestamptz, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_existing jsonb; v_order public.orders%rowtype; v_new public.orders%rowtype; v_result jsonb; v_hash text;
begin
  perform 1 from public.profiles p where p.id=v_actor and p.role='admin' and coalesce(p.employment_status,true) and p.deleted_at is null for share;
  if v_actor is null or not found then raise exception 'Solo un administrador activo puede intervenir una orden.'; end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null or char_length(btrim(coalesce(p_reason_detail,''))) not between 10 and 500 then raise exception 'El motivo de intervención no es válido.'; end if;
  if p_action <> 'register_payment' then return public.admin_execute_order_command_legacy(p_order_id,p_action,p_payload,p_reason_category,p_reason_detail,p_expected_updated_at,p_idempotency_key); end if;
  select result into v_existing from public.admin_order_command_executions where idempotency_key=p_idempotency_key;
  if found then if v_existing is null then raise exception 'El comando ya está en proceso.'; end if; return v_existing; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.status <> 'in_Quote' or coalesce(v_order.is_archived,false) or v_order.operational_status='blocked' then raise exception 'La orden no está disponible para registrar el pago.'; end if;
  if p_payload->>'payment_status' not in ('Pending_Payment','parcial','pagado') then raise exception 'Selecciona un estado de pago válido.'; end if;
  if p_payload->>'payment_status'='pagado' and not public.order_has_confirmable_payment(p_order_id,coalesce(nullif(btrim(p_payload->>'invoice_number'),''),v_order.invoice_number),coalesce(nullif(btrim(p_payload->>'invoice_payment'),''),v_order.invoice_payment)) then raise exception 'Para marcar la orden como pagada debes registrar el código de facturación y adjuntar un comprobante de imagen verificado.'; end if;
  v_hash := md5(concat_ws('|',p_order_id::text,p_action,coalesce(p_payload,'{}'::jsonb)::text,p_reason_category,p_reason_detail));
  insert into public.admin_order_command_executions(idempotency_key,order_id,actor_id,action,request_hash) values(p_idempotency_key,p_order_id,v_actor,p_action,v_hash);
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status=p_payload->>'payment_status', invoice_payment=case when p_payload->>'payment_status'='pagado' then coalesce(nullif(btrim(p_payload->>'invoice_payment'),''),invoice_payment) when p_payload->>'payment_status'='parcial' then null else invoice_payment end, invoice_number=coalesce(nullif(btrim(p_payload->>'invoice_number'),''),invoice_number),updated_at=now(),updated_by=v_actor,last_admin_intervention_at=now(),last_admin_intervention_by=v_actor,last_admin_intervention_kind=p_action where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id,actor_id,event_type,old_payment_status,new_payment_status,changes) values(p_order_id,v_actor,'payment_confirmed',v_order.payment_status,v_new.payment_status,jsonb_build_object('invoice_number',v_new.invoice_number,'receipt_verified',v_new.payment_status='pagado'));
  perform public.record_admin_intervention(v_order,v_new,p_action,p_reason_category,btrim(p_reason_detail),clock_timestamp(),null);
  v_result := jsonb_build_object('order',to_jsonb(v_new),'action',p_action,'success',true);
  update public.admin_order_command_executions set result=v_result,completed_at=now() where idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.order_has_confirmable_payment(uuid,text,text), public.authorize_order_for_production(uuid,timestamptz) from public, anon;
grant execute on function public.authorize_order_for_production(uuid,timestamptz) to authenticated;
revoke all on function public.can_send_order_to_production(uuid,uuid), public.send_order_to_production(uuid,jsonb) from public, anon;
grant execute on function public.can_send_order_to_production(uuid,uuid), public.send_order_to_production(uuid,jsonb) to authenticated;
grant execute on function public.seller_send_order_to_designer(uuid,uuid,timestamptz) to authenticated;
revoke all on function public.quote_set_order_payment(uuid,text,text,timestamptz), public.semi_admin_register_order_payment(uuid,text,text,text,timestamptz), public.admin_execute_order_command(uuid,text,jsonb,text,text,timestamptz,text) from public, anon;
grant execute on function public.quote_set_order_payment(uuid,text,text,timestamptz), public.admin_execute_order_command(uuid,text,jsonb,text,text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
