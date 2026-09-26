-- Require registered clients for new orders and keep denormalized order
-- customer fields synchronized with the clients catalog.

do $$
declare
  duplicate_count integer;
  duplicate_samples text;
begin
  select count(*)
  into duplicate_count
  from (
    select phone_digits
    from public.clients
    where nullif(phone_digits, '') is not null
    group by phone_digits
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    select string_agg(phone_digits, ', ' order by phone_digits)
    into duplicate_samples
    from (
      select phone_digits
      from public.clients
      where nullif(phone_digits, '') is not null
      group by phone_digits
      having count(*) > 1
      order by phone_digits
      limit 10
    ) samples;

    raise exception
      'No se puede exigir telefono unico de clientes: existen % telefonos duplicados. Ejemplos: %',
      duplicate_count,
      duplicate_samples;
  end if;
end
$$;

create unique index if not exists idx_clients_phone_digits_unique
  on public.clients (phone_digits)
  where nullif(phone_digits, '') is not null;

create or replace function public.enforce_registered_order_client()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
begin
  if tg_op = 'INSERT' and new.client_id is null then
    raise exception 'Debes seleccionar un cliente registrado para crear una orden.';
  end if;

  if new.client_id is null then
    if tg_op = 'UPDATE' and (
      new.client_name is distinct from old.client_name
      or new.client_contact is distinct from old.client_contact
    ) then
      raise exception 'Debes vincular un cliente registrado antes de modificar los datos del cliente.';
    end if;

    return new;
  end if;

  select *
  into v_client
  from public.clients
  where id = new.client_id;

  if not found then
    raise exception 'El cliente seleccionado no existe.';
  end if;

  new.client_name := v_client.name;
  new.client_contact := v_client.phone;

  return new;
end;
$$;

revoke all on function public.enforce_registered_order_client() from public;
revoke all on function public.enforce_registered_order_client() from anon;
revoke all on function public.enforce_registered_order_client() from authenticated;

drop trigger if exists trg_enforce_registered_order_client on public.orders;
create trigger trg_enforce_registered_order_client
  before insert or update of client_id, client_name, client_contact on public.orders
  for each row
  execute function public.enforce_registered_order_client();
