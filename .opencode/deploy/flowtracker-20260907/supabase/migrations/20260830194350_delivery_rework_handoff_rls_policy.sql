-- The handoff table is server-owned. Keep direct browser reads denied even if
-- a future grant is introduced accidentally; production reads go exclusively
-- through the authorised RPC.
drop policy if exists delivery_rework_handoffs_direct_read_denied on public.delivery_rework_handoffs;
create policy delivery_rework_handoffs_direct_read_denied
on public.delivery_rework_handoffs
for select
to authenticated
using (false);
