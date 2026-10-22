# Plan técnico — Caja como autoridad de pagos y continuidad SemiAdmin a Producción

- **Plan ID:** `semi-admin-caja-payment-ownership-20260928`
- **Task ID:** `20260928-091156-semi-admin-payment-ownership-plan`
- **Solicitud original:** Analizar y corregir el flujo para que únicamente Caja gestione pagos; asegurar que Caja pueda devolver órdenes de SemiAdmin al responsable correcto y que el SemiAdmin que opera como Ventas/Diseño pueda enviar su orden autorizada a Producción desde registros y detalle.
- **Baseline:** `39f2b151c86b952b255d6e3c60331a53180cf8e9` (rama `main`). El worktree ya estaba dirty al iniciar; ver `.opencode/runs/20260928-091156-semi-admin-payment-ownership-plan/manifest.md`. Ninguno de esos cambios locales se considera desplegado.
- **STATUS: DRAFT**

## 1. Objetivo y límites

Hacer que la autoridad financiera de una orden sea exclusiva de Caja (`profiles.role='quote'`) y no dependa de que el SemiAdmin haya creado, vendido o diseñado la orden. Separadamente, permitir que un SemiAdmin que conserva una responsabilidad comercial/creativa válida continúe a Producción después de que Caja confirme el pago y registre la autorización persistida. Reutilizar el handoff de devolución de Caja y comprobar que llega al SemiAdmin que es responsable de la etapa.

No se cambiarán estados canónicos, reglas de elegibilidad de Producción (`pagado`, `parcial`, `credito`), formulario de diseño/producción, asignaciones por área, contratos de cliente/archivo, ni otras capacidades administrativas no financieras. No se aplicará una migración remota, no se desplegará y no se escribirán datos en esta fase.

## 2. Flujo objetivo

```text
SemiAdmin crea/vende y diseña (o es vendedor de diseño externo)
        │  asigna a Caja; quote_id identifica a Caja
        ▼
Caja asignada: confirma pago / crédito / comprobante según reglas existentes
        │  confirmación persistida
        ▼
Caja asignada o Admin (solo como autoridad operativa, nunca para mutar pagos)
autoriza explícitamente la continuidad a Producción
        │  production_authorized_at/by válido
        ▼
SemiAdmin responsable por función de diseño/comercial abre asignación por áreas
        │  send_order_to_production; RPC vuelve a validar todo
        ▼
Producción
```

El evento de pago y la autorización de Producción permanecen como operaciones distintas. La confirmación de pago no autoautoriza la orden: se conserva el gate explícito `authorize_order_for_production` para evitar quitar una revisión operativa/financiera independiente.

Retorno:

```text
Caja asignada → devuelve con motivo → handoff durable al vendedor/diseñador responsable
destinatario (incluido SemiAdmin si ocupa ese campo) → corrige y responde → vuelve a Caja
```

## 3. Arquitectura propuesta

### 3.1 Fuente única de autoridad financiera

Crear en SQL un helper interno, con nombre final sujeto a convenciones y a inspección de migraciones al ejecutar, que determine si el actor autenticado es Caja activa asignada a la orden. Debe comprobar `profiles.role='quote'`, cuenta activa/no eliminada, `orders.quote_id=auth.uid()`, estado `in_Quote`, y ausencia de bloqueo/archivo cuando la mutación así lo exige. El helper no debe aceptar Admin ni inferir Caja desde `created_by`, `seller_id` o `designer_id`.

La validación se aplica en todas las vías de escritura, no solo en React:

- `quote_set_order_payment`, `mark_order_as_credit`, carga/confirmación de comprobante y cualquier variante de cierre de crédito.
- RPC de pago de SemiAdmin y su wrapper genérico `semi_admin_execute_order_command`, además de sus sobrecargas y grants.
- `admin_execute_order_command` y caminos de pago del Dashboard/Admin.
- Actualización directa de columnas financieras por comandos genéricos, rutas API/server, triggers y policies que puedan eludir los RPC especializados.
- Políticas RLS del bucket privado `payment-invoice`, rutas de subida/firma y metadatos asociados: bloquear escrituras de usuarios no Caja, restringir cada objeto a la orden autorizada y evitar que un intento denegado deje comprobantes huérfanos o vinculables a otra orden. Las URLs de lectura seguirán firmadas y sujetas al acceso actual.
- `quote_assign_invoice_code` se audita por separado: la asignación de número de factura no equivale a confirmar pago y actualmente puede seguir el `invoice_assignment_mode`. No se moverá su propiedad comercial automáticamente; si una ruta permite cambiar `payment_status`, comprobante o estado de liquidación junto con el código, esa escritura debe sujetarse a Caja.

