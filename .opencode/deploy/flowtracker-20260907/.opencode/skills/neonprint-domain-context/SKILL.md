---
name: neonprint-domain-context
description: Reglas de negocio, seguridad y contratos de datos de NeonPrint. Usar antes de planificar, implementar, probar o revisar cambios funcionales.
---

# Contexto de dominio de NeonPrint

Antes de actuar sobre una tarea de este proyecto, lee por completo:

`./.opencode/context/neonprint-business-context.md`

Después, abre la fuente canónica indicada allí para el área que cambiará. El
contexto reduce errores de dominio, pero el código y las migraciones actuales
prevalecen si existe una diferencia.

## Reglas de uso

1. Identifica si la tarea afecta UI, flujo de órdenes, pagos, KPI, permisos, API,
   RLS, Storage o migraciones.
2. Enumera los invariantes relevantes antes de proponer o editar código.
3. Para KPI, declara qué significa cada métrica y de dónde proviene antes de
   cambiar un tooltip, tarjeta, gráfica o filtro.
4. Para datos sensibles, privilegios o borrado, detente si el requisito no dice
   expresamente qué permisos, datos o entorno puede afectar.
5. No inventes transiciones de órdenes, estados de pago, métricas ni roles.

