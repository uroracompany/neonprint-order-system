# PLAN ID: 20260829-designer-saved-files-margin

Original user request: Hola quiero que me ayude una mini implementacion para provar en el apartado de diseñador en el modal de detalles de orden en diseño aparece un texto que dice Archivos guardados (1 que dice la canidad de archivos guardado en la orde y abajo aparecen los contendo archivos quiero que a este texto le agregues un margin para que esta mas para abajo y no este tan pegado del input de arrbia solo haz el plan para este mini cambios para ver tu capacidad

Baseline commit: `c3c9bac57bc357ffd15e3ce4c13baa8fbe8f622a`

Affected files:
- `src/pages/page-designer.jsx` (file:///C:/Users/Usuario/Desktop/PROJECTS_GLOBAL/URORA_COMPANY/PROYECTOS_DE_CLIENTES/neonprint-order-system/src/pages/page-designer.jsx)

Acceptance criteria:
1. The label "Archivos guardados" and its container must have a 16px margin-top separation from the file upload input zone or readonly message when there are no pending files.
2. The spacing between pending files list and saved files list should be 12px when both lists are present.
3. No compile or runtime errors are introduced.

Risks:
- Negligible risk. CSS layout changes are isolated to this designer container and do not impact functionality.

Required specialist checks:
- Visual QA (manual verification of layout spacing).

STATUS: DRAFT
