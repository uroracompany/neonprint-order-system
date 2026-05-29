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
- Storage: buckets de documentos, previews y comprobantes.
- Migraciones SQL: `supabase/`.


## Variables de entorno

El proyecto espera estas variables en `.env`:

```env
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your_publishable_or_anon_key"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
```

Reglas importantes:

- `SUPABASE_SERVICE_ROLE_KEY` solo debe usarse del lado servidor.
- Nunca crear una variable `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- La autorizacion debe venir de `public.profiles.role`, no de `user_metadata`.

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

La politica esperada para `payment-invoice` es privada con signed URLs. La migracion `supabase/20260526_harden_tracking_and_payment_assets.sql` actualiza el bucket y agrega politicas para lectura, subida, reemplazo y borrado segun rol/departamento.

## Tracking publico

`/track/:token` se mantiene publico, pero con exposicion reducida:

- Muestra estado, pago, fechas basicas, tipo de orden y motivo de cancelacion si aplica.
- No muestra descripcion completa, preview interno, materiales ni historial tecnico completo.
- Las RPC publicas esperadas son `get_order_tracking(text)` y `get_order_tracking_events(text)`.

## Migraciones relevantes

- `supabase/20260521_standardize_order_status_codes.sql`: normaliza estados de orden y reglas del flujo.
- `supabase/20260522_flowtrack_tracking_system.sql`: agrega tracking publico y eventos.
- `supabase/20260526_harden_tracking_and_payment_assets.sql`: normaliza pagos, endurece tracking y protege comprobantes.

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
