# Revisión independiente del plan — SemiAdmin, Caja y Producción

- **Plan ID:** `semi-admin-caja-payment-ownership-20260928`
- **Task ID:** `20260928-091156-semi-admin-payment-ownership-plan`
- **Baseline revisado:** `39f2b151c86b952b255d6e3c60331a53180cf8e9` (`main`)
- **Tipo:** revisión de plan-only; no se implementaron cambios de aplicación ni se ejecutaron mutaciones remotas.

## VERDICT: READY FOR EXECUTION

El plan cubre las tres solicitudes del usuario sin confundir responsabilidades financieras, operativas y de diseño. Define una matriz concreta de autorización, mantiene el comando de producción como autoridad final, reutiliza el handoff de Caja existente y exige pruebas de rutas directas además de la UI. Los supuestos conservadores están expresados como defaults y los casos que ampliarían permisos o cambiarían el destinatario del retorno quedan fuera del alcance silencioso.

## Evidencia comprobada contra el código actual

1. **La exclusividad de Caja aún no existe.** En `supabase/migrations/20260926112516_payment_authorization_production_gate.sql`, `quote_set_order_payment` admite roles `quote` y `admin` aunque su error diga “Solo Caja”; además, `semi_admin_register_order_payment` permite a SemiAdmin participante por `designer_id`, `quote_id`, `seller_id` o `created_by`. La interfaz también expone pago en `SemiAdminOperationalPanel.jsx` y `pages-seller.jsx`. El plan contempla retirar cada superficie y cerrar wrappers/RPC/atajos administrativos, lo cual es necesario; quitar solo botones sería insuficiente.
2. **Admin tiene rutas financieras distintas.** El Dashboard y `AdminAdvancedSettings` exponen `register_payment`, y las migraciones incluyen `admin_execute_order_command` y variantes de `mark_order_as_credit`. El plan separa explícitamente lectura/intervención no financiera de mutación de pagos.
3. **El retorno ya tiene un contrato durable.** `return_quote_order_for_correction` y `return_order_to_cashier` operan mediante `order_return_handoffs`; el destinatario se resuelve por el ID del responsable de etapa y puede ser un perfil SemiAdmin aunque el campo semántico del handoff sea `seller` o `designer`. El plan correctamente propone probar órdenes externas con SemiAdmin como vendedor/creador e internas con SemiAdmin como diseñador, sin duplicar RPC.
4. **El envío de SemiAdmin a Producción está bloqueado por la responsabilidad de Caja.** La autorización persistida `production_authorized_at/by` es una operación separada. Sin embargo, `can_send_order_to_production` y `semi_admin_route_order_to_production_v2` usan la etapa `quote`/`quote_id`; la función de catálogo y la UI dependen de ese gate. El plan separa `quote_id` del responsable funcional y enumera catálogo, handler, filas/tarjetas/recientes y modal de detalle.
5. **El alcance de almacenamiento quedó cubierto.** La copia durable ahora exige revisar RLS y rutas de subida/firma del bucket privado `payment-invoice`, el vínculo del objeto con la orden y posibles comprobantes huérfanos al retirar los flujos de pago de otros roles.

Las referencias y el estado sucio previo se preservan en `manifest.md` y `analysis.md` del run. Las migraciones locales no se consideran aplicadas en remoto; este review no consultó ni modificó la base de datos.

## Auditoría del plan

- **Correctitud funcional:** sí; pago solo por Caja asignada, autorización productiva explícita separada, SemiAdmin continúa según función interna/externa y el retorno vuelve al responsable actual.
- **Seguridad:** requiere revisar RPCs `SECURITY DEFINER`, overloads, grants, comandos genéricos, acceso directo a columnas y Storage. El plan lo requiere y propone lock/concurrencia/auditoría; debe permanecer como criterio de salida, no como tarea opcional.
- **Atomicidad/concurrencia:** solicita `FOR UPDATE`, `expected_updated_at`, doble clic idempotente/conflicto y éxito solo tras persistencia.
- **Compatibilidad:** conserva estados y elegibilidad actuales, firmas públicas cuando sea viable, asignaciones productivas y demás acciones no financieras de Admin.
- **Límites:** no cambia el significado del retorno al “último emisor”, no permite al creador de un diseño interno desplazar al diseñador asignado, no autoautoriza Producción al confirmar un pago, no toca despliegue ni migraciones remotas.
- **Mantenibilidad:** usa un predicado coherente en RPC, catálogo y fallback; mantiene un solo `ProductionAssignmentModal`.

## Riesgos que deben verificarse en ejecución

- Enumerar todas las firmas activas y grants efectivos, no solo las migraciones citadas; especialmente overloads de crédito, wrappers Admin/SemiAdmin y escrituras genéricas de `orders`.
- Confirmar que las rutas server-side y políticas Storage no acepten subir o vincular comprobantes por vendedores, Admin o SemiAdmin después de retirar el flujo UI.
- Confirmar que quitar mutaciones financieras de Admin no quite el permiso independiente de autorizar Producción ni sus intervenciones administrativas no financieras.
- Probar notificaciones, auditoría y refresco de vistas únicamente después de confirmar cada escritura.
- En el retorno, probar el ID destinatario en las rutas/paneles SemiAdmin; el plan no promete devolver al último emisor si ese usuario no es el responsable asignado.
- Revalidar `git status` antes de ejecución: el worktree ya contiene cambios en los archivos previstos, y el baseline/manifest prohíben atribuirlos a esta tarea.

## Condición de entrada a ejecución

El plan permanece **`STATUS: DRAFT`**. Este veredicto significa que puede ejecutarse tras una solicitud explícita que identifique este Plan ID; no autoriza por sí mismo cambios de código, migración remota ni despliegue. En ejecución, las preguntas sobre ampliar permisos o cambiar la semántica de retorno deben tratarse como cambio de alcance y volver al usuario.
