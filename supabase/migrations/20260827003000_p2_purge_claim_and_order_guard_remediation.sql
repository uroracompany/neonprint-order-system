-- P2: close the retention-claim race and make the order command guard effective.
-- This migration is forward-only and depends on P0/P1.

alter table public.order_purge_audit drop constraint if exists order_purge_audit_status_check;
alter table public.order_purge_audit add constraint order_purge_audit_status_check
  check (purge_status in ('claimed', 'storage_deleted', 'failed', 'purged', 'skipped_storage_error'));

update public.order_purge_audit
set purge_status = 'failed', phase = 'failed', claim_token = null, claim_expires_at = null
where purge_status = 'skipped_storage_error';

-- SECURITY DEFINER sees its owner as current_user, so this guard must be based
-- solely on the transaction-local authorization flag set by approved commands.
create or replace function public.guard_orders_direct_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Generic table UPDATE is revoked for authenticated users. The active admin
  -- command family predates P0/P1 and is itself SECURITY DEFINER, audited and
  -- version-checked; retain that explicit privileged command path while every
  -- other actor must carry the local command flag.
  if current_setting('app.neonprint_order_command', true) is distinct from 'on'
     and not public.current_profile_is_admin()
     and (
       new.created_by is distinct from old.created_by or new.seller_id is distinct from old.seller_id
       or new.designer_id is distinct from old.designer_id or new.quote_id is distinct from old.quote_id
       or new.production_id is distinct from old.production_id or new.delivery_id is distinct from old.delivery_id
       or new.status is distinct from old.status or new.payment_status is distinct from old.payment_status
       or new.invoice_payment is distinct from old.invoice_payment or new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name or new.client_contact is distinct from old.client_contact
       or new.invoice_number is distinct from old.invoice_number or new.description is distinct from old.description
       or new.material is distinct from old.material or new.termination_type is distinct from old.termination_type
       or new.order_type is distinct from old.order_type or new.order_design_type is distinct from old.order_design_type
       or new.delivery_date is distinct from old.delivery_date or new.order_file_url is distinct from old.order_file_url
       or new.preview_image is distinct from old.preview_image or new.reference_images is distinct from old.reference_images
       or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_from_status is distinct from old.cancelled_from_status
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
       or new.return_reason is distinct from old.return_reason or new.returned_to_designer_at is distinct from old.returned_to_designer_at
       or new.delivery_note is distinct from old.delivery_note or new.operational_status is distinct from old.operational_status
       or new.blocked_reason_category is distinct from old.blocked_reason_category or new.blocked_reason_detail is distinct from old.blocked_reason_detail
       or new.blocked_owner_id is distinct from old.blocked_owner_id or new.blocked_by is distinct from old.blocked_by
       or new.blocked_at is distinct from old.blocked_at or new.blocked_expected_resolution_at is distinct from old.blocked_expected_resolution_at
       or new.commercial_review_required is distinct from old.commercial_review_required
       or new.status_changed_at is distinct from old.status_changed_at
       or new.last_admin_intervention_at is distinct from old.last_admin_intervention_at
       or new.last_admin_intervention_by is distinct from old.last_admin_intervention_by
       or new.last_admin_intervention_kind is distinct from old.last_admin_intervention_kind
       or new.is_archived is distinct from old.is_archived or new.is_archived_designer is distinct from old.is_archived_designer
       or new.is_archived_quote is distinct from old.is_archived_quote or new.is_archived_delivery is distinct from old.is_archived_delivery
       or new.is_archived_admin is distinct from old.is_archived_admin or new.updated_by is distinct from old.updated_by
     ) then raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden'; end if;
  if new.status = 'in_Production' and old.status is distinct from 'in_Quote' then
    raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
  end if;
  return new;
end;
$$;

create or replace function public.record_order_purge_storage_result(p_order_id uuid,p_claim_token uuid,p_storage_files_deleted integer default 0,p_storage_errors jsonb default '[]'::jsonb)
returns public.order_purge_audit language plpgsql security definer set search_path=public as $$
declare v_audit public.order_purge_audit%rowtype; v_has_errors boolean;
begin
  select * into v_audit from public.order_purge_audit where order_id=p_order_id and claim_token=p_claim_token for update;
  if not found or v_audit.claim_expires_at is null or v_audit.claim_expires_at < now() or v_audit.phase <> 'claimed' then raise exception 'PURGE_CLAIM_INVALID'; end if;
  v_has_errors := jsonb_array_length(coalesce(p_storage_errors,'[]'::jsonb)) > 0;
  update public.order_purge_audit set storage_files_deleted=greatest(coalesce(p_storage_files_deleted,0),0),storage_errors=coalesce(p_storage_errors,'[]'::jsonb),
    phase=case when v_has_errors then 'failed' else 'storage_deleted' end,purge_status=case when v_has_errors then 'failed' else 'storage_deleted' end,
    claim_token=case when v_has_errors then null else claim_token end,claim_expires_at=case when v_has_errors then null else claim_expires_at end
  where id=v_audit.id returning * into v_audit;
  return v_audit;
