# Caso 1: Ventas crea una orden de Diseño Externo

## Resumen

- Sacar Ajustes avanzados del modal de detalles.
- Añadir una acción directa en la tabla de Administración que abra el nuevo modal “Configuración avanzada”.
- Reutilizar los flujos actuales de pago, Producción, auditoría, Realtime y notificaciones.
- No crear tablas nuevas; ampliar los RPC y componentes existentes.

## Implementación

### Modal avanzado

- Para una orden externa en Ventas mostrar únicamente “Enviar a Caja”.
- Permitir asignar opcionalmente un usuario de Caja durante ese movimiento.
- Si queda sin usuario, Administración conserva la responsabilidad.
- Una vez en Caja, mostrar:
  - Asignar, cambiar o quitar usuario de Caja.
  - Regresar a Ventas, seleccionando un vendedor activo y sugiriendo al creador original.
  - Registrar pago.
  - Enviar a Producción, únicamente cuando el pago y los archivos sean válidos.
- Cada cambio exigirá categoría y detalle del motivo.
- El modal actualizará silenciosamente su orden después de cada operación.

### Reutilización

- Extraer el formulario de pago de Administración para usarlo dentro del nuevo flujo.
- Mantener las reglas actuales:
  - Pagado exige comprobante.
  - Parcial no exige imagen.
  - Crédito exige cliente vinculado y número de facturación.
- Extraer el formulario de asignación por áreas de Cotización y reutilizarlo en Administración.
- Enviar a Producción mediante el RPC administrativo existente para conservar validación y auditoría.
- El modal de detalles quedará exclusivamente informativo.

### Base de datos y notificaciones

- Ampliar `admin_intervene_order` con una acción específica para gestionar `quote_id` sin cambiar el estado.
- Validar en Postgres:
  - Administrador activo.
  - Orden externa y estado compatible.
  - Usuarios activos del departamento correcto.
  - Control de concurrencia mediante `expected_updated_at`.
  - Archivos y pago válidos antes de Producción.
- Mantener pago y facturación al regresar a Ventas; solo cambiar estado y responsables.
- Separar destinatarios funcionales de los destinatarios técnicos de Realtime:
  - Enviar a Caja: vendedor/creador y Caja asignada.
  - Cambiar Caja: usuario anterior y nuevo.
  - Regresar a Ventas: Caja retirada, vendedor anterior afectado y vendedor receptor.
- Registrar un único evento y notificación por usuario afectado, evitando duplicados.
- Añadir `admin_intervention` al reconocimiento de notificaciones.
- Eliminar “Revisar luego” y el cierre exterior: el modal informativo desaparecerá únicamente al pulsar “Entendido”.
- Mantener Broadcast privado y la recarga silenciosa de órdenes existente.

## Casos límite

- Si el vendedor original está inactivo, exigir otro vendedor activo.
- Si no existen usuarios de Caja, permitir dejar la orden sin asignación.
- No registrar cambios cuando se seleccione nuevamente el mismo responsable.
- Si la orden cambia concurrentemente, refrescarla y solicitar repetir la acción.
- Ocultar acciones incompatibles en lugar de mostrarlas deshabilitadas.
- Una orden sin archivos válidos no podrá entrar a Caja ni Producción.

## Pruebas

- Matriz del modal para orden externa en Ventas y en Caja.
- Envío a Caja con usuario y sin usuario.
- Asignación, cambio y eliminación de Caja.
- Regreso al vendedor original y a otro vendedor.
- Pago completo, parcial y crédito, incluyendo errores de validación.
- Reutilización del modal de Producción y asignación por todas las áreas participantes.
- Destinatarios exactos y ausencia de notificaciones duplicadas.
- Persistencia hasta “Entendido” y marcado conjunto de revisión/notificación.
- E2E con sesiones Admin, Ventas y Caja, incluyendo Realtime y reconexión.
- Suite completa, ESLint, build y QA visual en escritorio y móvil.

## Supuestos

- “Enviar a Caja” permite asignación opcional, según la decisión tomada.
- Las notificaciones administrativas son bloqueantes hasta “Entendido”.
- Este primer caso cubre exclusivamente órdenes de Diseño Externo creadas por Ventas.
- Despliegue: migración compatible primero, frontend después.
