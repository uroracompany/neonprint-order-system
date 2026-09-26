# Plan de correccion minimo

## Objetivo

Sincronizar la definicion activa de `public.send_order_to_production(uuid)` en Supabase con la definicion corregida del repositorio, manteniendo el contrato actual y sin cambiar el frontend.

## Pasos de implementacion

1. Verificar en la base real la definicion activa de `public.send_order_to_production(uuid)` con `pg_get_functiondef`.
2. Confirmar que el RPC activo sea `security invoker` y lea el rol directamente desde `public.profiles` con `auth.uid()`.
3. Confirmar que la variable local de rol se llame `v_profile_role`, no `current_role`.
4. Si el RPC activo no coincide, aplicar `supabase/20260607_fix_send_to_production_role_check.sql` completo.
5. Confirmar que `execute` quede concedido a `authenticated` y revocado para `public`/`anon`.
6. No cambiar `quote` a `caja`: `quote` es el rol canonico almacenado.

## SQL exacto del fix principal

Usar el contenido de:

```text
supabase/20260607_fix_send_to_production_role_check.sql
```

Puntos obligatorios de la definicion:

```sql
create or replace function public.send_order_to_production(p_order_id uuid)
returns public.orders
language plpgsql
security invoker
set search_path = public
```

Y validacion de rol:

```sql
select p.role into v_profile_role
from public.profiles p
where p.id = auth.uid();

if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
  raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
end if;
```

## Verificacion funcional

Probar con un usuario Caja real:

1. `debug_auth_uid()` debe devolver `auth_uid` no nulo y `role = "quote"`.
2. Una orden pagada, asignada en `orders.quote_id` al usuario y con todos sus `order_production_files.production_area_code` definidos debe pasar a `orders.status = 'in_Production'`.
3. Un usuario con rol distinto de `admin`/`quote` debe recibir `Solo caja o admin pueden enviar ordenes a produccion.`
4. Un usuario `quote` no asignado a la orden debe recibir `No tienes acceso a esta orden.`
5. Una orden sin archivos clasificados debe recibir `La orden no tiene archivos clasificados para produccion.`
6. Una orden con archivos sin area debe recibir `Todos los archivos deben tener tipo de produccion antes de enviar.`

## Limitacion de esta ejecucion

En esta sesion no hay herramienta SQL live disponible para consultar `pg_proc` ni aplicar SQL directamente:

- `supabase` CLI no esta instalada.
- `tool_search` no expuso herramientas Supabase SQL.
- `.mcp.json` apunta a Supabase MCP `read_only=true`, pero no hay herramienta de consulta SQL disponible en el entorno actual.

Por eso el repositorio queda documentado y listo para aplicar la migracion exacta desde el SQL editor o el flujo de despliegue de Supabase.
