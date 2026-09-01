# Plan 20260830-delivery-returns-rework — Delivery: reversión y retrabajo selectivo

**PLAN ID:** `20260830-delivery-returns-rework`  
**STATUS:** `DRAFT`  
**Baseline commit:** `c3c9bac57bc357ffd15e3ce4c13baa8fbe8f622a`

## Petición original

Permitir que Delivery revierta una orden entregada a completada y, desde
completada, devuelva selectivamente uno o más archivos defectuosos a Producción,
con una nota individual por archivo y notificaciones únicamente para los
responsables que reciben esos archivos. Los archivos correctos permanecen en
`completed`.

## Solución propuesta

Implementar dos RPCs atómicas, restringidas al Delivery activo asignado:

1. `in_Delivered → in_Completed`, sin modificar archivos ni pago.
2. Desde `in_Completed`, recibir `{file_id, correction_note}` por cada archivo
   seleccionado, pasar solo esos archivos `completed → in_production`, recalcular
   el estado agregado a `in_Production` y mantener los no seleccionados en
   `completed`.

Agregar un historial append-only de eventos e ítems para guardar actor,
destinatario, archivo, notas y estados anterior/nuevo. Resolver el responsable
por archivo, fallar el lote si no existe un responsable activo e inequívoco, y
notificar una vez por destinatario del lote. Un contexto de comando exclusivo
permitirá únicamente las dos transiciones de orden necesarias; el trigger de
notificaciones genérico se inhibirá en ese contexto para evitar difusión global.

## Archivos afectados

- `supabase/migrations/<timestamp>_delivery_return_to_completed_and_rework.sql`
- `src/pages/page-delivery.jsx`
- `src/css-components/page-delivery.css`
- `src/pages/page-production.jsx`
- `src/__tests__/delivery-rework.test.jsx` (nuevo)
- `src/__tests__/delivery-rework-migration.test.js` (nuevo)
- `src/__tests__/production-file-transitions.test.jsx`
- `src/__tests__/p2-production-delivery-command-context-contract.test.js`

## Interfaces y modelo de datos

- RPC `delivery_revert_order_to_completed(order_id, expected_updated_at)`.
- RPC `delivery_return_completed_files_to_production(order_id, items,
  expected_updated_at)` con `items = [{file_id, correction_note}]`.
- Tablas `delivery_rework_events` y `delivery_rework_event_items`, ambas con RLS
  de solo lectura para participantes/administración y escritura exclusiva de
  RPC. Los ítems guardan receptor efectivo y nota por archivo.
- La UI Delivery presenta reversión separada y un modal accesible de selección y
  notas; Producción muestra el último motivo dirigido para cada archivo que le
  fue devuelto.

## Criterios de aceptación

1. Solo Delivery activo asignado revierte su orden de `in_Delivered` a
   `in_Completed`.
2. Solo Delivery activo asignado devuelve desde `in_Completed`, eligiendo al
   menos un archivo `completed` y una nota no vacía por cada uno.
3. Los elegidos pasan a `in_production`; los no elegidos siguen `completed`; el
   estado de orden se recalcula atómicamente y nunca queda completado con un
   archivo devuelto activo.
4. Cada acción tiene bitácora durable de actor, tiempo, estado anterior/nuevo,
   archivo, nota y receptor.
5. Solo productores receptores válidos reciben una notificación deduplicada;
   no hay aviso a roles/áreas completos, actor, cliente ni otros participantes.
6. Roles, ownership, RLS, errores, concurrencia y reintentos se rechazan sin
   efectos parciales.
7. Producción puede leer el motivo dirigido y seguir su flujo normal hasta
   completar de nuevo la orden.

## Riesgos y comprobaciones requeridas

- Auditoría de seguridad obligatoria: `security definer`, grants, RLS,
  autorización, inyección de payload JSON, locks y prevención de avisos amplios.
- QA visual obligatorio: modal Delivery, selección, notas, foco, teclado,
  feedback de error/éxito y vista del motivo en Producción.
- Probar happy path, múltiples archivos/múltiples destinatarios, destinatario
  repetido, archivos correctos, payload inválido, archivo ya reabierto, orden
  ajena/cancelada/archivada, perfil inactivo, asignación ausente y carrera por
  `updated_at`.
- Ejecutar lint, security check, build y tests focalizados. Playwright solo si
  se pide de forma explícita.

## Detalle completo

El plan ejecutable, con secuencia de cambios, guard, trigger y estrategia de
pruebas, está en
`.opencode/runs/20260830-delivery-returns-rework/plan.md`. Este documento es el
borrador durable que deberá recibir revisión independiente antes de una posterior
solicitud explícita de ejecución.
