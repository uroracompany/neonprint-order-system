# Contexto de dominio — NeonPrint Order System

> Este documento es contexto obligatorio para los agentes de OpenCode. Resume las
> reglas estables del negocio, pero no sustituye al código, las migraciones ni los
> contratos que se estén modificando. Ante un conflicto, verificar la fuente
> canónica indicada en cada sección y declarar la discrepancia antes de cambiarla.

## Propósito del producto

NeonPrint es un sistema interno para una imprenta. Centraliza una orden desde su
creación comercial hasta su entrega y archivo, con visibilidad por departamento,
notificaciones internas y seguimiento público limitado por token.

La aplicación usa React 19 + Vite en `src/`, Supabase para Auth, datos y Storage,
endpoints server-side en `api/` con lógica reutilizable en `server/`, y migraciones
SQL ordenadas en `supabase/migrations/`.

## Roles y límites de acceso

La fuente de autorización es siempre `public.profiles.role`; nunca `user_metadata`.
`src/ProtectedRoute.jsx` controla rutas protegidas. Los roles principales son:

- `admin`: administración, usuarios y visibilidad operativa amplia.
- `seller`: crea y sigue órdenes de venta.
- `designer`: recibe y avanza el trabajo de diseño.
- `quote`: gestiona caja/cotización y estado de pago.
- `printer`: producción y terminación.
- `delivery`: entrega y cierre logístico.

No ampliar visibilidad, permisos o transiciones de un rol sin un requisito expreso
y una revisión de RLS/API.

## Flujo de una orden

Usar los valores canónicos de `src/utils/constants.js`; no introducir aliases en
la base de datos ni comparar estados con texto de interfaz.

```text
Pending → in_Design → in_Quote → in_Production → in_Termination
        → in_Completed → in_Delivered
```

`cancelled` es un estado terminal. La interfaz puede normalizar aliases históricos,
pero las escrituras y los contratos nuevos deben usar exactamente:

- `Pending`
- `in_Design`
- `in_Quote`
- `in_Production`
- `in_Termination`
- `in_Completed`
- `in_Delivered`
- `cancelled`

Antes de cambiar una transición, buscar su validación en componentes, handlers y
migraciones. No asumir que una vista tiene permiso solo por mostrar una orden.

## Pagos y reglas operativas

Los estados canónicos son `Pending_Payment`, `parcial`, `credito` y `pagado`.

- Producción solo es elegible con pago `pagado`, `parcial` o `credito`.
- Entrega solo es elegible con `pagado` o `credito`.
- Una orden se considera liquidada financieramente solo con `pagado`.
- La venta a crédito exige que el cliente esté registrado y vinculado a la orden.

Estas reglas viven en `src/utils/constants.js`; cualquier cambio requiere pruebas
del flujo completo y debe conservar los normalizadores existentes.

## Clientes, materiales y KPI

Los clientes registrados pertenecen a `public.clients`; no se deben inferir desde
`orders.client_name`. Una orden puede referenciar un cliente y el material se usa
como dato operativo/analítico.

En **Clientes → KPI** existen métricas distintas que no son intercambiables:

- **Clientes registrados:** cantidad de registros en `public.clients`. En la
  gráfica general actual, cada punto muestra el total global recibido como
  `registeredClientCount`; no se debe calcular desde órdenes activas ni dejarlo
  en cero por falta de actividad mensual.
- **Clientes activos:** clientes distintos con al menos una orden en el período.
- **Órdenes:** órdenes creadas dentro del período.

La serie mensual general procede de la RPC `kpi_client_monthly_activity`; su
contrato actual aporta `month`, `orders` y `active_clients`. La composición de la
métrica de registrados para el tooltip está en
`src/components/kpi/KPIClientWorkspace.jsx`. Si se pide cambiar la semántica a
“clientes creados durante el período”, eso es un cambio de contrato explícito y
requiere ajustar la RPC, el frontend y sus pruebas: no mezclar ambas definiciones.

Los KPI son de administración: las RPC de inteligencia deben mantener su control
de acceso de administrador. Para cualquier ajuste de KPI verificar frontend,
handler (`server/kpi-data-handler.js`), contrato SQL y tests afectados.

## Datos, Storage y seguridad

- `SUPABASE_SERVICE_ROLE_KEY` y las claves R2 son exclusivamente server-side. No
  crear variables `VITE_` para secretos.
- `order_files` es el registro canónico de metadatos de archivos, tanto para
  Supabase Storage como Cloudflare R2.
- Buckets: `order-docs`, `order-previews` y `payment-invoice`.
- `payment-invoice` es privado y se entrega mediante signed URLs.
- R2 es opcional: `STORAGE_PROVIDER=supabase` mantiene el flujo estándar;
  `hybrid` o `r2` requiere credenciales server-side y configuración validada.
- Los endpoints administrativos exigen Bearer token, perfil existente y rol
  `admin` antes de usar el service role.

No exponer archivos internos, descripciones técnicas, materiales ni historial
completo en el tracking público.

## Tracking público y operaciones destructivas

`/track/:token` muestra solo estado, pago, fechas básicas, tipo de orden y motivo
de cancelación. Mantener privadas la descripción completa, previews internos,
materiales e historial técnico.

Las operaciones de borrado o purga deben ser explícitas, auditadas y comprobadas
en modo seguro. La purga automatizada usa auditoría y debe probarse con
`dry_run: true` antes de habilitarla en producción. No activar infraestructura
remota, migraciones, cron ni borrar datos por una tarea de UI.

## Convenciones de interfaz

- Conservar los componentes, tokens y patrón CSS local del área modificada.
- Para cambios en KPI, tratar datos, filtros, tooltips y modales como contratos
  separados: un cambio visual no debe modificar la consulta ni sus filtros sin
  autorización explícita.
- Mantener accesibilidad: etiquetas, foco, teclado y contenido dentro de modales
  y contenedores.
- No sustituir términos visibles definidos por `formatUiTerms` sin revisar su uso
  en toda la interfaz.

## Verificación mínima

Elegir pruebas por alcance y ejecutar al menos las relevantes:

```text
npm run lint
npm run security:check
npm run build
npm run test -- <archivo-o-patrón-afectado>
```

Para cambios de autorización, API, SQL, Storage o pagos, revisar además RLS,
tokens, roles autorizados/no autorizados y la ausencia de secretos en cliente.

## Fuentes canónicas por tipo de cambio

| Cambio | Consultar primero |
| --- | --- |
| Estados, pagos y etiquetas | `src/utils/constants.js` |
| Acceso de rutas | `src/ProtectedRoute.jsx` y `profiles.role` |
| KPI Clientes | `src/components/kpi/KPIClientWorkspace.jsx`, `server/kpi-data-handler.js`, migraciones KPI |
| API administrativa | `api/`, `server/` y sus pruebas |
| Datos/RLS/RPC | migraciones en `supabase/migrations/` |
| Archivos/Storage/R2 | `order_files`, handlers server-side y migraciones |

