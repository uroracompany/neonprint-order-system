-- Trigger implementation is not a public RPC surface.
revoke all on function public.enforce_invoice_assignment_lifecycle() from public, anon, authenticated;
