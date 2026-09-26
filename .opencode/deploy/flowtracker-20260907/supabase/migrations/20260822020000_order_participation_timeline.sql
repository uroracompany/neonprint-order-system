-- ============================================================
-- RPC: get_order_participation_timeline
-- Returns a chronological timeline of all users who participated
-- in an order: creation, assignments, production, delivery, etc.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_order_participation_timeline(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_timeline jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_actor_name text;
  v_event record;
  v_prod record;
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb;
  v_area_label text;
BEGIN
  -- Load order base data
  SELECT
    o.id, o.created_by, o.seller_id, o.designer_id, o.quote_id,
    o.delivery_id, o.status, o.created_at
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_order IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- 1. Order creation
  IF v_order.created_by IS NOT NULL THEN
    SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
    FROM public.profiles p WHERE p.id = v_order.created_by;

    v_timeline := v_timeline || jsonb_build_object(
      'role', 'seller',
      'role_label', 'Vendedor',
      'user_name', coalesce(v_actor_name, 'Desconocido'),
      'user_id', v_order.created_by,
      'action', 'Creó la orden',
      'timestamp', v_order.created_at,
      'metadata', '{}'::jsonb
    );
  END IF;

  -- 2. Walk order_events for assignments and status changes
  FOR v_event IN
    SELECT
      oe.id, oe.actor_id, oe.event_type, oe.old_status, oe.new_status,
      oe.changes, oe.created_at
    FROM public.order_events oe
    WHERE oe.order_id = p_order_id
      AND oe.event_type IN (
        'order_created', 'order_updated', 'admin_edited_order',
        'admin_intervention'
      )
    ORDER BY oe.created_at ASC
  LOOP
    v_changes := v_event.changes;
    v_old := v_changes -> 'old';
    v_new := v_changes -> 'new';

    -- Skip the initial creation event (already handled above)
    CONTINUE WHEN v_event.event_type = 'order_created';

    -- Detect designer assignment change
    IF v_old IS NOT NULL AND v_new IS NOT NULL
       AND (v_old ->> 'designer_id') IS DISTINCT FROM (v_new ->> 'designer_id')
       AND (v_new ->> 'designer_id') IS NOT NULL
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = (v_new ->> 'designer_id')::uuid;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'design',
        'role_label', 'Diseñador',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', (v_new ->> 'designer_id')::uuid,
        'action', 'Asignada a diseño',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect quote assignment change
    IF v_old IS NOT NULL AND v_new IS NOT NULL
       AND (v_old ->> 'quote_id') IS DISTINCT FROM (v_new ->> 'quote_id')
       AND (v_new ->> 'quote_id') IS NOT NULL
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = (v_new ->> 'quote_id')::uuid;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'quote',
        'role_label', 'Cotizador',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', (v_new ->> 'quote_id')::uuid,
        'action', 'Asignada a cotización',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect delivery assignment change
    IF v_old IS NOT NULL AND v_new IS NOT NULL
       AND (v_old ->> 'delivery_id') IS DISTINCT FROM (v_new ->> 'delivery_id')
       AND (v_new ->> 'delivery_id') IS NOT NULL
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = (v_new ->> 'delivery_id')::uuid;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'delivery',
        'role_label', 'Entrega',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', (v_new ->> 'delivery_id')::uuid,
        'action', 'Asignada a entrega',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect status change to in_Production
    IF (v_event.old_status IS DISTINCT FROM v_event.new_status)
       AND v_event.new_status = 'in_Production'
    THEN
      -- Get actor name
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_event.actor_id;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'production',
        'role_label', 'Producción',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_event.actor_id,
        'action', 'Orden enviada a producción',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect status change to in_Delivered
    IF (v_event.old_status IS DISTINCT FROM v_event.new_status)
       AND v_event.new_status = 'in_Delivered'
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_event.actor_id;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'delivery',
        'role_label', 'Entrega',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_event.actor_id,
        'action', 'Orden entregada',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect status change to in_Completed
    IF (v_event.old_status IS DISTINCT FROM v_event.new_status)
       AND v_event.new_status = 'in_Completed'
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_event.actor_id;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'production',
        'role_label', 'Producción',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_event.actor_id,
        'action', 'Orden completada',
        'timestamp', v_event.created_at,
        'metadata', '{}'::jsonb
      );
    END IF;

    -- Detect admin intervention
    IF v_event.event_type = 'admin_intervention'
       AND v_changes ? 'action'
    THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_event.actor_id;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'admin',
        'role_label', 'Administrador',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_event.actor_id,
        'action', 'Intervención admin: ' || coalesce(v_changes ->> 'action', 'acción'),
        'timestamp', v_event.created_at,
        'metadata', jsonb_build_object(
          'reason', v_changes ->> 'reason_label',
          'detail', v_changes ->> 'reason_detail'
        )
      );
    END IF;
  END LOOP;

  -- 3. Production file events
  FOR v_prod IN
    SELECT
      opf.id, opf.production_area_code, opf.assigned_to, opf.created_by,
      opf.status, opf.filename, opf.created_at
    FROM public.order_production_files opf
    WHERE opf.order_id = p_order_id
    ORDER BY opf.created_at ASC
  LOOP
    -- File added
    IF v_prod.created_by IS NOT NULL THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_prod.created_by;

      -- Get area label, falling back to the stored code when the area no longer exists.
      SELECT coalesce(
        (SELECT pa.label FROM public.production_areas pa
         WHERE pa.code = v_prod.production_area_code),
        v_prod.production_area_code
      ) INTO v_area_label;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'production',
        'role_label', 'Producción',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_prod.created_by,
        'action', 'Archivo agregado: ' || coalesce(v_prod.filename, 'sin nombre'),
        'timestamp', v_prod.created_at,
        'metadata', jsonb_build_object(
          'production_area', v_area_label,
          'filename', v_prod.filename,
          'status', v_prod.status
        )
      );
    END IF;

    -- File assigned to someone
    IF v_prod.assigned_to IS NOT NULL AND v_prod.assigned_to IS DISTINCT FROM v_prod.created_by THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_prod.assigned_to;

      SELECT coalesce(
        (SELECT pa.label FROM public.production_areas pa
         WHERE pa.code = v_prod.production_area_code),
        v_prod.production_area_code
      ) INTO v_area_label;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'production',
        'role_label', 'Producción',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_prod.assigned_to,
        'action', 'Archivo asignado: ' || coalesce(v_prod.filename, 'sin nombre'),
        'timestamp', v_prod.created_at,
        'metadata', jsonb_build_object(
          'production_area', v_area_label,
          'filename', v_prod.filename
        )
      );
    END IF;
  END LOOP;

  -- 4. Production area assignments
  FOR v_prod IN
    SELECT
      opa.production_area_code, opa.assigned_to, opa.assigned_by, opa.created_at
    FROM public.order_production_assignments opa
    WHERE opa.order_id = p_order_id
    ORDER BY opa.created_at ASC
  LOOP
    IF v_prod.assigned_to IS NOT NULL THEN
      SELECT coalesce(p.name, 'Usuario') INTO v_actor_name
      FROM public.profiles p WHERE p.id = v_prod.assigned_to;

      SELECT coalesce(
        (SELECT pa.label FROM public.production_areas pa
         WHERE pa.code = v_prod.production_area_code),
        v_prod.production_area_code
      ) INTO v_area_label;

      v_timeline := v_timeline || jsonb_build_object(
        'role', 'production',
        'role_label', 'Producción',
        'user_name', coalesce(v_actor_name, 'Desconocido'),
        'user_id', v_prod.assigned_to,
        'action', 'Asignado al área: ' || coalesce(v_area_label, v_prod.production_area_code),
        'timestamp', v_prod.created_at,
        'metadata', jsonb_build_object(
          'production_area', v_area_label,
          'assigned_by', v_prod.assigned_by
        )
      );
    END IF;
  END LOOP;

  -- Sort everything by timestamp ascending
  SELECT jsonb_agg(entry ORDER BY (entry ->> 'timestamp')::timestamptz ASC)
  INTO v_timeline
  FROM jsonb_array_elements(v_timeline) AS entry;

  RETURN coalesce(v_timeline, '[]'::jsonb);
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_order_participation_timeline(uuid) TO authenticated;
