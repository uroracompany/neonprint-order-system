# Backend Supabase: send_order_to_production

## RPC corregido esperado

Archivo: `supabase/20260607_fix_send_to_production_role_check.sql`

Contrato:

```sql
public.send_order_to_production(p_order_id uuid)
returns public.orders
```

Propiedades esperadas:

- `language plpgsql`
- `security invoker`
- `set search_path = public`
- `execute` concedido a `authenticated`
- `public` y `anon` revocados

## Bloque SQL responsable de P0001

```sql
select p.role into current_role
from public.profiles p
where p.id = auth.uid();

if current_role is null or current_role not in ('admin', 'quote') then
  raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
end if;
```

El modelo de permisos era correcto, pero el nombre `current_role` no era seguro: en Postgres `current_role` tambien es un identificador especial que devuelve el rol SQL activo. La correccion aplicada usa `v_profile_role`:

```sql
select p.role into v_profile_role
from public.profiles p
where p.id = auth.uid();

if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
  raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
end if;
```

## Version anterior problematica

Archivo: `supabase/20260606_file_level_production.sql`

La version anterior definia el RPC como `security definer` y calculaba rol con:

```sql
current_role text := coalesce(public.current_profile_role(), '');
```

Esa funcion helper fue cambiada a `security invoker` en `supabase/20260519_role_helpers_security_invoker.sql`. La primera migracion correctiva tambien tenia que evitar usar `current_role` como nombre de variable local; el fix final usa `v_profile_role`.

## RLS y seguridad relacionada

- `profiles_select_authenticated` permite a usuarios autenticados leer perfiles; por eso el RPC invoker puede leer `profiles.role`.
- `orders_update_by_role` permite updates a usuarios asignados, incluido `quote_id`.
- `order_production_files_update_by_owner` permite al usuario asignado en flujo previo modificar archivos antes de produccion.
- `current_user` y `session_user` no participan en la autorizacion del RPC; solo aparecen en `debug_auth_uid()` para diagnostico.

Interpretacion del diagnostico observado:

- `auth_uid` no nulo: la sesion de Supabase esta llegando al backend.
- `role = quote`: el rol real del usuario es Caja.
- `current_user = authenticated`: rol Postgres activo para la llamada.
- `session_user = authenticator`: rol base de PostgREST/Supabase.

No hay conflicto entre esos valores; son esperados para una llamada autenticada por PostgREST.

## Validaciones del RPC esperado

1. Lee `profiles.role` usando `auth.uid()`.
2. Rechaza si el rol no es `admin` ni `quote`.
3. Rechaza si no existe la orden o si el usuario `quote` no esta asignado en `orders.quote_id`.
4. Rechaza si no hay archivos clasificados en `order_production_files`.
5. Rechaza si existe al menos un archivo sin `production_area_code`.
6. Actualiza archivos `pending` a `in_production`.
7. Actualiza la orden a `status = 'in_Production'` y `production_id = null`.

## Verificacion SQL recomendada en base real

Ejecutar en SQL editor de Supabase:

```sql
select
  p.proname,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  case p.prosecdef when true then 'security definer' else 'security invoker' end as security_mode,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'send_order_to_production';
```

La definicion activa debe coincidir con `supabase/20260607_fix_send_to_production_role_check.sql`.
