# Plan 20260901-credit-governance-simplification

**STATUS: DRAFT**  
**Baseline:** `4fcf51f9b6526b0efa424455941d349484dd1980`  
**Solicitud:** simplificar y robustecer Gestión de Créditos sin manejar dinero; registrar cliente, órdenes pendientes y cantidad.

## Objetivo

Transformar la gestión de créditos en un seguimiento operativo por orden: una orden de crédito queda abierta, resuelta o anulada. Cliente y cantidad pendiente se derivan de esas órdenes; no existen saldos, importes ni pagos parciales internos.

## Archivos/rutas previsibles

- Migración nueva de Supabase para normalización, restricciones, transiciones y retención.
- `src/pages/page-quote.jsx`, `src/pages/dashboard.jsx`, componentes de detalle/cierre y recordatorios.
- Pruebas de contratos de crédito, ciclo de vida de órdenes y RLS/seguridad de las RPC.

## Contrato lógico propuesto

- Una obligación única por orden.
- Estados: `open`, `resolved`, `void`.
- Conceder: solo orden elegible, cliente y factura; abre obligación atómica.
- Resolver: solo obligaciones abiertas de un cliente por comando; registra actor, hora y nota.
- Cancelar: anula obligación; reabrir no la restaura automáticamente.
- Editar cliente/factura: bloqueado con obligación abierta.
- Retención: ninguna purga puede eliminar historia de crédito sin política explícita de conservación.
- Recordatorios: se conservan como seguimiento por cliente; sus órdenes abiertas se calculan, no se duplican como estado propio.
- Aviso global: Caja recibe cada 30 días un resumen dinámico de todos los clientes con órdenes abiertas. El intervalo se mide desde su último aviso/reconocimiento y no por mes calendario.
- Responsabilidad: Caja concede, sigue y resuelve créditos; Administración consulta, audita e interviene solo ante excepciones.

## Criterios de aceptación

- No queda ninguna ruta funcional de montos, saldo o parcial dentro de Créditos.
- La bandeja muestra correctamente cuántas órdenes abiertas tiene cada cliente.
- El recordatorio global de 30 días incluye únicamente los clientes y órdenes que continúan abiertos al momento de emitirse.
- Cierre individual, seleccionado y completo conserva evento/actor/hora y no permite mezcla de clientes.
- Cancelar/reabrir, editar y purgar no dejan una orden y su seguimiento en estados contradictorios ni eliminan historial.
- Caja opera el flujo cotidiano; Administración conserva consulta y excepciones auditadas.

## Riesgos y verificaciones obligatorias

- Inventario de datos existentes antes de migrar; rollback/migración de `partial` y columnas históricas.
- Revisión de permisos, RLS y funciones `security definer`.
- Pruebas SQL de concurrencia y de transiciones inválidas; pruebas visuales de Caja y Administración.
- Verificar la migración de recordatorios existentes al modelo por cliente, preservando notas, creador, fechas y estado atendido.
- Migrar la confirmación mensual actual a una marca de último aviso/reconocimiento por usuario, sin crear notificaciones duplicadas.
