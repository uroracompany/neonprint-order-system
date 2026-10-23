# Plan — Preview de referencias pendientes en Diseño

- Plan ID: 20261018-232546-designer-reference-image-preview
- Original user request: "Escúchame, mira el apartado diseñador en el formulario de detalles de diseñador. En esta parte donde se muestra básicamente la imagen, si ha agregado una imagen, ahí dice imagen pendiente. Entonces la realidad es la siguiente: cuando tú se agregues una imagen, debería mostrarse una preview de la imagen de referencia que tú agregaste. Un ejemplo, como en el formulario de creación de órdenes de venta. Entonces analiza eso, analiza la estructura, cómo funciona y arréglalo."
- Baseline commit: 2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb
- STATUS: DRAFT
- PLAYWRIGHT: NOT REQUIRED
- Revision: 1 — removed per-file pending-image removal after Plan Reviewer identified it as unnecessary scope expansion. Preserve existing Cancelar/Guardar behavior.

## Resumen y alcance
Mostrar, antes de guardar, una miniatura y el nombre de cada archivo de referencia pendiente en el modal de detalles de Diseño, siguiendo el patrón visual del formulario de creación de órdenes. Mantener el conteo y las acciones existentes Guardar/Cancelar. Limitar cambios al render/CSS de pendientes y pruebas focalizadas; no cambiar la creación de órdenes, carga, RPC, compresión, permisos, referencias ya guardadas ni trabajo CDC.

## Implementación
- En `OrderDetailModal` (`src/pages/page-designer.jsx`), derivar URLs de preview con `URL.createObjectURL` en un efecto ligado a `pendingReferenceFiles`; mantener un mapeo por identidad estable de archivo y revocar todas las URLs del ciclo anterior al cambiar la lista y al desmontar. No crear URLs durante render.
- Renderizar cada pendiente en una cuadrícula bajo el contador, usando la estructura/clases de tarjeta y miniatura de referencias existentes; mostrar `file.name` como nombre y `alt` descriptivo. Preservar sin cambios Cancelar (descarta todos los pendientes) y Guardar (sube/persiste los pendientes según el flujo actual); no agregar una acción de quitar por archivo.
- Extender únicamente el CSS local en `src/css-components/page-designer.css` para que tarjetas pendientes y nombres truncados se adapten a móvil. Reusar `.pd-reference-grid` y `.pd-reference-thumb` cuando sea apropiado; no tocar `CreateOrderModal.jsx`.
- Extender `src/__tests__/designer-reference-images.test.jsx`: verificar miniatura/src local y nombre por archivo; Cancelar elimina todas las previews y no invoca RPC; verificar revocación de URLs al cancelar, tras el guardado exitoso y al desmontar. Preservar acumulación/deduplicación, capacidad restante, persistencia existente y flujo de guardado. No añadir pruebas ni comportamiento de eliminación por archivo.

## Criterios de aceptación y verificación
- Cada imagen aceptada muestra miniatura y nombre antes de guardarse; alt permite identificarla con tecnología asistiva.
- Cancelar continúa limpiando todos los pendientes; guardar conserva contrato, límite global de tres y comportamiento existente. Las URLs creadas para preview se revocan al limpiar/cambiar pendientes y al desmontar.
- Ejecutar pruebas focalizadas de referencias de diseñador, lint, security check y build según el flujo del proyecto; realizar Visual QA obligatorio del cambio renderizado. Food Taster y Reviewer deben completar sus etapas. Sin Playwright salvo nueva solicitud expresa.

## Archivos permitidos
- `src/pages/page-designer.jsx`
- `src/css-components/page-designer.css`
- `src/__tests__/designer-reference-images.test.jsx`
- `.opencode/runs/20261018-232546-designer-reference-image-preview/**`
- `.opencode/plans/20261018-232546-designer-reference-image-preview.md`

## Riesgos y salvaguardas
- No reutilizar las URLs de `CreateOrderModal`, que se crean directamente durante render y no tienen ciclo visible de liberación; gestionar URLs locales del modal de diseñador con limpieza del efecto.
- Los archivos permitidos para código/pruebas ya están modificados por trabajo previo. Inspeccionar el diff inmediatamente antes de editar y conservar intactos sus hunks existentes; integrar cambios solo en el bloque de pendientes y sus pruebas.
- No cambia contrato de Storage ni hay migración. Si no puede mantenerse el alcance dentro de archivos permitidos por el estado concurrente, detener y reportar la interferencia.
- Revisión Visual QA: REQUIRED. Revisión security: no especialista requerido (cambio UI local sin modificar auth, permisos, API, SQL o Storage).