Retirar la acción `register_payment` del catálogo y handler SemiAdmin, y ocultar/eliminar su modal, callback, subida de comprobante y estados locales en el panel SemiAdmin. La función RPC especializada no debe quedar como bypass: rechazar explícitamente, revocar el grant público previo si es una función obsoleta o rediseñarla para que solo Caja la invoque; el wrapper SemiAdmin también debe rechazar la clave financiera antes de delegar. Admin conserva lectura/supervisión y sus demás comandos, pero sus rutas de cambiar pago, aprobar crédito o confirmar comprobante quedan rechazadas por UI, handler y SQL. Diseño, Ventas, Producción y Entrega no reciben acciones financieras.

Para evitar que `quote_id` sea solo una etiqueta, Caja sin ser el cajero asignado no podrá modificar esa orden: si no hay Caja asignada, primero se usa el flujo vigente de asignación. Mantener `FOR UPDATE`, `expected_updated_at`, validación de evidencia de pago, auditoría y notificación únicamente tras persistencia exitosa.

### 3.2 Retorno Caja → responsable SemiAdmin

Reutilizar `return_quote_order_for_correction` y `return_order_to_cashier`, junto con `order_return_handoffs`, `useOrderReturnHandoffs` y la UI existente para responder. La lectura estática muestra que ya se devuelve por tipo al `seller_id/created_by` (externo) o al `designer_id` (interno), y el destinatario puede ser SemiAdmin porque la autorización se hace por `recipient_id`, no por rol `seller/designer` del perfil. Por eso, en principio, no hace falta ampliar permisos SQL ni añadir una ruta de devolución paralela.

Antes de modificar esa lógica, agregar/ajustar cobertura contractual/UI para que:

- Orden externa cuyo vendedor/creador es SemiAdmin: el handoff aparece a ese SemiAdmin en Ventas/SemiAdmin.
- Orden interna cuyo diseñador es SemiAdmin: el handoff aparece a ese SemiAdmin en Diseño/SemiAdmin.
- El destinatario solo responde su handoff; la respuesta vuelve a `source_status`, reasigna `quote_id` al cajero originador, registra nota/auditoría y notifica a Caja.
- Terceros, devoluciones duplicadas, handoff cerrado y handoff inconsistente se rechazan.

**Decisión abierta, sin ampliar silenciosamente:** la implementación actual devuelve al responsable designado (`designer_id`/`seller_id`), no necesariamente al último SemiAdmin que pulsó “Enviar a Caja”. El plan conserva esta semántica. Si el usuario requiere que siempre vuelva al último emisor aun cuando otra persona sea responsable asignada, habría que persistir/consultar el actor de esa transición y definir qué rol continúa el trabajo; ese cambio afecta también Ventas/Diseño y requiere confirmación antes de implementarse.

### 3.3 Permiso SemiAdmin para envío autorizado a Producción

Separar la responsabilidad financiera (`quote_id`) de la responsabilidad funcional que permite enviar a Producción. Definir un predicado reutilizable y coherente entre catálogo y RPC:

- **Diseño interno (`INTERNAL_DESING`):** SemiAdmin debe ser el diseñador asignado (`designer_id=actor`).
- **Diseño externo (`EXTERNAL_DESING`):** SemiAdmin debe ser el vendedor responsable o creador (`seller_id=actor` o `created_by=actor`).
- No se concede permiso por ser únicamente `quote_id`, por ser participante genérico, ni por ser dueño de una orden distinta.
- Admin conserva su control global de Producción actual, pero eso no incluye permiso para cambiar pago.
- Caja solo autoriza; nunca asigna áreas ni ejecuta el envío.

La acción solo puede ofrecerse/ejecutarse si el pedido sigue en `in_Quote`, autorización persistida presente y vigente, pago elegible, sin lock/archive/cancelación, detalles de cada archivo válidos (área/materiales/terminación activos) y asignaciones completas en el modal. `send_order_to_production` permanece como autoridad final y valida nuevamente esas condiciones bajo bloqueo y concurrencia.

Actualización conjunta requerida:

