# Auditoria: send_order_to_production

## Resultado principal

El arreglo minimo de `send_order_to_production` no debe ampliar roles. Debe permitir solo:

- `admin`
- `quote`

El rol `quote` es Caja en el sistema. Permitir `caja` como string adicional seria incorrecto porque no es un rol canonico almacenado en `profiles.role`.

La variable local que almacena el rol de `profiles` debe llamarse `v_profile_role` o similar. No debe llamarse `current_role`, porque ese nombre colisiona con el identificador especial de Postgres y puede volver a evaluar el rol SQL activo (`authenticated`) en vez del rol funcional del usuario.

## Riesgos detectados

1. `recalculate_order_production_status(uuid)` es `SECURITY DEFINER` y esta concedida a `authenticated` en `supabase/20260606_file_level_production.sql`. Riesgo: usuarios autenticados podrian intentar recalcular estados sin pasar por `send_order_to_production`.
2. `update_production_file_status(uuid, text)` es `SECURITY DEFINER` y valida area productiva, pero debe asegurar que la orden ya este oficialmente en produccion antes de permitir avances de archivo.
3. `orders_update_by_role` permite updates amplios a usuarios asignados. Riesgo: un cliente directo podria intentar cambiar `orders.status` sin pasar por RPC.
4. `order_production_files_update_by_owner` permite updates de archivos a roles previos del flujo mientras la orden no este en produccion. Esto puede ser intencional para clasificacion, pero debe vigilarse para que no permita avances de estado indebidos.
5. `employment_status = false` se bloquea en UI, pero no en todas las funciones/RLS. Una sesion vigente de una cuenta desactivada podria seguir intentando llamadas directas.
6. `debug_auth_uid()` expone datos de diagnostico a `authenticated`. Es util para este incidente, pero debe retirarse o restringirse despues de confirmar el fix.
7. El rol legacy `printer` sigue en administracion, pero `/production` usa `digital_producer`, `dtf_producer` y `ploteo_producer`. Puede generar usuarios con acceso confuso o incompleto.

## Recomendaciones posteriores al fix principal

- Revocar `execute` de `recalculate_order_production_status(uuid)` para `authenticated` si solo debe ser llamada internamente.
- Endurecer `update_production_file_status` para validar que la orden ya tenga `status = 'in_Production'` o estado productivo equivalente.
- Reemplazar updates directos amplios sobre `orders.status` por RPCs de transicion con validaciones explicitas.
- Incluir `employment_status` en helpers de autorizacion o en validaciones sensibles.
- Retirar `debug_auth_uid()` del frontend y revocar su `execute` cuando termine la investigacion.
