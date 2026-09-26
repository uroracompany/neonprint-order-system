-- Polish advanced Admin order UX without changing stored order data.
-- 1) Keep admin review/notification values user-facing.
-- 2) Avoid leaking UUIDs/internal enum keys in future order messages.

create or replace function public.admin_order_profile_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(trim(coalesce(p.name, p.email, '')), '')
      from public.profiles p
      where p.id = p_user_id
      limit 1
    ),
    case when p_user_id is null then null else 'Usuario no disponible' end
  )
$$;

create or replace function public.admin_order_edit_value(
  p_order public.orders,
  p_field text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with assignment_values(sort_order, value) as (
    values
      (1, case when p_order.designer_id is not null then 'Diseño: ' || public.admin_order_profile_name(p_order.designer_id) end),
      (2, case when p_order.quote_id is not null then 'Caja: ' || public.admin_order_profile_name(p_order.quote_id) end),
      (3, case when p_order.production_id is not null then 'Producción: ' || public.admin_order_profile_name(p_order.production_id) end),
      (4, case when p_order.delivery_id is not null then 'Entrega: ' || public.admin_order_profile_name(p_order.delivery_id) end)
  )
  select case
    when p_field = 'client' then nullif(concat_ws(' / ', p_order.client_name, p_order.client_contact), '')
    when p_field = 'invoice_number' then p_order.invoice_number
    when p_field = 'description' then p_order.description
    when p_field = 'material' then p_order.material
    when p_field = 'termination_type' then p_order.termination_type
    when p_field = 'delivery_date' then p_order.delivery_date::text
    when p_field = 'files' then 'Archivos de la orden'
    when p_field = 'order_file_url' then
      case
        when nullif(p_order.order_file_url, '') is null then 'Sin archivos adjuntos'
        else 'Archivos adjuntos cargados'
      end
    when p_field = 'preview_image' then
      case
        when nullif(p_order.preview_image, '') is null then 'Sin preview'
        else 'Preview cargado'
      end
    when p_field = 'reference_images' then
      case
        when jsonb_array_length(coalesce(p_order.reference_images, '[]'::jsonb)) = 0 then 'Sin imagenes de referencia'
        else 'Imagenes de referencia cargadas'
      end
    when p_field = 'status' then case p_order.status
      when 'Pending' then 'Pendiente'
      when 'in_Design' then 'Diseño'
      when 'in_Quote' then 'Caja'
      when 'in_Production' then 'Producción'
      when 'in_Termination' then 'Terminación'
      when 'in_Delivered' then 'Entregado'
      when 'in_Completed' then 'Completada'
      when 'cancelled' then 'Cancelada'
      else coalesce(p_order.status, 'Sin estado')
    end
    when p_field in ('payment', 'payment_status') then case lower(coalesce(p_order.payment_status, ''))
      when 'pending_payment' then 'Pendiente'
      when 'pending payment' then 'Pendiente'
      when 'pendiente' then 'Pendiente'
      when 'parcial' then 'Pago parcial'
      when 'pagado' then 'Pagado'
      when 'paid' then 'Pagado'
      when 'credito' then 'Pago a crédito'
      when 'crédito' then 'Pago a crédito'
      when 'credit' then 'Pago a crédito'
      else 'Estado de pago no disponible'
    end
    when p_field = 'order_design_type' then case p_order.order_design_type
      when 'INTERNAL_DESING' then 'Diseño interno'
      when 'EXTERNAL_DESING' then 'Diseño externo'
      else coalesce(p_order.order_design_type, 'Sin tipo de diseño')
    end
    when p_field = 'assignment' then coalesce(
      (
        select nullif(string_agg(value, ' / ' order by sort_order), '')
        from assignment_values
        where value is not null
      ),
      'Sin responsable'
    )
    when p_field = 'workflow_note' then coalesce(p_order.return_reason, p_order.cancellation_reason)
    else null
  end
$$;

revoke all on function public.admin_order_profile_name(uuid) from public, anon, authenticated;
revoke all on function public.admin_order_edit_value(public.orders, text) from public, anon, authenticated;
