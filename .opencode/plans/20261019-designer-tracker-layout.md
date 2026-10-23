# Plan — Designer tracker layout

**Plan ID:** `20261019-designer-tracker-layout`  
**Original user request:** En el modal de detalle de Diseño, mostrar primero el flow tracker, quitar «Seguimiento de la orden» y su icono, y usar el contenedor interno que contiene las etapas como contenedor visual principal, quitando la tarjeta exterior redundante y dejando una separación clara con el contenido siguiente.  
**Baseline commit:** `2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb` (`HEAD` revalidado por Planner).  
**Run:** `.opencode/runs/20261019-designer-tracker-layout/`.

## Análisis y decisión

El modal de Diseño está implementado en `src/pages/page-designer.jsx`. Actualmente las cuatro tarjetas de resumen aparecen antes del tracker. El tracker se envuelve en `.designer-order-modal__flow-section`, que tiene borde, fondo, radio y padding; dentro, `.designer-order-modal__flow` contiene el `FlowTracker`, mantiene scroll horizontal y foco de teclado, pero no tiene la superficie visual solicitada. El encabezado del bloque de tracker comparte una regla CSS con el encabezado del link, por lo que debe separarse para preservar el link.

Se reordenará la sección de tracker para que preceda al resumen, se retirará únicamente su título/icono, se conservará un wrapper semántico simple y el contenedor de etapas recibirá la superficie visual. Carga/error seguirán accesibles y tendrán su propia presentación interna para evitar un wrapper visual vacío. Los estados, rutas, autorización, link e historial no cambian.

## Archivos permitidos

- `src/pages/page-designer.jsx`
- `src/css-components/page-designer.css`
- Un test específico del layout en `src/__tests__/` (usar `designer-order-preview.test.jsx` si permite probarlo sin acoplamiento, o crear `designer-tracker-layout.test.jsx`).
- Evidencia del run en `.opencode/runs/20261019-designer-tracker-layout/`.

## Archivos fuera de alcance

No modificar estados/transiciones, `FlowTracker.jsx`, history/link, autenticación, RPC, migraciones, Sales modal, CDC/CI/CD, otras pruebas no relacionadas, configuración, despliegue, datos remotos, commit ni push. El worktree contiene numerosos cambios concurrentes anteriores; preservar sus hunks íntegramente.

## Implementación

1. Dentro del cuerpo del modal, poner `.designer-order-modal__flow-section` antes de `.designer-order-modal__summary`.
2. Quitar el heading «Seguimiento de la orden» y `Icons.Clock`, manteniendo `section[aria-label="Progreso de la orden"]`, roles de carga/error, etiquetas y `FlowTracker`.
3. Eliminar el borde/fondo/padding del wrapper exterior. Estilizar `.designer-order-modal__flow` como la única tarjeta visual de etapas; alinear gutters con el resumen y dejar margen inferior consistente.
4. Mantener `overflow-x: auto`, ancho de tira/pasos y `:focus-visible`. Asegurar que el scroll se limite al tracker en viewport estrecho.
5. Presentar el mensaje de carga/error con superficie interna equivalente, conservando su `role="status"`/`role="alert"`.
6. Separar selectores CSS del tracker y del link, sin cambiar apariencia ni contenido del link de seguimiento.
7. Agregar prueba focalizada para orden de DOM, ausencia del heading, wrapper/etapas y preservación del resumen/link; cubrir carga/error si fixture existente lo permite.

## Criterios de aceptación

- El tracker precede a las tarjetas de resumen en el cuerpo del modal.
- El texto «Seguimiento de la orden» y el icono de reloj no se muestran.
- La tira interna que contiene las etapas es la única superficie visual del tracker; el wrapper semántico no crea una tarjeta anidada.
- El contenido de carga/error sigue visible y accesible sin tarjeta externa vacía.
- Hay separación consistente entre tracker y resumen.
- Scroll horizontal, foco visible y comportamiento de etapas quedan intactos.
- El encabezado y visual del link siguen iguales; no cambia ruta, estado, permisos, historial ni acciones del diseñador.
- No se alteran hunks concurrentes ajenos a la solicitud.

## Verificación y especialistas

- Tester: prueba focalizada y pruebas cercanas al modal/tracker; lint, security:check, build y suite completa conforme al workflow del proyecto.
- Visual QA requerido: inspección estática/renderizada del modal en escritorio y ancho estrecho, jerarquía, contenedor único, separación, scroll y foco.
- Security Auditor no aplica: el alcance no modifica auth, permisos, API, SQL, Storage, pagos, tracking ni operaciones destructivas.
- Playwright no requerido; no iniciar aplicación salvo nueva instrucción explícita.
- Food Taster debe correr independientemente `security:check`, lint, suite completa y build después de Tester y especialistas. Si falla o falta una comprobación, detener el flujo antes de Reviewer.
- Reviewer comparará solicitud, plan, evidencia, estado inicial y diff final. Sin despliegue, migración remota, commit ni push.

## Riesgos

- El JSX y CSS están sucios por cambios previos de otras tareas; cambios localizados solamente.
- Los estilos de heading tracker/link están acoplados y deben desacoplarse cuidadosamente.
- El ancho mínimo de las etapas requiere mantener scroll interno en móvil.
- Al no mostrar el tracker mientras se determina el origen de la orden, el estado neutral debe seguir siendo legible y anunciado.

**STATUS: DRAFT** — pendiente de revisión independiente del Plan Reviewer. No autoriza implementación por sí mismo.
