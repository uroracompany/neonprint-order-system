-- Failed browser attachment metadata must not become an immediate destructive
-- request.  Managed uploads stay untouched until the server reconciler's
-- grace-period pass can assess them out-of-band.
revoke all on function public.admin_enqueue_unattached_order_asset_deletion(uuid, text, text) from public, anon, authenticated;
comment on function public.admin_enqueue_unattached_order_asset_deletion(uuid, text, text) is 'Retired from client use: failed attachment cleanup is handled by the grace-period reconciler.';

notify pgrst, 'reload schema';
