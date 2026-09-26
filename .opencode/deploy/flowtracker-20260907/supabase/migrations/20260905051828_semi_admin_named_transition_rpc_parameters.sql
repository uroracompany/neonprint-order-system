-- PostgREST resolves RPC payloads by argument name. The original wrappers were
-- positional-only, while the seller endpoint sends named JSON parameters.
-- Keep workflow enforcement in semi_admin_transition_order and expose only the
-- canonical parameter names expected by the callers.

create or replace function public.semi_admin_send_order_to_designer(
  p_order_id uuid,
  p_designer_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders language sql security definer set search_path = public as $$
  select public.semi_admin_transition_order(p_order_id, 'send_to_designer', p_designer_id, null, p_expected_updated_at)
$$;

create or replace function public.semi_admin_send_order_to_quote(
  p_order_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders language sql security definer set search_path = public as $$
  select public.semi_admin_transition_order(p_order_id, 'send_to_quote', p_quote_id, null, p_expected_updated_at)
$$;

create or replace function public.semi_admin_cancel_order(
  p_order_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
)
returns public.orders language sql security definer set search_path = public as $$
  select public.semi_admin_transition_order(p_order_id, 'cancel', null, p_reason, p_expected_updated_at)
$$;

create or replace function public.semi_admin_set_order_archive(
  p_order_id uuid,
  p_archived boolean,
  p_expected_updated_at timestamptz
)
returns public.orders language sql security definer set search_path = public as $$
  select public.semi_admin_transition_order(p_order_id, 'archive', null, null, p_expected_updated_at)
$$;

revoke all on function public.semi_admin_send_order_to_designer(uuid,uuid,timestamptz), public.semi_admin_send_order_to_quote(uuid,uuid,timestamptz), public.semi_admin_cancel_order(uuid,text,timestamptz), public.semi_admin_set_order_archive(uuid,boolean,timestamptz) from public, anon;
grant execute on function public.semi_admin_send_order_to_designer(uuid,uuid,timestamptz), public.semi_admin_send_order_to_quote(uuid,uuid,timestamptz), public.semi_admin_cancel_order(uuid,text,timestamptz), public.semi_admin_set_order_archive(uuid,boolean,timestamptz) to authenticated;
notify pgrst, 'reload schema';
