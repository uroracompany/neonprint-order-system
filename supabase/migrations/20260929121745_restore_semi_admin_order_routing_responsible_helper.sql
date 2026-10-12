create or replace function public.semi_admin_is_order_routing_responsible(p_order_id uuid, p_actor_id uuid default auth.uid())
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

notify pgrst, 'reload schema';