1. Ajustar `can_send_order_to_production` y wrapper SemiAdmin `semi_admin_route_order_to_production_v2` para usar el nuevo predicado funcional, manteniendo la barrera de autorización persistida y las validaciones productivas.
2. Ajustar catálogo SQL unitario y batch para emitir `route_production` solo para ese mismo predicado. Mantener mensaje de acción no disponible cuando falte autorización, pago, especificaciones o relación funcional.
3. Ajustar `server/seller-order-actions-handler.js`: autorización/fallback del catálogo, handler de comando y payload de asignaciones deben reflejar la misma matriz; ningún fallback debe agregar `route_production` a un actor que SQL rechaza.
4. Completar las superficies SemiAdmin en `src/pages/pages-seller.jsx`: acción directa contextual en fila, tarjeta y lista de recientes, con el estilo/color/ícono y patrón de llamada existentes; al hacer clic abrir el `ProductionAssignmentModal` compartido, no ejecutar un envío sin elegir responsables.
5. El modal de detalle `SemiAdminOperationalPanel` conserva la acción “Preparar envío a Producción” y abre el mismo modal compartido. Evitar duplicar el formulario de áreas.
6. Después de éxito, sincronizar listado, tarjetas, recientes, detalle y catálogo; deshabilitar doble envío y manejar `ORDER_STALE`. Fallos de persistencia no deben mostrar éxito.

El permiso de asignar áreas no altera permisos de operación de Producción ni autoriza editar/reasignar archivos activos.

## 4. Migración, seguridad y despliegue (para una futura ejecución)

Crear una única migración forward-only y coordinada con frontend/handler. En la etapa de ejecución se deben abrir las definiciones vigentes completas de cada función y crear reemplazos explícitos; no usar `pg_get_functiondef` más reemplazos frágiles de texto. Revisar todas las overloads y grants efectivos antes de revocar.

La migración deberá:

- Instalar helper de Caja asignada y helper de relación funcional SemiAdmin/Producción con `search_path` fijo y permisos mínimos.
- Endurecer RPCs financieras y comandos admin/SemiAdmin para rechazar pagos de todo rol salvo Caja asignada.
- Mantener `SECURITY DEFINER` solo con comprobación explícita de actor/rol/responsable, locking y concurrencia. Hacer `REVOKE` de `public`/`anon`, `GRANT` solo a `authenticated` para RPCs que requieren sesión; una concesión a `authenticated` nunca reemplaza la validación de rol dentro de la función.
- Cambiar autorización de `can_send_order_to_production`/`send_order_to_production` de forma que SemiAdmin válido pase por responsabilidad funcional y no por `quote_id`; mantener productor, área, archivo y pago checks.
- Actualizar catálogos unitarios/batch si el contrato SQL así lo requiere. `NOTIFY pgrst, 'reload schema'` al final.
- Conservar auditoría financiera, de autorización, routing, handoffs y notificaciones existentes; no borrar historial ni reescribir datos.

Desplegar migración y frontend como un cambio coordinado, con la base de datos rechazando de manera segura clientes antiguos que aún muestren acciones retiradas. Verificar funciones y grants remotos después de aplicar solo cuando el usuario autorice explícitamente la aplicación; la presencia del archivo local no prueba que el remoto la haya aplicado. No aplicar ni desplegar en esta tarea.

## 5. Archivos/superficies previstos

Los paths son un mapa preliminar; durante ejecución deben validarse contra el worktree actual y no apropiarse de cambios preexistentes fuera del diff de esta tarea.

- UI SemiAdmin/Ventas: `src/components/orders/SemiAdminOperationalPanel.jsx`, `src/pages/pages-seller.jsx`, probablemente estilos locales si la acción directa necesita una variante; conservar `src/components/orders/ProductionAssignmentModal.jsx` como modal compartido.
- Backend/API: `server/seller-order-actions-handler.js` y contrato/ruta bajo `api/` solo si el inspeccionado handler requiere cambio adicional.
- UI de Caja/Admin: `src/pages/page-quote.jsx`, `src/pages/dashboard.jsx`, `src/components/orders/AdminAdvancedSettings.jsx` y `PaymentFormModal`/handlers compartidos para retirar mutación de quienes no sean Caja, manteniendo lectura y acciones de autorización independientes.
- Base: una migración nueva en `supabase/migrations/`, basada en las definiciones vigentes de pagos, autorización, comandos genéricos, producción y handoffs.
- Pruebas: tests de payment lifecycle, SemiAdmin role/catalog/batch, seller order actions, producción y return handoff; añadir pruebas solo en ubicaciones contractuales existentes.
- Evidencia: `.opencode/runs/20260928-091156-semi-admin-payment-ownership-plan/` y plan durable al aprobar la revisión. No se modificará código en fase plan-only.

