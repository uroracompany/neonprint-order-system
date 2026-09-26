-- Align the Semi-Admin action catalogue with the effective RPC gates.
-- This migration is intentionally forward-only: it does not broaden the
-- underlying delivery RPC or change production/payment permissions.

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_unavailable jsonb;
  v_quote_responsible boolean;
  v_delivery_responsible boolean;
  v_payment_status text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  v_catalog := public.semi_admin_get_order_command_catalog_base(p_order_id);
  if coalesce((v_catalog->>'locked')::boolean, false) then return v_catalog; end if;

  -- Quote actions remain stage-specific. Delivery participation must not grant
  -- payment or quote-return authority merely because it is a valid participant.
  v_quote_responsible := v_order.designer_id = v_actor
    or v_order.quote_id = v_actor
    or v_order.seller_id = v_actor
    or v_order.created_by = v_actor;

  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
  from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
  where action->>'key' not in ('register_payment', 'grant_credit');

  select coalesce(jsonb_agg(action), '[]'::jsonb) into v_unavailable
  from jsonb_array_elements(coalesce(v_catalog->'unavailable_actions', '[]'::jsonb)) action;

  if v_order.status = 'in_Quote' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' not in (
      'manage_specifications', 'manage_design_assets', 'production_file_status',
      'reassign_production_file', 'manage_production', 'stage_responsibility',
      'return_quote_to_design'
    )
    and (v_order.payment_status in ('pagado', 'parcial', 'credito') or action->>'key' <> 'route_production');

    if v_quote_responsible
       and not coalesce(v_order.is_archived, false)
       and v_order.operational_status is distinct from 'blocked' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'register_payment', 'title', 'Gestionar pago'));
      if v_order.payment_status = 'Pending_Payment' then
        v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'stage_responsibility', 'title', 'Cambiar responsable de Caja'));
        if v_order.designer_id is not null then
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'return_quote_to_design', 'title', 'Regresar a Diseño'));
        else
          v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
            'key', 'return_quote_to_design',
            'title', 'Regresar a Diseño',
            'next_safe_step', 'Asigna un diseñador antes de regresar la orden.'
          ));
        end if;
      end if;
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'payment_operations',
        'title', 'Gestión de pago',
        'next_safe_step', 'Solo el responsable de Caja, vendedor, diseñador o creador puede gestionar esta etapa.'
      ));
    end if;

    if v_order.payment_status = 'Pending_Payment' then
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'route_production',
        'title', 'Preparación para Producción',
        'next_safe_step', 'Registra el pago antes de preparar el envío a Producción.'
      ));
    end if;

  elsif v_catalog->>'active_stage' = 'delivery' then
    -- The delivery RPC checks both stage/payment and delivery_id. Mirror the
    -- same gate in the catalogue so an unauthorized button is never shown.
    select payment_status into v_payment_status from public.orders where id = p_order_id;
    v_delivery_responsible := v_order.delivery_id = v_actor;

    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(coalesce(v_actions, '[]'::jsonb)) action
    where action->>'key' <> 'mark_delivered';

    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_unavailable
    from jsonb_array_elements(coalesce(v_unavailable, '[]'::jsonb)) action
    where action->>'key' <> 'delivery_operations';

    if v_payment_status in ('pagado', 'credito') and v_delivery_responsible then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
    elsif not v_delivery_responsible then
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'delivery_operations',
        'title', 'Acciones de Entrega',
        'next_safe_step', 'Solo el responsable asignado a Entrega puede confirmar esta orden.'
      ));
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
        'key', 'delivery_operations',
        'title', 'Acciones de Entrega',
        'next_safe_step', 'La orden debe estar pagada o a crédito antes de entregarse.'
      ));
    end if;

  elsif v_catalog->>'active_stage' = 'production' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
    from jsonb_array_elements(v_actions) action
    where action->>'key' not in ('stage_responsibility', 'reassign_production_file', 'manage_production', 'production_file_status');
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object(
      'key', 'production_operations',
      'title', 'Producción',
      'next_safe_step', 'Producción se gestiona exclusivamente por el operador asignado.'
    ));
  end if;

  -- Asset participation intentionally uses the canonical helper, which covers
  -- created_by, seller_id, designer_id, quote_id and delivery_id.
  if public.semi_admin_can_manage_order_assets(p_order_id)
     and not exists (
       select 1 from jsonb_array_elements(coalesce(v_actions, '[]'::jsonb)) action
       where action->>'key' = 'manage_design_assets'
     ) then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'key', 'manage_design_assets',
      'title', 'Gestionar diseños y archivos'
    ));
  end if;

  return jsonb_set(
    jsonb_set(v_catalog, '{actions}', coalesce(v_actions, '[]'::jsonb), true),
    '{unavailable_actions}',
    coalesce(v_unavailable, '[]'::jsonb),
    true
  );
end;
$$;

revoke all on function public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid) to authenticated;

notify pgrst, 'reload schema';
