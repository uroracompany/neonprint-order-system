# Independent Review — Plan 20260830-delivery-returns-rework

**VERDICT: READY FOR EXECUTION**

El plan cumple el objetivo confirmado: Delivery asignado revierte una entrega a
`in_Completed` y luego puede devolver solo archivos defectuosos a
`in_production`, manteniendo los correctos en `completed`, con una nota por
archivo, auditoría durable y notificaciones solo a responsables efectivos.

La revisión independiente verificó que la implementación debe integrarse con el
guard de órdenes, el recalculador de producción, las RLS de archivos/asignaciones
y el trigger de notificaciones; el plan contempla estos puntos.

Condiciones obligatorias durante ejecución:

- El contexto `delivery_rework` debe ser reconocido explícitamente por el guard
  y permitir únicamente las dos transiciones nuevas y el no-op de recálculo;
  nunca actualizaciones directas del cliente.
- El receptor debe ser único, activo, no eliminado y pertenecer al área del
  archivo. Una discrepancia entre `assigned_to` y la asignación actual debe
  fallar o resolverse mediante una regla explícita, sin avisar a ambos.
- RLS de notas/ítems: Delivery actor, receptor exacto y admin únicamente. Otro
  productor, incluso del mismo área, no puede leer una nota ajena.
- El trigger genérico de cambio de estado debe suprimirse dentro de este contexto
  para evitar difusión; `notify_many` se invoca una vez por destinatario único.
- Las pruebas deben cubrir las negativas de RLS, receptor ausente/inactivo o
  discrepante, reintentos/concurrencia, múltiples archivos y destinatarios.

Revisión completa: `.opencode/runs/20260830-delivery-returns-rework/review.md`.
