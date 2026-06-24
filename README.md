# NeonPrint Order System

Sistema interno de gestion de ordenes para una imprenta, construido con React + Vite y Supabase.

## Objetivo

NeonPrint centraliza el flujo operativo de una orden desde ventas hasta entrega:

- Login y acceso por roles internos.
- Creacion, asignacion, cotizacion, produccion, terminacion, entrega y archivo de ordenes.
- Tracking publico por token para clientes.
- Notificaciones internas por departamento.
- Carga y consulta de archivos en Supabase Storage.

## Arquitectura

- Frontend: React 19 + Vite en `src/`.
- Rutas protegidas: `src/ProtectedRoute.jsx` usa `profiles.role` como fuente de permisos.
- Cliente Supabase browser: `supabaseClient.js` con variables `VITE_*`.
- Endpoints server-side: `api/` con logica compartida en `server/`.
- Base de datos: Supabase Auth, `profiles`, `orders`, `notifications`, `order_events`.
- Storage: buckets de documentos, previews y comprobantes; `order_files` registra metadatos canonicos para Supabase Storage o Cloudflare R2.
- Migraciones SQL: `supabase/`.


## Variables de entorno

El proyecto espera estas variables en `.env`:

```env
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your_publishable_or_anon_key"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
ORDER_PURGE_CRON_SECRET="optional_long_random_token"
STORAGE_PROVIDER="supabase"
R2_UPLOAD_THRESHOLD_MB="25"
R2_ACCOUNT_ID="ad020a03ba5e769d8340331e3640c2f7"
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET="neonprint-order-files-dev"
R2_BUCKET_DEV="neonprint-order-files-dev"
R2_BUCKET_PROD="neonprint-order-files-prod"
```

Reglas importantes:

- `SUPABASE_SERVICE_ROLE_KEY` solo debe usarse del lado servidor.
- Nunca crear una variable `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- `ORDER_PURGE_CRON_SECRET` es opcional si el cron invoca la Edge Function con `SUPABASE_SERVICE_ROLE_KEY` como Bearer token.
- La autorizacion debe venir de `public.profiles.role`, no de `user_metadata`.
- `STORAGE_PROVIDER=supabase` conserva el flujo actual; `hybrid` envia archivos grandes de `order-docs` a Cloudflare R2 si las credenciales R2 estan configuradas.
- `R2_BUCKET` define el bucket activo del entorno. Usar `neonprint-order-files-dev` para validacion y cambiar a `neonprint-order-files-prod` solo despues de probar el flujo completo.
- Las claves R2 son solo server-side. Nunca deben usar prefijo `VITE_`.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

## Rutas principales

- `/`: login y redireccion por rol.
- `/dashboard`: administracion.
- `/page-seller`: ventas.
- `/designer`: diseno.
- `/quote`: cotizacion.
- `/production`: produccion.
- `/delivery`: entrega.
- `/track/:token`: tracking publico del cliente.

## Roles

- `admin`: administracion, usuarios, visibilidad operativa amplia.
- `seller`: creacion y seguimiento de ordenes de ventas.
- `designer`: asignacion y avance de diseno.
- `quote`: cotizacion y estado de pago.
- `printer`: produccion y terminacion.
- `delivery`: entrega y cierre logistico.

## Estados canonicos

### Ordenes

```js
Pending
in_Design
in_Quote
in_Production
in_Termination
in_Completed
in_Delivered
cancelled
```

### Pagos

```js
Pending_Payment
parcial
pagado
```

Los enums y normalizadores del frontend viven en `src/utils/constants.js`. Las migraciones SQL corrigen valores historicos y agregan restricciones para evitar mezclas como `en produccion`, `completada`, `In_Design` o `cotizacion`.

## Endpoints administrativos

- `POST /api/admin-create-user`
- `POST /api/admin-update-user`
- `POST /api/change-user-password`
- `POST /api/get-user-email`

Contrato de seguridad:

- Requieren `Authorization: Bearer <access_token>`.
- Validan que el usuario exista en `profiles`.
- Validan que `profiles.role = 'admin'`.
- Usan `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor.

