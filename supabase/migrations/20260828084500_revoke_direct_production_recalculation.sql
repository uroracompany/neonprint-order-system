-- The recalculator is an internal SECURITY DEFINER helper. Its authorized
-- producer and administrator commands invoke it as the function owner, so it
-- must not be exposed as a standalone authenticated RPC.
revoke all on function public.recalculate_order_production_status(uuid)
from public, anon, authenticated;
