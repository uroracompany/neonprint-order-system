# Investigacion: Error "Enviar a produccion"

## Causa raiz identificada

El usuario observado tiene `profiles.role = 'quote'`, que es el rol canonico de Caja en este sistema. El frontend usa ese rol correctamente y llama el RPC correcto.

El error `P0001: Solo caja o admin pueden enviar ordenes a produccion.` ocurria dentro de `public.send_order_to_production(uuid)`, en la validacion SQL de rol. La causa raiz final fue que la funcion usaba una variable local llamada `current_role`, que choca con el identificador especial de Postgres `current_role`. Aunque `debug_auth_uid()` devolvia `role = 'quote'`, la validacion del RPC terminaba evaluando el rol SQL activo (`authenticated`) en vez del rol de `profiles`, y por eso fallaba contra `('admin', 'quote')`.

## Flujo completo

```text
Usuario autenticado
  -> AuthProvider carga session/user y profiles.role
  -> ProtectedRoute permite /quote solo si profile.role = 'quote'
  -> PageQuote carga ordenes con quote_id = auth.uid()
  -> QuoteOrderDetailModal muestra "Dar paso a produccion"
  -> handleOpenProductionModal(order)
  -> Modal "Enviar a produccion"
  -> handleConfirmSendToProduction()
  -> supabase.rpc("debug_auth_uid")
  -> supabase.rpc("send_order_to_production", { p_order_id })
  -> SQL valida profiles.role
  -> SQL valida orders.quote_id = auth.uid() o admin
  -> SQL valida archivos clasificados
  -> SQL actualiza order_production_files
  -> SQL actualiza orders.status = 'in_Production'
```

## Evidencia frontend

- `src/App.jsx:30`: `/quote` esta protegido con `allowed={["quote"]}`.
- `src/ProtectedRoute.jsx:82`: el acceso depende de `profile.role`.
- `src/pages/dashboard.jsx:1063`: la UI de administracion guarda Caja como `<option value="quote">Caja</option>`.
- `src/pages/page-quote.jsx:222-224`: el boton de avance a produccion solo se habilita para orden en Caja, pagada y no archivada.
- `src/pages/page-quote.jsx:627-631`: las ordenes de Caja se cargan con `.eq("quote_id", quoteUserId)`.
- `src/pages/page-quote.jsx:838-848`: `handleConfirmSendToProduction()` ejecuta primero `debug_auth_uid` y luego `send_order_to_production`.
- `src/pages/page-quote.jsx:1299`: el boton final del modal ejecuta `handleConfirmSendToProduction`.

## Evidencia de roles

- El diagnostico observado devuelve:

```json
{
  "role": "quote",
  "auth_uid": "1387e76a-6aae-4d3d-b57c-6e103b785adf",
  "uid_is_null": false,
  "current_user": "authenticated",
  "session_user": "authenticator"
}
```

- `quote` no es un error de traduccion: es el valor tecnico almacenado para Caja.
- Los roles validos se controlan en `profiles.role`; la migracion `supabase/20260606_file_level_production.sql:35-49` incluye `quote`, `admin`, productores y otros roles.
- No se encontro uso de `auth.users`, JWT claims ni una tabla `user_roles` para esta validacion.

## Punto exacto de falla

El flujo falla antes de validar pertenencia de orden, archivos clasificados o updates. La excepcion P0001 sale del bloque de rol en el RPC.

El fix aplicado renombra la variable local a `v_profile_role`, evitando el choque con `current_role`. Tras aplicar el SQL en Supabase, el RPC acepto al usuario `quote` y movio la orden de prueba a produccion correctamente.