## 6. Interfaces/contratos

- Se mantienen firmas públicas de las RPC existentes cuando sea viable (`quote_set_order_payment`, `send_order_to_production`, retorno y comandos actuales), endureciendo autorización internamente. Las firmas exactas se confirman antes de escribir migración.
- Caja debe pasar el `expected_updated_at` actual y ser el `quote_id` asignado.
- Catálogo SemiAdmin emitirá `route_production` con metadatos de acción existentes, y handler/UI enviarán `area_assignments` al wrapper actual.
- `order_return_handoffs` conserva el contrato de destinatario por ID y los roles semánticos actuales `seller|designer`.
- No crear un estado artificial ni autoestablecer autorización al confirmar pago.

## 7. Casos límite y tratamiento

- Caja activa pero no asignada: no puede cambiar pago; asignar primero a Caja responsable.
- SemiAdmin es creador pero un diseñador humano diferente está asignado a una orden interna: no podrá enviar por defecto; validar en ejecución que `designer_id` es la responsabilidad funcional. Si el negocio quiere “creador interno también”, es una decisión que amplía el permiso y no debe asumirse.
- SemiAdmin aparece solo como `quote_id`: no recibe controles de pago ni Producción por esa relación.
- Pago autorizado anteriormente pero luego invalidado/corregido: trigger/predicado invalida autorización y oculta/rechaza envío.
- Archivo sin área/materiales/terminación o área inactiva: acción de ruta no ejecutable; modal no debe sustituir validación del servidor.
- Dos sesiones/clics concurrentes o `updated_at` obsoleto: `ORDER_STALE`/conflicto, refrescar contexto y no duplicar asignaciones/eventos.
- Handoff interno sin `designer_id` o externo sin `seller_id/created_by`: rechazar de manera clara y auditada; no dirigir a un destinatario inferido sin evidencia.
- Admin: mantener lectura y capacidades no financieras; la vía genérica legacy no puede permitir cambiar indirectamente columnas de pago.
- Número de factura asignado por Ventas: conservar el modelo de propiedad configurado salvo que la auditoría confirme una mutación combinada de estado financiero; solo la confirmación/registro de pago queda inequívocamente Caja-only.

## 8. Aceptación

1. Caja asignada confirma pago, comprobante, crédito/settlement de acuerdo con las reglas actuales; Caja no asignada no puede hacerlo.
2. SemiAdmin, Admin, seller, designer, printer y delivery no pueden escribir estado de pago, comprobante o crédito desde UI, handler, RPC directa, wrapper o actualización genérica de orden. Admin mantiene lectura/supervisión y operaciones no financieras.
3. UI y catálogos de SemiAdmin no presentan `Gestionar pago`; sus endpoints tampoco enrutan `register_payment`.
4. La asignación de código de factura sigue explícitamente el modo ya configurado y no puede confirmar pago indirectamente.
5. Caja puede devolver una orden externa cuyo responsable sea SemiAdmin y una interna cuyo diseñador sea SemiAdmin; el destinatario correcto ve el handoff y devuelve la corrección a Caja, con motivo, auditoría y concurrencia.
6. SemiAdmin diseñador responsable de orden interna y SemiAdmin responsable/creador de orden externa ven `Enviar a Producción` tras autorización explícita válida, en tabla, tarjeta, recientes y modal de detalle, y el clic abre asignación de áreas.
7. SemiAdmin no autorizado, Caja, SemiAdmin relacionado solo por `quote_id`, estados no elegibles, orden no autorizada/bloqueada/archivada/cancelada, archivos incompletos y `updated_at` obsoleto no consiguen enviar; backend rechaza llamadas directas.
8. Tras routing, todas las superficies muestran `in_Production`, desaparecen acciones previas y se registran evento/notificación/asignaciones una sola vez.
9. Sin regresiones de Ventas, Diseño, Caja, Admin, Producción, Entrega, pagos parciales/crédito, handoffs, permisos/RLS y carga de detalles.

## 9. Pruebas y revisiones requeridas

### Pruebas funcionales