end;
$$;

create or replace function public.purge_claimed_order_after_storage(p_order_id uuid,p_claim_token uuid,p_cutoff timestamptz)
returns public.order_purge_audit language plpgsql security definer set search_path=public as $$
declare v_audit public.order_purge_audit%rowtype; v_order public.orders%rowtype;
begin
  select * into v_audit from public.order_purge_audit where order_id=p_order_id and claim_token=p_claim_token for update;
  if not found or v_audit.claim_expires_at is null or v_audit.claim_expires_at < now() or v_audit.phase <> 'storage_deleted' then raise exception 'PURGE_CLAIM_INVALID'; end if;
  select * into v_order from public.orders where id=p_order_id and created_at<p_cutoff and (coalesce(is_archived,false) or status in ('in_Delivered','cancelled')) for update;
  if not found then raise exception 'Order % is not eligible for purge',p_order_id; end if;
  perform set_config('app.order_purge_authorized','on',true);
  delete from public.notifications where order_id=p_order_id;
  delete from public.orders where id=p_order_id;
  update public.order_purge_audit set purge_status='purged',phase='db_deleted',completed_at=now(),purged_at=now(),claim_token=null,claim_expires_at=null where id=v_audit.id returning * into v_audit;
  return v_audit;
end;
$$;

revoke all on function public.guard_orders_direct_update() from public,anon,authenticated;
revoke all on function public.claim_old_orders_for_purge(timestamptz,integer),public.record_order_purge_storage_result(uuid,uuid,integer,jsonb),public.purge_claimed_order_after_storage(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_old_orders_for_purge(timestamptz,integer),public.record_order_purge_storage_result(uuid,uuid,integer,jsonb),public.purge_claimed_order_after_storage(uuid,uuid,timestamptz) to service_role;

-- A live lease is never overwritten. Retry only expired leases, retaining the
-- immutable snapshot and asset manifest captured by the first claim.
create or replace function public.claim_old_orders_for_purge(p_cutoff timestamptz, p_limit integer default 100)
returns table(order_id uuid, claim_token uuid, asset_manifest jsonb)
language plpgsql security definer set search_path = public as $$
begin
  update public.order_purge_audit set purge_status='failed',phase='failed',claim_token=null,claim_expires_at=null
  where purge_status in ('claimed','storage_deleted') and claim_expires_at is not null and claim_expires_at < now();
  return query with candidates as (
    select o.* from public.orders o
    where o.created_at < p_cutoff and (coalesce(o.is_archived,false) or o.status in ('in_Delivered','cancelled'))
      and not exists (select 1 from public.order_purge_audit a where a.order_id=o.id
        and (a.purge_status='purged' or (a.claim_token is not null and a.claim_expires_at >= now())))
    order by o.created_at limit greatest(least(coalesce(p_limit,100),500),1) for update skip locked
  ), claims as (
    insert into public.order_purge_audit(order_id,order_created_at,client_name,status,payment_status,order_events_count,notifications_count,storage_errors,purge_status,claim_token,claim_expires_at,attempt_count,phase,order_snapshot,asset_manifest)
    select c.id,c.created_at,c.client_name,c.status,c.payment_status,
      (select count(*)::int from public.order_events e where e.order_id=c.id),
      (select count(*)::int from public.notifications n where n.order_id=c.id),
      '[]'::jsonb,'claimed',gen_random_uuid(),now()+interval '30 minutes',1,'claimed',to_jsonb(c),
      jsonb_build_object('objects',coalesce((select jsonb_agg(jsonb_build_object('provider',f.provider,'bucket',f.bucket,'object_key',f.object_key) order by f.provider,f.bucket,f.object_key)
        from public.order_files f where f.order_id=c.id and f.deleted_at is null and f.provider in ('supabase','r2')
          and f.bucket in ('order-docs','order-previews','payment-invoice') and nullif(trim(f.object_key),'') is not null),'[]'::jsonb))
    from candidates c
    on conflict (order_id) where purge_status <> 'purged' do update
      set claim_token=gen_random_uuid(),claim_expires_at=now()+interval '30 minutes',attempt_count=public.order_purge_audit.attempt_count+1,
          phase='claimed',purge_status='claimed',storage_errors='[]'::jsonb
      where public.order_purge_audit.claim_token is null or public.order_purge_audit.claim_expires_at < now()
    returning public.order_purge_audit.order_id,public.order_purge_audit.claim_token,public.order_purge_audit.asset_manifest
  ) select * from claims;
end;
$$;
