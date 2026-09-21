-- Índices de lectura para las colas operativas.
-- Se basan en EXPLAIN de las consultas actuales: los índices simples por
-- responsable obligaban a ordenar por created_at después del escaneo.
-- No cambian RLS, permisos ni datos.

create index if not exists idx_orders_quote_created_at
  on public.orders (quote_id, created_at desc)
  where quote_id is not null;

create index if not exists idx_orders_designer_created_at
  on public.orders (designer_id, created_at desc)
  where designer_id is not null;

create index if not exists idx_orders_seller_created_at
  on public.orders (seller_id, created_at desc)
  where seller_id is not null;

create index if not exists idx_orders_created_by_created_at
  on public.orders (created_by, created_at desc)
  where created_by is not null;

create index if not exists idx_accounts_receivable_issued_at
  on public.accounts_receivable (issued_at desc);
