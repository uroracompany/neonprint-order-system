-- Presentation metadata is normalized at persistence time so Realtime and a
-- reload yield the same single notification, without creating a second row.
create or replace function public.normalize_operational_notification_presentation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_kind text := coalesce(new.metadata ->> 'event_kind', '');
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('actor_id', v_actor_id);
  end if;

  if v_event_kind = 'payment_updated' and coalesce(new.metadata ->> 'payment_status', '') = 'pagado' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('event_kind', 'payment_confirmed', 'variant', 'payment_confirmed');
    new.type := 'payment_confirmed'; new.title := 'Pago confirmado'; new.message := 'La orden fue marcada como pagada.';
  elsif v_event_kind in ('production_assigned', 'production_assignment_confirmation') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'event_kind', case when v_event_kind = 'production_assignment_confirmation' then 'production_routed_confirmation' else 'production_assigned' end,
      'variant', case when v_event_kind = 'production_assignment_confirmation' then 'success' else 'production_assignment' end
    );
    if v_event_kind = 'production_assignment_confirmation' then
      new.title := 'Orden enviada a Producción'; new.message := 'Orden enviada a producción exitosamente';
    else
      new.title := 'Asignación de Producción';
    end if;
  elsif v_event_kind = 'production_reassigned' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'production_reassignment');
    new.title := 'Producción reasignada';
  elsif v_event_kind in ('production_routed', 'production_routed_confirmation') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('event_kind', 'production_routed_confirmation', 'variant', 'success');
    new.title := 'Orden enviada a Producción';
  elsif v_event_kind in ('delivery_confirmed', 'delivery_delivered')
     or (v_event_kind = 'status_changed' and coalesce(new.metadata ->> 'status', '') = 'in_Delivered') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('event_kind', 'delivery_confirmed', 'variant', 'success');
    new.title := 'Entrega confirmada';
  elsif v_event_kind = 'designer_returned_to_sales' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'warning');
  end if;
  return new;
end;
$$;
-- PostgreSQL executes same-kind triggers alphabetically. This suffix keeps
-- trg_normalize_order_success_notification first, then applies the final operational
-- variant (notably Production orange) without creating another notification.
drop trigger if exists trg_normalize_operational_notification_presentation on public.notifications;
drop trigger if exists trg_zz_normalize_operational_notification_presentation on public.notifications;
create trigger trg_zz_normalize_operational_notification_presentation
before insert on public.notifications
for each row execute function public.normalize_operational_notification_presentation();
revoke all on function public.normalize_operational_notification_presentation() from public, anon, authenticated;
notify pgrst, 'reload schema';
