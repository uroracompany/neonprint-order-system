export const ADMIN_PASSWORD_MIN_LENGTH = 13;

export function getAdminPasswordPolicyError(password) {
  const value = String(password || "");

  if (value.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return "La contrasena debe tener mas de 12 caracteres.";
  }

  return null;
}

export function validateEmployeeForm(form = {}, mode = "create") {
  const isEdit = mode === "edit";
  const name = String(form.name || "").trim();
  const email = String(form.email || "").trim();
  const role = String(form.role || "").trim();
  const password = String(form.password || "");
  const confirmPassword = String(form.confirmPassword || "");
  const credentialsTouched = Boolean(password || confirmPassword);
  const passwordPolicyError = password ? getAdminPasswordPolicyError(password) : null;
  const passwordError = !isEdit && !password
    ? "La contrasena es obligatoria."
    : passwordPolicyError;
  const passwordsMatch = password === confirmPassword;
  const credentialsValid = isEdit
    ? (!credentialsTouched || (!passwordError && passwordsMatch))
    : Boolean(password) && !passwordError && passwordsMatch;

  return {
    hasRequiredIdentity: Boolean(name && email && role),
    credentialsValid,
    isValid: Boolean(name && email && role && credentialsValid),
    passwordError,
    passwordsMatch,
  };
}

export function getEmployeeFormValidationMessage(form = {}, mode = "create") {
  const validation = validateEmployeeForm(form, mode);

  if (!validation.hasRequiredIdentity) {
    return "Completa nombre, correo y rol.";
  }

  if (validation.passwordError) {
    return validation.passwordError;
  }

  if (!validation.passwordsMatch) {
    return "Las contraseñas no coinciden.";
  }

  return null;
}