- Matriz de pagos por rol (positivos solo para Caja asignada; negativos para todos los demás) contra RPC directa, wrapper, handler y UI.
- Variantes de `mark_order_as_credit`, comprobante, liquidación, reintento/idempotencia, asignación de factura y comandos genéricos.
- Catálogo y tabla/card/recent/detail en órdenes internas y externas; verificaciones de diseño/tipo, relación, autorización, pago, archivo, bloqueo, concurrencia y doble click.
- Handoff externo e interno a SemiAdmin; usuario ajeno, repetido, respondido, vencido/inconsistente, falta de responsable; nota/auditoría/notificación.
- Invariancia: el pago solo cambia estado financiero, no envía a Producción; autorización y envío requieren operaciones separadas.
- Casos de crédito/parcial siguen siendo elegibles para la autorización y routing si así lo permiten los checks actuales.

### Suites indicativas

```text
npx vitest run src/__tests__/payment-lifecycle-contract.test.js
npx vitest run src/__tests__/quote-production-flow.test.js src/__tests__/production-routing-separation-contract.test.js
npx vitest run src/__tests__/semi-admin-role-contract.test.js src/__tests__/semi-admin-batch-catalog-contract.test.js
npx vitest run src/__tests__/seller-order-actions-handler.test.js src/__tests__/order-return-handoff.test.jsx
npm run lint
npm run security:check
npm run build
```

Los nombres exactos y las suites de Dashboard/Admin se verificarán al ejecutar porque este worktree ya trae pruebas y cambios locales. Añadir tests puntuales de regresión en los archivos existentes.

### Especialistas obligatorios al ejecutar

- **Security Auditor:** revisar SQL/RPC/roles/grants/RLS, endpoints directos, columnas y comandos genéricos de pago, concurrency/idempotency y autorización productiva.
- **Visual QA:** revisar modal y acción directa de SemiAdmin y que Caja/Admin no muestren controles de pago; Playwright solo si el usuario solicita explícitamente ejecutar/revisar en navegador según AGENTS.
- **Reviewer independiente:** comparar solicitud, plan, migración, diff y evidencias; veredicto `SHIP`, `NEEDS WORK` o `BLOCK`.

## 10. Riesgos y mitigaciones

- **Riesgo alto — bypass residual financiero:** puede permanecer una overload o comando genérico con `SECURITY DEFINER`. Mitigar inventariando firmas, triggers, policies, RPC grants y comandos legacy antes de cerrar la migración; probar invocación directa por rol.
- **Riesgo alto — UX comunica una acción que backend deniega:** catálogo batch, fallback y tablas pueden divergir. Usar un único predicado SQL para permiso y tests de paridad en todas las superficies.
- **Riesgo alto — autoridad Admin y Caja mezclada:** separar pago de autorización de Producción y de otras intervenciones administrativas. Admin no modifica pagos, pero su autorización operativa existente se conserva salvo cambio explícito.
- **Riesgo medio — retorno al responsable distinto del último emisor:** mantener semántica vigente y probar al responsable SemiAdmin. No ampliar a último emisor sin confirmación por impacto entre roles.
- **Riesgo medio — despliegue coordinado:** migración endurecida mientras hay clientes antiguos puede ocultar el control visualmente tarde; DB falla segura. Publicar frontend pronto después de la migración y verificar telemetría/errores sin ejecutar migración en esta fase.
- **Riesgo medio — dirty worktree:** archivos de las rutas previstas ya tienen cambios locales. Implementación futura debe revalidar estado, aislar exclusivamente el diff nuevo y no sobrescribir ni atribuir al plan dichos cambios.

## 11. Decisiones explícitas / preguntas abiertas

1. **Pago-only Caja:** se interpreta literalmente que Admin tampoco cambia pago. Admin conserva consulta y acciones administrativas no financieras.
2. **Diseño interno SemiAdmin:** predeterminado `designer_id=actor`; un creador que no sea diseñador asignado no puede enviar. Confirmar si se quiere ampliar a cualquier creador interno.
3. **Devolución:** se conserva el destinatario responsable actual (diseñador interno / vendedor-creador externo), no “último emisor”. Confirmar si negocio requiere el último emisor, lo que implicaría guardar/consultar actor histórico.
4. **Autorización:** pago pagado y autorización siguen siendo pasos separados; no autoautorizar en la confirmación de pago.
5. **Código de factura:** mantener `invoice_assignment_mode` actual; esta asignación no otorga permiso para confirmar pago.

Estos son los defaults de alcance para una futura ejecución: se privilegia la responsabilidad asignada y el mínimo permiso, sin ampliar la semántica de handoff ni mezclar autorización productiva con pago. Si el usuario pide cambiar cualquiera de ellos, se revisará el plan antes de modificar código.
