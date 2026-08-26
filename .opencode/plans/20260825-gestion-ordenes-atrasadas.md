# Plan: gestión de órdenes atrasadas

**ID:** `20260825-gestion-ordenes-atrasadas`
**STATUS: DRAFT**
**Baseline:** `81cf707cc13e7b7f29c3bcd17eb5264c4cd9bed3`

## Solicitud

Implementar lógica para órdenes con fecha de entrega vencida: priorizarlas y alertar al responsable y administración. La etiqueta debe desaparecer al marcarse entregada y verla toda persona que ya puede acceder o está asignada a la orden.

## Implementación propuesta

- Añadir un cálculo común de atraso por fecha de calendario en `America/Asuncion`. Será atrasada una orden con fecha válida anterior al día local actual y estado diferente de `in_Delivered`/`cancelled`; incluye devueltas e `in_Completed` hasta su entrega.
- Mostrar `Atrasada · N días` en las colas y detalle internos de Administración, Ventas, Diseño, Cotización, Producción y Entrega. Dar prioridad por días de atraso y habilitar filtro de atrasadas donde exista filtrado. El badge se renderiza únicamente sobre las órdenes que el usuario ya recibió por sus permisos; no se modifica RLS ni la visibilidad de órdenes.
- Unificar los contadores de perfiles y KPI al mismo cálculo. Al cambiar a `in_Delivered` o reprogramar a una fecha vigente, el cálculo devuelve no atrasada y la etiqueta desaparece.
- Añadir migración con tabla de deduplicación y despacho horario. Notificar una vez por orden/fecha/destinatario al responsable actual según estado y a todos los administradores activos. Producción usa asignaciones de área con respaldo en `production_id`.
- Mantener las alertas como historial y no enviar mensajes al cliente ni modificar tracking público.

## Archivos o subsistemas afectados

- Utilidad de fechas de órdenes, páginas internas de órdenes y handlers de perfiles/KPI.
- Nueva migración en `supabase/migrations/` para ejecución, deduplicación y notificaciones.
- Pruebas unitarias, de componentes y de contrato de migración.

## Aceptación y riesgos

- Cubrir fechas límite, terminales, devoluciones, reasignación/reprogramación, múltiples productores, deduplicación y visibilidad sin expansión de permisos.
- Ejecutar lint, security check, build y Vitest afectado; requerir revisión visual y auditoría de seguridad de la migración.
- No incluir cambios de pagos, estados, RLS, tracking público, despliegues o mensajes externos.
