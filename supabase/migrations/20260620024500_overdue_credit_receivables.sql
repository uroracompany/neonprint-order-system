-- Read model for overdue credit invoices. NeonPrint stores the external
-- invoice reference, not the official financial value.

create index if not exists idx_accounts_receivable_open_due_at
  on public.accounts_receivable (status, due_date, issued_at, client_id)
  where status in ('open', 'partial');

create or replace function public.get_overdue_credit_receivables(
  p_days integer default 30
)
returns table (
  receivable_id uuid,
  order_id uuid,
  client_id uuid,
  client_name text,
  client_phone text,
  invoice_number text,
  issued_at timestamptz,
  due_date timestamptz,
  status text,
  age_days integer,
  overdue_days integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with source as (
    select
      ar.id as receivable_id,
      ar.order_id,
      ar.client_id,
      coalesce(c.name, o.client_name, 'Cliente sin nombre') as client_name,
      coalesce(c.phone, o.client_contact) as client_phone,
      coalesce(ar.invoice_number, o.invoice_number) as invoice_number,
      ar.issued_at,
      ar.due_date,
      ar.status,
      coalesce(ar.due_date, ar.issued_at + make_interval(days => greatest(coalesce(p_days, 30), 1))) as effective_due_at
    from public.accounts_receivable ar
    left join public.orders o on o.id = ar.order_id
    left join public.clients c on c.id = ar.client_id
    where ar.status in ('open', 'partial')
  )
  select
    source.receivable_id,
    source.order_id,
    source.client_id,
    source.client_name,
    source.client_phone,
    source.invoice_number,
    source.issued_at,
    source.due_date,
    source.status,
    greatest(floor(extract(epoch from (now() - source.issued_at)) / 86400)::integer, 0) as age_days,
    greatest(floor(extract(epoch from (now() - source.effective_due_at)) / 86400)::integer, 0) as overdue_days
  from source
  where source.effective_due_at < now()
  order by overdue_days desc, source.issued_at asc;
$$;

revoke all on function public.get_overdue_credit_receivables(integer) from public;
revoke all on function public.get_overdue_credit_receivables(integer) from anon;
grant execute on function public.get_overdue_credit_receivables(integer) to authenticated;
