-- Lock down internal trigger-only functions.

revoke execute on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from anon;
revoke execute on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from authenticated;
revoke execute on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from public;

revoke execute on function public.set_order_update_metadata() from anon;
revoke execute on function public.set_order_update_metadata() from authenticated;
revoke execute on function public.set_order_update_metadata() from public;

revoke execute on function public.handle_order_change_notification() from anon;
revoke execute on function public.handle_order_change_notification() from authenticated;
revoke execute on function public.handle_order_change_notification() from public;