## Buckets de Storage

- `order-docs`: documentos de trabajo de las ordenes.
- `order-previews`: previews asociados a ordenes.
- `payment-invoice`: comprobantes de pago.
- Cloudflare R2 opcional para archivos grandes de `order-docs` cuando `STORAGE_PROVIDER=hybrid` o `r2`.

Estado R2: el codigo local y la migracion `supabase/migrations/20260624050859_activate_r2_storage_gateway.sql` estan preparados. La activacion remota queda pendiente hasta tener invitacion/permisos en la cuenta Cloudflare del cliente, configurar CORS/lifecycle y cargar `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` como variables server-side.

La politica esperada para `payment-invoice` es privada con signed URLs. La migracion `supabase/20260526_harden_tracking_and_payment_assets.sql` actualiza el bucket y agrega politicas para lectura, subida, reemplazo y borrado segun rol/departamento.

El endpoint `POST /api/admin-delete-order` elimina ordenes de prueba de forma segura: borra primero archivos en Supabase Storage y R2, registra auditoria en `order_delete_audit` y solo despues borra la orden.

## Tracking publico

`/track/:token` se mantiene publico, pero con exposicion reducida:

- Muestra estado, pago, fechas basicas, tipo de orden y motivo de cancelacion si aplica.
- No muestra descripcion completa, preview interno, materiales ni historial tecnico completo.
- Las RPC publicas esperadas son `get_order_tracking(text)` y `get_order_tracking_events(text)`.

## Purga automatica de ordenes antiguas

La migracion `supabase/20260604_add_old_order_purge_job.sql` crea una auditoria minima en `order_purge_audit`, funciones internas para purgar ordenes con mas de 3 meses y un job diario `purge-old-orders-daily`. La Edge Function tambien borra objetos registrados en `order_files`, incluyendo R2 cuando las variables R2 estan configuradas.

Antes de activar en produccion:

- Ejecutar la consulta de inventario de FKs incluida en la migracion para confirmar dependencias reales de `public.orders`.
- Desplegar la Edge Function `supabase/functions/purge-old-orders`.
- Crear secretos de Vault: `project_url` con la URL del proyecto y `order_purge_cron_token` con `SUPABASE_SERVICE_ROLE_KEY` o con `ORDER_PURGE_CRON_SECRET` si la funcion se publica sin verificacion JWT.
- Probar manualmente con `POST /functions/v1/purge-old-orders` y body `{"dry_run": true}` antes de permitir borrado real.

## Migraciones relevantes

- `supabase/20260521_standardize_order_status_codes.sql`: normaliza estados de orden y reglas del flujo.
- `supabase/20260522_flowtrack_tracking_system.sql`: agrega tracking publico y eventos.
- `supabase/20260526_harden_tracking_and_payment_assets.sql`: normaliza pagos, endurece tracking y protege comprobantes.
- `supabase/20260604_add_old_order_purge_job.sql`: agrega purga automatica diaria de ordenes antiguas con auditoria.

## Verificacion minima antes de produccion

- `npm run lint` debe terminar sin errores.
- `npm run build` debe terminar correctamente.
- Probar login por cada rol.
- Probar el flujo completo de orden: crear, diseno, cotizacion, pago, produccion, terminacion, entrega y archivo.
- Probar bloqueo de produccion cuando el pago no esta confirmado.
- Probar tracking con token valido, invalido, orden cancelada y orden completada.
- Validar RLS de `orders`, `profiles`, `notifications`, `order_events`.
- Validar endpoints admin con token admin y con token no-admin.
- Validar Storage con buckets privados y signed URLs donde corresponda.

## Pendientes tecnicos conocidos

- Aplicar y verificar las migraciones contra Supabase remoto cuando haya CLI, MCP autenticado o conexion SQL directa.
- Reducir el bundle principal con code splitting para paginas grandes.
- Resolver warnings restantes de `react-hooks/exhaustive-deps`.
- Dividir `dashboard.jsx` y `pages-seller.jsx` en componentes/hooks mas pequenos.
