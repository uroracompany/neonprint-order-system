import { PAYMENT_STATUS } from "./constants";

export const getPaymentConfirmButtonLabel = (paymentStatus, isSaving = false) => {
  if (isSaving) return "Confirmando...";
  if (paymentStatus === PAYMENT_STATUS.PARTIAL) return "Confirmar pago parcial";
  return "Confirmar pago";
};
