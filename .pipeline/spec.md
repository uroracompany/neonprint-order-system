# Spec: Extraer PaymentFormModal + Rediseño Visual AdminAdvancedOrderModal

## Objetivo

Extraer el formulario de pago actualmente inline en `dashboard.jsx` a un componente reutilizable `PaymentFormModal`, integrarlo en `AdminAdvancedOrderModal` (que hoy delega al dashboard), y rediseñar visualmente el modal de Configuración Avanzada para que sea más profesional y coherente con el design system existente.

## Archivos a crear

### 1. `src/components/ui/PaymentFormModal.jsx`

Componente autónomo de pago con las siguientes características:

**Props:**
- `open` (boolean) — controla visibilidad
- `order` (object) — `{ id, client_name, description, payment_status, invoice_number, client_id, invoice_payment }`
- `loading` (boolean) — estado de guardado externo
- `onClose` (function) — cierra el modal
- `onConfirm` (async function `({ paymentStatus, receiptFile })`) — ejecuta la lógica de pago; debe lanzar error si falla

**Estado interno:**
- `paymentStatus` — enum: Pending_Payment | parcial | pagado | credito
- `receiptFile` — File | null (para pagado)
- `receiptPreviewUrl` — derived de `URL.createObjectURL(receiptFile)` con cleanup
- `existingReceiptUrl` — signed URL desde `order.invoice_payment`
- `receiptZoneError` / `receiptZoneErrorKey` — errores de FileUploadZone
- `receiptPreviewAvailable` — controla preview de HEIC/HEIF

**Validaciones inline (antes de onConfirm):**
- `pagado`: requiere receiptFile nuevo o `order.invoice_payment` existente
- `credito`: requiere `order.invoice_number` y `order.client_id`
- `parcial`: no requiere comprobante

**UI:**
- Header: "Registro de pago" con descripción breve de la orden
- Badge del estado actual de pago (solo lectura)
- Selector de estado de pago (Pendiente → Parcial → Crédito → Pagado)
- Si `credito`: muestra número de facturación
- Si `pagado`: FileUploadZone + preview del receipt + botones cambiar/eliminar
- Si ya existe `invoice_payment` y no se seleccionó archivo nuevo: muestra preview del receipt existente
- Botón cancelar + botón confirmar con label dinámico (`getPaymentConfirmButtonLabel`)
- Animación de entrada consistente con el sistema

### 2. `src/components/ui/PaymentFormModal.css`

Estilos del modal, usando variables CSS del sistema (`--surface`, `--border`, `--text`, `--cyan`, `--radius-md`, etc.).

---

## Archivos a modificar

### 3. `src/pages/dashboard.jsx`

**Eliminar:**
- 10 estados `quotation*`: `quotationModalOpen`, `quotationOrder`, `quotationPaymentStatus`, `quotationInvoice`, `quotationExistingReceiptUrl`, `quotationReceiptInputRef`, `quotationLoading`, `quotationReceiptPreviewAvailable`, `quotationReceiptZoneError`, `quotationReceiptZoneErrorKey`
- `quotationConfirmButtonLabel` (línea 3432)
- `quotationReceiptPreviewUrl` (línea 1597)
- useEffect de signed URL (línea 1580)
- `handleQuotationOrder`, `handleQuotationReceiptAccepted`, `handleQuotationRemoveReceipt`
- `showQuotationReceiptZoneError`

**Conservar:**
- `openQuotationModal` -> mantener simplificada, que solo setea el order
- `handleQuotationOrder` -> convertir en `handlePaymentConfirm` que llama al RPC + upload

**Reemplazar:**
- ModalShell inline (4479-4673) por `<PaymentFormModal>`
- Importar `PaymentFormModal`

### 4. `src/components/orders/AdminAdvancedOrderModal.jsx`

**Cambios:**
- Importar `PaymentFormModal`
- Añadir estado `paymentOrder` y `paymentLoading`
- En `beginAction`, cuando `key === "register_payment"`, setear `paymentOrder` en vez de llamar `onOpenPayment`
- Renderizar `<PaymentFormModal>` dentro del modal
- Eliminar prop `onOpenPayment` (ya no se necesita)
- Añadir `handlePaymentInAdvanced` que sube receipt, llama a `admin_manage_external_order` con `register_payment`, y refresca la orden

### 5. `src/components/orders/AdminAdvancedOrderModal.css`

**Reescritura completa del CSS usando variables del sistema:**

- Migrar todos los colores a `var(--...)` desde `page-admin.css`
- Añadir `::before` gradient bar como el `.pa-modal`
- Summary en 2×2 grid en desktop, 1 col en mobile, sin bordes verticales
- Action cards: border-radius 12px, hover más pronunciado (translateY(-2px) + shadow), active scale(0.98)
- Icon containers: 44×44, border-radius 12px, fondos con opacidad de colores del sistema
- Focus-visible consistente en todos los elementos
- Animación `scaleIn` de entrada
- Loading state con skeleton cards animados (pulse)
- Footer con `box-shadow: 0 -4px 12px rgba(15,30,64,0.04)` para separación
- Form grid más balanceado
- CSS expandido a multi-línea para mantenibilidad

---

## Lo que NO cambia

- Dashboard mantiene su botón de icono de dinero que abre PaymentFormModal
- No se elimina funcionalidad existente
- No se requieren migraciones de base de datos
- No se modifican RPCs

## Pruebas necesarias

1. PaymentFormModal renderiza correctamente en dashboard
2. PaymentFormModal renderiza correctamente desde AdminAdvancedOrderModal
3. Validación de pago (pagado requiere receipt, crédito requiere invoice_number + client_id)
4. Receipt upload y preview funcionan
5. Estados de carga y error se muestran correctamente
6. El modal avanzado mantiene todas sus acciones existentes
